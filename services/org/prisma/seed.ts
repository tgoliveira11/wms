import { PrismaClient } from '../src/generated/prisma';
import { COMPANY, LOCATION_LIST, MEMBERSHIPS } from '@wfms/shared';

const prisma = new PrismaClient();

async function main() {
  for (const loc of LOCATION_LIST) {
    await prisma.location.upsert({
      where: { id: loc.id },
      update: {
        companyId: COMPANY.id,
        name: loc.name,
        address: loc.address,
        externalRef: loc.externalRef,
        selfCheckInEnabled: loc.selfCheckInEnabled,
        managerAttendanceMarkingEnabled: loc.managerAttendanceMarkingEnabled,
      },
      create: {
        id: loc.id,
        companyId: COMPANY.id,
        name: loc.name,
        address: loc.address,
        externalRef: loc.externalRef,
        selfCheckInEnabled: loc.selfCheckInEnabled,
        managerAttendanceMarkingEnabled: loc.managerAttendanceMarkingEnabled,
      },
    });
  }

  for (const m of MEMBERSHIPS) {
    // offBalanceRemaining defaults to annualOffAllowance unless the seed overrides it.
    const remaining = m.offBalanceRemaining ?? m.annualOffAllowance;
    await prisma.locationMember.upsert({
      where: { locationId_userId: { locationId: m.locationId, userId: m.userId } },
      update: {
        role: m.role,
        jobTitle: m.jobTitle,
        annualOffAllowance: m.annualOffAllowance,
        offBalanceRemaining: remaining,
      },
      create: {
        locationId: m.locationId,
        userId: m.userId,
        role: m.role,
        jobTitle: m.jobTitle,
        annualOffAllowance: m.annualOffAllowance,
        offBalanceRemaining: remaining,
      },
    });
  }

  console.log(`Seeded ${LOCATION_LIST.length} locations, ${MEMBERSHIPS.length} memberships`);
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
