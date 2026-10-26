import { prisma } from '../db/prisma';

export interface AttendanceSummary {
  disponible: boolean;
  absencesJustifiees: number;
  absencesNonJustifiees: number;
  absencesTotal: number;
  retards: number;
  minutesRetard: number;
}

export async function resumeAbsences(
  schoolId: string,
  enrollmentId: string,
  semesterIds: string[],
): Promise<AttendanceSummary> {
  const records = await prisma.attendanceRecord.findMany({
    where: { schoolId, enrollmentId, semesterId: { in: semesterIds }, deletedAt: null },
    select: { kind: true, justified: true, durationMinutes: true },
  });
  const absencesJustifiees = records.filter((r) => r.kind === 'ABSENCE' && r.justified).length;
  const absencesNonJustifiees = records.filter((r) => r.kind === 'ABSENCE' && !r.justified).length;
  const retards = records.filter((r) => r.kind === 'RETARD');
  return {
    disponible: true,
    absencesJustifiees,
    absencesNonJustifiees,
    absencesTotal: absencesJustifiees + absencesNonJustifiees,
    retards: retards.length,
    minutesRetard: retards.reduce((total, record) => total + (record.durationMinutes ?? 0), 0),
  };
}
