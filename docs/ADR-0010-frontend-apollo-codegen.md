# ADR-0010: Apollo Client + GraphQL Codegen on the frontend

**Status:** Accepted

## Context
The frontend must communicate only with the GraphQL gateway. We want that constraint to be
structural (hard to violate by accident) rather than just a convention, and we want frontend
types to stay in sync with the gateway schema without hand maintenance.

## Decision
Use **Apollo Client** configured with a single `uri` pointing at the gateway's `/graphql`
endpoint — no other HTTP client or base URL is configured anywhere in the frontend app, so there
is no code path that could reach a backend service directly. Use **GraphQL Code Generator** to
generate TypeScript types and typed React hooks (`useCreateAttendanceRequestMutation`, etc.)
from `.graphql` operation files against the gateway's SDL, run as a pre-build step and checked
into CI (build fails if generated types are stale relative to `.graphql` files or schema).

## Consequences
**Positive:** the "frontend talks only to the gateway" requirement is enforced by the absence of
any alternative client configuration, not just documentation. Type drift between schema and UI
code is caught at build time, not at runtime.

**Negative:** adds a codegen step to the build pipeline; accepted as standard practice for
GraphQL frontends and low-cost relative to the type-safety it buys.

## Alternatives Considered
- **Hand-written fetch calls to `/graphql` with manually-typed responses:** avoids the codegen
  step but reintroduces exactly the kind of type drift codegen exists to prevent, and doesn't
  provide Apollo's normalized cache (useful for the "viewing as" persona switcher re-fetching
  role-scoped data).
- **REST client hitting services directly for read-heavy views, GraphQL for writes:** rejected
  outright — directly violates the single-gateway requirement.
