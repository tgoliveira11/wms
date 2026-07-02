# ADR-0013: OFF-day balance semantics (per-location allowance vs. remaining)

**Status:** Accepted

## Context
The brief states *"Workers have an annual OFF-day balance."* It does not specify (a) whether the
balance is global to the company or scoped per location, (b) whether it distinguishes the annual
*allowance* (the grant) from the *remaining* count, or (c) exactly when and where it is
decremented. An earlier draft was contradictory: TDR §2.1(7) described the balance as *"per
Worker, global to the company,"* while the schema (§5.2) stored a single `off_balance` column on
`location_members` — i.e. **per location**, not global. The curl playbook further assumed two
distinct fields (`annualOffAllowance`, `offBalanceRemaining`) that did not exist in the GraphQL
SDL at all. This ADR fixes all three.

## Decision
- **Scope: per location.** The balance lives on `location_members`, consistent with every other
  worker attribute (job title, membership) being location-scoped in this system. A worker who
  belongs to two locations has an independent allowance at each. This aligns the balance with the
  ownership model (everything scoped at the location level) instead of introducing a
  company-global concept that nothing else in the domain uses.
- **Two fields, not one:**
  - `annual_off_allowance` — the yearly grant (default `12`), administered by `SUPER_ADMIN`.
  - `off_balance_remaining` — the current remaining count for the year; decremented on approval of
    an `OFF` request, reset to `annual_off_allowance` at the start of each calendar year.
  These surface in the GraphQL SDL as `LocationMember.annualOffAllowance` and
  `LocationMember.offBalanceRemaining`, matching the mockup's "X of Y OFF days" display.
- **Decrement is synchronous and atomic, enforced in org-service.** On approving an `OFF` request,
  attendance-service calls org-service's conditional-decrement endpoint
  (`UPDATE ... SET off_balance_remaining = off_balance_remaining - 1 WHERE off_balance_remaining > 0`
  returning whether a row was affected) *before* committing the approval. If the decrement fails
  (already `0`), the approval is rejected with `InsufficientOffBalanceError` (`INVALID_STATE`) and
  no attendance record is written. This removes the read-modify-write race that a
  check-then-async-decrement design would have. See the revised Flow A in TDR §7 and ADR-0007.
- **Reversal:** cancelling/rejecting a request that had already consumed a day (an approved OFF
  later reversed) increments `off_balance_remaining` back, bounded above by
  `annual_off_allowance`.

## Consequences
**Positive:** the balance is consistent with the location-scoped ownership model; the
allowance-vs-remaining split matches the mockups and makes "you have 3 of 12 OFF days left"
directly expressible; the atomic conditional decrement makes the "cannot go negative" invariant
(#7) race-free and testable (playbook `T-BAL-03`).

**Negative:** a multi-location worker has separate balances to reason about (accepted — it mirrors
having separate job titles per location). The synchronous decrement couples the approval latency
to org-service availability; acceptable because the manager-scope check in Flow A is already a
synchronous org-service call, so no *new* dependency is introduced.

## Alternatives Considered
- **Company-global balance (one number per worker):** simpler to display, but inconsistent with
  every other attribute being location-scoped and requires a new company-level worker record that
  the domain otherwise doesn't need. Rejected.
- **Single `off_balance` column (remaining only, no allowance):** can't express "X of Y" and makes
  the yearly reset ambiguous (reset to what?). Rejected in favor of storing the allowance
  explicitly.
- **Asynchronous decrement via outbox (original ADR-0007 design):** left a window where two
  concurrent approvals could each see a positive balance and both succeed, driving it negative.
  Replaced by the synchronous atomic decrement above; the outbox is retained only for the
  non-critical compensating "release balance" event on the rare local-commit failure.
