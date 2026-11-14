import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { formaterMatricule, prochainMatricule } from '../src/services/matricule';
import { cleanTestDb, createSchool } from './helpers';

async function creerEleve(schoolId: string, matricule: string) {
  return prisma.student.create({
    data: {
      schoolId,
      matricule,
      lastName: 'Test',
      firstNames: 'Élève',
    },
  });
}

describe('Matricules automatiques', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('démarre à ELI001 puis incrémente le plus grand numéro', async () => {
    const school = await createSchool('École matricules');
    expect(await prochainMatricule(school.id)).toBe('ELI001');

    await creerEleve(school.id, 'ELI001');
    await creerEleve(school.id, 'ELI009');
    await creerEleve(school.id, 'AB-12');
    await creerEleve(school.id, 'ELIABC');

    expect(await prochainMatricule(school.id)).toBe('ELI010');
  });

  it("ignore les matricules d'un autre établissement", async () => {
    const schoolA = await createSchool('École A');
    const schoolB = await createSchool('École B');
    await creerEleve(schoolA.id, 'ELI005');
    await creerEleve(schoolB.id, 'ELI050');

    expect(await prochainMatricule(schoolA.id)).toBe('ELI006');
    expect(await prochainMatricule(schoolB.id)).toBe('ELI051');
  });

  it('conserve au moins trois chiffres et gère les dépassements', () => {
    expect(formaterMatricule('ELI', 1)).toBe('ELI001');
    expect(formaterMatricule('ELI', 42)).toBe('ELI042');
    expect(formaterMatricule('ELI', 1000)).toBe('ELI1000');
  });
});
