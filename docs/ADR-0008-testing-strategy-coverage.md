# ADR-0008: Test pyramid with ≥90% coverage gate

**Status:** Accepted

## Context
The deliverable requires ~90% test coverage and needs to be understandable and verifiable by
either a human reviewer or an agentic reviewer without running the whole stack manually.
Different layers of the Clean Architecture (domain, application, infrastructure, interface) have
very different testing needs and costs.

## Decision
Adopt a test pyramid mapped onto the architecture's layers (full detail and tooling in TDR §11):
mostly fast, mock-free unit tests on `domain/`, use-case tests against in-memory fakes on
`application/`, a smaller number of Testcontainers-backed tests for `infrastructure/`
repositories, Supertest controller tests for `interface/http`, resolver tests for the gateway,
and a thin top layer of Playwright E2E smoke tests covering one happy path per persona.
`coverageThreshold` in each service's `jest.config.ts` enforces `lines: 90, branches: 85` and is
wired into CI so a PR that drops below threshold fails the build, not just a manual check.

## Consequences
**Positive:** coverage is concentrated where it's cheapest and most valuable (domain rules —
the invariants in TDR §2.1 — are the most heavily tested surface, since they're the actual
business risk). The pyramid shape keeps the suite fast enough to run on every commit.

**Negative:** hitting 90% on `interface/`/`infrastructure/` glue code (DI wiring,
framework boilerplate) is disproportionately expensive relative to its risk — addressed by
setting the branch threshold slightly below the line threshold and by keeping controllers
deliberately thin (they only map DTOs and call a use case), so most of their "coverage" comes
for free from the use-case tests exercising them via Supertest.

## Alternatives Considered
- **Coverage target enforced only via CI badge, not build-breaking:** rejected — a
  non-enforced target tends to erode over time; a hard gate matches the exercise's explicit
  ~90% requirement.
- **End-to-end-only testing (no unit tests):** would technically produce a coverage number, but
  would be slow, brittle, and wouldn't isolate business-rule regressions (e.g. an off-balance bug)
  from infrastructure flakiness — rejected as the wrong shape for a rules-heavy domain like this
  one.
