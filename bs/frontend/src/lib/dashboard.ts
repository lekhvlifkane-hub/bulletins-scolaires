import { api } from './api';

export interface DashboardSchool {
  scope: 'school';
  schoolName: string | null;
  academicYear: { id: string; name: string } | null;
  indicators: {
    students: number;
    enrollments: number;
    classrooms: number;
    subjects: number;
    assessments: number;
    bulletins: number;
    publishedBulletins: number;
  };
  semesters: {
    id: string;
    name: string;
    numero: number;
    bulletins: number;
    bulletinsPublies: number;
    absences: number;
    retards: number;
  }[];
}

export interface DashboardPlatform {
  scope: 'platform';
  indicators: { schools: number; activeSchools: number; users: number };
}

export async function chargerDashboard(): Promise<DashboardSchool | DashboardPlatform> {
  const response = await api.fetch('/api/dashboard');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? 'Impossible de charger le tableau de bord');
  }
  return body as DashboardSchool | DashboardPlatform;
}
