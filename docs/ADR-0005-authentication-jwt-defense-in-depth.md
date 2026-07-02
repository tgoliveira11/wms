# ADR-0005: Simulated JWT authentication, re-verified at every service

**Status:** Accepted

## Context
The exercise states authentication may be simulated, but authorization must be enforced
appropriately, and the reviewer will probe API-level auth specifically. We need a mechanism that
(a) is trivially usable for a live demo/evaluation ("log in as any seeded persona instantly"),
(b) still demonstrates a realistic, production-shaped auth boundary, and (c) works uniformly
across a REST-based gateway-to-service topology.

## Decision
`identity-service` issues a signed JWT from `POST /auth/login { loginToken }`, where
`loginToken` is a fixed, seeded value per demo user (simulated credential, not a real password
flow). The JWT carries `sub` (userId), `externalId`, and `role` claims, signed HS256 with a
shared secret for this exercise (documented upgrade path: RS256 + JWKS behind a real IdP).

The gateway validates the JWT from the browser and forwards it unchanged to every downstream
service call. **Each service independently re-verifies the JWT** (shared verification library)
rather than trusting the internal network or a gateway-injected header as ground truth.

## Consequences
**Positive:** demonstrates a zero-trust posture between services (a compromised or
misconfigured internal network doesn't imply compromised authorization), while keeping the demo
frictionless — anyone can log in as Tom Reyes (Worker), Megan Garcia (Manager), or the Super
Admin using their seeded token. Swapping HS256/shared-secret for RS256/JWKS later is a
config-only change since verification is already abstracted behind one shared package.

**Negative:** slightly more verification overhead per request (three verifications instead of
one) — negligible at this scale and explicitly worth it for the security story the exercise asks
candidates to be ready to discuss.

## Alternatives Considered
- **Gateway-only verification, trusted internal header downstream (`X-User-Id`, `X-Role`):**
  simpler, but means any service reachable on the internal network can impersonate any user by
  forging the header — rejected as a bad default even for a demo, since it's the kind of shortcut
  that quietly becomes a real vulnerability if the code is ever reused.
- **Full OAuth2/OIDC provider integration:** correct for production, explicitly out of scope
  per "authentication may be simulated"; captured as a roadmap item (TDR §15).
