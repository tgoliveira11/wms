# ADR-0011: Semantics of location feature flags

**Status:** Accepted

## Context
The domain defines two Location feature flags — `selfCheckInEnabled` and
`managerAttendanceMarkingEnabled` — and states they "should influence system behaviour," without
fully specifying every interaction. A concrete, testable semantics is needed so both the domain
tests (TDR §11) and the guards (ADR-0006) have an unambiguous contract.

## Decision
- **`managerAttendanceMarkingEnabled = false`** → the `markAttendance` mutation is rejected
  (`INVALID_STATE`) for that location, for all roles including `SUPER_ADMIN`'s
  location-management context (Super Admin can still change the flag itself, just not use the
  marking action while it's off). Attendance can then only originate from approved worker
  requests or third-party integrations at that location.
- **`selfCheckInEnabled = false`** → the `createAttendanceRequest` mutation is rejected for
  `kind: CHECK_IN_OUT` at that location. `kind: OFF` requests remain allowed regardless of this
  flag, since OFF-day requests are governed by the worker's annual balance (a separate concern
  from "self check-in"), not by whether the location allows self-service presence check-ins. This
  reading is the most literal interpretation of "self check-in" as specifically about presence
  check-in/out, not all self-service requests — flagged explicitly here since the spec doesn't
  disambiguate, so this is deliberately documented as a decision made under ambiguity, not
  something to be discovered by later inconsistency.
- Both flags are administered exclusively by `SUPER_ADMIN` via `setLocationFeatureFlags`, take
  effect immediately (read live from `org-service`, never cached beyond a short TTL — TDR §7), and
  apply going forward only (no retroactive effect on already-`PENDING` requests).

## Consequences
**Positive:** every guard and domain test has a single unambiguous rule to implement and verify;
a reviewer can find the exact interpretation here rather than infer it from code.

**Negative:** this is an interpretive decision where the source spec is genuinely ambiguous; if
the actual product intent differs (e.g. `selfCheckInEnabled=false` should also block OFF
requests), only this ADR and the corresponding guard/test need to change — the rest of the
architecture is unaffected, which is itself evidence the boundary was drawn in the right place.

## Alternatives Considered
- **`selfCheckInEnabled` gates all worker-initiated requests (both kinds):** simpler mental
  model, but conflates "self check-in" with "self-service requests generally" and would make the
  OFF-day-balance feature unusable at any location that disables presence self-check-in, which
  seems like an unintended coupling. Rejected in favor of the narrower reading above.
