import type { Prisma, User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { HttpError } from '../lib/http';

const activeSchoolUser = (schoolId: string) => ({
  schoolId,
  deletedAt: null,
});

export function tenantUsers(schoolId: string) {
  const scope = activeSchoolUser(schoolId);

  return {
    list() {
      return prisma.user.findMany({
        where: { ...scope },
        orderBy: { createdAt: 'asc' },
      });
    },
    findById(id: string) {
      return prisma.user.findFirst({ where: { id, ...scope } });
    },
    create(data: Prisma.UserUncheckedCreateInput) {
      return prisma.user.create({
        data: { ...data, schoolId, deletedAt: null },
      });
    },
    async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
      const existing = await prisma.user.findFirst({ where: { id, ...scope } });
      if (!existing) {
        throw new HttpError(404, 'Utilisateur introuvable');
      }
      return prisma.user.update({ where: { id }, data });
    },
    async softDelete(id: string): Promise<void> {
      const existing = await prisma.user.findFirst({ where: { id, ...scope } });
      if (!existing) {
        throw new HttpError(404, 'Utilisateur introuvable');
      }
      await prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
    },
  };
}
