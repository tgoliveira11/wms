import jwt from 'jsonwebtoken';

export type Role = 'WORKER' | 'MANAGER' | 'SUPER_ADMIN';

// JWT claims (TDR §8): sub=userId, plus externalId and role.
export interface AuthClaims {
  sub: string;
  externalId: string;
  role: Role;
}

export interface AuthUser {
  userId: string;
  externalId: string;
  role: Role;
}

const SECRET = process.env.JWT_SECRET || 'dev-secret-wms';
const EXPIRES_IN = '8h';

export function signToken(claims: AuthClaims): string {
  return jwt.sign(claims, SECRET, { algorithm: 'HS256', expiresIn: EXPIRES_IN });
}

// Throws on invalid/expired/tampered token — callers translate to UNAUTHENTICATED.
export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as AuthClaims;
  return { userId: decoded.sub, externalId: decoded.externalId, role: decoded.role };
}
