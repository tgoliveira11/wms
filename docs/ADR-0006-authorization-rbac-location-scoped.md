# ADR-0006: RBAC + location-scoped authorization, enforced at gateway and service

**Status:** Accepted

## Context
The domain states permissions and ownership are scoped at the Location level, and defines three
roles. A role alone (`MANAGER`) is not sufficient to authorize an action — a Manager may only act
on Locations they belong to (invariant #5 in the TDR). Authorization logic must live somewhere
that can't be bypassed by calling a service directly (i.e., not only in the frontend, and not
only in the gateway).

## Decision
Two enforcement layers, both mandatory:

1. **Gateway — coarse RBAC.** A resolver-level guard checks the JWT's `role` claim against the
   operation's minimum required role (e.g. `approveAttendanceRequest` requires `MANAGER` or
   `SUPER_ADMIN`) before any downstream call is made. This fails fast and cheaply for
   obviously-unauthorized calls.
2. **Service — fine-grained, location-scoped ABAC.** Inside `attendance-service` and
   `org-service`, each mutating use case independently re-checks that the acting user is a member
   of the target `locationId` with the required role (via `org-service`'s `location_members`
   table), or is a `SUPER_ADMIN`. Worker-scoped operations additionally check resource ownership
   (`request.workerId === callerUserId`).

This mirrors the authentication decision in ADR-0005: never trust an earlier layer's check as
sufficient on its own.

## Consequences
**Positive:** an attacker (or a bug) that bypasses the gateway (e.g. calls `attendance-service`
directly) still cannot approve a request for a location they don't manage — the invariant holds
at the data layer, not just at the edge. The authorization table in TDR §9 becomes directly
testable: each row is a unit test at the service layer, independent of the gateway.

**Negative:** authorization logic exists in two places, which must be kept behaviorally
consistent — mitigated by generating the gateway's coarse checks from the same
`@Roles()`/`@LocationScope()` guard metadata used at the service layer, so there is one source of
truth for "which role/scope is required," even though it's checked twice.

## Alternatives Considered
- **Gateway-only authorization:** simpler, but leaves every service's REST API — including the
  Swagger-documented one intended for direct evaluation — effectively unauthenticated in
  practice. Rejected.
- **Centralized policy engine (e.g. OPA/Rego):** attractive for larger systems with many
  services/roles, but adds infrastructure disproportionate to three roles and one scoping
  dimension (location); revisit if the permission model grows more dimensions (e.g.
  per-resource-type policies).
