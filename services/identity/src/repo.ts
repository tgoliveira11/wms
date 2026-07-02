import type { User } from './generated/prisma';
import { prisma } from './prisma';

// Public JSON shape for a user: { id, externalId, displayName, role }.
export interface UserDTO {
  id: string;
  externalId: string;
  displayName: string;
  role: string;
}

export function toDTO(user: User): UserDTO {
  return {
    id: user.id,
    externalId: user.externalId,
    displayName: user.displayName,
    role: user.role,
  };
}

export function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export function findByExternalId(externalId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { externalId } });
}

export function findByIds(ids: string[]): Promise<User[]> {
  return prisma.user.findMany({ where: { id: { in: ids } } });
}
