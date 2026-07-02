import { AppError, signToken, type ErrorCode } from '@wfms/shared';

// Internal service-to-service credential for flows with no user JWT (the third-party
// integration ingest). A real signed token so identity-service still re-verifies a
// signature (defense in depth) rather than trusting the network. Minted per call.
export function serviceAuth(): string {
  return 'Bearer ' + signToken({ sub: 'system-integration', externalId: 'SYSTEM', role: 'SUPER_ADMIN' });
}

// Base URLs for cross-service calls (TDR §7 / CONTRACT ports table).
const ORG_URL = process.env.ORG_URL || 'http://localhost:3002';
const IDENTITY_URL = process.env.IDENTITY_URL || 'http://localhost:3001';

// Forward the caller's Authorization header when present so downstream services
// re-verify the JWT (defense in depth) and apply their own RBAC.
function buildHeaders(auth?: string, hasBody = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth) headers['authorization'] = auth;
  if (hasBody) headers['content-type'] = 'application/json';
  return headers;
}

// Parse a non-2xx `{error:{code,message}}` body and throw the matching AppError,
// preserving the downstream error code (and therefore HTTP status).
async function throwFromResponse(res: Response): Promise<never> {
  let code: ErrorCode = 'INTERNAL';
  let message = `Upstream request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.code) code = body.error.code as ErrorCode;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Non-JSON body — fall back to defaults above.
  }
  throw new AppError(code, message);
}

export async function orgGet<T = unknown>(path: string, auth?: string): Promise<T> {
  const res = await fetch(`${ORG_URL}${path}`, { headers: buildHeaders(auth) });
  if (!res.ok) return throwFromResponse(res);
  return (await res.json()) as T;
}

export async function orgPost<T = unknown>(path: string, body: unknown, auth?: string): Promise<T> {
  const res = await fetch(`${ORG_URL}${path}`, {
    method: 'POST',
    headers: buildHeaders(auth, true),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) return throwFromResponse(res);
  return (await res.json()) as T;
}

export async function identityGet<T = unknown>(path: string, auth?: string): Promise<T> {
  const res = await fetch(`${IDENTITY_URL}${path}`, { headers: buildHeaders(auth) });
  if (!res.ok) return throwFromResponse(res);
  return (await res.json()) as T;
}
