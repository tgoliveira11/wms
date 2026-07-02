import { GraphQLError } from 'graphql';
import type { ErrorCode } from '@wfms/shared';

// Service base URLs from env (with localhost defaults per CONTRACT).
const IDENTITY_URL = process.env.IDENTITY_URL || 'http://localhost:3001';
const ORG_URL = process.env.ORG_URL || 'http://localhost:3002';
const ATTENDANCE_URL = process.env.ATTENDANCE_URL || 'http://localhost:3003';

interface ServiceErrorBody {
  error?: { code?: ErrorCode; message?: string };
}

// On non-2xx, parse {error:{code,message}} and throw a GraphQLError carrying the
// service's error code as extensions.code (CONTRACT error model).
async function handle(res: Response): Promise<any> {
  if (res.ok) {
    // 204 or empty body -> null
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  let code: ErrorCode = 'INTERNAL';
  let message = `Upstream error (${res.status})`;
  try {
    const body = (await res.json()) as ServiceErrorBody;
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // non-JSON error body — keep defaults
  }
  throw new GraphQLError(message, { extensions: { code } });
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson(base: string, path: string, token?: string): Promise<any> {
  const res = await fetch(`${base}${path}`, { method: 'GET', headers: authHeaders(token) });
  return handle(res);
}

async function postJson(base: string, path: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

async function patchJson(base: string, path: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(body ?? {}),
  });
  return handle(res);
}

export const identity = {
  get: (path: string, token?: string) => getJson(IDENTITY_URL, path, token),
  post: (path: string, body: unknown, token?: string) => postJson(IDENTITY_URL, path, body, token),
};

export const org = {
  get: (path: string, token?: string) => getJson(ORG_URL, path, token),
  post: (path: string, body: unknown, token?: string) => postJson(ORG_URL, path, body, token),
  patch: (path: string, body: unknown, token?: string) => patchJson(ORG_URL, path, body, token),
};

export const attendance = {
  get: (path: string, token?: string) => getJson(ATTENDANCE_URL, path, token),
  post: (path: string, body: unknown, token?: string) => postJson(ATTENDANCE_URL, path, body, token),
};
