# ADR-0003: GraphQL Gateway via schema stitching, not Apollo Federation

**Status:** Accepted

## Context
The frontend must talk only to a single GraphQL gateway. With three backend services, there are
two common ways to compose a unified GraphQL schema: (a) hand-author one SDL at the gateway and
write resolvers that call each service's REST API ("BFF" / schema-stitching style), or (b) make
each service expose its own GraphQL subgraph and use Apollo Federation to compose them at
query-plan time.

## Decision
Use a **single hand-authored SDL at the gateway**, with resolvers implemented as typed REST
clients into `identity-service`, `org-service`, and `attendance-service`. Each backend service
exposes REST + OpenAPI (needed anyway for the third-party integration endpoint and for direct
Swagger evaluation), not a GraphQL subgraph.

## Consequences
**Positive:** one schema to reason about, no federation-specific tooling
(`@apollo/subgraph`, gateway query planner) to configure and debug, resolver code maps 1:1 to
"call this service's REST endpoint" which is easy to trace. DataLoader batches per-request calls
to avoid N+1 against the REST subgraphs.

**Negative:** the gateway becomes a integration point that must be updated whenever a service's
API shape changes (no independent subgraph deploys). Acceptable at this scale (3 services, one
team); flagged as a revisit trigger in TDR §15 if the org grows to multiple independent teams
owning separate services.

## Alternatives Considered
- **Apollo Federation:** better story for independently-owned subgraphs and large teams, but its
  operational overhead (federation directives, `_entities` resolvers, gateway composition) isn't
  justified for 3 tightly-coordinated services built together in one exercise. Documented as the
  natural next step if/when service ownership fragments across teams.
- **GraphQL-per-service, no gateway composition, frontend picks endpoint per feature:** rejected
  outright — violates the explicit "frontend talks only to the gateway" requirement.
