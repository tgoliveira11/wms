# ADR-0004: Database-per-service with PostgreSQL

**Status:** Accepted

## Context
The exercise recommends PostgreSQL and expects schemas that align with service boundaries.
Sharing a single database/schema across services would couple their deployment and evolution,
undermining the microservices decision in ADR-0001.

## Decision
Each service owns a **dedicated PostgreSQL database** (`identity_db`, `org_db`, `attendance_db`),
provisioned as separate containers/instances in `docker-compose.yml`. No service reads or writes
another service's tables directly; all cross-service data access goes through that service's API
(REST, per ADR-0003). Cross-service references are stored as plain UUID columns (e.g.
`attendance_records.worker_id`) with no physical foreign key across databases — referential
integrity for those is an application-level concern, validated at write time via API calls (see
TDR §7).

## Consequences
**Positive:** each service's schema evolves independently; a migration in `attendance-service`
can never break `org-service`. Matches the "database design aligned with service boundaries"
expectation directly. Makes the ownership story unambiguous when discussing the design.

**Negative:** no cross-database joins or transactions — consistency across services must be
handled explicitly (ADR-0007), and read paths that need data from two services (e.g. "attendance
record with worker display name") require the gateway (or a service-to-service call) to stitch
results rather than a SQL join. This is treated as a deliberate cost of service autonomy, not an
oversight.

## Alternatives Considered
- **Shared database, separate schemas (Postgres `CREATE SCHEMA`):** slightly cheaper
  operationally (one instance) while still namespacing tables, but makes it too easy to
  "cheat" with a cross-schema join during a live-coding session under time pressure, quietly
  reintroducing coupling the architecture is supposed to prevent. Rejected to keep the boundary
  honest.
- **Single shared database, single schema:** rejected — directly contradicts the
  microservices/service-boundary requirement.
