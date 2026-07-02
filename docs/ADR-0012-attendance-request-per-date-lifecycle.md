# ADR-0012: One active attendance request per worker/date, with retained history

**Status:** Accepted

## Context
The brief states: *"Only one attendance request may exist per worker per date."* Read literally,
that would mean a single physical row per `(workerId, date)` for all time. But the same brief
also requires the four request statuses `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, and
requires that a worker who cancels (or is rejected) be able to submit again for the same date.
Those two requirements are in tension: if only one row may ever exist, either resubmission is
impossible or the historical outcome (what was cancelled/rejected, by whom, when) is destroyed.

An earlier draft of the design was internally contradictory on this point: the TDR schema used a
**partial** unique index (`UNIQUE (worker_id, date) WHERE status = 'PENDING'`) — which permits
multiple terminal-state rows — while the curl playbook's `T-REQ-06` asserted the *opposite*
(that resubmission reuses the same row in place, same `id`). Both could not be true. This ADR
resolves that contradiction.

## Decision
Interpret the constraint as **"exactly one *active* (PENDING) attendance request per
`(workerId, locationId, date)`"** (scoped per location to match per-location attendance,
invariant #2), not one row for all time:

- Enforced by the partial unique index `UNIQUE (worker_id, location_id, date) WHERE status = 'PENDING'`
  (TDR §5.3). Only one row in the `PENDING` state can exist for a given worker/location/date at any moment.
- Terminal-state rows (`CANCELLED`, `REJECTED`, `APPROVED`) are **immutable history** and are
  retained. They do not participate in the partial index, so they never block a new request.
- Resubmitting for the same date after a `CANCELLED`/`REJECTED` outcome creates a **new row** with
  a **new `id`** and a fresh `PENDING` status. Rows are never mutated back out of a terminal state.
- Attempting to create a second request while a `PENDING` one already exists for that date fails
  with `CONFLICT` (invariant #3); the worker must `CANCEL` the pending one first.

## Consequences
**Positive:** preserves a full audit trail ("Tom cancelled his 2026-07-10 OFF request, then
requested it again") which is exactly the kind of history an HR tool needs; keeps the four
statuses meaningful; and the "one active request" rule is enforced by the database, not just
application code.

**Negative:** the literal one-row reading of the brief is not honored — this is a deliberate,
documented interpretation. Consumers must filter by status (or query "the latest request") rather
than assuming a single row per date. Query and UI code must be explicit about which request they
mean (almost always "the current `PENDING` one, else the latest terminal one").

## Alternatives Considered
- **Single row reused in place (UPSERT, same `id` across lifecycles):** matches the most literal
  reading and keeps the table small, but destroys history — a cancelled-then-resubmitted request
  looks identical to one that was always pending, and rejections leave no trace. Rejected: the
  audit trail is worth more than the literal reading here. (This was the model `T-REQ-06`
  originally — incorrectly — asserted; the test has been corrected to expect a new `id`.)
- **Plain `UNIQUE (worker_id, date)` (no partial predicate):** would block resubmission entirely
  after any terminal outcome. Rejected — directly contradicts the "cancel then resubmit" flow.
