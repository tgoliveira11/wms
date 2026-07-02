import { Router, type Request } from 'express';
import { Errors, asyncH, requireRole, INTEGRATION_API_KEY } from '@wfms/shared';
import { prisma } from './prisma';
import { orgGet, orgPost, identityGet, serviceAuth } from './clients';

export const router = Router();

// --- Serialization helpers (exact JSON shapes per CONTRACT) --------------------

interface RequestRow {
  id: string;
  workerId: string;
  locationId: string;
  date: string;
  kind: string;
  status: string;
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

interface RecordRow {
  id: string;
  workerId: string;
  locationId: string;
  date: string;
  status: string;
  source: string;
}

function toRequestJSON(r: RequestRow) {
  return {
    id: r.id,
    workerId: r.workerId,
    locationId: r.locationId,
    date: r.date,
    kind: r.kind,
    status: r.status,
    note: r.note,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

function toRecordJSON(r: RecordRow) {
  return {
    id: r.id,
    workerId: r.workerId,
    locationId: r.locationId,
    date: r.date,
    status: r.status,
    source: r.source,
  };
}

// --- Cross-service DTOs --------------------------------------------------------

interface LocationDTO {
  id: string;
  selfCheckInEnabled: boolean;
  managerAttendanceMarkingEnabled: boolean;
}

interface MemberDTO {
  id: string;
  locationId: string;
  userId: string;
  role: string;
}

interface UserDTO {
  id: string;
  externalId: string;
}

function bearer(req: Request): string | undefined {
  return req.header('authorization') || undefined;
}

// Verify a MANAGER is scoped to a location as its MANAGER (invariant #5).
// SUPER_ADMIN bypasses this check at the call site.
async function assertManagerScope(req: Request, locationId: string, managerUserId: string) {
  let member: MemberDTO;
  try {
    member = await orgGet<MemberDTO>(
      `/locations/${locationId}/members/${managerUserId}`,
      bearer(req),
    );
  } catch (e: unknown) {
    // Not-found membership -> forbidden (out of scope).
    if ((e as { code?: string })?.code === 'NOT_FOUND') {
      throw Errors.forbidden('Manager is not scoped to this location');
    }
    throw e;
  }
  if (member.role !== 'MANAGER') {
    throw Errors.forbidden('Manager is not scoped to this location');
  }
}

// ==============================================================================
// WORKER: create request
// ==============================================================================
router.post(
  '/requests',
  requireRole('WORKER'),
  asyncH(async (req, res) => {
    const workerId = req.auth!.userId;
    const { locationId, date, kind, note } = req.body ?? {};
    if (!locationId || !date || !kind) {
      throw Errors.validation('locationId, date and kind are required');
    }
    if (kind !== 'OFF' && kind !== 'CHECK_IN_OUT') {
      throw Errors.validation('kind must be OFF or CHECK_IN_OUT');
    }

    const location = await orgGet<LocationDTO>(`/locations/${locationId}`, bearer(req));

    // Flag gating (ADR-0011): CHECK_IN_OUT requires self check-in enabled.
    if (kind === 'CHECK_IN_OUT' && !location.selfCheckInEnabled) {
      throw Errors.invalidState('Self check-in is disabled at this location');
    }

    // Invariant #3: only one active PENDING request per (workerId,locationId,date),
    // scoped per location to match per-location attendance (invariant #2).
    // Terminal-state rows (APPROVED/REJECTED/CANCELLED) do not block (ADR-0012).
    const existingPending = await prisma.attendanceRequest.findFirst({
      where: { workerId, locationId, date, status: 'PENDING' },
    });
    if (existingPending) {
      throw Errors.conflict('A pending request already exists for this date');
    }

    try {
      const created = await prisma.attendanceRequest.create({
        data: { workerId, locationId, date, kind, note: note ?? null, status: 'PENDING' },
      });
      res.status(201).json(toRequestJSON(created));
    } catch (e: unknown) {
      // Partial unique index race -> conflict.
      if ((e as { code?: string })?.code === 'P2002') {
        throw Errors.conflict('A pending request already exists for this date');
      }
      throw e;
    }
  }),
);

// ==============================================================================
// WORKER: list own requests
// ==============================================================================
router.get(
  '/requests/mine',
  requireRole('WORKER'),
  asyncH(async (req, res) => {
    const workerId = req.auth!.userId;
    const status = req.query.status as string | undefined;
    const rows = await prisma.attendanceRequest.findMany({
      where: { workerId, ...(status ? { status } : {}) },
      orderBy: { requestedAt: 'desc' },
    });
    res.json(rows.map(toRequestJSON));
  }),
);

// ==============================================================================
// MANAGER/SUPER_ADMIN: list requests for a location
// ==============================================================================
router.get(
  '/requests',
  requireRole('MANAGER', 'SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const locationId = req.query.locationId as string | undefined;
    const status = req.query.status as string | undefined;
    if (!locationId) throw Errors.validation('locationId is required');

    // MANAGER must be scoped to the location.
    if (req.auth!.role === 'MANAGER') {
      await assertManagerScope(req, locationId, req.auth!.userId);
    }

    const rows = await prisma.attendanceRequest.findMany({
      where: { locationId, ...(status ? { status } : {}) },
      orderBy: { requestedAt: 'desc' },
    });
    res.json(rows.map(toRequestJSON));
  }),
);

// ==============================================================================
// WORKER: cancel own PENDING request
// ==============================================================================
router.post(
  '/requests/:id/cancel',
  requireRole('WORKER'),
  asyncH(async (req, res) => {
    const workerId = req.auth!.userId;
    const request = await prisma.attendanceRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw Errors.notFound('Request not found');
    if (request.workerId !== workerId) throw Errors.forbidden('Not your request');
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw Errors.invalidState('Only pending or approved requests can be cancelled');
    }

    // Reversal (invariant #7 / ADR-0013): cancelling an already-APPROVED request
    // releases the consumed OFF day and removes the attendance record it created.
    if (request.status === 'APPROVED') {
      if (request.kind === 'OFF') {
        await orgPost(
          `/locations/${request.locationId}/members/${request.workerId}/off-balance/release`,
          {},
          bearer(req),
        );
      }
      await prisma.attendanceRecord.deleteMany({
        where: { workerId, locationId: request.locationId, date: request.date, sourceRefId: request.id },
      });
    }

    const updated = await prisma.attendanceRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
    });
    res.json(toRequestJSON(updated));
  }),
);

// ==============================================================================
// MANAGER/SUPER_ADMIN: approve request
// ==============================================================================
router.post(
  '/requests/:id/approve',
  requireRole('MANAGER', 'SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const request = await prisma.attendanceRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw Errors.notFound('Request not found');
    if (request.status !== 'PENDING') throw Errors.invalidState('Request is not pending');

    // Scope check for MANAGER (invariant #5). SUPER_ADMIN bypasses.
    if (req.auth!.role === 'MANAGER') {
      await assertManagerScope(req, request.locationId, req.auth!.userId);
    }

    // OFF requests consume from the worker's OFF balance atomically at org.
    // A 409 INVALID_STATE (insufficient balance) propagates unchanged.
    if (request.kind === 'OFF') {
      await orgPost(
        `/locations/${request.locationId}/members/${request.workerId}/off-balance/consume`,
        {},
        bearer(req),
      );
    }

    const recordStatus = request.kind === 'OFF' ? 'OFF' : 'PRESENT';

    // Transactionally flip the request to APPROVED and upsert the attendance
    // record (invariant #6).
    const [updated] = await prisma.$transaction([
      prisma.attendanceRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', decidedBy: req.auth!.userId, decidedAt: new Date() },
      }),
      prisma.attendanceRecord.upsert({
        where: {
          workerId_locationId_date: {
            workerId: request.workerId,
            locationId: request.locationId,
            date: request.date,
          },
        },
        update: {
          status: recordStatus,
          source: 'WORKER_REQUEST',
          sourceRefId: request.id,
        },
        create: {
          workerId: request.workerId,
          locationId: request.locationId,
          date: request.date,
          status: recordStatus,
          source: 'WORKER_REQUEST',
          sourceRefId: request.id,
        },
      }),
    ]);

    res.json(toRequestJSON(updated));
  }),
);

// ==============================================================================
// MANAGER/SUPER_ADMIN: reject request
// ==============================================================================
router.post(
  '/requests/:id/reject',
  requireRole('MANAGER', 'SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const reason = (req.body ?? {}).reason as string | undefined;
    const request = await prisma.attendanceRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw Errors.notFound('Request not found');
    if (request.status !== 'PENDING') throw Errors.invalidState('Request is not pending');

    if (req.auth!.role === 'MANAGER') {
      await assertManagerScope(req, request.locationId, req.auth!.userId);
    }

    const note = reason
      ? request.note
        ? `${request.note}\nRejected: ${reason}`
        : `Rejected: ${reason}`
      : request.note;

    const updated = await prisma.attendanceRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', decidedBy: req.auth!.userId, decidedAt: new Date(), note },
    });
    res.json(toRequestJSON(updated));
  }),
);

// ==============================================================================
// MANAGER/SUPER_ADMIN: mark attendance
// ==============================================================================
router.post(
  '/attendance/mark',
  requireRole('MANAGER', 'SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const { locationId, workerId, date, status } = req.body ?? {};
    if (!locationId || !workerId || !date || !status) {
      throw Errors.validation('locationId, workerId, date and status are required');
    }
    if (status !== 'PRESENT' && status !== 'OFF') {
      throw Errors.validation('status must be PRESENT or OFF');
    }

    // MANAGER scope check (invariant #5).
    if (req.auth!.role === 'MANAGER') {
      await assertManagerScope(req, locationId, req.auth!.userId);
    }

    // Flag gating (ADR-0011): applies to SUPER_ADMIN too.
    const location = await orgGet<LocationDTO>(`/locations/${locationId}`, bearer(req));
    if (!location.managerAttendanceMarkingEnabled) {
      throw Errors.invalidState('Manager attendance marking is disabled at this location');
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { workerId_locationId_date: { workerId, locationId, date } },
      update: { status, source: 'MANAGER', sourceRefId: null },
      create: { workerId, locationId, date, status, source: 'MANAGER' },
    });
    res.json(toRecordJSON(record));
  }),
);

// ==============================================================================
// MANAGER/SUPER_ADMIN: list attendance records for a location
// ==============================================================================
router.get(
  '/attendance',
  requireRole('MANAGER', 'SUPER_ADMIN'),
  asyncH(async (req, res) => {
    const locationId = req.query.locationId as string | undefined;
    const workerId = req.query.workerId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const status = req.query.status as string | undefined;
    if (!locationId) throw Errors.validation('locationId is required');

    if (req.auth!.role === 'MANAGER') {
      await assertManagerScope(req, locationId, req.auth!.userId);
    }

    const rows = await prisma.attendanceRecord.findMany({
      where: {
        locationId,
        ...(workerId ? { workerId } : {}),
        ...(status ? { status } : {}),
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    res.json(rows.map(toRecordJSON));
  }),
);

// ==============================================================================
// WORKER: list own attendance records
// ==============================================================================
router.get(
  '/attendance/mine',
  requireRole('WORKER'),
  asyncH(async (req, res) => {
    const workerId = req.auth!.userId;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const rows = await prisma.attendanceRecord.findMany({
      where: {
        workerId,
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    res.json(rows.map(toRecordJSON));
  }),
);

// ==============================================================================
// INTEGRATION ingest — NO user JWT, X-Api-Key + Idempotency-Key.
// (authMiddleware is NOT mounted on this route; see main.ts)
// ==============================================================================
router.post(
  '/integrations/attendance',
  asyncH(async (req, res) => {
    const apiKey = req.header('x-api-key');
    if (apiKey !== INTEGRATION_API_KEY) {
      throw Errors.unauthenticated('Invalid API key');
    }

    const headerKey = req.header('idempotency-key');
    const { externalWorkerId, locationExternalRef, date, status } = req.body ?? {};
    const idempotencyKey = (req.body ?? {}).idempotencyKey || headerKey;

    if (!headerKey) throw Errors.validation('Idempotency-Key header is required');
    if (!externalWorkerId || !locationExternalRef || !date || !status) {
      throw Errors.validation('externalWorkerId, locationExternalRef, date and status are required');
    }
    if (status !== 'PRESENT' && status !== 'OFF') {
      throw Errors.validation('status must be PRESENT or OFF');
    }

    // Resolve worker via identity using an internal service token (integration
    // has no user JWT, but identity still re-verifies the signature).
    let worker: UserDTO;
    try {
      worker = await identityGet<UserDTO>(`/users/by-external/${encodeURIComponent(externalWorkerId)}`, serviceAuth());
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'NOT_FOUND') {
        throw Errors.validation(`Unknown external worker: ${externalWorkerId}`);
      }
      throw e;
    }

    // Resolve location by externalRef via org-service (works for runtime-created
    // locations too, not just seeded ones). Uses the internal service token.
    let location: LocationDTO;
    try {
      location = await orgGet<LocationDTO>(
        `/locations/by-ref/${encodeURIComponent(locationExternalRef)}`,
        serviceAuth(),
      );
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'NOT_FOUND') {
        throw Errors.validation(`Unknown location ref: ${locationExternalRef}`);
      }
      throw e;
    }

    // Idempotent insert of the integration event. Duplicate key -> replay (200).
    try {
      await prisma.integrationEvent.create({
        data: {
          externalWorkerId,
          idempotencyKey,
          payload: JSON.stringify(req.body ?? {}),
        },
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        const existing = await prisma.attendanceRecord.findUnique({
          where: { workerId_locationId_date: { workerId: worker.id, locationId: location.id, date } },
        });
        res.status(200).json({ recordId: existing?.id ?? null, workerId: worker.id, replay: true });
        return;
      }
      throw e;
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { workerId_locationId_date: { workerId: worker.id, locationId: location.id, date } },
      update: { status, source: 'INTEGRATION', sourceRefId: null },
      create: { workerId: worker.id, locationId: location.id, date, status, source: 'INTEGRATION' },
    });

    res.status(201).json({ recordId: record.id, workerId: worker.id });
  }),
);
