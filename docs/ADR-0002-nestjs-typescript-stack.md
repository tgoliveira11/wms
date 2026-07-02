# ADR-0002: NestJS + TypeScript as the uniform service stack

**Status:** Accepted

## Context
We need a backend stack that makes Clean Architecture and SOLID explicit and enforceable rather
than a matter of discipline, provides first-class OpenAPI/Swagger generation, and has a mature
testing story to hit the ≥90% coverage target within the exercise's time constraints. Using one
language/framework across all three services also reduces context-switching for a single-session
build and lets domain code (entities, value objects) be shared as a thin internal package where
useful.

## Decision
Use **NestJS (TypeScript)** for `identity-service`, `org-service`, `attendance-service`, and the
GraphQL gateway.

- NestJS's dependency-injection container is Dependency Inversion made structural: providers are
  bound to interfaces (`useClass`/`useFactory`), so `application/` code depends on abstractions,
  not concrete infrastructure.
- `@nestjs/swagger` derives OpenAPI directly from the same `class-validator` DTOs used for
  runtime validation — no separate spec to maintain.
- `@nestjs/testing` gives a lightweight `TestingModule` for fast unit/integration tests with
  provider overrides (mocking repositories, external clients) without booting the full HTTP
  server.
- Guards (`CanActivate`) are a natural fit for the two-layer authorization model in ADR-0006.

## Consequences
**Positive:** consistent project layout across all services (lower onboarding cost for a human or
an agentic reviewer), strong typing end-to-end (shared types possible with the frontend via
GraphQL codegen), mature ecosystem for everything in §11 of the TDR.

**Negative:** NestJS has more ceremony (modules, decorators) than a minimal Express/Fastify app;
accepted because the ceremony is exactly what buys us the DI-based SOLID structure and the
Swagger/testing integration the exercise asks for.

## Alternatives Considered
- **Express/Fastify + manual layering**: lighter weight, but Dependency Inversion and Swagger
  generation would have to be hand-rolled and kept in sync manually — higher risk of drift under
  time pressure.
- **Polyglot per service** (e.g. Go for attendance-service): rejected for this exercise; the
  domain complexity doesn't yet justify per-service language optimization, and a single stack
  keeps the reviewable surface area consistent.
