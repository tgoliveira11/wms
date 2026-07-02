#!/usr/bin/env bash
#
# run_curl_tests.sh — executable version of docs/CURL_TEST_PLAYBOOK.md
#
# Chains the jq-extracted IDs automatically and prints a PASS/FAIL summary per test ID.
# Run after `docker compose up`, `pnpm db:push`, `pnpm seed`, and `pnpm dev` (TDR §13):
#
#   pnpm test:curl                       # or: bash scripts/run_curl_tests.sh
#
# Requires: bash 4+, curl, jq.
#
# NOTE on quoting: GraphQL payloads are built with the `mk` helper (jq into a global $REQ)
# rather than an inline "$(jq ...)" nested inside another command substitution. The nested
# form triggers bash brace-expansion on `{a, b}` groups inside the query and silently
# corrupts it — the `mk` two-step avoids that entirely.
set -uo pipefail

GATEWAY="${GATEWAY:-http://localhost:4000/graphql}"
ORG_SVC="${ORG_SVC:-http://localhost:3002}"
ATTENDANCE_SVC="${ATTENDANCE_SVC:-http://localhost:3003}"
IDENTITY_SVC="${IDENTITY_SVC:-http://localhost:3001}"
INTEGRATION_KEY="${INTEGRATION_KEY:-seed-integration-key}"
COMPANY_ID="${COMPANY_ID:-00000000-0000-0000-0000-0000000000c0}"

command -v jq   >/dev/null || { echo "jq is required"; exit 2; }
command -v curl >/dev/null || { echo "curl is required"; exit 2; }

PASS=0; FAIL=0; SKIP=0
green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }

ok() { # ok <id> <desc> <actual> <expected>
  if [[ "$3" == "$4" ]]; then
    printf '  %s %-12s %s\n' "$(green PASS)" "$1" "$2"; PASS=$((PASS+1))
  else
    printf '  %s %-12s %s (got: %q, want: %q)\n' "$(red FAIL)" "$1" "$2" "$3" "$4"; FAIL=$((FAIL+1))
  fi
}
skip() { printf '  %s %-12s %s\n' "$(yellow SKIP)" "$1" "$2"; SKIP=$((SKIP+1)); }

REQ=''
mk() { REQ=$(jq -n "$@"); }             # build a GraphQL JSON payload into $REQ (no nested $())
gql() { # gql <token-or-empty> <payload>
  if [[ -n "$1" ]]; then
    curl -s "$GATEWAY" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"
  else
    curl -s "$GATEWAY" -H 'Content-Type: application/json' -d "$2"
  fi
}
jqr() { jq -r "$2 // empty" <<<"$1"; }
code() { jqr "$1" '.errors[0].extensions.code'; }
login() { mk --arg t "$1" '{query:"mutation($t:String!){ login(loginToken:$t){ token } }",variables:{t:$t}}'; gql "" "$REQ" | jq -r '.data.login.token // empty'; }

echo "== WMS curl acceptance tests =="
echo "Gateway: $GATEWAY"
echo

########################################################## 1. Authentication
echo "1. Authentication (TDR §8, ADR-0005)"
ADMIN_TOKEN=$(login "admin-token")
MANAGER_TOKEN=$(login "megan-garcia-token")
PRIYA_MANAGER_TOKEN=$(login "priya-nair-token")
WORKER_TOKEN=$(login "tom-reyes-token")
JAMIE_TOKEN=$(login "jamie-cole-token")
LIN_TOKEN=$(login "lin-huang-token")
ok "T-AUTH-01" "every seeded persona logs in" \
  "$([[ -n $ADMIN_TOKEN && -n $MANAGER_TOKEN && -n $PRIYA_MANAGER_TOKEN && -n $WORKER_TOKEN && -n $JAMIE_TOKEN && -n $LIN_TOKEN ]] && echo yes || echo no)" "yes"

mk --arg t "not-a-real-token" '{query:"mutation($t:String!){ login(loginToken:$t){ token } }",variables:{t:$t}}'
ok "T-AUTH-02" "unknown token rejected" "$(code "$(gql "" "$REQ")")" "UNAUTHENTICATED"
ok "T-AUTH-03" "no token rejected" "$(code "$(gql "" '{"query":"{ me { id role } }"}')")" "UNAUTHENTICATED"
ok "T-AUTH-04" "tampered JWT rejected" "$(code "$(gql "eyJhbGciOiJIUzI1NiJ9.invalid.sig" '{"query":"{ me { id } }"}')")" "UNAUTHENTICATED"

R=$(gql "$WORKER_TOKEN" '{"query":"{ me { id externalId displayName role } }"}')
ok "T-AUTH-05" "me returns correct identity" "$(jqr "$R" '.data.me.role')" "WORKER"
TOM_USER_ID=$(jqr "$R" '.data.me.id')
JAMIE_USER_ID=$(gql "$JAMIE_TOKEN" '{"query":"{ me { id } }"}' | jq -r '.data.me.id // empty')

########################################################## 2. Company & Location
echo "2. Company & Location — Super Admin"
R=$(gql "$ADMIN_TOKEN" '{"query":"{ locations { id name selfCheckInEnabled managerAttendanceMarkingEnabled workerCount managerCount pendingApprovalCount } }"}')
# Tolerate extra locations left by prior createLocation runs; assert the 3 seed locations are present.
ok "T-ORG-01" "SUPER_ADMIN lists the 3 seed locations" "$(jq '[.data.locations[]|select(.name=="Aramark Boulder CO" or .name=="NRG Park" or .name=="Wembley Stadium")]|length' <<<"$R")" "3"
BOULDER_ID=$(jqr "$R" '.data.locations[]|select(.name=="Aramark Boulder CO")|.id')
NRG_ID=$(jqr "$R"     '.data.locations[]|select(.name=="NRG Park")|.id')
WEMBLEY_ID=$(jqr "$R" '.data.locations[]|select(.name=="Wembley Stadium")|.id')

ok "T-ORG-02" "non-admin cannot list locations" "$(code "$(gql "$WORKER_TOKEN" '{"query":"{ locations { id name } }"}')")" "FORBIDDEN"

mk --arg cid "$COMPANY_ID" '{query:"mutation($cid:ID!,$n:String!){ createLocation(companyId:$cid, name:$n, address:\"100 Test Ave\"){ id selfCheckInEnabled managerAttendanceMarkingEnabled } }",variables:{cid:$cid,n:"Test Arena"}}'
R=$(gql "$ADMIN_TOKEN" "$REQ")
# NB: use raw jq (not jqr's `// empty`, which treats a literal `false` as empty) for booleans.
ok "T-ORG-03" "new location default flags" "$(jq -r '.data.createLocation.selfCheckInEnabled' <<<"$R")/$(jq -r '.data.createLocation.managerAttendanceMarkingEnabled' <<<"$R")" "false/true"

mk --arg id "$NRG_ID" '{query:"mutation($id:ID!){ setLocationFeatureFlags(locationId:$id, selfCheckInEnabled:true){ id selfCheckInEnabled } }",variables:{id:$id}}'
ok "T-ORG-04" "admin toggles feature flag" "$(jqr "$(gql "$ADMIN_TOKEN" "$REQ")" '.data.setLocationFeatureFlags.selfCheckInEnabled')" "true"
mk --arg id "$NRG_ID" '{query:"mutation($id:ID!){ setLocationFeatureFlags(locationId:$id, selfCheckInEnabled:false){ id } }",variables:{id:$id}}'
gql "$ADMIN_TOKEN" "$REQ" >/dev/null   # flip back to seed value

mk --arg id "$BOULDER_ID" '{query:"mutation($id:ID!){ setLocationFeatureFlags(locationId:$id, selfCheckInEnabled:false){ id } }",variables:{id:$id}}'
ok "T-ORG-05" "manager cannot toggle flags" "$(code "$(gql "$MANAGER_TOKEN" "$REQ")")" "FORBIDDEN"

########################################################## 3. Worker Attendance Requests
echo "3. Worker Attendance Requests (ADR-0011, ADR-0012)"
mk --arg loc "$BOULDER_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:CHECK_IN_OUT, note:\"Badge scan failed\"){ id status } }",variables:{loc:$loc,d:"2026-07-10"}}'
R=$(gql "$WORKER_TOKEN" "$REQ")
ok "T-REQ-01" "worker submits CHECK_IN_OUT (self-checkin on)" "$(jqr "$R" '.data.createAttendanceRequest.status')" "PENDING"
REQ1_ID=$(jqr "$R" '.data.createAttendanceRequest.id')

mk --arg loc "$NRG_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:CHECK_IN_OUT){ id } }",variables:{loc:$loc,d:"2026-07-10"}}'
ok "T-REQ-02" "CHECK_IN_OUT blocked where self-checkin off" "$(code "$(gql "$LIN_TOKEN" "$REQ")")" "INVALID_STATE"

mk --arg loc "$NRG_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF, note:\"Family\"){ id status } }",variables:{loc:$loc,d:"2026-07-11"}}'
ok "T-REQ-03" "OFF still allowed there (ADR-0011)" "$(jqr "$(gql "$LIN_TOKEN" "$REQ")" '.data.createAttendanceRequest.status')" "PENDING"

mk --arg loc "$BOULDER_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF){ id } }",variables:{loc:$loc,d:"2026-07-10"}}'
ok "T-REQ-04" "duplicate PENDING for same date rejected" "$(code "$(gql "$WORKER_TOKEN" "$REQ")")" "CONFLICT"

mk --arg id "$REQ1_ID" '{query:"mutation($id:ID!){ cancelAttendanceRequest(id:$id){ id status } }",variables:{id:$id}}'
ok "T-REQ-05" "worker cancels own PENDING request" "$(jqr "$(gql "$WORKER_TOKEN" "$REQ")" '.data.cancelAttendanceRequest.status')" "CANCELLED"

mk --arg loc "$BOULDER_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF, note:\"need it off\"){ id status } }",variables:{loc:$loc,d:"2026-07-10"}}'
R=$(gql "$WORKER_TOKEN" "$REQ")
REQ1B_ID=$(jqr "$R" '.data.createAttendanceRequest.id')
ok "T-REQ-06a" "resubmit after cancel = new row (ADR-0012)" "$([[ -n $REQ1B_ID && $REQ1B_ID != $REQ1_ID ]] && echo yes || echo no)" "yes"
H=$(gql "$WORKER_TOKEN" '{"query":"{ myAttendanceRequests { id status date } }"}')
ok "T-REQ-06b" "history preserved: 2 rows for the date" "$(jq '[.data.myAttendanceRequests[]|select(.date=="2026-07-10")]|length' <<<"$H")" "2"

mk --arg loc "$BOULDER_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF){ id date status } }",variables:{loc:$loc,d:"2026-01-15"}}'
R=$(gql "$JAMIE_TOKEN" "$REQ"); PAST_REQ_ID=$(jqr "$R" '.data.createAttendanceRequest.id')
mk --arg loc "$BOULDER_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF){ id status } }",variables:{loc:$loc,d:"2026-12-24"}}'
R2=$(gql "$JAMIE_TOKEN" "$REQ")
ok "T-REQ-07" "past & future dates both accepted" "$([[ -n $PAST_REQ_ID && -n $(jqr "$R2" '.data.createAttendanceRequest.id') ]] && echo yes || echo no)" "yes"

mk --arg loc "$BOULDER_ID" --arg w "$TOM_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc, workerId:$w, date:$d, status:PRESENT){ id } }",variables:{loc:$loc,w:$w,d:"2026-07-12"}}'
ok "T-REQ-08" "worker cannot markAttendance" "$(code "$(gql "$WORKER_TOKEN" "$REQ")")" "FORBIDDEN"

########################################################## 4. Manager Approval
echo "4. Manager Approval Workflow (invariants #5, #6)"
mk --arg id "$REQ1B_ID" '{query:"mutation($id:ID!){ approveAttendanceRequest(id:$id){ id status decidedBy { displayName } } }",variables:{id:$id}}'
ok "T-APR-01" "manager approves own-location request" "$(jqr "$(gql "$MANAGER_TOKEN" "$REQ")" '.data.approveAttendanceRequest.status')" "APPROVED"

R=$(gql "$WORKER_TOKEN" '{"query":"{ myAttendance(from:\"2026-07-10\", to:\"2026-07-10\"){ date status source } }"}')
ok "T-APR-02a" "approval creates attendance record" "$(jqr "$R" '.data.myAttendance[0].status')" "OFF"
ok "T-APR-02b" "record source is WORKER_REQUEST" "$(jqr "$R" '.data.myAttendance[0].source')" "WORKER_REQUEST"

mk --arg loc "$NRG_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF){ id } }",variables:{loc:$loc,d:"2026-08-01"}}'
NRG_REQ_ID=$(jqr "$(gql "$LIN_TOKEN" "$REQ")" '.data.createAttendanceRequest.id')
mk --arg id "$NRG_REQ_ID" '{query:"mutation($id:ID!){ approveAttendanceRequest(id:$id){ id } }",variables:{id:$id}}'
ok "T-APR-03a" "manager cannot approve outside their locations" "$(code "$(gql "$MANAGER_TOKEN" "$REQ")")" "FORBIDDEN"
mk --arg id "$NRG_REQ_ID" '{query:"mutation($id:ID!){ approveAttendanceRequest(id:$id){ status } }",variables:{id:$id}}'
ok "T-APR-03b" "correct manager (Priya/NRG) can approve" "$(jqr "$(gql "$PRIYA_MANAGER_TOKEN" "$REQ")" '.data.approveAttendanceRequest.status')" "APPROVED"

mk --arg id "$PAST_REQ_ID" '{query:"mutation($id:ID!){ rejectAttendanceRequest(id:$id, reason:\"needs sign-off\"){ id status } }",variables:{id:$id}}'
ok "T-APR-04" "manager rejects with reason" "$(jqr "$(gql "$MANAGER_TOKEN" "$REQ")" '.data.rejectAttendanceRequest.status')" "REJECTED"

if [[ -n "$JAMIE_USER_ID" ]]; then
  mk --arg loc "$BOULDER_ID" --arg w "$JAMIE_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc, workerId:$w, date:$d, status:PRESENT){ source } }",variables:{loc:$loc,w:$w,d:"2026-07-13"}}'
  ok "T-APR-05" "manager marks attendance (flag on)" "$(jqr "$(gql "$MANAGER_TOKEN" "$REQ")" '.data.markAttendance.source')" "MANAGER"
else
  skip "T-APR-05" "could not resolve JAMIE_USER_ID"
fi

mk --arg loc "$WEMBLEY_ID" --arg w "$TOM_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc, workerId:$w, date:$d, status:PRESENT){ id } }",variables:{loc:$loc,w:$w,d:"2026-07-13"}}'
ok "T-APR-06" "marking blocked where flag off (Wembley)" "$(code "$(gql "$ADMIN_TOKEN" "$REQ")")" "INVALID_STATE"

########################################################## 5. OFF-Day Balance
echo "5. OFF-Day Balance (invariant #7, ADR-0013)"
mk --arg id "$BOULDER_ID" '{query:"query($id:ID!){ location(id:$id){ members(role:WORKER){ user { id displayName } annualOffAllowance offBalanceRemaining } } }",variables:{id:$id}}'
R=$(gql "$MANAGER_TOKEN" "$REQ")
ok "T-BAL-01" "balance exposes allowance & remaining" "$(jq '[.data.location.members[0]|has("annualOffAllowance"),has("offBalanceRemaining")]|all' <<<"$R")" "true"
TOM_REMAINING=$(jqr "$R" ".data.location.members[]|select(.user.id==\"$TOM_USER_ID\")|.offBalanceRemaining")
ok "T-BAL-02" "Tom's balance decremented by the T-APR-01 OFF approval" "$TOM_REMAINING" "11"
skip "T-BAL-03" "zero-balance rejection — run against a driven-to-zero fixture"

########################################################## 6. Attendance Record Invariant
echo "6. Attendance Record Invariant (#2)"
mk --arg loc "$BOULDER_ID" --arg w "$TOM_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc, workerId:$w, date:$d, status:PRESENT){ id } }",variables:{loc:$loc,w:$w,d:"2026-07-20"}}'
gql "$MANAGER_TOKEN" "$REQ" >/dev/null
mk --arg loc "$BOULDER_ID" --arg w "$TOM_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc, workerId:$w, date:$d, status:OFF){ id } }",variables:{loc:$loc,w:$w,d:"2026-07-20"}}'
gql "$MANAGER_TOKEN" "$REQ" >/dev/null
R=$(gql "$WORKER_TOKEN" '{"query":"{ myAttendance(from:\"2026-07-20\", to:\"2026-07-20\"){ date } }"}')
ok "T-ATT-01" "one record per worker/date after two writes" "$(jq '[.data.myAttendance[]]|length' <<<"$R")" "1"

########################################################## 7. Integration
echo "7. Third-Party Integration (invariant #9)"
CODE=$(curl -s -o /tmp/int1.json -w "%{http_code}" -X POST "$ATTENDANCE_SVC/integrations/attendance" \
  -H "X-Api-Key: $INTEGRATION_KEY" -H "Idempotency-Key: demo-key-001" -H 'Content-Type: application/json' \
  -d '{"externalWorkerId":"EXT-TOM-1042","locationExternalRef":"aramark-boulder-co","date":"2026-07-21","status":"PRESENT"}')
ok "T-INT-01" "integration accepts externalId (2xx)" "$([[ $CODE == 200 || $CODE == 201 ]] && echo ok || echo "$CODE")" "ok"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ATTENDANCE_SVC/integrations/attendance" \
  -H "Authorization: Bearer $WORKER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"externalWorkerId":"EXT-TOM-1042","locationExternalRef":"aramark-boulder-co","date":"2026-07-22","status":"PRESENT"}')
ok "T-INT-02" "user JWT rejected on integration endpoint" "$CODE" "401"

curl -s -X POST "$ATTENDANCE_SVC/integrations/attendance" \
  -H "X-Api-Key: $INTEGRATION_KEY" -H "Idempotency-Key: demo-key-001" -H 'Content-Type: application/json' \
  -d '{"externalWorkerId":"EXT-TOM-1042","locationExternalRef":"aramark-boulder-co","date":"2026-07-21","status":"PRESENT"}' >/dev/null
R=$(gql "$WORKER_TOKEN" '{"query":"{ myAttendance(from:\"2026-07-21\", to:\"2026-07-21\"){ date } }"}')
ok "T-INT-03" "duplicate idempotency key is a no-op (1 record)" "$(jq '[.data.myAttendance[]]|length' <<<"$R")" "1"

########################################################## 7b. Gap fixes #1/#2/#4
echo "7b. Per-location attendance (#1), worker balance (#2), reversal (#4)"
LIN_USER_ID=$(gql "$LIN_TOKEN" '{"query":"{ me { id } }"}' | jq -r '.data.me.id // empty')

# #1: Lin (worker at Boulder AND NRG) gets PRESENT at Boulder and OFF at NRG on the same
# date -> two distinct records (impossible under the old (worker,date) key).
mk --arg loc "$BOULDER_ID" --arg w "$LIN_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc,workerId:$w,date:$d,status:PRESENT){ id } }",variables:{loc:$loc,w:$w,d:"2026-09-01"}}'
gql "$MANAGER_TOKEN" "$REQ" >/dev/null          # Megan manages Boulder
mk --arg loc "$NRG_ID" --arg w "$LIN_USER_ID" '{query:"mutation($loc:ID!,$w:ID!,$d:Date!){ markAttendance(locationId:$loc,workerId:$w,date:$d,status:OFF){ id } }",variables:{loc:$loc,w:$w,d:"2026-09-01"}}'
gql "$PRIYA_MANAGER_TOKEN" "$REQ" >/dev/null     # Priya manages NRG
R=$(gql "$LIN_TOKEN" '{"query":"{ myAttendance(from:\"2026-09-01\",to:\"2026-09-01\"){ location { name } status } }"}')
ok "T-LOC-01" "multi-location worker: 2 records same date (#1)" "$(jq '[.data.myAttendance[]]|length' <<<"$R")" "2"

# #2: a worker can read its own OFF balance via me.memberships.
R=$(gql "$WORKER_TOKEN" '{"query":"{ me { memberships { location { name } annualOffAllowance offBalanceRemaining } } }"}')
ok "T-BAL-04" "worker reads own balance (me.memberships #2)" "$(jq '[.data.me.memberships[]|select(.location.name=="Aramark Boulder CO")]|length' <<<"$R")" "1"

# #4: approve an OFF (balance -1), then the worker cancels the APPROVED request ->
# balance restored and the attendance record removed (reversal, ADR-0013).
balOf() { mk --arg id "$BOULDER_ID" '{query:"query($id:ID!){ location(id:$id){ members(role:WORKER){ user{id} offBalanceRemaining } } }",variables:{id:$id}}'; jqr "$(gql "$MANAGER_TOKEN" "$REQ")" ".data.location.members[]|select(.user.id==\"$1\")|.offBalanceRemaining"; }
mk --arg loc "$BOULDER_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc,date:$d,kind:OFF){ id } }",variables:{loc:$loc,d:"2026-09-05"}}'
REV_ID=$(jqr "$(gql "$JAMIE_TOKEN" "$REQ")" '.data.createAttendanceRequest.id')
mk --arg id "$REV_ID" '{query:"mutation($id:ID!){ approveAttendanceRequest(id:$id){ status } }",variables:{id:$id}}'
gql "$MANAGER_TOKEN" "$REQ" >/dev/null
BAL_APPROVED=$(balOf "$JAMIE_USER_ID")
mk --arg id "$REV_ID" '{query:"mutation($id:ID!){ cancelAttendanceRequest(id:$id){ status } }",variables:{id:$id}}'
ok "T-REV-01" "worker cancels an APPROVED request" "$(jqr "$(gql "$JAMIE_TOKEN" "$REQ")" '.data.cancelAttendanceRequest.status')" "CANCELLED"
R=$(gql "$JAMIE_TOKEN" '{"query":"{ myAttendance(from:\"2026-09-05\",to:\"2026-09-05\"){ date } }"}')
ok "T-REV-02" "reversal removed the attendance record (#4)" "$(jq '[.data.myAttendance[]]|length' <<<"$R")" "0"
ok "T-REV-03" "reversal restored OFF balance (#4)" "$(balOf "$JAMIE_USER_ID")" "$((BAL_APPROVED + 1))"

########################################################## 8. RBAC matrix
echo "8. Role Authorization Matrix (negative-path sweep)"
rbac() { ok "$1" "negative-path FORBIDDEN" "$(code "$(gql "$2" "$3")")" "FORBIDDEN"; }
rbac "T-RBAC-01" "$WORKER_TOKEN"  '{"query":"mutation{ approveAttendanceRequest(id:\"x\"){ id } }"}'
rbac "T-RBAC-02" "$WORKER_TOKEN"  '{"query":"mutation{ rejectAttendanceRequest(id:\"x\"){ id } }"}'
rbac "T-RBAC-03" "$WORKER_TOKEN"  '{"query":"mutation{ markAttendance(locationId:\"x\",workerId:\"y\",date:\"2026-07-01\",status:PRESENT){ id } }"}'
rbac "T-RBAC-04" "$MANAGER_TOKEN" '{"query":"mutation{ createAttendanceRequest(locationId:\"x\",date:\"2026-07-01\",kind:OFF){ id } }"}'
rbac "T-RBAC-05" "$ADMIN_TOKEN"   '{"query":"mutation{ createAttendanceRequest(locationId:\"x\",date:\"2026-07-01\",kind:OFF){ id } }"}'
rbac "T-RBAC-08" "$MANAGER_TOKEN" '{"query":"mutation{ setLocationFeatureFlags(locationId:\"x\",selfCheckInEnabled:false){ id } }"}'
rbac "T-RBAC-09" "$WORKER_TOKEN"  '{"query":"mutation{ addLocationMember(locationId:\"x\",userId:\"y\",role:WORKER){ id } }"}'
rbac "T-RBAC-10" "$MANAGER_TOKEN" '{"query":"mutation{ addLocationMember(locationId:\"x\",userId:\"y\",role:WORKER){ id } }"}'
rbac "T-RBAC-11" "$WORKER_TOKEN"  '{"query":"{ locations { id } }"}'

########################################################## 9. Defense in depth
echo "9. Defense-in-Depth (services re-verify auth directly)"
ok "T-DEEP-01" "org-svc direct, no JWT -> 401" "$(curl -s -o /dev/null -w '%{http_code}' "$ORG_SVC/locations")" "401"
ok "T-DEEP-02" "org-svc direct, wrong role -> 403" "$(curl -s -o /dev/null -w '%{http_code}' "$ORG_SVC/locations" -H "Authorization: Bearer $WORKER_TOKEN")" "403"
# Fresh PENDING NRG request (the earlier one was already approved by Priya), so the
# scope check — not the status check — is what rejects Megan's direct attempt.
mk --arg loc "$NRG_ID" '{query:"mutation($loc:ID!,$d:Date!){ createAttendanceRequest(locationId:$loc, date:$d, kind:OFF){ id } }",variables:{loc:$loc,d:"2026-08-02"}}'
DEEP_REQ_ID=$(jqr "$(gql "$LIN_TOKEN" "$REQ")" '.data.createAttendanceRequest.id')
if [[ -n "$DEEP_REQ_ID" ]]; then
  ok "T-DEEP-03" "attendance-svc direct, wrong location -> 403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ATTENDANCE_SVC/requests/$DEEP_REQ_ID/approve" -H "Authorization: Bearer $MANAGER_TOKEN")" "403"
else
  skip "T-DEEP-03" "no DEEP_REQ_ID available"
fi

########################################################## 10. Docs
echo "10. Documentation Surfaces"
for pair in "identity:$IDENTITY_SVC" "org:$ORG_SVC" "attendance:$ATTENDANCE_SVC"; do
  ok "T-DOC-01" "${pair%%:*} OpenAPI doc -> 200" "$(curl -s -o /dev/null -w '%{http_code}' "${pair#*:}/docs-json")" "200"
done
R=$(gql "" '{"query":"{ __schema { types { name } } }"}')
ok "T-DOC-03" "GraphQL introspection returns types" "$([[ $(jq '[.data.__schema.types[]]|length' <<<"$R") -gt 0 ]] && echo yes || echo no)" "yes"

echo
echo "== Summary =="
printf '  %s: %d   %s: %d   %s: %d\n' "$(green PASS)" "$PASS" "$(red FAIL)" "$FAIL" "$(yellow SKIP)" "$SKIP"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
