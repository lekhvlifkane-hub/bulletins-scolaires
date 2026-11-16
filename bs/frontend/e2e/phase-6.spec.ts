import { expect, test } from '@playwright/test';

const session = {
  authenticated: true,
  csrfToken: 'playwright-csrf',
  user: {
    id: 'user-1',
    schoolId: 'school-1',
    name: 'Awa Ndiaye',
    email: 'awa@example.test',
    role: 'SCHOOL_ADMIN',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  school: {
    id: 'school-1',
    name: 'École de test',
    officialName: null,
    iefName: 'IEF Thiès',
    city: null,
    address: null,
    phone: null,
    email: null,
    accreditationNumber: null,
    logoDataUrl: null,
    status: 'ACTIVE',
    accountMode: 'EQUIPE',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

const classes = [{
  id: 'class-1',
  name: '6e A',
  academicYear: { id: 'year-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: '6e' },
  _count: { enrollments: 1 },
}];

const years = [
  {
    id: 'year-1',
    name: '2025-2026',
    status: 'ACTIVE',
    semesters: [
      { id: 'semester-1', number: 1, name: 'Semestre 1' },
      { id: 'semester-2', number: 2, name: 'Semestre 2' },
    ],
  },
  {
    id: 'year-0',
    name: '2024-2025',
    status: 'CLOSED',
    semesters: [{ id: 'semester-0', number: 1, name: 'Semestre 1' }],
  },
];

test.beforeEach(async ({ page }) => {
  const records: Record<string, unknown>[] = [{
    id: 'attendance-1',
    date: '2025-11-10T12:00:00.000Z',
    kind: 'ABSENCE',
    justified: true,
    durationMinutes: null,
    reason: 'Maladie',
  }];
  let appreciations: Record<string, unknown>[] = [{
    id: 'appreciation-1',
    subjectId: 'subject-1',
    content: 'Bon travail.',
    subject: { id: 'subject-1', name: 'Mathématiques' },
  }];
  let decisions: Record<string, unknown>[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const respond = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/session') return respond(session);
    if (path === '/api/schooling/classes') return respond({ classes });
    if (path === '/api/schooling/years') return respond({ years });
    if (path === '/api/schooling/classroom-subjects') {
      return respond({
        classroomSubjects: [{
          id: 'assignment-1',
          classroomId: 'class-1',
          subjectId: 'subject-1',
          coefficient: '3',
          subject: { id: 'subject-1', name: 'Mathématiques', code: 'MATH' },
          classroom: { id: 'class-1', name: '6e A' },
        }],
      });
    }
    if (path === '/api/report-cards') {
      return respond({
        semestre: { id: 'semester-1', numero: 1, nom: 'Semestre 1', academicYearId: 'year-1', anneeScolaire: '2025-2026' },
        lignes: [{
          enrollmentId: 'enrollment-1',
          studentId: 'student-1',
          matricule: 'MAT-1',
          nom: 'Ndiaye',
          prenoms: 'Awa',
          classe: '6e A',
          niveau: '6e',
          bulletin: null,
        }],
      });
    }
    if (path === '/api/school-life/attendance') {
      return respond({ records, resume: {} });
    }
    if (path === '/api/school-life/appreciations') {
      if (method === 'PUT') {
        const data = request.postDataJSON() as { subjectId: string; content: string };
        const record = {
          id: 'appreciation-1',
          subjectId: data.subjectId,
          content: data.content,
          subject: { id: data.subjectId, name: 'Mathématiques' },
        };
        appreciations = [record];
        return respond({ appreciation: data.content ? record : null });
      }
      return respond({ appreciations });
    }
    if (path === '/api/school-life/council-decisions' && method === 'POST') {
      const data = request.postDataJSON() as { enrollmentId: string; academicYearId: string; content: string };
      const record = {
        id: 'decision-1',
        enrollmentId: data.enrollmentId,
        academicYearId: data.academicYearId,
        content: data.content,
        status: 'BROUILLON',
        validatedAt: null,
        enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
      };
      decisions = [record];
      return respond({ decision: record }, 201);
    }
    if (path === '/api/school-life/council-decisions/decision-1/validate') {
      decisions = decisions.map((item) => ({
        ...item,
        status: 'VALIDEE',
        validatedAt: '2026-11-16T11:00:00.000Z',
      }));
      return respond({ decision: decisions[0], dejaValidee: false });
    }
    if (path === '/api/school-life/council-decisions') {
      return respond({ decisions });
    }
    if (path === '/api/school-life/archives') {
      return respond({
        annee: { id: 'year-0', name: '2024-2025' },
        bulletins: [{
          id: 'bulletin-1',
          version: 1,
          statut: 'PUBLIE',
          semester: { name: 'Semestre 1' },
          enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
        }],
        bilansAnnuels: [],
        presences: [{
          id: 'attendance-0',
          date: '2025-05-10T12:00:00.000Z',
          kind: 'ABSENCE',
          justified: false,
          durationMinutes: null,
          reason: null,
          enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
        }],
        appreciations: [{
          id: 'appreciation-0',
          content: 'Élève sérieuse.',
          subject: { name: 'Mathématiques' },
          semester: { name: 'Semestre 1' },
          enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
        }],
        decisionsConseil: [],
      });
    }
    return respond({ error: `Route de test non configurée : ${path}` }, 404);
  });
});

test('vie scolaire → appréciation puis décision du conseil validée', async ({ page }) => {
  await page.goto('/#/vie-scolaire');
  await expect(page.getByRole('heading', { name: 'Vie scolaire' })).toBeVisible();

  await page.getByRole('tab', { name: 'Appréciations' }).click();
  const appreciation = page.getByLabel('Texte (500 caractères maximum)');
  await expect(appreciation).toHaveValue('Bon travail.');
  await appreciation.fill('Élève sérieuse et rigoureuse.');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Appréciation enregistrée');
  await expect(page.getByRole('listitem').getByText('Élève sérieuse et rigoureuse.')).toBeVisible();

  await page.getByRole('tab', { name: 'Conseil de classe' }).click();
  await page.getByLabel('Décision (500 caractères maximum)').fill('Admis en 6e avec mention.');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByRole('status')).toContainText('Décision du conseil enregistrée en brouillon');
  await expect(page.getByText('Admis en 6e avec mention.')).toBeVisible();
  await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Décision validée et datée');
  await expect(page.getByText('Validée', { exact: true })).toBeVisible();
});

test('archives → consulter une année clôturée sans la modifier', async ({ page }) => {
  await page.goto('/#/vie-scolaire');
  await page.getByRole('tab', { name: 'Archives' }).click();

  const select = page.getByLabel('Année scolaire clôturée');
  await expect(select).toHaveValue('year-0');
  await page.getByRole('button', { name: 'Consulter l’archive' }).click();

  await expect(page.getByRole('heading', { name: '2024-2025' })).toBeVisible();
  await expect(page.getByText('Versions de bulletins')).toBeVisible();
  await page.getByText('Bulletins et versions').click();
  await expect(page.getByText('Ndiaye Awa — Semestre 1 · v1 · PUBLIE')).toBeVisible();
  await page.getByText('Présences, appréciations et décisions').click();
  await expect(page.getByText('Appréciation de Ndiaye Awa — Mathématiques, Semestre 1 : Élève sérieuse.')).toBeVisible();
});
