import { z } from 'zod';
import { prisma } from '../db/prisma';

export const studentImportDataSchema = z.object({
  matricule: z.string().trim().optional().transform((value) => value || undefined),
  lastName: z.string().trim().min(2),
  firstNames: z.string().trim().min(2),
  birthDate: z.coerce.date(),
  birthPlace: z.string().trim().optional(),
  sex: z.string().trim().optional(),
  address: z.string().trim().optional(),
  guardianName: z.string().trim().optional(),
  guardianPhone: z.string().trim().optional(),
  classroom: z.string().trim().optional(),
  academicYear: z.string().trim().optional(),
  status: z.enum(['NOUVEAU', 'REDOUBLANT', 'TRANSFERE']).default('NOUVEAU'),
});

export const studentImportRequestSchema = z.object({
  students: z.array(z.object({
    row: z.number().int().min(2),
    student: z.unknown(),
    action: z.enum(['CREATE', 'LINK', 'UPDATE']).optional(),
    candidateId: z.string().min(1).optional(),
  })).min(1).max(500),
});

type ImportCandidate = {
  id: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  birthDate: Date | null;
  deletedAt: Date | null;
  activeEnrollments: {
    classroomId: string;
    classroomName: string;
    academicYearName: string;
  }[];
};

export type ImportSuggestedAction = 'CREATE' | 'LINK' | 'UPDATE';

export type AnalyzedImportRow = {
  row: number;
  data: z.infer<typeof studentImportDataSchema> | null;
  error?: string;
  candidates: ImportCandidate[];
  suggestedAction: ImportSuggestedAction;
  suggestedCandidateId?: string;
  classroom: {
    id: string;
    name: string;
    academicYearId: string;
    academicYearName: string;
  } | null;
};

function normaliser(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR');
}

function cleIdentite(data: z.infer<typeof studentImportDataSchema>): string {
  return [
    normaliser(data.lastName),
    normaliser(data.firstNames),
    data.birthDate.toISOString().slice(0, 10),
  ].join('|');
}

function formatIssue(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'élève'}: ${issue.message}`)
    .join('; ');
}

export async function analyserImportEleves(
  schoolId: string,
  rows: z.infer<typeof studentImportRequestSchema>['students'],
): Promise<AnalyzedImportRow[]> {
  const parsed = rows.map(({ row, student }) => {
    const result = studentImportDataSchema.safeParse(student);
    return {
      row,
      data: result.success ? result.data : null,
      ...(!result.success ? { error: formatIssue(result.error) } : {}),
      candidates: [] as ImportCandidate[],
      suggestedAction: 'CREATE' as ImportSuggestedAction,
      classroom: null as AnalyzedImportRow['classroom'],
    };
  });

  const matricules = new Set<string>();
  const identities = new Map<string, number>();
  for (const item of parsed) {
    if (!item.data || item.error) continue;
    const matricule = item.data.matricule?.toLocaleUpperCase('fr-FR');
    if (matricule && matricules.has(matricule)) {
      item.error = 'Matricule répété dans le fichier';
      continue;
    }
    if (matricule) matricules.add(matricule);
    const identity = cleIdentite(item.data);
    const firstRow = identities.get(identity);
    if (firstRow !== undefined) {
      item.error = `Identité répétée dans le fichier (ligne ${firstRow})`;
      continue;
    }
    identities.set(identity, item.row);
  }

  const valid = parsed.filter((item): item is typeof item & {
    data: z.infer<typeof studentImportDataSchema>;
  } => item.data !== null && !item.error);
  const criteria = new Map<string, { lastName: string; firstNames: string; birthDate: Date }>();
  for (const { data } of valid) {
    criteria.set(cleIdentite(data), {
      lastName: data.lastName,
      firstNames: data.firstNames,
      birthDate: data.birthDate,
    });
  }

  const identityTerms = [...criteria.values()].map(({ lastName, firstNames, birthDate }) => {
    const start = new Date(Date.UTC(
      birthDate.getUTCFullYear(),
      birthDate.getUTCMonth(),
      birthDate.getUTCDate(),
    ));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return {
      lastName: { equals: lastName, mode: 'insensitive' as const },
      firstNames: { equals: firstNames, mode: 'insensitive' as const },
      birthDate: { gte: start, lt: end },
    };
  });
  const matriculeTerms = [...new Set(
    valid.flatMap(({ data }) => data.matricule ? [data.matricule] : []),
  )].map((matricule) => ({ matricule: { equals: matricule, mode: 'insensitive' as const } }));

  const [students, classrooms] = await Promise.all([
    identityTerms.length + matriculeTerms.length > 0
      ? prisma.student.findMany({
          where: {
            schoolId,
            OR: [...identityTerms, ...matriculeTerms],
          },
          select: {
            id: true,
            matricule: true,
            lastName: true,
            firstNames: true,
            birthDate: true,
            deletedAt: true,
            enrollments: {
              where: { schoolId, deletedAt: null, status: 'ACTIVE' },
              select: {
                classroomId: true,
                classroom: {
                  select: {
                    name: true,
                    academicYear: { select: { name: true } },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.classroom.findMany({
      where: {
        schoolId,
        deletedAt: null,
        academicYear: { deletedAt: null, status: { not: 'CLOSED' } },
      },
      select: {
        id: true,
        name: true,
        academicYearId: true,
        academicYear: { select: { name: true } },
      },
    }),
  ]);

  for (const item of valid) {
    const exactMatricule = item.data.matricule
      ? students.filter((student) =>
          student.matricule.toLocaleLowerCase('fr-FR') ===
          item.data.matricule!.toLocaleLowerCase('fr-FR'),
        )
      : [];
    const exactIdentity = students.filter((student) =>
      normaliser(student.lastName) === normaliser(item.data!.lastName) &&
      normaliser(student.firstNames) === normaliser(item.data!.firstNames) &&
      student.birthDate?.toISOString().slice(0, 10) === item.data!.birthDate.toISOString().slice(0, 10),
    );
    const matches = exactMatricule.length > 0 ? exactMatricule : exactIdentity;
    item.candidates = matches.map((student) => ({
      id: student.id,
      matricule: student.matricule,
      lastName: student.lastName,
      firstNames: student.firstNames,
      birthDate: student.birthDate,
      deletedAt: student.deletedAt,
      activeEnrollments: student.enrollments.map((enrollment) => ({
        classroomId: enrollment.classroomId,
        classroomName: enrollment.classroom.name,
        academicYearName: enrollment.classroom.academicYear.name,
      })),
    }));

    const candidateUpdate = item.candidates.find((candidate) =>
      candidate.deletedAt === null &&
      Boolean(item.data!.matricule) &&
      candidate.matricule.toLocaleLowerCase('fr-FR') ===
        item.data!.matricule!.toLocaleLowerCase('fr-FR') &&
      candidate.birthDate?.toISOString().slice(0, 10) ===
        item.data!.birthDate.toISOString().slice(0, 10),
    );
    if (candidateUpdate) {
      item.suggestedAction = 'UPDATE';
      item.suggestedCandidateId = candidateUpdate.id;
    } else if (item.candidates.length > 0) {
      item.suggestedAction = 'LINK';
      item.suggestedCandidateId = item.candidates[0]!.id;
    }

    if (item.data.academicYear && !item.data.classroom) {
      item.error = 'Une année scolaire ne peut être indiquée sans classe';
      continue;
    }
    if (item.data.classroom) {
      const candidates = classrooms.filter((classroom) =>
        normaliser(classroom.name) === normaliser(item.data!.classroom!) &&
        (!item.data!.academicYear ||
          normaliser(classroom.academicYear.name) === normaliser(item.data!.academicYear)),
      );
      if (candidates.length === 0) {
        item.error = 'Classe ou année scolaire introuvable, ou année clôturée';
      } else if (candidates.length > 1) {
        item.error = 'Classe présente dans plusieurs années : préciser l’année scolaire';
      } else {
        const classroom = candidates[0];
        item.classroom = {
          id: classroom.id,
          name: classroom.name,
          academicYearId: classroom.academicYearId,
          academicYearName: classroom.academicYear.name,
        };
      }
    }
  }

  return parsed;
}
