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

## Where this MVP deliberately deviates from the TDR (for the 30-minute build)
These are scoped cuts, not disagreements with the design — each is a documented trade-off:
- **One Postgres container / three databases** instead of three instances (still DB-per-service *logically*; no cross-DB access in code). ADR-0004 target unchanged.
- **`prisma db push`** instead of a migration history (ADR-0009's migrations are the production path).
- **Express + a thin layering** instead of full NestJS/Clean-Architecture folders (ADR-0002's target stack). The service boundaries, two-layer authz, and invariants are all preserved.
- **Synchronous atomic OFF-balance decrement only** (ADR-0013); the compensating outbox publisher (ADR-0007 step 5) is not wired.
- **No DataLoader / no graphql-codegen / no 90% coverage gate** — replaced here by the curl acceptance script (`scripts/run_curl_tests.sh`) and the tiny seed scale.
- Auth is **simulated** (fixed login tokens → HS256 JWT), re-verified at every service (ADR-0005).

Full design, rationale, and the production-grade version live in [`docs/`](docs/) (TDR + ADR-0001…0013).
