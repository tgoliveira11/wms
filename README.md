# Workforce Management System (MVP)

A runnable slice of the system designed in [`docs/TDR.md`](docs/TDR.md): three backend
microservices behind a single GraphQL gateway, with a React + TypeScript frontend that talks
**only** to the gateway.

```
web (React/Apollo :5173) ──GraphQL──> gateway (:4000) ──REST──> identity (:3001)
                                                          ├────> org      (:3002)
                                                          └────> attendance(:3003)
                                          each service ──> its own Postgres database
```

## Prerequisites
- Node **>= 18.17** (for global `fetch`)
- `pnpm` (`npm i -g pnpm`) and Docker (for Postgres)

## Run it (warm machine ≈ a few minutes)
```bash
pnpm install                 # installs all workspaces
docker compose up -d         # Postgres with identity_db / org_db / attendance_db
pnpm db:push                 # create tables in each service DB (prisma db push)
pnpm seed                    # seed personas, locations, memberships, demo attendance
pnpm dev                     # runs all 3 services + gateway + web concurrently
```
Then open:
- Frontend: http://localhost:5173  (use the **persona switcher** top-right to log in as any seed user)
- GraphQL sandbox: http://localhost:4000
- Swagger per service: http://localhost:3001/docs · :3002/docs · :3003/docs

`pnpm setup` chains `docker compose up`, `db:push`, and `seed` in one shot.

## Seed personas (simulated login — TDR §8)
| Persona | Role | Location(s) | Login token |
|---|---|---|---|
| Alex Rivera | SUPER_ADMIN | all | `admin-token` |
| Megan Garcia | MANAGER | Aramark Boulder CO | `megan-garcia-token` |
| Priya Nair | MANAGER | NRG Park | `priya-nair-token` |
| Tom Reyes | WORKER (Food server) | Aramark Boulder CO | `tom-reyes-token` |
| Jamie Cole | WORKER (Concession/Usher) | Boulder, Wembley | `jamie-cole-token` |
| Lin Huang | WORKER (Cook) | Boulder, NRG | `lin-huang-token` |

Location flags: Boulder `selfCheckIn=on, managerMark=on` · NRG `selfCheckIn=off` · Wembley `managerMark=off`.

## Acceptance tests
```bash
pnpm test:curl               # runs scripts/run_curl_tests.sh against the running stack
```

## Core workflows to try
1. **Worker OFF request → Manager approval → balance decrement.** Log in as *Tom* (WORKER), request an OFF day at Boulder. Log in as *Megan* (MANAGER), approve it — attendance flips to OFF and Tom's `offBalanceRemaining` drops by 1 (atomic decrement in org-service, ADR-0013).
2. **Feature flags.** As *Lin* at NRG, a `CHECK_IN_OUT` request is rejected (`selfCheckIn=off`) but `OFF` is allowed (ADR-0011). As anyone, `markAttendance` at Wembley is rejected (`managerMark=off`).
3. **Location scope.** *Megan* cannot approve an NRG request; *Priya* can (invariant #5).
4. **Super admin.** As *Alex*, toggle a flag, create a location, add a member (job titles unique per location — invariant #4).
5. **Integration by externalId** (bypasses the gateway, uses an API key):
   ```bash
   curl -X POST http://localhost:3003/integrations/attendance \
     -H "X-Api-Key: seed-integration-key" -H "Idempotency-Key: k1" -H 'Content-Type: application/json' \
     -d '{"externalWorkerId":"EXT-TOM-1042","locationExternalRef":"aramark-boulder-co","date":"2026-07-21","status":"PRESENT"}'
   ```

## Scope: the brief vs. our extra design docs

We separate two things on purpose: **what the take-home brief actually required** (all met), and
**what our own auxiliary design docs additionally proposed** (extra — not required by the brief,
and partly not implemented). This keeps "done" honest.

### ✅ Brief requirements — fully met

Every requirement in the brief is implemented and demonstrated. Each is mapped to its
design + test in [`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md) and
proven by the acceptance suite `scripts/run_curl_tests.sh` (**54 pass / 0 fail / 1 skip**):

- Multiple backend **microservices** + a single **GraphQL gateway** + a **React + TypeScript** frontend that talks *only* to the gateway.
- Single **company**, multiple **locations**, all permissions/ownership **scoped per location**.
- Location **feature flags** (`selfCheckInEnabled`, `managerAttendanceMarkingEnabled`) that influence behaviour.
- **Workers** in 1+ locations, unique `externalId`, a **job title per location** (unique within a location).
- **Managers** in 1+ locations running the approval workflow.
- **Attendance** per worker/date/**location**, `PRESENT`/`OFF`, sourced from manager marking, third-party integration, or approved worker request.
- **Worker requests** (workers can't modify attendance directly), `CHECK_IN_OUT`/`OFF`, one active per worker/location/date, past **and** future dates, manager-approved only for their locations, approval updates the record; statuses `PENDING`/`APPROVED`/`REJECTED`/`CANCELLED`.
- **Annual OFF-day balance** (per location), decremented atomically on approval, restored on reversal.
- **Third-party integration** identifies workers by `externalId` (idempotent).
- Roles **WORKER/MANAGER/SUPER_ADMIN**, authorization enforced at gateway *and* service; auth **simulated**.
- **PostgreSQL**, schemas aligned to service boundaries; **seed data** for every view.

### 🔵 Beyond the brief — our TDR/ADR extras (NOT implemented)

These were proposed by *our own* [`docs/`](docs/) (TDR + ADRs), **not** by the brief. They are
deliberately out of scope for this build — listed so nothing looks "done" that isn't:

- **Playwright / UI end-to-end tests** (TDR §11, ADR-0008) — the API-level end-to-end is covered by the curl suite; browser E2E is not built.
- **≥90% coverage gate + Testcontainers/Vitest suites** (ADR-0008) — not wired.
- **Outbox publisher** for async cross-service compensation (ADR-0007) — only the *synchronous* atomic OFF-balance path is implemented (the reversal calls release inline, not via a polling publisher).
- **DataLoader batching** (TDR §6) and **graphql-codegen** typed hooks (ADR-0010) — plain resolvers / hand-written docs instead (fine at seed scale).
- **Three separate Postgres instances** (ADR-0004) — one container hosting three databases (DB-per-service *logically*, no cross-DB access in code).
- **Prisma migration history** (ADR-0009) — `prisma db push` instead.
- **Full NestJS / Clean-Architecture folders** (ADR-0002) — Express + a thin layering; service boundaries, two-layer authz, and all invariants preserved.
- **Annual OFF-balance reset job** (ADR-0013) — the `annualOffAllowance`/`offBalanceRemaining` fields support it, but there is no scheduler.
- **Real IdP / RS256 + JWKS** (ADR-0005) — simulated HS256 tokens (the brief explicitly allows simulated auth).

Full design and the production-grade target for all of the above live in [`docs/`](docs/) (TDR + ADR-0001…0013).
