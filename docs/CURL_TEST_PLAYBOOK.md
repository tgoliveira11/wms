# Curl Test Playbook — Workforce Management System

| | |
|---|---|
| **Status** | Draft v1.0 |
| **Scope** | Acceptance tests, run with `curl`, against the API contract defined in `TDR.md` |
| **Purpose** | Prove every requirement in the source brief and every invariant in TDR §2.1 is actually enforced at the API boundary — not just designed on paper |

> This playbook is written **against the designed contract**, so it doubles as the acceptance
> spec the implementation must satisfy (write these tests before/alongside the code — see
> `scripts/run_curl_tests.sh` for a runnable version). Every test ID below is cross-referenced
> from `REQUIREMENTS_TRACEABILITY.md`.

---

## 0. Environment

```bash
export GATEWAY=http://localhost:4000/graphql
export ORG_SVC=http://localhost:3002        # direct, for defense-in-depth tests only (§9)
export ATTENDANCE_SVC=http://localhost:3003 # direct, for the integration endpoint (§7)
export IDENTITY_SVC=http://localhost:3001   # direct, for defense-in-depth tests only (§9)
```

**Seed personas** (per TDR §13 seed data), each with a fixed simulated login token:

| Persona | Role | Location(s) | Login token |
|---|---|---|---|
| Alex Rivera | SUPER_ADMIN | all | `admin-token` |
| Megan Garcia | MANAGER | Aramark Boulder CO | `megan-garcia-token` |
| Priya Nair | MANAGER | NRG Park | `priya-nair-token` |
| Tom Reyes | WORKER (Food server) | Aramark Boulder CO | `tom-reyes-token` |
| Jamie Cole | WORKER (Concession) | Aramark Boulder CO | `jamie-cole-token` |
| Lin Huang | WORKER (Cook) | Aramark Boulder CO, NRG Park | `lin-huang-token` |

**Seed locations**:

| Location | selfCheckInEnabled | managerAttendanceMarkingEnabled |
|---|---|---|
| Aramark Boulder CO | `true` | `true` |
| NRG Park | `false` | `true` |
| Wembley Stadium | `true` | `false` |

Every test below uses `jq` to extract values into shell variables so later tests can chain off
earlier ones. Run section 1 first — every other section depends on its tokens.

---

## 1. Authentication (TDR §8, ADR-0005)

### T-AUTH-01 — Login as each seeded persona succeeds and returns a JWT

```bash
ADMIN_TOKEN=$(curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token user { id role displayName } } }",
  "variables": { "t": "admin-token" }
}' | jq -r '.data.login.token')
echo "ADMIN_TOKEN=$ADMIN_TOKEN"   # expect a non-empty JWT string

MANAGER_TOKEN=$(curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token user { id role displayName } } }",
  "variables": { "t": "megan-garcia-token" }
}' | jq -r '.data.login.token')

PRIYA_MANAGER_TOKEN=$(curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token } }",
  "variables": { "t": "priya-nair-token" }
}' | jq -r '.data.login.token')

WORKER_TOKEN=$(curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token user { id role displayName } } }",
  "variables": { "t": "tom-reyes-token" }
}' | jq -r '.data.login.token')

JAMIE_TOKEN=$(curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token } }",
  "variables": { "t": "jamie-cole-token" }
}' | jq -r '.data.login.token')

# Lin Huang is a member of BOTH Aramark Boulder CO and NRG Park — used by the
# self-check-in-flag tests (T-REQ-02/03) and the cross-location approval test (T-APR-03).
LIN_TOKEN=$(curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token } }",
  "variables": { "t": "lin-huang-token" }
}' | jq -r '.data.login.token')
```
**Expect:** HTTP 200, `data.login.token` present and non-null for every persona, `user.role`
matches the table above.

### T-AUTH-02 — Login with an unknown token is rejected

```bash
curl -s -o /dev/null -w "%{http_code}\n" $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "mutation($t:String!){ login(loginToken:$t){ token } }",
  "variables": { "t": "not-a-real-token" }
}'
```
**Expect:** HTTP 200 (GraphQL always returns 200) with `errors[0].extensions.code = "UNAUTHENTICATED"` and `data.login = null`.

### T-AUTH-03 — Any authenticated query without a token is rejected

```bash
curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "{ me { id role } }"
}' | jq '.errors[0].extensions.code'
```
**Expect:** `"UNAUTHENTICATED"`.

### T-AUTH-04 — A tampered/invalid JWT is rejected

```bash
curl -s $GATEWAY -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.invalid.signature" \
  -H 'Content-Type: application/json' -d '{ "query": "{ me { id } }" }' | jq '.errors[0].extensions.code'
```
**Expect:** `"UNAUTHENTICATED"`.

### T-AUTH-05 — `me` returns the correct identity per token (sanity check before every other section)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "query": "{ me { id externalId displayName role } }" }' | jq '.data.me'
```
**Expect:** `role: "WORKER"`, `displayName: "Tom Reyes"`.

---

## 2. Company & Location — Super Admin (TDR §2 Company/Location, §9)

### T-ORG-01 — SUPER_ADMIN lists all locations

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ locations { id name selfCheckInEnabled managerAttendanceMarkingEnabled workerCount managerCount pendingApprovalCount } }"
}' | tee /tmp/locations.json | jq '.data.locations'

BOULDER_ID=$(jq -r '.data.locations[] | select(.name=="Aramark Boulder CO") | .id' /tmp/locations.json)
NRG_ID=$(jq -r '.data.locations[] | select(.name=="NRG Park") | .id' /tmp/locations.json)
WEMBLEY_ID=$(jq -r '.data.locations[] | select(.name=="Wembley Stadium") | .id' /tmp/locations.json)
```
**Expect:** 3 locations returned, flags matching the seed table in §0.

### T-ORG-02 — A non-SUPER_ADMIN cannot list all locations

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ locations { id name } }"
}' | jq '.errors[0].extensions.code'
```
**Expect:** `"FORBIDDEN"` — coarse RBAC block at the gateway (ADR-0006), no downstream call made.

### T-ORG-03 — SUPER_ADMIN creates a new location

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "mutation($cid:ID!,$n:String!){ createLocation(companyId:$cid, name:$n, address:\"100 Test Ave\") { id name selfCheckInEnabled managerAttendanceMarkingEnabled } }",
  "variables": { "cid": "<COMPANY_ID>", "n": "Test Arena" }
}' | jq '.data.createLocation'
```
**Expect:** new location returned with default flags (`selfCheckInEnabled: false`, `managerAttendanceMarkingEnabled: true` per TDR §5.2 defaults).

### T-ORG-04 — SUPER_ADMIN toggles feature flags and the change is immediately visible

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ setLocationFeatureFlags(locationId:\$id, selfCheckInEnabled:true){ id selfCheckInEnabled } }\",
  \"variables\": { \"id\": \"$NRG_ID\" }
}" | jq '.data.setLocationFeatureFlags'
```
**Expect:** `selfCheckInEnabled: true`. Re-run T-DOM-04 (self-check-in-disabled test) afterward and confirm it now behaves per the *new* flag value, then flip it back — proves the flag is read live, not cached indefinitely (TDR §7 read-side consistency, 5–10s TTL).

### T-ORG-05 — MANAGER cannot toggle feature flags or create locations

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ setLocationFeatureFlags(locationId:\$id, selfCheckInEnabled:false){ id } }\",
  \"variables\": { \"id\": \"$BOULDER_ID\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"FORBIDDEN"`.

### T-ORG-06 — SUPER_ADMIN adds a location member with a job title

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$u:ID!){ addLocationMember(locationId:\$loc, userId:\$u, role:WORKER, jobTitle:\\\"Bartender\\\"){ id jobTitle annualOffAllowance offBalanceRemaining } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"u\": \"<NEW_USER_ID>\" }
}" | jq '.data.addLocationMember'
```
**Expect:** member created, `annualOffAllowance`/`offBalanceRemaining` default to the seeded value (e.g. 12).

### T-ORG-07 — Job titles are unique within a location (invariant #4)

Add a second member to `$BOULDER_ID` with `jobTitle: "Bartender"` (same title used in T-ORG-06):

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$u:ID!){ addLocationMember(locationId:\$loc, userId:\$u, role:WORKER, jobTitle:\\\"Bartender\\\"){ id } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"u\": \"<ANOTHER_NEW_USER_ID>\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"CONFLICT"` — the `(location_id, job_title)` unique constraint (TDR §5.2) is violated.

### T-ORG-08 — The *same* job title is allowed at a *different* location

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$u:ID!){ addLocationMember(locationId:\$loc, userId:\$u, role:WORKER, jobTitle:\\\"Bartender\\\"){ id } }\",
  \"variables\": { \"loc\": \"$WEMBLEY_ID\", \"u\": \"<ANOTHER_NEW_USER_ID>\" }
}" | jq '.data.addLocationMember'
```
**Expect:** success — uniqueness is scoped per location, not global (proves T-ORG-07 isn't accidentally over-broad).

---

## 3. Worker Attendance Requests (TDR §2.1 invariants #1, #3, #8; ADR-0011, ADR-0012)

### T-REQ-01 — Worker submits a CHECK_IN_OUT request at a self-check-in-enabled location

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:CHECK_IN_OUT, note:\\\"Badge scan failed at gate\\\"){ id status kind date } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"d\": \"2026-07-10\" }
}" | tee /tmp/req1.json | jq '.data.createAttendanceRequest'
REQ1_ID=$(jq -r '.data.createAttendanceRequest.id' /tmp/req1.json)
```
**Expect:** `status: "PENDING"`. Boulder has `selfCheckInEnabled: true` per seed data.

### T-REQ-02 — CHECK_IN_OUT request is blocked where `selfCheckInEnabled = false` (ADR-0011)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $LIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:CHECK_IN_OUT){ id } }\",
  \"variables\": { \"loc\": \"$NRG_ID\", \"d\": \"2026-07-10\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"INVALID_STATE"` — NRG Park has `selfCheckInEnabled: false`.

### T-REQ-03 — An OFF request is still allowed at that same self-check-in-disabled location (ADR-0011's narrower reading)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $LIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:OFF, note:\\\"Family event\\\"){ id status kind } }\",
  \"variables\": { \"loc\": \"$NRG_ID\", \"d\": \"2026-07-11\" }
}" | jq '.data.createAttendanceRequest'
```
**Expect:** success, `status: "PENDING"` — proves the flag gates only `CHECK_IN_OUT`, not `OFF`.

### T-REQ-04 — Duplicate request for the same worker/date while one is PENDING is rejected (invariant #3 / ADR-0012)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:OFF){ id } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"d\": \"2026-07-10\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"CONFLICT"` — a request already exists (`$REQ1_ID`, PENDING) for Tom Reyes on `2026-07-10`.

### T-REQ-05 — Worker cancels their own PENDING request

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ cancelAttendanceRequest(id:\$id){ id status } }\",
  \"variables\": { \"id\": \"$REQ1_ID\" }
}" | jq '.data.cancelAttendanceRequest'
```
**Expect:** `status: "CANCELLED"`.

### T-REQ-06 — Re-submitting for the *same* date after cancellation creates a NEW row and preserves history (ADR-0012)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:OFF, note:\\\"changed my mind, need it off\\\"){ id status } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"d\": \"2026-07-10\" }
}" | tee /tmp/req1b.json | jq '.data.createAttendanceRequest'
REQ1B_ID=$(jq -r '.data.createAttendanceRequest.id' /tmp/req1b.json)
echo "new id? $([ "$REQ1_ID" != "$REQ1B_ID" ] && echo YES || echo NO)"

# The cancelled original must still be queryable as history, not overwritten:
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ myAttendanceRequests { id status date } }"
}' | jq '[.data.myAttendanceRequests[] | select(.date=="2026-07-10")] | { rows: length, statuses: (map(.status)|sort) }'
```
**Expect:** the create returns `status: "PENDING"` with **`REQ1B_ID != REQ1_ID`** (a fresh row).
The history query returns **two** rows for `2026-07-10` — the original `CANCELLED` one (`$REQ1_ID`)
and the new `PENDING` one (`$REQ1B_ID`). This is the core regression test for ADR-0012: resubmission
after a terminal outcome inserts a new row (the partial unique index only constrains `PENDING`),
and the audit trail is preserved rather than reused in place.

### T-REQ-07 — Attendance requests can target past and future dates (invariant #8)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $JAMIE_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:OFF){ id date status } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"d\": \"2026-01-15\" }
}" | jq '.data.createAttendanceRequest'   # a PAST date

curl -s $GATEWAY -H "Authorization: Bearer $JAMIE_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:OFF){ id date status } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"d\": \"2026-12-24\" }
}" | jq '.data.createAttendanceRequest'   # a FUTURE date
```
**Expect:** both succeed with no date-range validation error.

### T-REQ-08 — Workers cannot directly modify attendance (no such mutation exists / is authorized)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$w:ID!,\$d:Date!){ markAttendance(locationId:\$loc, workerId:\$w, date:\$d, status:PRESENT){ id } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"w\": \"<TOM_USER_ID>\", \"d\": \"2026-07-12\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"FORBIDDEN"` — `markAttendance` requires `MANAGER`/`SUPER_ADMIN` (TDR §9 authorization table).

---

## 4. Manager Approval Workflow (invariants #5, #6; ADR-0006, ADR-0007)

### T-APR-01 — Manager approves a request for a location they manage

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ approveAttendanceRequest(id:\$id){ id status decidedBy { id displayName } } }\",
  \"variables\": { \"id\": \"$REQ1B_ID\" }
}" | jq '.data.approveAttendanceRequest'
```
**Expect:** `status: "APPROVED"`, `decidedBy.displayName: "Megan Garcia"`.

### T-APR-02 — Approval actually updates the attendance record (invariant #6, transactional)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ myAttendance(from:\"2026-07-10\", to:\"2026-07-10\"){ date status source } }"
}' | jq '.data.myAttendance'
```
**Expect:** exactly one record, `status: "OFF"`, `source: "WORKER_REQUEST"`.

### T-APR-03 — A Manager cannot approve a request outside their managed locations (invariant #5)

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$d:Date!){ createAttendanceRequest(locationId:\$loc, date:\$d, kind:OFF){ id } }\",
  \"variables\": { \"loc\": \"$NRG_ID\", \"d\": \"2026-08-01\" }
}"
# (submitted as Lin Huang, a member of both Boulder and NRG — reuse $LIN_TOKEN, capture id as $NRG_REQ_ID)

curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ approveAttendanceRequest(id:\$id){ id } }\",
  \"variables\": { \"id\": \"$NRG_REQ_ID\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"FORBIDDEN"` — Megan Garcia manages Boulder, not NRG Park; Priya Nair (`$PRIYA_MANAGER_TOKEN`) should succeed on the same request.

### T-APR-04 — Manager rejects a request with a reason

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ rejectAttendanceRequest(id:\$id, reason:\\\"Needs supervisor sign-off first\\\"){ id status } }\",
  \"variables\": { \"id\": \"<PAST_DATE_REQ_ID_FROM_T-REQ-07>\" }
}" | jq '.data.rejectAttendanceRequest'
```
**Expect:** `status: "REJECTED"`. Confirm no `attendance_records` row was created for that date via `myAttendance`.

### T-APR-05 — Manager marks attendance directly where `managerAttendanceMarkingEnabled = true`

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$w:ID!,\$d:Date!){ markAttendance(locationId:\$loc, workerId:\$w, date:\$d, status:PRESENT){ id status source } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"w\": \"<JAMIE_USER_ID>\", \"d\": \"2026-07-13\" }
}" | jq '.data.markAttendance'
```
**Expect:** success, `source: "MANAGER"`.

### T-APR-06 — Direct marking is blocked where `managerAttendanceMarkingEnabled = false`

```bash
curl -s $GATEWAY -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$w:ID!,\$d:Date!){ markAttendance(locationId:\$loc, workerId:\$w, date:\$d, status:PRESENT){ id } }\",
  \"variables\": { \"loc\": \"$WEMBLEY_ID\", \"w\": \"<SOME_WEMBLEY_WORKER_ID>\", \"d\": \"2026-07-13\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"INVALID_STATE"` — Wembley Stadium has `managerAttendanceMarkingEnabled: false`.

---

## 5. OFF-Day Balance (invariant #7, ADR-0013)

### T-BAL-01 — Balance shows allowance and remaining, matching the mockup's "X of Y"

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"{ location(id:\\\"$BOULDER_ID\\\"){ members(role:WORKER){ user { displayName } annualOffAllowance offBalanceRemaining } } }\"
}" | jq '.data.location.members'
```
**Expect:** each worker has both fields; Tom Reyes's `offBalanceRemaining` should be one lower than before T-APR-01's approval (which consumed one OFF day).

### T-BAL-02 — Approving an OFF request decrements the balance (eventually consistent per ADR-0007's outbox)

```bash
BEFORE=$(curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ me { id } }"
}' | jq -r '.data.me.id')
# ... capture offBalanceRemaining before and after approving a fresh OFF request, poll for up to 2s
sleep 1.5
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"{ location(id:\\\"$BOULDER_ID\\\"){ members(role:WORKER){ user { id } offBalanceRemaining } } }\"
}" | jq '.data.location.members[] | select(.user.id==env.BEFORE)'
```
**Expect:** `offBalanceRemaining` reduced by 1 within the outbox's polling window (TDR §7 — should
settle within ~1s in a local dev setup).

### T-BAL-03 — Approving an OFF request when balance is already 0 is rejected

Seed (or drive down) a worker's `offBalanceRemaining` to `0`, then:

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$id:ID!){ approveAttendanceRequest(id:\$id){ id } }\",
  \"variables\": { \"id\": \"<PENDING_OFF_REQUEST_FOR_ZERO_BALANCE_WORKER>\" }
}" | jq '.errors[0].extensions.code'
```
**Expect:** `"INVALID_STATE"` (domain error `InsufficientOffBalanceError`, TDR §2.1(7)) — request stays `PENDING`, no attendance record is created.

---

## 6. Attendance Record Invariants (invariant #2)

### T-ATT-01 — Exactly one attendance record exists per worker per date, even after multiple sources touch the same date

Approve a request for Tom Reyes on `2026-07-20`, then have the same manager attempt to
`markAttendance` PRESENT for the same worker/date:

```bash
curl -s $GATEWAY -H "Authorization: Bearer $MANAGER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$w:ID!,\$d:Date!){ markAttendance(locationId:\$loc, workerId:\$w, date:\$d, status:PRESENT){ id status source } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"w\": \"<TOM_USER_ID>\", \"d\": \"2026-07-20\" }
}" | jq '.data.markAttendance'

curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ myAttendance(from:\"2026-07-20\", to:\"2026-07-20\"){ date status source } }"
}' | jq '.data.myAttendance | length'
```
**Expect:** `1` — the manager's direct mark overwrites the prior approved-request-sourced record
(explicit override, per invariant #8's "never silent overwrite" — this should be an intentional,
logged override action, not a silent second row).

---

## 7. Third-Party Integration (invariant #9)

### T-INT-01 — Integration identifies the worker by externalId, not internal UUID

```bash
curl -s -o /tmp/int1.json -w "%{http_code}\n" -X POST "$ATTENDANCE_SVC/integrations/attendance" \
  -H "X-Api-Key: seed-integration-key" -H "Idempotency-Key: demo-key-001" \
  -H 'Content-Type: application/json' -d '{
    "externalWorkerId": "EXT-TOM-1042",
    "locationExternalRef": "aramark-boulder-co",
    "date": "2026-07-21",
    "status": "PRESENT"
  }'
cat /tmp/int1.json | jq
```
**Expect:** HTTP 201/200, response resolves to the internal worker without the caller ever
supplying an internal UUID.

### T-INT-02 — A user JWT is rejected on the integration endpoint (it's a system credential, not a user one)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$ATTENDANCE_SVC/integrations/attendance" \
  -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
    "externalWorkerId": "EXT-TOM-1042", "locationExternalRef": "aramark-boulder-co",
    "date": "2026-07-22", "status": "PRESENT"
  }'
```
**Expect:** `401` — no `X-Api-Key`, and a user JWT is explicitly not accepted here (TDR §8).

### T-INT-03 — Duplicate delivery with the same idempotency key is a no-op, not a duplicate write

```bash
curl -s -X POST "$ATTENDANCE_SVC/integrations/attendance" \
  -H "X-Api-Key: seed-integration-key" -H "Idempotency-Key: demo-key-001" \
  -H 'Content-Type: application/json' -d '{
    "externalWorkerId": "EXT-TOM-1042", "locationExternalRef": "aramark-boulder-co",
    "date": "2026-07-21", "status": "PRESENT"
  }' | jq

curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d '{
  "query": "{ myAttendance(from:\"2026-07-21\", to:\"2026-07-21\"){ date status source } }"
}' | jq '.data.myAttendance | length'
```
**Expect:** the second call returns the same result as T-INT-01 (or a `200` idempotent-replay
response, service-defined) and the count query still returns `1` — the `integration_events`
table's `UNIQUE(idempotency_key)` constraint (TDR §5.3) rejected the duplicate insert.

---

## 8. Role Authorization Matrix (TDR §9) — exhaustive negative-path sweep

Run every mutation with every role that is **not** authorized for it and confirm `FORBIDDEN` in
every cell. This is the direct curl expression of the authorization table in TDR §9.

| Test ID | Mutation | Caller | Expected |
|---|---|---|---|
| T-RBAC-01 | `approveAttendanceRequest` | WORKER | `FORBIDDEN` |
| T-RBAC-02 | `rejectAttendanceRequest` | WORKER | `FORBIDDEN` |
| T-RBAC-03 | `markAttendance` | WORKER | `FORBIDDEN` (also T-REQ-08) |
| T-RBAC-04 | `createAttendanceRequest` | MANAGER | `FORBIDDEN` |
| T-RBAC-05 | `createAttendanceRequest` | SUPER_ADMIN | `FORBIDDEN` (not a worker persona) |
| T-RBAC-06 | `createLocation` | MANAGER | `FORBIDDEN` |
| T-RBAC-07 | `createLocation` | WORKER | `FORBIDDEN` |
| T-RBAC-08 | `setLocationFeatureFlags` | MANAGER | `FORBIDDEN` (also T-ORG-05) |
| T-RBAC-09 | `addLocationMember` | WORKER | `FORBIDDEN` |
| T-RBAC-10 | `addLocationMember` | MANAGER | `FORBIDDEN` |
| T-RBAC-11 | `locations` (query) | WORKER | `FORBIDDEN` (also T-ORG-02) |
| T-RBAC-12 | `attendanceRequests` (query, another manager's location) | MANAGER | `FORBIDDEN` |

Example curl for one row (repeat the pattern for each):

```bash
curl -s $GATEWAY -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' -d "{
  \"query\": \"mutation(\$loc:ID!,\$n:String!){ createLocation(companyId:\\\"<COMPANY_ID>\\\", name:\$n){ id } }\",
  \"variables\": { \"loc\": \"$BOULDER_ID\", \"n\": \"Should Fail\" }
}" | jq '.errors[0].extensions.code'
```

---

## 9. Defense-in-Depth — services independently re-verify auth (ADR-0005, ADR-0006)

These tests bypass the gateway entirely to prove each service enforces auth on its own, not just
trusting the internal network (the whole point of ADR-0005).

### T-DEEP-01 — Calling org-service directly without a JWT is rejected

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$ORG_SVC/locations"
```
**Expect:** `401`.

### T-DEEP-02 — Calling org-service directly *with* a valid JWT but wrong role succeeds only for allowed reads

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$ORG_SVC/locations" -H "Authorization: Bearer $WORKER_TOKEN"
```
**Expect:** `403` for the SUPER_ADMIN-only listing endpoint — proves the service itself enforces
the role check, independent of the gateway's own (already-tested) coarse check in T-ORG-02.

### T-DEEP-03 — Calling attendance-service directly to approve a request the manager doesn't own is still rejected

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$ATTENDANCE_SVC/requests/<NRG_REQ_ID>/approve" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```
**Expect:** `403` — location-scope re-check happens in `attendance-service` itself (invariant #5), not only at the gateway.

---

## 10. Documentation Surfaces (TDR §12)

### T-DOC-01 — Each service serves a live OpenAPI document

```bash
for url in "$IDENTITY_SVC/docs-json" "$ORG_SVC/docs-json" "$ATTENDANCE_SVC/docs-json"; do
  echo "== $url =="
  curl -s -o /dev/null -w "%{http_code}\n" "$url"
done
```
**Expect:** `200` for all three.

### T-DOC-02 — Swagger UI is reachable (manual/browser check, curl confirms it responds)

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$ATTENDANCE_SVC/docs"
```
**Expect:** `200`.

### T-DOC-03 — GraphQL schema introspection works (frontend/codegen depends on this — ADR-0010)

```bash
curl -s $GATEWAY -H 'Content-Type: application/json' -d '{
  "query": "{ __schema { types { name } } }"
}' | jq '.data.__schema.types | length'
```
**Expect:** a non-zero count, including `AttendanceRequest`, `LocationMember`, etc.

---

## 11. Coverage Checklist

Cross-reference against `REQUIREMENTS_TRACEABILITY.md`. Every row below must have at least one
passing test above before this system is considered to demonstrate the requirement, not just
document it.

| Requirement / Invariant | Covered by |
|---|---|
| Single company, multiple locations | T-ORG-01, T-ORG-03 |
| Permissions/ownership scoped at location | T-ORG-02, T-ORG-05, T-APR-03, T-DEEP-02, T-DEEP-03 |
| Feature flag: selfCheckInEnabled influences behavior | T-REQ-01, T-REQ-02, T-REQ-03, T-ORG-04 |
| Feature flag: managerAttendanceMarkingEnabled influences behavior | T-APR-05, T-APR-06 |
| Worker external identifier uniqueness / integration lookup | T-INT-01 |
| Job title unique within a location | T-ORG-07, T-ORG-08 |
| Attendance PRESENT/OFF, sourced from manager/integration/request | T-APR-01/02, T-APR-05, T-INT-01, T-ATT-01 |
| Workers cannot directly modify attendance | T-REQ-08 |
| One attendance record per worker per date | T-ATT-01 |
| One attendance request per worker per date (ever) | T-REQ-04, T-REQ-06 |
| Requests for past/future dates | T-REQ-07 |
| Manager approves only for locations they manage | T-APR-03, T-DEEP-03 |
| Approval updates the attendance record | T-APR-02 |
| Third-party identifies workers by externalId | T-INT-01 |
| Idempotent integration delivery | T-INT-03 |
| Request statuses PENDING/APPROVED/REJECTED/CANCELLED | T-REQ-01, T-REQ-05, T-APR-01, T-APR-04 |
| Annual OFF-day balance, allowance vs. remaining | T-BAL-01, T-BAL-02, T-BAL-03 |
| Roles WORKER/MANAGER/SUPER_ADMIN enforced | Section 8 (full matrix) |
| Authentication (simulated) | Section 1 |
| Swagger/OpenAPI documentation | Section 10 |
| GraphQL gateway as sole frontend entry point | T-DOC-03, ADR-0010 (structural, not curl-testable from the frontend side — verified by absence of any other configured endpoint in the frontend code) |

---

## 12. Running All Tests

See `scripts/run_curl_tests.sh` for an executable version of this playbook that chains the
`jq`-extracted IDs automatically and prints a `PASS`/`FAIL` summary per test ID. Run it after
`docker compose up` and seeding (TDR §13):

```bash
chmod +x scripts/run_curl_tests.sh
./scripts/run_curl_tests.sh
```
