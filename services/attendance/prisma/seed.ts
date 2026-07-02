import { PrismaClient } from '../src/generated/prisma';
import { USERS, LOCATIONS } from '@wfms/shared';

const prisma = new PrismaClient();

async function main() {
  // Partial unique index enforcing "one PENDING request per (workerId,date)"
  // (invariant #3, ADR-0012). Prisma can't express partial unique indexes in
  // schema, so we create it here. Terminal-state rows do not participate.
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_request ON "AttendanceRequest"("workerId","date") WHERE status = 'PENDING'`,
  );

  // Demo requests. Avoid date 2026-07-10 (reserved for curl tests).
  // Tom: a PENDING OFF request at Boulder on 2026-07-05.
  await prisma.attendanceRequest.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000f1' },
    update: {
      workerId: USERS.tom.id,
      locationId: LOCATIONS.boulder.id,
      date: '2026-07-05',
      kind: 'OFF',
      status: 'PENDING',
      note: 'Family event',
    },
    create: {
      id: '00000000-0000-0000-0000-0000000000f1',
      workerId: USERS.tom.id,
      locationId: LOCATIONS.boulder.id,
      date: '2026-07-05',
      kind: 'OFF',
      status: 'PENDING',
      note: 'Family event',
    },
  });

  // Jamie: an APPROVED OFF request at Boulder on 2026-06-20, with a matching
  // attendance record (source WORKER_REQUEST).
  await prisma.attendanceRequest.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000f2' },
    update: {
      workerId: USERS.jamie.id,
      locationId: LOCATIONS.boulder.id,
      date: '2026-06-20',
      kind: 'OFF',
      status: 'APPROVED',
      decidedBy: USERS.megan.id,
      decidedAt: new Date('2026-06-15T10:00:00Z'),
    },
    create: {
      id: '00000000-0000-0000-0000-0000000000f2',
      workerId: USERS.jamie.id,
      locationId: LOCATIONS.boulder.id,
      date: '2026-06-20',
      kind: 'OFF',
      status: 'APPROVED',
      decidedBy: USERS.megan.id,
      decidedAt: new Date('2026-06-15T10:00:00Z'),
    },
  });

  await prisma.attendanceRecord.upsert({
    where: { workerId_date: { workerId: USERS.jamie.id, date: '2026-06-20' } },
    update: {
      locationId: LOCATIONS.boulder.id,
      status: 'OFF',
      source: 'WORKER_REQUEST',
      sourceRefId: '00000000-0000-0000-0000-0000000000f2',
    },
    create: {
      workerId: USERS.jamie.id,
      locationId: LOCATIONS.boulder.id,
      date: '2026-06-20',
      status: 'OFF',
      source: 'WORKER_REQUEST',
      sourceRefId: '00000000-0000-0000-0000-0000000000f2',
    },
  });

  // Lin: one INTEGRATION PRESENT record at Boulder on 2026-06-25.
  await prisma.attendanceRecord.upsert({
    where: { workerId_date: { workerId: USERS.lin.id, date: '2026-06-25' } },
    update: {
      locationId: LOCATIONS.boulder.id,
      status: 'PRESENT',
      source: 'INTEGRATION',
    },
    create: {
      workerId: USERS.lin.id,
      locationId: LOCATIONS.boulder.id,
      date: '2026-06-25',
      status: 'PRESENT',
      source: 'INTEGRATION',
    },
  });

  console.log('Seeded attendance demo data');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
