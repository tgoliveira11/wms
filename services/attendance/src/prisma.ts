import { PrismaClient } from './generated/prisma';

// Single shared PrismaClient instance for the whole service.
export const prisma = new PrismaClient();
