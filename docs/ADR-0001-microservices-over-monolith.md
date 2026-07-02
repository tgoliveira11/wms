# ADR-0001: Microservices over a modular monolith

**Status:** Accepted

## Context
The exercise explicitly requires "multiple backend microservices" behind a GraphQL gateway. Aside
from that hard requirement, the domain naturally splits into three areas that change for
different reasons and at different rates: identity/auth, organizational structure (company,
locations, membership), and attendance (high write volume, complex approval workflow).

## Decision
Build three independently deployable services — `identity-service`, `org-service`,
`attendance-service` — each with its own codebase, database, and deployment lifecycle, fronted by
a GraphQL gateway. No shared database, no shared ORM models across service boundaries.

## Consequences
**Positive**
- Matches the stated requirement directly.
- Each service can be scaled, tested, and deployed independently (attendance-service is the
  highest write-volume and most likely to need independent scaling).
- Clear ownership boundaries make the authorization model (location-scoped) easier to reason
  about, since org-service is the single source of truth for "who belongs where."

**Negative**
- Cross-service consistency (§7 of the TDR) is now a real concern instead of a DB transaction —
  mitigated with the Outbox pattern (ADR-0007).
- More operational surface area (3 databases, 3 deployables) than a monolith would have for a
  system of this size — accepted as a deliberate trade-off to satisfy the exercise's
  architecture requirement and to demonstrate service-boundary design skill, which is explicitly
  part of what's being evaluated.

## Alternatives Considered
- **Modular monolith** with a GraphQL layer on top: simpler operationally, but does not satisfy
  the explicit "multiple backend microservices" requirement and would not let us demonstrate
  cross-service data-consistency design, which the exercise explicitly asks candidates to be
  ready to discuss.
