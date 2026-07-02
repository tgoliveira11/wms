import { PrismaClient } from '../src/generated/prisma';
import { USER_LIST } from '@wfms/shared';

const prisma = new PrismaClient();

async function main() {
  for (const u of USER_LIST) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {
        externalId: u.externalId,
        displayName: u.displayName,
        role: u.role,
      },
      create: {
        id: u.id,
        externalId: u.externalId,
        displayName: u.displayName,
        role: u.role,
      },
    });
  }
  console.log(`Seeded ${USER_LIST.length} users`);
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
