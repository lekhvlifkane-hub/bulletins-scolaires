import { Prisma } from '@prisma/client';
import type { GradeStatus } from '@prisma/client';
import { prisma } from '../src/db/prisma';

/**
 * Contexte de test partagé par la phase 5 (bulletins, comparaison, bilan annuel).
 *
 * Une classe de quatre élèves, deux disciplines (Maths coef 3, Histoire-Géo coef 2),
 * deux semestres et deux catégories d'évaluation (devoir, composition), avec des notes
 * rondes pour que les moyennes attendues restent lisibles dans les assertions.
 */

export interface Contexte {
  schoolId: string;
  userId: string;
  academicYearId: string;
  semestre1Id: string;
  semestre2Id: string;
  classroomId: string;
  mathsCsf: string;
  histoireCsf: string;
  devoirTypeId: string;
  compositionTypeId: string;
  eleves: { enrollmentId: string; studentId: string; matricule: string; nom: string }[];
}

export async function creerContexte(schoolId: string, userId: string): Promise<Contexte> {
  const annee = await prisma.academicYear.create({
    data: {
      schoolId,
      name: '2025-2026',
      startsAt: new Date('2025-10-01'),
      endsAt: new Date('2026-07-31'),
      status: 'ACTIVE',
      semesters: {
        create: [
          { number: 1, name: 'Semestre 1', startsAt: new Date('2025-10-01'), endsAt: new Date('2026-02-28') },
          { number: 2, name: 'Semestre 2', startsAt: new Date('2026-03-01'), endsAt: new Date('2026-07-31') },
        ],
      },
    },
    include: { semesters: { orderBy: { number: 'asc' } } },
  });
  const [semestre1, semestre2] = annee.semesters;

  const niveau = await prisma.level.create({ data: { schoolId, name: 'Terminale S' } });
  const classe = await prisma.classroom.create({
    data: { schoolId, academicYearId: annee.id, levelId: niveau.id, name: 'TS 1' },
  });

  const maths = await prisma.subject.create({ data: { schoolId, name: 'Mathématiques', code: 'MATH' } });
  const histoire = await prisma.subject.create({
    data: { schoolId, name: 'Histoire-Géographie', code: 'HIGE' },
  });
  const csMaths = await prisma.classroomSubject.create({
    data: { schoolId, classroomId: classe.id, subjectId: maths.id, coefficient: new Prisma.Decimal('3') },
  });
  const csHistoire = await prisma.classroomSubject.create({
    data: { schoolId, classroomId: classe.id, subjectId: histoire.id, coefficient: new Prisma.Decimal('2') },
  });

  const eleves: Contexte['eleves'] = [];
  const noms = ['Alpha', 'Beta', 'Gamma', 'Delta'];
  for (let i = 0; i < noms.length; i += 1) {
    const student = await prisma.student.create({
      data: {
        schoolId,
        matricule: `ELV-${i + 1}`,
        lastName: noms[i],
        firstNames: 'Eleve',
        birthDate: new Date('2007-03-14'),
        birthPlace: 'Touba',
        sex: 'M',
      },
    });
    const enrollment = await prisma.enrollment.create({
      data: { schoolId, studentId: student.id, classroomId: classe.id, status: 'ACTIVE' },
    });
    eleves.push({
      enrollmentId: enrollment.id,
      studentId: student.id,
      matricule: student.matricule,
      nom: student.lastName,
    });
  }

  const devoir = await prisma.assessmentType.create({
    data: { schoolId, code: 'DEV', name: 'Devoir surveillé', category: 'DEVOIR' },
  });
  const composition = await prisma.assessmentType.create({
    data: { schoolId, code: 'COMP', name: 'Composition', category: 'COMPOSITION' },
  });

  return {
    schoolId,
    userId,
    academicYearId: annee.id,
    semestre1Id: semestre1.id,
    semestre2Id: semestre2.id,
    classroomId: classe.id,
    mathsCsf: csMaths.id,
    histoireCsf: csHistoire.id,
    devoirTypeId: devoir.id,
    compositionTypeId: composition.id,
    eleves,
  };
}

export async function evalValidee(
  ctx: Contexte,
  options: {
    classroomSubjectId: string;
    semesterId: string;
    typeId: string;
    title: string;
    position?: number;
    status?: 'BOUILLON' | 'SAISIE_EN_COURS' | 'A_VERIFIER' | 'VALIDEE' | 'PUBLIEE';
    notes: { enrollmentId: string; score: string | number | null; status?: GradeStatus }[];
  }
) {
  const assessment = await prisma.assessment.create({
    data: {
      schoolId: ctx.schoolId,
      classroomSubjectId: options.classroomSubjectId,
      semesterId: options.semesterId,
      typeId: options.typeId,
      title: options.title,
      position: options.position ?? 1,
      outOf: new Prisma.Decimal('20'),
      status: options.status ?? 'VALIDEE',
    },
  });
  for (const note of options.notes) {
    await prisma.grade.create({
      data: {
        schoolId: ctx.schoolId,
        assessmentId: assessment.id,
        enrollmentId: note.enrollmentId,
        score: note.score === null ? null : new Prisma.Decimal(String(note.score)),
        status: note.status ?? 'SAISIE',
      },
    });
  }
  return assessment;
}

/**
 * S1 (poids devoirs 1, compositions 1) :
 *   Alpha  maths (16,16)=16   histoire (14,14)=14  -> 15,20 rang 1
 *   Beta   maths (14,14)=14   histoire (16,16)=16  -> 14,80 rang 2
 *   Gamma  maths (13,15)=14   histoire (17,15)=16  -> 14,80 rang 2 (ex aequo)
 *   Delta  maths (10,12)=11   histoire (10,10)=10  -> 10,60 rang 4
 * S2 : Alpha 18,2 ; Beta 12,8 ; Gamma 14,8 ; Delta 8,8
 * Annuels : Alpha 16,7 ; Gamma 14,8 ; Beta 13,8 ; Delta 9,7
 */
export async function creerScenarioSemestres(ctx: Contexte) {
  const n = (index: number) => ctx.eleves[index].enrollmentId;

  await evalValidee(ctx, {
    classroomSubjectId: ctx.mathsCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.devoirTypeId,
    title: 'Devoir 1 Maths S1',
    notes: [{ enrollmentId: n(0), score: 16 }, { enrollmentId: n(1), score: 14 }, { enrollmentId: n(2), score: 13 }, { enrollmentId: n(3), score: 10 }],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.mathsCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.compositionTypeId,
    title: 'Composition Maths S1',
    notes: [{ enrollmentId: n(0), score: 16 }, { enrollmentId: n(1), score: 14 }, { enrollmentId: n(2), score: 15 }, { enrollmentId: n(3), score: 12 }],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.histoireCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.devoirTypeId,
    title: 'Devoir 1 Histoire S1',
    notes: [{ enrollmentId: n(0), score: 14 }, { enrollmentId: n(1), score: 16 }, { enrollmentId: n(2), score: 17 }, { enrollmentId: n(3), score: 10 }],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.histoireCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.compositionTypeId,
    title: 'Composition Histoire S1',
    notes: [{ enrollmentId: n(0), score: 14 }, { enrollmentId: n(1), score: 16 }, { enrollmentId: n(2), score: 15 }, { enrollmentId: n(3), score: 10 }],
  });

  await evalValidee(ctx, {
    classroomSubjectId: ctx.mathsCsf,
    semesterId: ctx.semestre2Id,
    typeId: ctx.devoirTypeId,
    title: 'Devoir 1 Maths S2',
    notes: [{ enrollmentId: n(0), score: 18 }, { enrollmentId: n(1), score: 12 }, { enrollmentId: n(2), score: 14 }, { enrollmentId: n(3), score: 8 }],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.mathsCsf,
    semesterId: ctx.semestre2Id,
    typeId: ctx.compositionTypeId,
    title: 'Composition Maths S2',
    notes: [{ enrollmentId: n(0), score: 20 }, { enrollmentId: n(1), score: 12 }, { enrollmentId: n(2), score: 14 }, { enrollmentId: n(3), score: 8 }],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.histoireCsf,
    semesterId: ctx.semestre2Id,
    typeId: ctx.devoirTypeId,
    title: 'Devoir 1 Histoire S2',
    notes: [{ enrollmentId: n(0), score: 16 }, { enrollmentId: n(1), score: 14 }, { enrollmentId: n(2), score: 16 }, { enrollmentId: n(3), score: 10 }],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.histoireCsf,
    semesterId: ctx.semestre2Id,
    typeId: ctx.compositionTypeId,
    title: 'Composition Histoire S2',
    notes: [{ enrollmentId: n(0), score: 18 }, { enrollmentId: n(1), score: 14 }, { enrollmentId: n(2), score: 16 }, { enrollmentId: n(3), score: 10 }],
  });
}
