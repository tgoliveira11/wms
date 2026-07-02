# ADR-0007: Synchronous REST + Outbox pattern for cross-service consistency

**Status:** Accepted

## Context
Approving an attendance request (owned by `attendance-service`) must (a) confirm the manager is
scoped to the location (a fact owned by `org-service`) and (b) for OFF requests, decrement the
worker's OFF-day balance (also owned/administered by `org-service`, see ADR-0013). With
database-per-service (ADR-0004), this can't be a single SQL transaction. We need a strategy that
keeps these steps consistent without introducing heavyweight distributed-transaction
infrastructure for a three-service system built in a single exercise session.

## Decision
- **Read-before-write checks** (e.g. "is this manager scoped to this location?") are synchronous
  REST calls, made *before* attendance-service commits anything — if org-service is unreachable
  or returns 403, the approval fails cleanly with no partial state.
- **The OFF-balance decrement is synchronous and atomic**, not eventual. Because "the balance must
  never go negative" (invariant #7) is a hard constraint that would be violated by concurrent
  approvals under a check-then-async-decrement scheme, attendance-service calls org-service's
  **atomic conditional-decrement** endpoint (`... SET off_balance_remaining = off_balance_remaining
  - 1 WHERE off_balance_remaining > 0`) *before* committing the approval. Zero rows affected →
  `InsufficientOffBalanceError`, approval aborts with no local write. See ADR-0013 and TDR §7 Flow A.
- **The Outbox pattern is retained only for compensation.** In the rare case that org-service has
  already decremented but the subsequent local commit in attendance-service fails, an
  `outbox_events` row (`OffBalanceRelease`) is enqueued and a background publisher restores the
  consumed day (at-least-once, idempotent per `outbox_events.id`). This is the only asynchronous
  cross-service side effect.

This keeps the balance strongly consistent on the critical path (the number a manager and worker
see immediately after approval is correct) while still avoiding a distributed transaction; the
only eventual-consistency window is the rare compensating release, which can only *increase* a
balance and therefore never violates the non-negative invariant.

## Consequences
**Positive:** no distributed transaction coordinator, no message broker to stand up for this
exercise; the balance is race-free and strongly consistent on the critical path (the atomic
`WHERE ... > 0` update serializes concurrent approvals at the row); and the one remaining async
path (compensation) has failure modes that are easy to reason about (an unpublished outbox row =
"a day owed back to a worker, known exactly"). Directly answers the "data consistency" topic the
exercise asks candidates to be ready to discuss.

**Negative:** the synchronous decrement couples approval latency to org-service availability — but
the manager-scope check in the same flow is already a synchronous org-service call, so no *new*
dependency is added. If a broker is introduced later (Kafka/SNS+SQS), the compensating outbox
rows become the natural event source (transactional outbox → CDC), the called-out upgrade path.

## Alternatives Considered
- **Asynchronous decrement via outbox (the original design in an earlier draft):** decrement the
  balance after commit by polling an outbox and calling org-service. Simpler ordering, but leaves
  a window where two concurrent approvals each read a positive balance and both commit, driving it
  negative — a direct violation of invariant #7. Rejected in favor of the synchronous atomic
  decrement above (see ADR-0013).
- **Synchronous two-phase call** (call org-service to decrement balance, then commit locally, or
  vice-versa): this is essentially what we adopted, with the refinement that the decrement is a
  single atomic conditional update (not a read-then-write) and a compensating outbox event covers
  the rare local-commit failure — giving the correctness of 2PC's intent without a coordinator.
- **Full event bus (Kafka/RabbitMQ) with choreographed Sagas:** the architecturally "complete"
  answer for a larger system, but disproportionate infrastructure for two cross-service side
  effects in a three-service exercise. Documented as the natural next step (TDR §15) if
  cross-service event volume grows (e.g. more services start needing "attendance approved"
  notifications).
