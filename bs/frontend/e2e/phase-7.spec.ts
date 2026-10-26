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
    city: null,
    address: null,
    phone: null,
    email: null,
    accreditationNumber: null,
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

const years = [{
  id: 'year-1',
  name: '2025-2026',
  status: 'ACTIVE',
  semesters: [
    { id: 'semester-1', number: 1, name: 'Semestre 1' },
    { id: 'semester-2', number: 2, name: 'Semestre 2' },
  ],
}];

test.beforeEach(async ({ page }) => {
  const records: {
    id: string;
    date: string;
    kind: 'ABSENCE' | 'RETARD';
    justified: boolean;
    durationMinutes: number | null;
    reason: string | null;
  }[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/session') return respond(session);
    if (path === '/api/dashboard') {
      return respond({
        scope: 'school',
        schoolName: 'École de test',
        academicYear: { id: 'year-1', name: '2025-2026' },
        indicators: {
          students: 1,
          enrollments: 1,
          classrooms: 1,
          subjects: 2,
          assessments: 4,
          bulletins: 1,
          publishedBulletins: 0,
        },
        semesters: [{
          id: 'semester-1',
          name: 'Semestre 1',
          numero: 1,
          bulletins: 1,
          bulletinsPublies: 0,
          absences: 0,
          retards: 0,
        }],
      });
    }
    if (path === '/api/schooling/classes') return respond({ classes });
    if (path === '/api/schooling/years') return respond({ years });
    if (path === '/api/schooling/classroom-subjects') {
      return respond({
        classroomSubjects: [{
          id: 'assignment-1',
          classroomId: 'class-1',
          subjectId: 'subject-1',
          coefficient: '1',
          subject: { id: 'subject-1', name: 'Mathématiques', code: 'MATH' },
          classroom: { id: 'class-1', name: '6e A' },
        }],
      });
    }
    if (path === '/api/assessment-types') {
      return respond({ types: [{ id: 'type-1', code: 'DEV', name: 'Devoir', category: 'DEVOIR', defaultOutOf: '20', actif: true }] });
    }
    if (path === '/api/assessments') {
      return respond({
        assessments: [{
          id: 'assessment-1',
          title: 'Devoir 1',
          position: 1,
          status: 'BOUILLON',
          outOf: '20',
          date: null,
          validatedAt: null,
          publishedAt: null,
          classroomId: 'class-1',
          classroomName: '6e A',
          subjectId: 'subject-1',
          subjectName: 'Mathématiques',
          semesterId: 'semester-1',
          semesterName: 'Semestre 1',
          typeId: 'type-1',
          typeName: 'Devoir',
          category: 'DEVOIR',
          notesSaisies: 0,
        }],
      });
    }
    if (path === '/api/grade-grid') {
      return respond({
        assessment: { id: 'assessment-1', title: 'Devoir 1', status: 'BOUILLON', outOf: '20', saisieAutorisee: true },
        lignes: [{
          enrollmentId: 'enrollment-1',
          studentId: 'student-1',
          matricule: 'MAT-1',
          nom: 'Ndiaye',
          prenoms: 'Awa',
          gradeId: null,
          score: null,
          status: 'NON_SAISIE',
          observation: null,
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
      if (request.method() === 'POST') {
        const record = {
          id: 'attendance-1',
          date: '2026-10-26T12:00:00.000Z',
          kind: 'ABSENCE' as const,
          justified: false,
          durationMinutes: null,
          reason: null,
        };
        records.push(record);
        return respond({ record }, 201);
      }
      return respond({ records, resume: {} });
    }
    if (path === '/api/school-life/appreciations') return respond({ appreciations: [] });
    if (path === '/api/school-life/council-decisions') return respond({ decisions: [] });
    return respond({ error: `Route de test non configurée : ${path}` }, 404);
  });
});

test('dashboard → enregistrer une absence depuis la vie scolaire', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bonjour Awa Ndiaye' })).toBeVisible();
  await expect(page.getByText('Bulletins générés')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Graphique des bulletins générés et publiés par semestre' })).toBeVisible();

  await page.getByRole('link', { name: 'Vie scolaire', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vie scolaire' })).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Événement de présence enregistré');
  await expect(page.getByText(/Absence ·/)).toBeVisible();
});

test('la grille de notes reste utilisable sur une largeur mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/saisie-notes');
  await expect(page.getByRole('heading', { name: 'Saisie des notes' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note de Ndiaye Awa', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Statut de la note de Ndiaye Awa', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Observation de Ndiaye Awa', exact: true })).toBeVisible();
});

test('une adresse inconnue affiche une vraie page 404', async ({ page }) => {
  await page.goto('/#/adresse-inconnue');
  await expect(page.getByRole('heading', { name: 'Cette page est introuvable' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Retour à l’accueil' })).toBeVisible();
});
