import { Router } from 'express';
import { asyncH, requireRole, Errors } from '@wfms/shared';
import { prisma } from './prisma';

export const router = Router();

// ---- Serialization: enforce EXACT JSON shapes from the CONTRACT. ----

interface LocationRow {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  externalRef: string;
  selfCheckInEnabled: boolean;
  managerAttendanceMarkingEnabled: boolean;
}

function toLocation(l: LocationRow) {
  return {
    id: l.id,
    companyId: l.companyId,
    name: l.name,
    address: l.address,
    externalRef: l.externalRef,
    selfCheckInEnabled: l.selfCheckInEnabled,
    managerAttendanceMarkingEnabled: l.managerAttendanceMarkingEnabled,
  };
}

interface MemberRow {
  id: string;
  locationId: string;
  userId: string;
  role: string;
  jobTitle: string | null;
  annualOffAllowance: number;
  offBalanceRemaining: number;
}

function toMember(m: MemberRow) {
  return {
    id: m.id,
    locationId: m.locationId,
    userId: m.userId,
    role: m.role,
    jobTitle: m.jobTitle,
    annualOffAllowance: m.annualOffAllowance,
    offBalanceRemaining: m.offBalanceRemaining,
  };
}

// ---- Locations ----

// GET /locations — SUPER_ADMIN only.
router.get(
  '/locations',
  requireRole('SUPER_ADMIN'),
  asyncH(async (_req, res) => {
    const locations = await prisma.location.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(locations.map(toLocation));
  }),
);

// POST /locations — SUPER_ADMIN only.
router.post(
  '/locations',
  requireRole('SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const { companyId, name, address } = req.body ?? {};
    if (typeof companyId !== 'string' || !companyId || typeof name !== 'string' || !name) {
      throw Errors.validation('companyId and name are required');
    }
    const externalRef = `loc-${randomId()}`;
    const location = await prisma.location.create({
      data: {
        id: randomId(),
        companyId,
        name,
        address: typeof address === 'string' ? address : null,
        externalRef,
        // selfCheckInEnabled defaults false, managerAttendanceMarkingEnabled defaults true (schema).
      },
    });
    res.json(toLocation(location));
  }),
);

// GET /locations/:id — any authed user.
router.get(
  '/locations/:id',
  asyncH(async (req, res) => {
    const location = await prisma.location.findUnique({ where: { id: req.params.id } });
    if (!location) throw Errors.notFound('Location not found');
    res.json(toLocation(location));
  }),
);

// PATCH /locations/:id/flags — SUPER_ADMIN only.
router.patch(
  '/locations/:id/flags',
  requireRole('SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const { selfCheckInEnabled, managerAttendanceMarkingEnabled } = req.body ?? {};
    const data: { selfCheckInEnabled?: boolean; managerAttendanceMarkingEnabled?: boolean } = {};
    if (typeof selfCheckInEnabled === 'boolean') data.selfCheckInEnabled = selfCheckInEnabled;
    if (typeof managerAttendanceMarkingEnabled === 'boolean') {
      data.managerAttendanceMarkingEnabled = managerAttendanceMarkingEnabled;
    }
    const existing = await prisma.location.findUnique({ where: { id: req.params.id } });
    if (!existing) throw Errors.notFound('Location not found');
    const location = await prisma.location.update({ where: { id: req.params.id }, data });
    res.json(toLocation(location));
  }),
);

// GET /locations/:id/counts — worker/manager counts.
router.get(
  '/locations/:id/counts',
  asyncH(async (req, res) => {
    const locationId = req.params.id;
    const [workerCount, managerCount] = await Promise.all([
      prisma.locationMember.count({ where: { locationId, role: 'WORKER' } }),
      prisma.locationMember.count({ where: { locationId, role: 'MANAGER' } }),
    ]);
    res.json({ workerCount, managerCount });
  }),
);

// ---- Members ----

// GET /locations/:id/members?role=WORKER|MANAGER
router.get(
  '/locations/:id/members',
  asyncH(async (req, res) => {
    const locationId = req.params.id;
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const members = await prisma.locationMember.findMany({
      where: { locationId, ...(role ? { role } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members.map(toMember));
  }),
);

// GET /locations/:id/members/:userId
router.get(
  '/locations/:id/members/:userId',
  asyncH(async (req, res) => {
    const member = await prisma.locationMember.findUnique({
      where: { locationId_userId: { locationId: req.params.id, userId: req.params.userId } },
    });
    if (!member) throw Errors.notFound('Member not found');
    res.json(toMember(member));
  }),
);

// POST /locations/:id/members — SUPER_ADMIN only.
router.post(
  '/locations/:id/members',
  requireRole('SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const locationId = req.params.id;
    const { userId, role, jobTitle } = req.body ?? {};
    if (typeof userId !== 'string' || !userId || typeof role !== 'string' || !role) {
      throw Errors.validation('userId and role are required');
    }
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw Errors.notFound('Location not found');
    try {
      const member = await prisma.locationMember.create({
        data: {
          locationId,
          userId,
          role,
          jobTitle: typeof jobTitle === 'string' ? jobTitle : null,
          // annualOffAllowance & offBalanceRemaining default to 12 (schema).
        },
      });
      res.json(toMember(member));
    } catch (err) {
      // Duplicate (location,user) or duplicate (location,jobTitle) -> CONFLICT.
      if ((err as { code?: string }).code === 'P2002') {
        throw Errors.conflict('Member already exists or duplicate jobTitle in location');
      }
      throw err;
    }
  }),
);

// ---- Memberships across locations ----

// GET /memberships?userId=
router.get(
  '/memberships',
  asyncH(async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    if (!userId) throw Errors.validation('userId query param is required');
    const members = await prisma.locationMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members.map(toMember));
  }),
);

// ---- Off-balance atomic operations ----

// POST /locations/:id/members/:userId/off-balance/consume — atomic conditional decrement.
router.post(
  '/locations/:id/members/:userId/off-balance/consume',
  asyncH(async (req, res) => {
    const locationId = req.params.id;
    const userId = req.params.userId;
    const result = await prisma.locationMember.updateMany({
      where: { locationId, userId, offBalanceRemaining: { gt: 0 } },
      data: { offBalanceRemaining: { decrement: 1 } },
    });
    if (result.count === 0) {
      // Either member doesn't exist or has no remaining balance.
      throw Errors.invalidState('InsufficientOffBalance');
    }
    const member = await prisma.locationMember.findUnique({
      where: { locationId_userId: { locationId, userId } },
    });
    res.json({ offBalanceRemaining: member?.offBalanceRemaining ?? 0 });
  }),
);

// POST /locations/:id/members/:userId/off-balance/release — increment bounded by annualOffAllowance.
router.post(
  '/locations/:id/members/:userId/off-balance/release',
  asyncH(async (req, res) => {
    const locationId = req.params.id;
    const userId = req.params.userId;
    const member = await prisma.locationMember.findUnique({
      where: { locationId_userId: { locationId, userId } },
    });
    if (!member) throw Errors.notFound('Member not found');
    // Bound the increment by annualOffAllowance (compensation must not overshoot).
    const result = await prisma.locationMember.updateMany({
      where: { locationId, userId, offBalanceRemaining: { lt: member.annualOffAllowance } },
      data: { offBalanceRemaining: { increment: 1 } },
    });
    let offBalanceRemaining = member.offBalanceRemaining;
    if (result.count > 0) {
      const updated = await prisma.locationMember.findUnique({
        where: { locationId_userId: { locationId, userId } },
      });
      offBalanceRemaining = updated?.offBalanceRemaining ?? offBalanceRemaining;
    }
    res.json({ offBalanceRemaining });
  }),
);

// Deterministic-enough random UUID-ish id for created rows.
function randomId(): string {
  // Node 18+: crypto.randomUUID is available globally.
  return globalThis.crypto.randomUUID();
}
