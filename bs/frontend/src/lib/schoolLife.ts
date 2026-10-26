import { api } from './api';

async function demander<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await api.fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `Requête refusée (${response.status})`);
  }
  return body as T;
}

function query(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

export interface AttendanceRecord {
  id: string;
  date: string;
  kind: 'ABSENCE' | 'RETARD';
  justified: boolean;
  durationMinutes: number | null;
  reason: string | null;
}

export interface AppreciationRecord {
  id: string;
  subjectId: string;
  content: string;
  subject: { id: string; name: string };
}

export interface CouncilDecision {
  id: string;
  enrollmentId: string;
  academicYearId: string;
  content: string;
  status: 'BROUILLON' | 'VALIDEE';
  validatedAt: string | null;
  enrollment: { student: { lastName: string; firstNames: string } };
}

export interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  metadata: unknown;
  user: { name: string };
}

export interface SchoolArchive {
  annee: { id: string; name: string };
  bulletins: {
    id: string;
    version: number;
    statut: string;
    semester: { name: string };
    enrollment: { student: { lastName: string; firstNames: string } };
  }[];
  bilansAnnuels: {
    id: string;
    version: number;
    statut: string;
    enrollment: { student: { lastName: string; firstNames: string } };
  }[];
  presences: (AttendanceRecord & {
    enrollment: { student: { lastName: string; firstNames: string } };
  })[];
  appreciations: {
    id: string;
    content: string;
    subject: { name: string };
    semester: { name: string };
    enrollment: { student: { lastName: string; firstNames: string } };
  }[];
  decisionsConseil: CouncilDecision[];
}

export function chargerPresences(enrollmentId: string, semesterId: string) {
  return demander<{ records: AttendanceRecord[]; resume: unknown }>(
    `/api/school-life/attendance?${query({ enrollmentId, semesterId })}`
  );
}

export function enregistrerPresence(payload: {
  enrollmentId: string;
  semesterId: string;
  kind: 'ABSENCE' | 'RETARD';
  date: string;
  justified: boolean;
  durationMinutes?: number | null;
  reason?: string | null;
}) {
  return demander<{ record: AttendanceRecord }>('/api/school-life/attendance', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function chargerAppreciations(enrollmentId: string, semesterId: string) {
  return demander<{ appreciations: AppreciationRecord[] }>(
    `/api/school-life/appreciations?${query({ enrollmentId, semesterId })}`
  );
}

export function enregistrerAppreciation(payload: {
  enrollmentId: string;
  semesterId: string;
  subjectId: string;
  content: string;
}) {
  return demander<{ appreciation: AppreciationRecord | null }>('/api/school-life/appreciations', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function chargerDecisions(academicYearId: string) {
  return demander<{ decisions: CouncilDecision[] }>(
    `/api/school-life/council-decisions?${query({ academicYearId })}`
  );
}

export function enregistrerDecision(payload: {
  enrollmentId: string;
  academicYearId: string;
  content: string;
}) {
  return demander<{ decision: CouncilDecision }>('/api/school-life/council-decisions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function validerDecision(id: string) {
  return demander<{ decision: CouncilDecision }>(`/api/school-life/council-decisions/${encodeURIComponent(id)}/validate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function chargerArchive(academicYearId: string) {
  return demander<SchoolArchive>(
    `/api/school-life/archives?${query({ academicYearId })}`
  );
}

export function chargerHistorique(entityType: string, entityId: string) {
  return demander<{ history: AuditEntry[] }>(
    `/api/school-life/history?${query({ entityType, entityId })}`
  );
}
