# Requirements Traceability Matrix — Workforce Management System

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Purpose** | Map every requirement in the source brief (`thiago.pdf`) to where it is *designed* (TDR / ADR) and where it is *proven* (curl playbook test IDs). |
| **Related** | [`TDR.md`](TDR.md), [`CURL_TEST_PLAYBOOK.md`](CURL_TEST_PLAYBOOK.md), ADR-0001 … ADR-0013 |

Every brief requirement must have **both** a design anchor and at least one acceptance test. A row
with no test is a requirement that is documented but not demonstrated — treated as incomplete.

---

## 1. Domain & structure

| # | Requirement (brief) | Designed in | Verified by |
|---|---|---|---|
| R-01 | Multiple backend microservices | TDR §3; ADR-0001 | T-DOC-01, T-DEEP-01/02/03 |
| R-02 | A single GraphQL gateway; frontend talks only to it | TDR §6; ADR-0003, ADR-0010 | T-DOC-03; ADR-0010 (structural — no other endpoint configured) |
| R-03 | React + TypeScript frontend | TDR §10; ADR-0010 | (frontend suite — TDR §11 Vitest/Playwright) |
| R-04 | Single company, multiple locations | TDR §2, §5.2 | T-ORG-01, T-ORG-03 |
| R-05 | All permissions/ownership scoped at the location level | TDR §9; ADR-0006 | T-ORG-02, T-ORG-05, T-APR-03, T-DEEP-02, T-DEEP-03 |

## 2. Feature flags

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-06 | `selfCheckInEnabled` influences behaviour | ADR-0011; TDR §2.1(1) | T-REQ-01, T-REQ-02, T-REQ-03, T-ORG-04 |
| R-07 | `managerAttendanceMarkingEnabled` influences behaviour | ADR-0011; TDR §2.1(1) | T-APR-05, T-APR-06 |

## 3. Worker & Manager

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-08 | Worker belongs to one or more locations | TDR §5.2 (`location_members`) | T-ORG-06, T-AUTH-05 |
| R-09 | Worker has a unique external identifier | TDR §5.1 (`users.external_id UNIQUE`) | T-INT-01, T-AUTH-05 |
| R-10 | Worker has a job title per location | TDR §5.2 | T-ORG-06 |
| R-11 | Job titles unique within a location | TDR §2.1(4), §5.2; invariant #4 | T-ORG-07, T-ORG-08 |
| R-12 | Manager belongs to one or more locations | TDR §5.2 | T-APR-01, T-APR-03 |

## 4. Attendance

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-13 | Attendance per worker/date/location, PRESENT or OFF | TDR §5.3; §2.1(2) | T-APR-02, T-APR-05, T-INT-01, T-ATT-01 |
| R-14 | Attendance may originate from manager / integration / approved request | TDR §5.3 (`attendance_source`) | T-APR-05 (MANAGER), T-INT-01 (INTEGRATION), T-APR-02 (WORKER_REQUEST) |
| R-15 | Workers cannot directly modify attendance | TDR §9; §2.1(6) | T-REQ-08, T-RBAC-03 |
| R-16 | Exactly one attendance record per worker per date | TDR §2.1(2); invariant #2 | T-ATT-01 |

## 5. Attendance requests

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-17 | Requests must be approved by a manager to affect attendance | TDR §2.1(6), §7 Flow A | T-APR-01, T-APR-02 |
| R-18 | Request kinds: CHECK_IN_OUT (PRESENT) / OFF | TDR §5.3 (`request_kind`) | T-REQ-01, T-REQ-03 |
| R-19 | Exactly one *active* request per worker per date | TDR §2.1(3), §5.3; ADR-0012; invariant #3 | T-REQ-04, T-REQ-06 |
| R-20 | Requests may target past and future dates | TDR §2.1(8); invariant #8 | T-REQ-07 |
| R-21 | Managers may only approve for locations they manage | TDR §2.1(5), §9; ADR-0006; invariant #5 | T-APR-03, T-DEEP-03 |
| R-22 | Once approved, the request updates the attendance record | TDR §2.1(6), §7 Flow A; invariant #6 | T-APR-02 |
| R-23 | Statuses: PENDING / APPROVED / REJECTED / CANCELLED | TDR §5.3 (`request_status`); ADR-0012 | T-REQ-01, T-REQ-05, T-APR-01, T-APR-04 |

## 6. OFF-day balance

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-24 | Workers have an annual OFF-day balance | TDR §2.1(7), §5.2; ADR-0013; invariant #7 | T-BAL-01 |
| R-25 | Balance is decremented on approval and cannot go negative | TDR §7 Flow A; ADR-0007, ADR-0013 | T-BAL-02, T-BAL-03 |

## 7. Roles, auth & integration

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-26 | Roles WORKER / MANAGER / SUPER_ADMIN | TDR §2, §5.1 (`role_type`) | Section 8 (full RBAC matrix) |
| R-27 | Authorization enforced appropriately | TDR §9; ADR-0006 | Section 8; T-DEEP-02, T-DEEP-03 |
| R-28 | Authentication (may be simulated) | TDR §8; ADR-0005 | Section 1 (T-AUTH-01…05) |
| R-29 | Third-party systems identify workers by external identifier | TDR §2.1(9), §5.3; invariant #9 | T-INT-01 |
| R-30 | Idempotent third-party delivery | TDR §5.3 (`integration_events`), §7 Flow B | T-INT-03 |
| R-31 | Integration uses a system credential, not a user JWT | TDR §8 | T-INT-02 |

## 8. Persistence & docs

| # | Requirement | Designed in | Verified by |
|---|---|---|---|
| R-32 | Relational DB (PostgreSQL), schema per service boundary | TDR §5; ADR-0004, ADR-0009 | T-DOC-01 (services live); schema in TDR §5 |
| R-33 | Swagger / OpenAPI documentation | TDR §12 | T-DOC-01, T-DOC-02 |
| R-34 | Seed enough data to demonstrate the system | TDR §13 | Section 0 (seed personas/locations), all tests depend on it |

---

## Gaps / notes

- **R-03 (frontend)** is verified by the component/E2E suites described in TDR §11, not by the curl
  playbook (curl exercises the API boundary, not the React app).
- **R-02 "frontend only talks to the gateway"** is enforced *structurally* (ADR-0010: no other
  base URL exists in the frontend config) rather than by a runtime test — flagged as such in the
  playbook §11 coverage checklist.
- Interpretation decisions made under genuine spec ambiguity are recorded as ADRs, not left
  implicit: feature-flag semantics (ADR-0011), request-per-date lifecycle (ADR-0012), OFF-balance
  scope (ADR-0013), and attendance uniqueness key (TDR §2.1(2) note).
