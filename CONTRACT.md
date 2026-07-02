# WMS MVP — Build Contract (single source of truth for all apps)

All apps live in a pnpm workspace. Root `tsconfig.base.json` uses **CommonJS** + `strict`.
Every backend app: `extends` the base tsconfig, depends on `"@wfms/shared": "workspace:*"`,
runs with `tsx` (no build step). Node >= 18.17 (global `fetch`).

## Ports & base URLs
| App | Port | Env override |
|---|---|---|
| gateway (GraphQL) | 4000 | `PORT` |
| identity-service | 3001 | `PORT`, others call it via `IDENTITY_URL` (default `http://localhost:3001`) |
| org-service | 3002 | `PORT`, `ORG_URL` default `http://localhost:3002` |
| attendance-service | 3003 | `PORT`, `ATTENDANCE_URL` default `http://localhost:3003` |
| web (Vite) | 5173 | — talks only to `http://localhost:4000/graphql` |

## Databases (Postgres @ localhost:5432, user/pass `wms`/`wms`)
- identity → `identity_db`, org → `org_db`, attendance → `attendance_db`.
- Each service `.env`: `DATABASE_URL=postgresql://wms:wms@localhost:5432/<db>?schema=public`
- Prisma per service: `schema.prisma` + `prisma/seed.ts`. Scripts in each package.json:
  - `"dev": "tsx watch src/main.ts"`
  - `"db:push": "prisma db push --skip-generate && prisma generate"`
  - `"seed": "tsx prisma/seed.ts"`
- Seeds MUST import fixed IDs from `@wfms/shared` (`USERS`, `LOCATIONS`, `MEMBERSHIPS`, `COMPANY`, `CREDENTIALS`). Never invent UUIDs.

## Shared lib `@wfms/shared` (already written — DO NOT modify)
Exports: `signToken(claims)`, `verifyToken(token)`, `Role`, `AuthUser`, `AppError`, `Errors.*`,
`authMiddleware`, `requireRole(...roles)`, `asyncH(fn)`, `errorHandler`, and all seed constants.
Use these in every service: mount `authMiddleware` (except `/auth/login` and integration endpoint),
`requireRole(...)` for coarse RBAC, `asyncH` around async handlers, `errorHandler` last.
Throw `Errors.forbidden()/conflict()/invalidState()/notFound()/validation()` in use cases.

## Error model
Services respond to errors with HTTP status + body `{ "error": { "code": <ErrorCode>, "message": string } }`.
Codes: UNAUTHENTICATED(401), FORBIDDEN(403), NOT_FOUND(404), CONFLICT(409), INVALID_STATE(409), VALIDATION(400).
Gateway maps `error.code` -> GraphQL `extensions.code`.

## Pinned dependency versions (use EXACTLY these)
Backend services + gateway share:
- `typescript` 5.4.5, `tsx` 4.7.1, `@types/node` 20.11.30
- `express` 4.19.2, `@types/express` 4.17.21
- `prisma` 5.11.0, `@prisma/client` 5.11.0
- `swagger-ui-express` 5.0.0, `@types/swagger-ui-express` 4.1.6
Gateway also: `@apollo/server` 4.10.0, `graphql` 16.8.1.
Web: `react` 18.2.0, `react-dom` 18.2.0, `@types/react` 18.2.66, `@types/react-dom` 18.2.22,
`@apollo/client` 3.9.9, `graphql` 16.8.1, `vite` 5.2.8, `@vitejs/plugin-react` 4.2.1, `typescript` 5.4.5.

---

# identity-service (:3001)
Prisma model `User { id String @id, externalId String @unique, displayName String, role String, createdAt DateTime @default(now()) }`.
Login is simulated via `CREDENTIALS` map (token->userId) from `@wfms/shared`.

Endpoints (all JSON). `authMiddleware` on everything EXCEPT `POST /auth/login`.
- `POST /auth/login` body `{ loginToken }` → `{ token, user }`. Unknown token → 401 UNAUTHENTICATED.
  `token` = `signToken({ sub: user.id, externalId, role })`. `user` = full user object.
- `GET /me` → the authed user (from req.auth.userId).
- `GET /users/:id` → user or 404.
- `GET /users?ids=a,b,c` → `User[]` (batch; for gateway).
- `GET /users/by-external/:externalId` → user or 404 (for integration worker resolution).
User JSON: `{ id, externalId, displayName, role }`.
Swagger UI at `/docs`, raw at `/docs-json` (minimal hand-written OpenAPI object is fine).

# org-service (:3002)
Prisma:
```
model Location { id String @id, companyId String, name String, address String?, externalRef String @unique,
  selfCheckInEnabled Boolean @default(false), managerAttendanceMarkingEnabled Boolean @default(true),
  createdAt DateTime @default(now()), members LocationMember[] }
model LocationMember { id String @id @default(uuid()), locationId String, userId String, role String,
  jobTitle String?, annualOffAllowance Int @default(12), offBalanceRemaining Int @default(12),
  createdAt DateTime @default(now()),
  location Location @relation(fields:[locationId], references:[id]),
  @@unique([locationId, userId]) , @@unique([locationId, jobTitle]) }
```
`authMiddleware` on all. Endpoints:
- `GET /locations` → all locations. **SUPER_ADMIN only** (`requireRole('SUPER_ADMIN')`) → 403 otherwise.
- `GET /locations/:id` → location (any authed user).
- `POST /locations` body `{ companyId, name, address? }` (SUPER_ADMIN) → new location (defaults selfCheckIn=false, managerMark=true).
- `PATCH /locations/:id/flags` body `{ selfCheckInEnabled?, managerAttendanceMarkingEnabled? }` (SUPER_ADMIN) → location.
- `GET /locations/:id/members?role=WORKER|MANAGER` → members[] (filter optional).
- `GET /locations/:id/members/:userId` → member or 404 (membership/scope check helper).
- `POST /locations/:id/members` body `{ userId, role, jobTitle? }` (SUPER_ADMIN) → member. Duplicate jobTitle in location → 409 CONFLICT (catch P2002). Duplicate (location,user) → 409.
- `GET /memberships?userId=` → members[] across locations (for `me`/`User.locations`).
- `GET /locations/:id/counts` → `{ workerCount, managerCount }` (count members by role).
- **`POST /locations/:id/members/:userId/off-balance:consume`** → atomic conditional decrement:
  `UPDATE ... SET offBalanceRemaining = offBalanceRemaining - 1 WHERE locationId=? AND userId=? AND offBalanceRemaining > 0` (use `prisma.$executeRaw` or `updateMany` with `offBalanceRemaining: { gt: 0 }`). If 0 rows affected → 409 INVALID_STATE (InsufficientOffBalanceError). Else 200 `{ offBalanceRemaining }`.
- `POST /locations/:id/members/:userId/off-balance:release` → increment by 1 bounded by annualOffAllowance (compensation). 200.

Note: express route paths with a colon like `off-balance:consume` — register as `'/locations/:id/members/:userId/off-balance\\:consume'` or use a distinct suffix e.g. `/off-balance/consume`. USE `/off-balance/consume` and `/off-balance/release` (plain path segments) to avoid colon-in-path issues. Update attendance-service caller accordingly.
Member JSON: `{ id, locationId, userId, role, jobTitle, annualOffAllowance, offBalanceRemaining }`.
Location JSON: `{ id, companyId, name, address, externalRef, selfCheckInEnabled, managerAttendanceMarkingEnabled }`.
Swagger at `/docs`, `/docs-json`.

# attendance-service (:3003)
Prisma:
```
model AttendanceRecord { id String @id @default(uuid()), workerId String, locationId String, date String,
  status String, source String, sourceRefId String?, createdAt DateTime @default(now()), updatedAt DateTime @updatedAt,
  @@unique([workerId, date]) }         // invariant #2: one per worker per date (date is 'YYYY-MM-DD')
model AttendanceRequest { id String @id @default(uuid()), workerId String, locationId String, date String,
  kind String, status String @default("PENDING"), note String?, requestedAt DateTime @default(now()),
  decidedBy String?, decidedAt DateTime? }
model IntegrationEvent { id String @id @default(uuid()), externalWorkerId String, idempotencyKey String @unique, payload String, processedAt DateTime @default(now()) }
```
Partial unique index for "one PENDING per worker/date" (invariant #3, ADR-0012) — Prisma can't express a partial unique index in schema, so ADD IT in seed via `prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_request ON "AttendanceRequest"("workerId","date") WHERE status = \'PENDING\'')`. Also enforce in code before insert.

`authMiddleware` on all EXCEPT `POST /integrations/attendance` (uses X-Api-Key). Env: `ORG_URL`, `IDENTITY_URL`, `INTEGRATION_API_KEY` (default from shared).
Endpoints:
- `POST /requests` body `{ locationId, date, kind, note? }` — role WORKER (requireRole('WORKER')); workerId = req.auth.userId.
  Rules: call `GET ORG /locations/:id`. If `kind==='CHECK_IN_OUT'` and `!selfCheckInEnabled` → 409 INVALID_STATE (ADR-0011). `kind==='OFF'` always allowed. If an existing PENDING request for (workerId,date) exists → 409 CONFLICT (invariant #3). Terminal-state rows do NOT block (ADR-0012) — new row created. Past/future dates allowed (invariant #8). Return request.
- `POST /requests/:id/cancel` — WORKER, must own it & be PENDING → status CANCELLED.
- `POST /requests/:id/approve` — role MANAGER or SUPER_ADMIN. Load request (must be PENDING else 409). If MANAGER: call `GET ORG /locations/:locationId/members/:managerUserId`; if not found or role!=MANAGER → 403 (invariant #5). SUPER_ADMIN bypasses scope. If `kind==='OFF'`: call `POST ORG /locations/:locationId/members/:workerId/off-balance/consume`; on 409 → propagate 409 INVALID_STATE (InsufficientOffBalance). Then in a `prisma.$transaction`: set request APPROVED (decidedBy, decidedAt) + UPSERT attendance record (`workerId,date`) status = (kind OFF -> 'OFF' else 'PRESENT'), source='WORKER_REQUEST', sourceRefId=request.id. Return request.
- `POST /requests/:id/reject` body `{ reason? }` — MANAGER (scope-checked like approve) → REJECTED, decidedBy/At set, note may append reason. No attendance record.
- `POST /attendance/mark` body `{ locationId, workerId, date, status }` — role MANAGER or SUPER_ADMIN. If MANAGER, scope-check via ORG membership → 403 else. Call `GET ORG /locations/:id`; if `!managerAttendanceMarkingEnabled` → 409 INVALID_STATE (ADR-0011, applies to SUPER_ADMIN too). UPSERT record source='MANAGER'. Return record.
- `GET /attendance?locationId=&workerId=&from=&to=&status=` — MANAGER/SUPER_ADMIN (records for a location). 
- `GET /attendance/mine?from=&to=` — WORKER, workerId=req.auth.userId.
- `GET /requests?locationId=&status=` — MANAGER/SUPER_ADMIN; MANAGER must be scoped to locationId (else 403).
- `GET /requests/mine?status=` — WORKER, own requests (all statuses; for history — ADR-0012).
- **`POST /integrations/attendance`** — NO user JWT. Require header `X-Api-Key` == INTEGRATION_API_KEY else 401. Header `Idempotency-Key` required. Body `{ externalWorkerId, locationExternalRef, date, status, idempotencyKey? }`. Resolve worker via `GET IDENTITY /users/by-external/:externalWorkerId` (404→ VALIDATION). Resolve location via `GET ORG /locations` ... (ORG list requires SUPER_ADMIN; instead add resolution: integration should map locationExternalRef->locationId. Simplest: attendance calls `GET ORG /locations/:id` won't work with ref. So: org exposes lookup by ref? To avoid extra endpoint, resolve ref->id from `@wfms/shared` LOCATIONS map (allowed: it's seed data). Use LOCATION_LIST.find(externalRef). Then INSERT IntegrationEvent(idempotencyKey unique) — on duplicate (P2002) return 200 idempotent replay (no new write). UPSERT attendance record source='INTEGRATION'. Return 201 `{ recordId, workerId }`.
Records JSON: `{ id, workerId, locationId, date, status, source }`. Request JSON: `{ id, workerId, locationId, date, kind, status, note, decidedBy, decidedAt }`.
Swagger `/docs`, `/docs-json`.

Cross-service calls: use a small `fetch` helper that forwards the caller's Authorization header on approve/reject/mark scope checks and reads `{error:{code}}` to re-throw AppError with same code/status.

---

# gateway (:4000) — Apollo Server 4 standalone
`startStandaloneServer` with `context` that:
- Reads `Authorization` header. If present, `verifyToken` (catch → will 401 on protected resolvers). Build `ctx = { token, user?: AuthUser }`.
- `login` resolver is public. All others: if no `ctx.user` → throw GraphQLError code UNAUTHENTICATED.
Coarse RBAC in resolvers (throw FORBIDDEN) mirroring TDR §9 before calling services.
Resolvers call service REST endpoints via `fetch`, forwarding `Authorization: Bearer <ctx.token>`.
Map any non-2xx `{error:{code,message}}` → `throw new GraphQLError(message, { extensions: { code } })`.

## SDL (implement exactly; `Date` is a passthrough String scalar)
```graphql
scalar Date
enum Role { WORKER MANAGER SUPER_ADMIN }
enum AttendanceStatus { PRESENT OFF }
enum RequestStatus { PENDING APPROVED REJECTED CANCELLED }
enum RequestKind { CHECK_IN_OUT OFF }

type User { id: ID! externalId: String! displayName: String! role: Role! locations: [Location!]! }
type Location { id: ID! name: String! address: String selfCheckInEnabled: Boolean! managerAttendanceMarkingEnabled: Boolean!
  workerCount: Int! managerCount: Int! pendingApprovalCount: Int! members(role: Role): [LocationMember!]! }
type LocationMember { id: ID! user: User! role: Role! jobTitle: String annualOffAllowance: Int! offBalanceRemaining: Int! }
type AttendanceRecord { id: ID! worker: User! location: Location! date: Date! status: AttendanceStatus! source: String! }
type AttendanceRequest { id: ID! worker: User! location: Location! date: Date! kind: RequestKind! status: RequestStatus! note: String decidedBy: User }
type AuthPayload { token: String! user: User! }

type Query {
  me: User!
  location(id: ID!): Location
  locations: [Location!]!
  attendance(locationId: ID!, workerId: ID, from: Date, to: Date, status: AttendanceStatus): [AttendanceRecord!]!
  attendanceRequests(locationId: ID!, status: RequestStatus): [AttendanceRequest!]!
  myAttendance(from: Date, to: Date): [AttendanceRecord!]!
  myAttendanceRequests(status: RequestStatus): [AttendanceRequest!]!
}
type Mutation {
  login(loginToken: String!): AuthPayload!
  createAttendanceRequest(locationId: ID!, date: Date!, kind: RequestKind!, note: String): AttendanceRequest!
  cancelAttendanceRequest(id: ID!): AttendanceRequest!
  approveAttendanceRequest(id: ID!): AttendanceRequest!
  rejectAttendanceRequest(id: ID!, reason: String): AttendanceRequest!
  markAttendance(locationId: ID!, workerId: ID!, date: Date!, status: AttendanceStatus!): AttendanceRecord!
  createLocation(companyId: ID!, name: String!, address: String): Location!
  setLocationFeatureFlags(locationId: ID!, selfCheckInEnabled: Boolean, managerAttendanceMarkingEnabled: Boolean): Location!
  addLocationMember(locationId: ID!, userId: ID!, role: Role!, jobTitle: String): LocationMember!
}
```
Field resolvers:
- `User.locations`: GET org `/memberships?userId=<id>` -> for each, GET location.
- `Location.workerCount/managerCount/pendingApprovalCount`: counts from org `/locations/:id/counts` and attendance `/requests?locationId=&status=PENDING` length. (pendingApprovalCount only needs MANAGER/SUPER_ADMIN context; return via attendance.)
- `Location.members`: org `/locations/:id/members?role=`; each member's `user` resolved via identity.
- `AttendanceRecord.worker` / `AttendanceRequest.worker` / `.decidedBy`: identity `/users/:id`.
- `AttendanceRecord.location` / `AttendanceRequest.location`: org `/locations/:id`.
Keep resolvers simple (no DataLoader for MVP; seed scale is tiny). A tiny per-request cache map is a nice-to-have, optional.
Coarse RBAC: `locations` & `createLocation` & `setLocationFeatureFlags` & `addLocationMember` → SUPER_ADMIN. `approve/reject/markAttendance/attendanceRequests` → MANAGER or SUPER_ADMIN. `createAttendanceRequest/cancelAttendanceRequest/myAttendance/myAttendanceRequests` → WORKER.

# web (:5173) — Vite + React + TS + Apollo Client
- Apollo Client single `uri: http://localhost:4000/graphql`, `authLink` sets Authorization from a token in React state (persona switcher). No other HTTP client.
- Top bar: **persona switcher** dropdown listing the 6 seed personas by displayName+role; selecting one runs `login(loginToken)` (hardcode the token list in the web app: admin-token, megan-garcia-token, priya-nair-token, tom-reyes-token, jamie-cole-token, lin-huang-token) and stores the returned JWT + user. 
- Render view by `me.role`:
  - WORKER: show `myAttendance` table + `myAttendanceRequests` table (with status), and a form to `createAttendanceRequest(locationId, date, kind, note)` + cancel button on PENDING rows. Show OFF balance from the worker's membership if available.
  - MANAGER: pick one of the manager's locations; show `attendanceRequests(locationId, status:PENDING)` queue with Approve/Reject buttons; a `markAttendance` form (workerId,date,status); list `attendance(locationId)`.
  - SUPER_ADMIN: `locations` list with the two feature-flag toggles (call setLocationFeatureFlags), member list per location (annualOffAllowance/offBalanceRemaining shown as "X of Y"), forms for createLocation and addLocationMember.
- Minimal CSS (inline or one index.css). Functional over pretty. Show GraphQL errors (error.message / extensions.code) inline.
- Keep it to a handful of files: `index.html`, `src/main.tsx`, `src/apollo.ts`, `src/App.tsx`, `src/views/{Worker,Manager,SuperAdmin}.tsx`, `src/graphql.ts` (gql documents), `src/personas.ts`. Use `useQuery/useMutation` with inline `gql` documents (no codegen for MVP).
- `vite.config.ts` with react plugin, server.port 5173. tsconfig for react (jsx react-jsx, module ESNext, moduleResolution Bundler) — separate from base.
