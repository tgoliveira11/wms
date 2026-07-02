import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError, Errors } from './errors';
import { verifyToken, type AuthUser, type Role } from './auth';

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

// Verifies the JWT on every request (defense in depth — ADR-0005: each service
// re-verifies, never trusts the gateway or the network). Populates req.auth.
export const authMiddleware: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return next(Errors.unauthenticated());
  try {
    req.auth = verifyToken(header.slice('Bearer '.length).trim());
    next();
  } catch {
    next(Errors.unauthenticated('Invalid or expired token'));
  }
};

// Coarse role guard (RBAC). Fine-grained location scoping is enforced in each use case.
export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) return next(Errors.unauthenticated());
  if (!roles.includes(req.auth.role)) return next(Errors.forbidden(`Requires role: ${roles.join('/')}`));
  next();
};

// Wrap async handlers so thrown/rejected errors reach the error handler.
export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

// Terminal error handler: AppError -> {error:{code,message}} with mapped status.
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Prisma unique-constraint violation -> CONFLICT (kept generic to avoid a prisma dep here).
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Unique constraint violated' } });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error' } });
};
