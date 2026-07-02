import { Router } from 'express';
import { asyncH, Errors, signToken, authMiddleware, CREDENTIALS, type Role } from '@wfms/shared';
import { findById, findByExternalId, findByIds, toDTO } from './repo';

export const router = Router();

// POST /auth/login — public (no authMiddleware). Simulated login via CREDENTIALS map.
router.post(
  '/auth/login',
  asyncH(async (req, res) => {
    const loginToken = req.body?.loginToken;
    if (typeof loginToken !== 'string' || loginToken.length === 0) {
      throw Errors.validation('loginToken is required');
    }
    const userId = CREDENTIALS[loginToken];
    if (!userId) throw Errors.unauthenticated('Unknown login token');

    const user = await findById(userId);
    if (!user) throw Errors.unauthenticated('Unknown login token');

    const token = signToken({
      sub: user.id,
      externalId: user.externalId,
      role: user.role as Role,
    });
    res.json({ token, user: toDTO(user) });
  }),
);

// Everything below requires a valid JWT.
router.use(authMiddleware);

// GET /me — the authenticated user.
router.get(
  '/me',
  asyncH(async (req, res) => {
    const userId = req.auth!.userId;
    const user = await findById(userId);
    if (!user) throw Errors.notFound('User not found');
    res.json(toDTO(user));
  }),
);

// GET /users?ids=a,b,c — batch fetch (for gateway).
router.get(
  '/users',
  asyncH(async (req, res) => {
    const idsParam = req.query.ids;
    const ids =
      typeof idsParam === 'string' && idsParam.length > 0
        ? idsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const users = await findByIds(ids);
    res.json(users.map(toDTO));
  }),
);

// GET /users/by-external/:externalId — resolution for integration worker (registered
// before /users/:id so it is not shadowed).
router.get(
  '/users/by-external/:externalId',
  asyncH(async (req, res) => {
    const user = await findByExternalId(req.params.externalId);
    if (!user) throw Errors.notFound('User not found');
    res.json(toDTO(user));
  }),
);

// GET /users/:id — single user or 404.
router.get(
  '/users/:id',
  asyncH(async (req, res) => {
    const user = await findById(req.params.id);
    if (!user) throw Errors.notFound('User not found');
    res.json(toDTO(user));
  }),
);
