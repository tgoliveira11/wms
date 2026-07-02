# Technical Design Report (TDR)
## Workforce Management System

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Author** | Engineering |
| **Date** | 2026-07-02 |
| **Related** | Architecture Decision Records ADR-0001 … ADR-0013 in this `docs/` folder (indexed in §16) |

---

## 1. Purpose & Scope

This document describes the technical design of a Workforce Management System composed of:

- Multiple independently deployable **backend microservices**
- A single **GraphQL Gateway** acting as the only entry point for clients
- A **React + TypeScript** frontend that talks exclusively to the gateway

The design follows **Clean Architecture** (Entities → Use Cases → Interface Adapters →
Frameworks/Drivers) and **SOLID** principles inside every service, uses **PostgreSQL**
(database-per-service) for persistence, exposes **OpenAPI/Swagger** documentation on every
HTTP surface, and targets **≥90% automated test coverage** per service.

Out of scope for the MVP: real identity provider integration (SSO/OAuth), payroll, scheduling,
push notifications. These are called out in the roadmap (§13).

---

## 2. Domain Model (Ubiquitous Language)

| Concept | Definition |
|---|---|
| **Company** | Single tenant. Root of the ownership hierarchy. |
| **Location** | Belongs to the Company. Owns feature flags. All permissions/ownership are scoped here. |
| **Feature Flags** (per Location) | `selfCheckInEnabled`, `managerAttendanceMarkingEnabled` — gate which write-paths are legal for that location. |
| **Worker** | A person who performs work. Has a global `externalId` (used by 3rd parties) and, per Location, a `jobTitle` (unique within that Location) and OFF-day balance. |
| **Manager** | A person who operates a Location: marks attendance (if allowed) and approves/rejects Worker Attendance Requests for the Locations they manage. |
| **Attendance Record** | The system of record for a Worker's status (`PRESENT`/`OFF`) on a given `(workerId, locationId, date)`. Exactly one per worker per date. |
| **Attendance Request** | A Worker-submitted proposal to change attendance (`CHECK_IN_OUT` → PRESENT, or `OFF`) for a given date. Exactly one per worker per date. Must be approved by a Manager to take effect. |
| **Role** | `WORKER`, `MANAGER`, `SUPER_ADMIN` — global identity role; concrete permissions are additionally scoped by Location membership. |

### 2.1 Business Invariants (must be enforced in the Domain layer, not just the DB)

1. A Location's feature flags gate which mutations are legal:
   - `selfCheckInEnabled = false` → Workers cannot submit `CHECK_IN_OUT` requests at that Location (an `OFF` request via worker balance may still be allowed — configurable, see ADR-0011).
   - `managerAttendanceMarkingEnabled = false` → Managers cannot directly mark attendance; attendance can only originate from approved requests or integrations.
2. Exactly **one** Attendance Record per `(workerId, date)` — enforced with a DB unique constraint **and** an application-level upsert use case (never a blind insert). The record carries `locationId` as an attribute, but the uniqueness key is `(workerId, date)` **not** `(workerId, locationId, date)`: a worker has a single status per calendar day company-wide, even if they belong to multiple locations. This is a deliberate interpretation of the brief's "only one attendance record may exist per worker per date" over its "tracked per location" phrasing — documented here rather than left implicit.
3. Exactly **one** *active* (`PENDING`) Attendance Request per `(workerId, date)`. A new request cannot be created while a `PENDING` request exists for that date; the worker must `CANCEL` first. Terminal-state rows (`CANCELLED`/`REJECTED`/`APPROVED`) are retained as immutable history and do not block a resubmission, which creates a **new** row with a new `id`. See ADR-0012 for why this "one active request" reading is chosen over a literal one-row-per-date reading.
4. `jobTitle` is unique within a Location (`(locationId, jobTitle)` unique constraint) — this is a **catalog of titles per location**, not a free-text field per worker, so it also protects against typos/duplicates.
5. A Manager may only approve/reject requests for Locations in their `manager_location` membership set. Enforced in the domain (`ApproveAttendanceRequestUseCase`) via a `LocationScopeGuard`, independent of the transport-layer authorization.
6. Approving a request is the **only** way a request mutates attendance. Approval is transactional: request status → `APPROVED` and the Attendance Record upsert happen in a single DB transaction (or, across service boundaries, via the Outbox pattern — see §7 and ADR-0007).
7. Workers have an **annual OFF-day balance**, scoped **per Location** (see ADR-0013). It is modeled as two fields on the worker's `location_members` row: `annualOffAllowance` (the yearly grant, default 12, reset each calendar year) and `offBalanceRemaining` (current remaining count). `offBalanceRemaining` is decremented on approval of an `OFF` request and incremented back on later cancellation/rejection reversal (bounded above by `annualOffAllowance`). Balance cannot go negative: the decrement is a **synchronous, atomic conditional update** in org-service (`... SET off_balance_remaining = off_balance_remaining - 1 WHERE off_balance_remaining > 0`) performed *before* the approval commits; if it does not affect a row the approval fails with the domain error `InsufficientOffBalanceError`. This is enforced as a domain rule surfaced through the org-service endpoint, not a DB trigger, so the error stays a domain concept.
8. Attendance Requests may target past **or** future dates (no temporal restriction), but a request for a date that already has an `APPROVED` Attendance Record from a different source (e.g. integration) requires explicit manager override logic (reject-then-create), never silent overwrite.
9. Third-party integrations identify workers **only** by `externalId`, never by internal UUID — the Attendance service's integration endpoint resolves `externalId → workerId` before writing.

---

## 3. Service Boundaries

Boundaries are drawn along **ownership of data that changes for different reasons and at
different rates**, per the exercise's request to align schemas with service boundaries.

```
┌─────────────────────────────────────────────────────────────────┐
│                         React + TS Frontend                     │
└──────────────────────────────┬──────────────────────────────────┘
                                │  GraphQL (HTTPS)
┌──────────────────────────────▼──────────────────────────────────┐
│                        GraphQL Gateway (BFF)                    │
│   - AuthN (verifies JWT)                                        │
│   - AuthZ (role + location scope, first line of defense)        │
│   - Schema composition (schema stitching over REST subgraphs)   │
└───────┬───────────────────┬───────────────────┬─────────────────┘
        │ REST/JSON         │ REST/JSON         │ REST/JSON
┌───────▼────────┐  ┌───────▼─────────┐  ┌──────▼───────────────┐
│ Identity Svc    │  │ Org Svc         │  │ Attendance Svc        │
│ (Auth)          │  │ (Company,       │  │ (Attendance Records,  │
│                 │  │  Location,      │  │  Attendance Requests, │
│ users, roles,   │  │  Membership,    │  │  OFF balance)          │
│ simulated login │  │  Feature Flags, │  │                        │
│                 │  │  Job Titles)    │  │  + Integration inbox   │
└───────┬─────────┘  └───────┬─────────┘  └──────┬─────────────────┘
        │                    │                    │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │ identity│          │  org    │          │attendance│   3 separate
   │   db    │          │   db    │          │    db    │   Postgres
   └─────────┘          └─────────┘          └─────────┘   schemas/instances
```

| Service | Owns | Why this boundary |
|---|---|---|
| **identity-service** | `users`, `roles`, credentials (simulated), issues JWTs | Identity/auth changes independently of org structure and has the strictest security surface — isolating it limits blast radius. |
| **org-service** | `companies`, `locations`, `feature_flags`, `location_membership` (worker/manager ↔ location, `jobTitle`), **OFF-day balance (allowance + remaining, sole owner)** | Org structure changes rarely, is read-heavy from every other service (for scoping), and is the single source of truth for "who belongs where", "what's enabled where", and "how many OFF days are left" (decremented atomically here — ADR-0013). |
| **attendance-service** | `attendance_records`, `attendance_requests`, integration inbox, compensating outbox | Highest write volume, its own lifecycle (approvals, integrations), and the most complex business rules — deserves isolation so it can scale/evolve independently. It *consumes* the OFF balance via a synchronous call to org-service but never stores it. |
| **gateway** | No business data. GraphQL schema, request orchestration, AuthN/Z enforcement at the edge. | Single ingress point per the requirement; keeps frontend decoupled from service topology. |

> **Why REST between gateway and services, not gRPC?** See ADR-0007. Short version: for this
> scope, HTTP/JSON keeps the exercise's iteration speed high, is trivially debuggable, and each
> service already needs a REST+Swagger surface for internal tooling / potential direct
> integrations (e.g. the third-party attendance webhook). gRPC is called out as a future
> optimization once traffic volume justifies it.

---

## 4. Clean Architecture per Service

Every backend service follows the same internal layering (Dependency Rule: inner layers know
nothing about outer layers):

```
src/
├── domain/                      # Enterprise business rules — pure TS, zero framework deps
│   ├── entities/                #   Worker, Location, AttendanceRecord, AttendanceRequest...
│   ├── value-objects/           #   ExternalId, DateOnly, OffBalance...
│   ├── errors/                  #   DomainError subclasses (InsufficientOffBalanceError, ...)
│   └── repositories/            #   Interfaces only (IAttendanceRepository) — Dependency Inversion
│
├── application/                 # Use cases (application business rules)
│   ├── use-cases/               #   ApproveAttendanceRequestUseCase, MarkAttendanceUseCase...
│   ├── ports/                   #   IClock, IEventPublisher, IOrgServiceClient (interfaces)
│   └── dto/                     #   Input/Output DTOs for use cases
│
├── infrastructure/               # Frameworks & drivers — implements the interfaces above
│   ├── persistence/
│   │   ├── prisma/              #   schema.prisma, migrations
│   │   └── repositories/        #   PrismaAttendanceRepository implements IAttendanceRepository
│   ├── http-clients/            #   OrgServiceHttpClient implements IOrgServiceClient
│   └── messaging/                #   OutboxPublisher, event consumers (future)
│
├── interface/                    # Interface adapters — controllers, presenters, mappers
│   ├── http/
│   │   ├── controllers/         #   NestJS controllers, thin: DTO in → use case → DTO out
│   │   ├── guards/               #   JwtAuthGuard, RolesGuard, LocationScopeGuard
│   │   └── dto/                 #   class-validator request/response shapes, Swagger decorators
│   └── mappers/                  #   Domain entity ↔ HTTP DTO
│
└── main.ts / module wiring       # NestJS DI container composition root
```

**SOLID mapping**

| Principle | Where it shows up |
|---|---|
| **S**ingle Responsibility | Each use case does exactly one thing (`CreateAttendanceRequestUseCase` never approves anything). Controllers only translate HTTP ↔ use case. |
| **O**pen/Closed | New attendance sources (e.g. a new integration) implement `IAttendanceSource` without modifying `AttendanceRecord` domain logic. |
| **L**iskov Substitution | Any `IAttendanceRepository` implementation (Prisma today, in-memory for tests) is interchangeable behind the interface. |
| **I**nterface Segregation | `IOrgServiceClient` exposes only `getLocationFlags`, `getWorkerMembership` — not a fat "OrgClient" god-interface. |
| **D**ependency Inversion | `application/` depends on `domain/` interfaces, never on `infrastructure/`; infrastructure is wired at the composition root (NestJS module `providers`). |

**Recommended stack:** NestJS (TypeScript) for every service — DI container makes Dependency
Inversion explicit and testable, has first-class `@nestjs/swagger` for OpenAPI generation, and a
mature testing module (`@nestjs/testing`) for fast unit tests with mocked providers. See
ADR-0002.

---

## 5. Data Design (PostgreSQL, database-per-service)

Each service owns its schema exclusively; no cross-service foreign keys. Cross-service
references are stored as opaque IDs and resolved via API calls (or denormalized read models —
see ADR-0007 for the consistency trade-off).

### 5.1 identity-service

```sql
CREATE TYPE role_type AS ENUM ('WORKER', 'MANAGER', 'SUPER_ADMIN');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT NOT NULL UNIQUE,        -- used by 3rd parties & to correlate with org-service
  display_name  TEXT NOT NULL,
  role          role_type NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Simulated auth: no password hashing needed for the exercise, but we model it
-- so a real provider can be swapped in without changing the domain.
CREATE TABLE credentials (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  login_token   TEXT NOT NULL UNIQUE          -- "simulated" — any known token logs in as that user
);
```

### 5.2 org-service

```sql
CREATE TABLE companies (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL
);

CREATE TABLE locations (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                        UUID NOT NULL REFERENCES companies(id),
  name                              TEXT NOT NULL,
  address                           TEXT,
  self_check_in_enabled             BOOLEAN NOT NULL DEFAULT false,
  manager_attendance_marking_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Worker/Manager membership at a Location. A "user" here is a foreign key
-- in the logical sense only (identity-service's user.id) — no physical FK.
CREATE TABLE location_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   UUID NOT NULL REFERENCES locations(id),
  user_id       UUID NOT NULL,                -- identity-service user id
  member_role           role_type NOT NULL,   -- WORKER | MANAGER at this location
  job_title             TEXT,                 -- only meaningful for WORKER members
  annual_off_allowance  INTEGER NOT NULL DEFAULT 12,  -- yearly OFF-day grant (see §2.1.7, ADR-0013)
  off_balance_remaining INTEGER NOT NULL DEFAULT 12,  -- remaining this year; decremented on OFF approval
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, user_id),
  UNIQUE (location_id, job_title) DEFERRABLE INITIALLY IMMEDIATE,  -- job titles unique per location
  CHECK (off_balance_remaining >= 0 AND off_balance_remaining <= annual_off_allowance)
);

CREATE INDEX idx_location_members_user ON location_members(user_id);
```

> The balance is *administered* here (Super Admin sets `annual_off_allowance`; the yearly reset
> restores `off_balance_remaining`). It is *consumed* during request approval via a synchronous,
> atomic conditional decrement against this table (§7, ADR-0013) — org-service is the single owner
> of the number, so there is no cross-service copy to keep consistent.

### 5.3 attendance-service

```sql
CREATE TYPE attendance_status AS ENUM ('PRESENT', 'OFF');
CREATE TYPE attendance_source AS ENUM ('MANAGER', 'INTEGRATION', 'WORKER_REQUEST');
CREATE TYPE request_status    AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE request_kind      AS ENUM ('CHECK_IN_OUT', 'OFF');

CREATE TABLE attendance_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id     UUID NOT NULL,          -- identity-service user id
  location_id   UUID NOT NULL,          -- org-service location id
  date          DATE NOT NULL,
  status        attendance_status NOT NULL,
  source        attendance_source NOT NULL,
  source_ref_id UUID,                   -- e.g. the approved request id, or integration event id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, date)              -- invariant #2
);

CREATE TABLE attendance_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id     UUID NOT NULL,
  location_id   UUID NOT NULL,
  date          DATE NOT NULL,
  kind          request_kind NOT NULL,
  status        request_status NOT NULL DEFAULT 'PENDING',
  note          TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    UUID,                   -- manager user id
  decided_at    TIMESTAMPTZ,
  UNIQUE (worker_id, date) WHERE (status = 'PENDING')   -- invariant #3, partial unique index
);

-- Idempotency ledger for third-party integrations (invariant #9 + at-least-once delivery safety)
CREATE TABLE integration_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_worker_id TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL UNIQUE,
  payload            JSONB NOT NULL,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox for the compensating "OffBalanceRelease" event only (restore a day if the local
-- commit fails after org-service already decremented) — see ADR-0007/ADR-0013
CREATE TABLE outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
```

**Key design notes**

- The `UNIQUE (worker_id, date) WHERE (status = 'PENDING')` partial index enforces "only one
  *pending* request per worker per date" while still allowing historical `REJECTED`/`CANCELLED`
  (and `APPROVED`) rows to accumulate (audit trail) — a plain unique constraint would block that
  history. Resubmitting after a terminal outcome inserts a new row with a new `id`; see ADR-0012.
- `attendance_records` never gets a hard delete; corrections are new rows with a full audit
  trail preserved in `attendance_requests`/`integration_events`.

---

## 6. GraphQL Gateway Design

### 6.1 Composition approach

**Schema stitching over internal REST subgraphs**, not full Apollo Federation. Rationale in
ADR-0003: with only 3 backend services and no need for independent GraphQL subgraph teams,
federation's operational overhead (federation directives, gateway planning, subgraph SDL
contracts) isn't justified. The gateway owns one hand-authored SDL and resolvers call out to
each service's REST API via typed clients — same architectural value (single client-facing
schema, service autonomy) with far less machinery. If team/service count grows, migrating to
Apollo Federation is a low-risk follow-up (resolvers already map 1:1 to services).

### 6.2 SDL (abridged)

```graphql
enum Role { WORKER MANAGER SUPER_ADMIN }
enum AttendanceStatus { PRESENT OFF }
enum RequestStatus { PENDING APPROVED REJECTED CANCELLED }
enum RequestKind { CHECK_IN_OUT OFF }

type Company { id: ID! name: String! locations: [Location!]! }

type Location {
  id: ID!
  name: String!
  address: String
  selfCheckInEnabled: Boolean!
  managerAttendanceMarkingEnabled: Boolean!
  workerCount: Int!
  managerCount: Int!
  pendingApprovalCount: Int!   # PENDING attendance requests at this location (manager dashboard badge)
  members(role: Role): [LocationMember!]!
}

type LocationMember {
  id: ID!
  user: User!
  role: Role!
  jobTitle: String
  annualOffAllowance: Int!     # yearly OFF-day grant (default 12) — see ADR-0013
  offBalanceRemaining: Int!    # remaining this year; drives the mockup's "X of Y" display
}

type User { id: ID! externalId: String! displayName: String! role: Role! locations: [Location!]! }

type AttendanceRecord {
  id: ID!
  worker: User!
  location: Location!
  date: Date!
  status: AttendanceStatus!
  source: String!
}

type AttendanceRequest {
  id: ID!
  worker: User!
  location: Location!
  date: Date!
  kind: RequestKind!
  status: RequestStatus!
  note: String
  decidedBy: User
}

type Query {
  me: User!
  location(id: ID!): Location
  locations: [Location!]!                                  # SUPER_ADMIN
  attendance(locationId: ID!, workerId: ID, from: Date, to: Date, status: AttendanceStatus): [AttendanceRecord!]!
  attendanceRequests(locationId: ID!, status: RequestStatus): [AttendanceRequest!]!  # MANAGER
  myAttendance(from: Date, to: Date): [AttendanceRecord!]!  # WORKER
  myAttendanceRequests(status: RequestStatus): [AttendanceRequest!]!                  # WORKER
}

type Mutation {
  login(loginToken: String!): AuthPayload!

  createAttendanceRequest(locationId: ID!, date: Date!, kind: RequestKind!, note: String): AttendanceRequest!  # WORKER
  cancelAttendanceRequest(id: ID!): AttendanceRequest!                                                           # WORKER
  approveAttendanceRequest(id: ID!): AttendanceRequest!                                                          # MANAGER
  rejectAttendanceRequest(id: ID!, reason: String): AttendanceRequest!                                           # MANAGER
  markAttendance(locationId: ID!, workerId: ID!, date: Date!, status: AttendanceStatus!): AttendanceRecord!      # MANAGER

  createLocation(companyId: ID!, name: String!, address: String): Location!                                     # SUPER_ADMIN
  setLocationFeatureFlags(locationId: ID!, selfCheckInEnabled: Boolean, managerAttendanceMarkingEnabled: Boolean): Location! # SUPER_ADMIN
  addLocationMember(locationId: ID!, userId: ID!, role: Role!, jobTitle: String): LocationMember!               # SUPER_ADMIN
}

type AuthPayload { token: String! user: User! }
scalar Date
```

### 6.3 Gateway responsibilities

1. Terminate TLS, parse & verify the JWT (see §8).
2. Populate a `RequestContext { userId, role, locationIds[] }` from JWT claims.
3. First-pass **coarse authorization**: reject obviously out-of-role operations before any
   downstream call (e.g. a `WORKER` calling `approveAttendanceRequest` is rejected at the
   resolver boundary with a GraphQL `FORBIDDEN` error, no network call made).
4. Forward the JWT (or a derived internal service token) on every downstream REST call so each
   service can independently re-verify (defense in depth — see ADR-0005/0006).
5. Aggregate/compose responses (e.g. `AttendanceRecord.worker` resolver calls identity-service;
   `AttendanceRecord.location` resolver calls org-service), with **DataLoader** batching to avoid
   N+1 calls to downstream REST APIs.

---

## 7. Data Consistency Across Services

Two consistency-sensitive flows cross service boundaries:

**Flow A — Approve Attendance Request** (attendance-service is authoritative, but must confirm
the manager is scoped to the location, an org-service fact):

```
Gateway → attendance-svc.approveRequest(id)
  attendance-svc:
    1. Load request (must be PENDING)
    2. Call org-svc: GET /locations/{id}/members?userId={managerId}&role=MANAGER
       → 403 if manager isn't a member of that location  (invariant #5)
    3. If kind=OFF: call org-svc atomic conditional decrement (invariant #7, ADR-0013)
         POST /locations/{id}/members/{workerId}/off-balance:consume
         → org-svc: UPDATE location_members
                      SET off_balance_remaining = off_balance_remaining - 1
                    WHERE ... AND off_balance_remaining > 0   (returns rows-affected)
         → INVALID_STATE (InsufficientOffBalanceError) if 0 rows affected — approval aborts here,
           nothing is committed in attendance-svc.
    4. BEGIN TRANSACTION
         UPDATE attendance_requests SET status='APPROVED', decided_by, decided_at
         UPSERT attendance_records (worker_id, date) ON CONFLICT DO UPDATE   (invariant #2, #6)
       COMMIT
    5. If step 4 fails after a successful step 3 decrement: enqueue an outbox_events row
       (type='OffBalanceRelease') so a background publisher restores the day — the only
       compensating action, for a rare failure window.
```

The OFF-balance decrement is a **synchronous, atomic conditional update** in org-service (the sole
owner of the number), performed *before* the local commit. This makes the "cannot go negative"
invariant (#7) race-free: two concurrent approvals cannot both see a positive balance and both
succeed, because the `WHERE off_balance_remaining > 0` update serializes at the row. The
**outbox pattern** (table `outbox_events` + a polling publisher) is retained only for the rare
*compensating* case (step 5) — restoring a consumed day if the local commit fails after the
decrement — not for the happy-path decrement itself. This avoids both a distributed transaction
(2PC) and a message broker while keeping the balance strongly consistent on the critical path.
See ADR-0007 for alternatives considered (async decrement via outbox, synchronous 2-phase call,
Saga/choreography, full event bus) and why this shape was chosen.

**Flow B — Third-party integration check-in** (idempotent write):

```
POST /integrations/attendance  (attendance-service, API-key authenticated, no user JWT)
  body: { externalWorkerId, locationExternalRef, date, status, idempotencyKey }
  1. Resolve externalWorkerId → workerId via identity-svc (cached, short TTL)
  2. INSERT INTO integration_events (idempotency_key UNIQUE) — reject duplicate deliveries
  3. UPSERT attendance_records (source='INTEGRATION')
```

**Read-side consistency:** the gateway always reads location feature flags and membership live
from org-service (small, low-latency, cacheable with a 5–10s TTL) rather than denormalizing them
into attendance-service, keeping org-service the single source of truth for anything
location-scoped, per the domain requirement.

---

## 8. Authentication

- Authentication is **simulated** per the spec: `identity-service` exposes
  `POST /auth/login { loginToken }` and returns a signed **JWT** (HS256 for the exercise; RS256 +
  JWKS noted as the production upgrade in ADR-0005) containing:
  ```json
  { "sub": "<userId>", "externalId": "...", "role": "WORKER", "iat": ..., "exp": ... }
  ```
  Seed data ships a fixed `loginToken` per seeded user (e.g. `tom-reyes-token`) so any evaluator
  can "log in as" any persona instantly — mirrors the mockups' "Viewing as Worker / Manager /
  Super admin" switcher.
- The **gateway** is the only component that terminates the JWT from the browser (`Authorization:
  Bearer <token>`), validates signature + expiry, and forwards it unchanged as an internal
  service-to-service header to Identity, Org, and Attendance.
- **Every backend service independently re-validates the JWT** (shared secret / shared JWKS via
  an internal `@wfms/auth` npm package) rather than trusting an internal-network header blindly —
  zero-trust between services, not just at the edge. This is deliberate over "gateway validates
  once, services trust the network" — see ADR-0005.
- The third-party integration endpoint uses a **separate credential** (static API key per
  integration partner, stored hashed in `attendance-service`), never the user JWT — it identifies
  a *system*, not a *person* (invariant #9).

---

## 9. Authorization

Two layers, both enforced (defense in depth), never just one:

1. **Gateway (coarse, role-based):** a `RolesGuard`-equivalent on each resolver rejects
   obviously-wrong roles before any network hop (e.g. `WORKER` → `approveAttendanceRequest`).
2. **Service (fine-grained, location-scoped):** each mutating use case in `attendance-service`
   and `org-service` re-checks:
   - Is this user a member (`MANAGER`) of the target `locationId`? (`location_members` lookup)
   - Is this the *owner* worker for worker-scoped operations (`createAttendanceRequest`,
     `cancelAttendanceRequest`, `myAttendance*`)?
   - `SUPER_ADMIN` bypasses location scoping entirely (company-wide).

| Action | WORKER | MANAGER (own locations) | SUPER_ADMIN |
|---|---|---|---|
| View own attendance/requests | ✅ | ✅ (any worker in their locations) | ✅ (all) |
| Create/cancel own attendance request | ✅ (`CHECK_IN_OUT` only if `selfCheckInEnabled`; `OFF` always allowed, gated by balance — ADR-0011) | ❌ | ❌ |
| Approve/reject attendance request | ❌ | ✅ (own locations only) | ✅ |
| Mark attendance directly | ❌ | ✅ (if `managerAttendanceMarkingEnabled`) | ✅ |
| Manage locations / feature flags / members | ❌ | ❌ | ✅ |

This table is implemented as declarative guards (`@Roles('MANAGER')`,
`@LocationScope('params.locationId')`) on NestJS controllers, backed by unit tests that assert
every endpoint has at least one guard (a "no naked controller" lint-style test — see §11).

---

## 10. Frontend (React + TypeScript)

- **Apollo Client** talking only to the gateway's single `/graphql` endpoint (enforces the
  "frontend only talks to the gateway" requirement structurally — no other base URL exists in
  the frontend config).
- **Role-aware routing**: a `ViewingAsSwitcher` (matches the mockups) toggles the active persona
  among seeded users for demo purposes; in a real deployment this maps 1:1 to the logged-in
  user's actual role.
- **Structure** (feature-sliced, mirrors backend boundaries so contributors can navigate both
  sides consistently):
  ```
  src/
  ├── app/            # routing, Apollo provider, auth context
  ├── features/
  │   ├── attendance/  # Manager + Worker attendance table views, mutations
  │   ├── locations/   # Super-admin locations & feature flags view
  │   └── auth/        # login / persona switcher
  ├── components/      # shared presentational components (Table, StatusPill, Modal...)
  └── graphql/         # generated types (graphql-codegen) + queries/mutations (.graphql files)
  ```
- **codegen**: `graphql-codegen` generates TypeScript types + typed hooks from the gateway SDL —
  no hand-written response types, no drift between schema and frontend.
- Three top-level views matching the mockups: **Manager** (attendance queue + approve/reject),
  **Worker** (my attendance + request form), **Super Admin** (locations, feature flags, people).

---

## 11. Testing Strategy (target ≥90% line coverage per service)

| Layer | Tool | What's covered |
|---|---|---|
| **Domain** | Jest | Pure unit tests on entities/value objects/domain services — no mocks needed, fastest tests, highest count. All invariants in §2.1 have a dedicated test (e.g. `off-balance.spec.ts` asserts balance never goes negative). |
| **Application (use cases)** | Jest + hand-written fakes | Use cases tested against in-memory fake repositories (`InMemoryAttendanceRepository implements IAttendanceRepository`) — no DB, no HTTP — fast and deterministic. |
| **Infrastructure** | Jest + Testcontainers (Postgres) | Repository implementations tested against a real ephemeral Postgres container to catch SQL/constraint mismatches (e.g. the partial unique index actually behaves as designed). |
| **Interface (HTTP)** | Supertest against a NestJS `TestingModule` | Controller + guard behavior: correct status codes, correct 403s for wrong role/location, Swagger contract matches actual responses. |
| **Gateway** | Jest + `apollo-server-testing` | Resolver-level tests with mocked REST clients; verifies coarse authorization and DataLoader batching (no N+1). |
| **Cross-service** | Jest integration suite + docker-compose | The two critical flows in §7 (approve request → balance decrement; integration check-in idempotency) run end-to-end against all three services + Postgres in CI. |
| **Frontend** | Vitest + React Testing Library | Component tests for the three main views; MSW (Mock Service Worker) mocks the `/graphql` endpoint. |
| **E2E (smoke)** | Playwright | One happy-path per persona (Worker requests OFF → Manager approves → balance updates; Super Admin toggles a feature flag and sees it take effect). |

**Coverage enforcement:** `jest.config.ts` sets `coverageThreshold: { global: { lines: 90,
branches: 85 } }` per service, wired into CI (`ci.yml`) so a PR fails the build under threshold.
Domain and application layers realistically reach 95–100%; infrastructure/interface glue code is
the harder-to-cover 10%, which is why the branch threshold is slightly lower than the line
threshold.

---

## 12. API Documentation (Swagger/OpenAPI)

- Each service (`identity`, `org`, `attendance`) uses `@nestjs/swagger` to generate a live
  OpenAPI 3 document from the same decorators used for validation (`class-validator` DTOs +
  `@ApiProperty`), so docs cannot drift from the actual request/response shape.
- Served at `GET /docs` (Swagger UI) and `GET /docs-json` (raw spec) on each service, **and**
  aggregated at the gateway under `/docs/{service}` for convenience during evaluation.
- The GraphQL schema itself is self-documenting via introspection; Apollo Sandbox is exposed at
  `/graphql` in non-production environments.
- All mutating endpoints document their required role/scope in the OpenAPI description (pulled
  from the same guard metadata used at runtime — single source of truth).

---

## 13. Local Development & Docker

`docker-compose.yml` (see accompanying file) provisions three isolated Postgres instances (one
per service, honoring database-per-service) plus the three Nest services and the gateway:

```
docker compose up -d postgres-identity postgres-org postgres-attendance
pnpm --filter identity-service prisma migrate deploy && pnpm --filter identity-service seed
pnpm --filter org-service prisma migrate deploy && pnpm --filter org-service seed
pnpm --filter attendance-service prisma migrate deploy && pnpm --filter attendance-service seed
pnpm dev   # turbo/nx: runs all 4 backend processes + the frontend concurrently
```

Seed data reproduces the mockups: 1 company ("Future Enterprises"), 3 locations (Aramark
Boulder CO, NRG Park, Wembley Stadium) with differing feature-flag combinations, ~5 workers with
job titles, 2 managers, 1 super admin, and a mix of `PENDING`/`APPROVED`/integration-sourced
attendance rows so every view in the mockups has representative data on first load.

---

## 14. Non-Functional Considerations

- **Idempotency:** all mutation endpoints accept an optional `Idempotency-Key` header (mandatory
  for the integration endpoint) to make retries safe.
- **Observability:** structured JSON logs (`pino`) with `requestId` propagated from
  gateway → services via header; not wired to a full APM stack for this scope (roadmap item).
- **Error model:** domain errors map to typed GraphQL error codes (`FORBIDDEN`,
  `INVALID_STATE`, `NOT_FOUND`, `CONFLICT`) via a shared `mapDomainErrorToGraphQLError` in the
  gateway, so the frontend can branch on `error.extensions.code` rather than string-matching
  messages.
- **Migrations:** Prisma Migrate, one migration history per service, applied in CI before tests.

---

## 15. What Would Be Built Next

1. Replace simulated auth with a real IdP (Auth0/Cognito) — JWKS-based RS256 verification is
   already the designed upgrade path (ADR-0005).
2. Move Flow A's outbox publisher from polling to a proper broker (SNS/SQS or Kafka) once
   cross-service event volume justifies it (ADR-0007 revisit trigger documented there).
3. Migrate the gateway from schema-stitching to Apollo Federation if/when services are owned by
   separate teams (ADR-0003 revisit trigger).
4. Add scheduling/shift-planning as a new bounded context, reusing `location_members` as the
   membership source of truth.
5. Multi-company support (the domain currently hard-assumes a single Company).
6. Push notifications for pending approvals (Manager) and decisions (Worker).

---

## 16. Index of Architecture Decision Records

The ADR files live alongside this document in `docs/`; summary below.

| ADR | Title |
|---|---|
| [0001](ADR-0001-microservices-over-monolith.md) | Microservices over a modular monolith |
| [0002](ADR-0002-nestjs-typescript-stack.md) | NestJS + TypeScript as the uniform service stack |
| [0003](ADR-0003-graphql-gateway-schema-stitching.md) | GraphQL Gateway via schema stitching, not Apollo Federation |
| [0004](ADR-0004-database-per-service-postgres.md) | Database-per-service with PostgreSQL |
| [0005](ADR-0005-authentication-jwt-defense-in-depth.md) | Simulated JWT auth, re-verified at every service |
| [0006](ADR-0006-authorization-rbac-location-scoped.md) | RBAC + location-scoped authorization, enforced at gateway and service |
| [0007](ADR-0007-cross-service-consistency-outbox.md) | Synchronous REST + Outbox pattern for cross-service consistency |
| [0008](ADR-0008-testing-strategy-coverage.md) | Test pyramid with ≥90% coverage gate |
| [0009](ADR-0009-orm-prisma.md) | Prisma as the ORM/migration tool |
| [0010](ADR-0010-frontend-apollo-codegen.md) | Apollo Client + GraphQL Codegen on the frontend |
| [0011](ADR-0011-feature-flags-semantics.md) | Semantics of location feature flags |
| [0012](ADR-0012-attendance-request-per-date-lifecycle.md) | One active attendance request per worker/date, with retained history |
| [0013](ADR-0013-off-balance-semantics.md) | OFF-day balance semantics (per-location allowance vs. remaining) |
