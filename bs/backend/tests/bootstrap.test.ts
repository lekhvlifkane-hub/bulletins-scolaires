import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { assurerAdministrateurGeneral } from '../src/db/bootstrap';
import { prisma } from '../src/db/prisma';
import { verifyPassword } from '../src/lib/password';

describe('assurerAdministrateurGeneral', () => {
  it('garantit l’existence de l’administrateur général par défaut puis reste idempotent', async () => {
    await assurerAdministrateurGeneral();

    const admin = await prisma.user.findUnique({
      where: { email: env.PLATFORM_ADMIN_EMAIL },
    });
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('PLATFORM_ADMIN');
    expect(admin?.isActive).toBe(true);
    expect(admin?.schoolId).toBeNull();
    expect(await verifyPassword(env.PLATFORM_ADMIN_PASSWORD, admin!.passwordHash)).toBe(
      true,
    );

    const total = await prisma.user.count({
      where: { role: 'PLATFORM_ADMIN', deletedAt: null },
    });
    expect(total).toBeGreaterThanOrEqual(1);

    // Deuxième appel : rien ne bouge, aucun doublon créé.
    await assurerAdministrateurGeneral();
    expect(
      await prisma.user.count({ where: { role: 'PLATFORM_ADMIN', deletedAt: null } }),
    ).toBe(total);
  });
});
