import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const platformEmail = 'platform-admin@e2e.local';
const platformPassword = 'E2E-Only-Password-2026!';
const schoolAdminEmail = 'school-admin@e2e.local';
const assistantEmail = 'assistant@e2e.local';

type School = { id: string; name: string };
type Semester = { id: string; number: number };

async function login(page: Page, email: string, password: string) {
  const sessionResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/session') && response.ok(),
  );
  await page.goto(`/?e2e-session=${Date.now()}#/connexion`);
  await sessionResponse;
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
}

async function postJson(
  request: APIRequestContext,
  origin: string,
  path: string,
  body: unknown,
) {
  const sessionResponse = await request.get(`${origin}/api/auth/session`);
  expect(sessionResponse.ok(), 'la session doit être accessible').toBeTruthy();
  const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
  const response = await request.post(`${origin}${path}`, {
    data: body,
    headers: { 'X-CSRF-Token': csrfToken },
  });
  const responseBody = await response.json().catch(() => null);
  expect(
    response.ok(),
    `${path} doit réussir ; réponse : ${JSON.stringify(responseBody)}`,
  ).toBeTruthy();
  return responseBody as Record<string, unknown>;
}

async function createSchool(page: Page, name: string) {
  await page.goto('/#/etablissements');
  await page.getByPlaceholder("Nom de l'établissement").fill(name);
  await page.getByPlaceholder('Ville').fill('Dakar');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
}

async function grantPlatformAccess(page: Page, schoolName: string) {
  await page.goto('/#/acces-temporaire');
  await page.locator('form select').selectOption({ label: schoolName });
  await page.getByPlaceholder('Motif').fill('Configuration initiale E2E fictive');
  const expiration = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const localDateTime = [
    expiration.getFullYear(),
    '-',
    pad(expiration.getMonth() + 1),
    '-',
    pad(expiration.getDate()),
    'T',
    pad(expiration.getHours()),
    ':',
    pad(expiration.getMinutes()),
  ].join('');
  await page.locator('input[type="datetime-local"]').fill(localDateTime);
  await page.getByRole('button', { name: 'Accorder' }).click();
  await expect(page.getByText('Accès temporaire accordé')).toBeVisible();
}

async function createUser(
  page: Page,
  schoolName: string,
  name: string,
  email: string,
  role: 'SCHOOL_ADMIN' | 'ASSISTANT',
) {
  await page.goto('/#/utilisateurs');
  await page.getByLabel('Établissement').selectOption({ label: schoolName });
  await page.getByPlaceholder('Nom complet').fill(name);
  await page.getByPlaceholder('E-mail').fill(email);
  await page.locator('form select').selectOption(role);
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Utilisateur créé')).toBeVisible();
  const password = await page.locator('p.rounded-md strong').innerText();
  expect(password.length).toBeGreaterThanOrEqual(12);
  return password;
}

async function verifyPdf(request: APIRequestContext, origin: string, path: string) {
  const response = await request.get(`${origin}${path}`);
  expect(response.ok(), `${path} doit produire un PDF`).toBeTruthy();
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
}

test('parcours réel complet : établissement, notes, bulletins, bilan, PDF et isolation', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  const request = page.context().request;
  const origin = 'http://127.0.0.1:1421';

  await login(page, platformEmail, platformPassword);
  const firstSchoolName = 'Collège E2E FICTIF';
  const otherSchoolName = 'Lycée E2E isolé FICTIF';
  await createSchool(page, firstSchoolName);
  await createSchool(page, otherSchoolName);
  await grantPlatformAccess(page, firstSchoolName);
  const adminPassword = await createUser(
    page,
    firstSchoolName,
    'Administrateur E2E',
    schoolAdminEmail,
    'SCHOOL_ADMIN',
  );
  const assistantPassword = await createUser(
    page,
    firstSchoolName,
    'Assistant E2E',
    assistantEmail,
    'ASSISTANT',
  );
  const schoolsResponse = await request.get(`${origin}/api/schools`);
  const { schools } = await schoolsResponse.json() as { schools: School[] };
  const school = schools.find((item) => item.name === firstSchoolName);
  const otherSchool = schools.find((item) => item.name === otherSchoolName);
  if (!school || !otherSchool) {
    throw new Error('Les deux établissements E2E doivent être présents dans la base.');
  }

  await logout(page);
  await login(page, schoolAdminEmail, adminPassword);

  const yearResponse = await postJson(request, origin, '/api/schooling/years', {
    name: '2026-2027',
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2027-07-01T00:00:00.000Z',
    status: 'ACTIVE',
  });
  const createdYear = yearResponse.year as { id: string };
  const yearsResponse = await request.get(`${origin}/api/schooling/years`);
  const { years } = await yearsResponse.json() as {
    years: { id: string; semesters: Semester[] }[];
  };
  const year = years.find((item) => item.id === createdYear.id);
  if (!year) throw new Error('L’année créée doit être relisible avec ses semestres.');
  const semesters = year.semesters.sort((left, right) => left.number - right.number);
  expect(semesters).toHaveLength(2);

  const levelResponse = await postJson(request, origin, '/api/schooling/levels', {
    name: '6e',
    sortOrder: 1,
  });
  const levelId = (levelResponse.level as { id: string }).id;
  const classResponse = await postJson(request, origin, '/api/schooling/classes', {
    name: '6e A E2E',
    academicYearId: year.id,
    levelId,
  });
  const classroomId = (classResponse.classroom as { id: string }).id;
  const subjectResponse = await postJson(request, origin, '/api/schooling/subjects', {
    name: 'Mathématiques',
    code: 'MATH-E2E',
  });
  const subjectId = (subjectResponse.subject as { id: string }).id;
  const assignmentResponse = await postJson(request, origin, '/api/schooling/classroom-subjects', {
    classroomId,
    subjectId,
    coefficient: 1,
  });
  const assignmentId = (assignmentResponse.classroomSubject as { id: string }).id;
  const typeResponse = await postJson(request, origin, '/api/assessment-types', {
    code: 'DEV-E2E',
    name: 'Devoir E2E',
    category: 'DEVOIR',
    defaultOutOf: '20',
  });
  const assessmentTypeId = (typeResponse.type as { id: string }).id;

  await page.getByRole('link', { name: 'Élèves', exact: true }).click();
  await page.getByPlaceholder('Matricule').fill('E2E-001');
  await page.getByPlaceholder('Nom', { exact: true }).fill('Ndiaye');
  await page.getByPlaceholder('Prénoms').fill('Awa');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'E2E-001' })).toBeVisible();
  const studentsResponse = await request.get(`${origin}/api/students?search=E2E-001`);
  const { students } = await studentsResponse.json() as { students: { id: string }[] };
  expect(students).toHaveLength(1);
  const studentId = students[0].id;
  const enrollmentResponse = await postJson(request, origin, `/api/students/${studentId}/enrollments`, {
    classroomId,
  });
  expect(enrollmentResponse.message).toContain('Inscription créée');

  for (const semester of semesters) {
    const title = `Devoir E2E S${semester.number}`;
    await page.getByRole('link', { name: 'Saisie des notes', exact: true }).click();
    await page.getByLabel('Semestre').selectOption(semester.id);
    await page.getByLabel('Discipline').selectOption(assignmentId);
    await page.getByLabel('Type').selectOption(assessmentTypeId);
    await page.getByPlaceholder('Titre (ex. Devoir 1)').fill(title);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note de Ndiaye Awa' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Note de Ndiaye Awa' }).fill(semester.number === 1 ? '15' : '17');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText(/note.*enregistrée|enregistrée.*note/i)).toBeVisible();

    await page.getByRole('link', { name: 'Vérifications', exact: true }).click();
    await page.getByLabel('Semestre').selectOption(semester.id);
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Envoyer à vérifier' }).click();
    await row.getByRole('button', { name: 'Valider' }).click();
    await row.getByRole('button', { name: 'Publier' }).click();
    await expect(row.getByText('Publiée')).toBeVisible();
  }

  await page.getByRole('link', { name: 'Calcul et classement', exact: true }).click();
  await expect(page.getByText('Moyenne générale')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'E2E-001' })).toBeVisible();

  for (const semester of semesters) {
    await page.getByRole('link', { name: 'Bulletins', exact: true }).click();
    await page.getByLabel('Semestre').selectOption(semester.id);
    await page.getByRole('button', { name: 'Générer toute la classe' }).click();
    await expect(page.getByText(/1 bulletin\(s\) créé\(s\)/)).toBeVisible();
    await page.getByRole('checkbox', { name: 'Sélectionner Ndiaye' }).check();
    await page.getByRole('button', { name: 'Publier la sélection (1)' }).click();
    await expect(page.getByText(/1 bulletin\(s\) publié\(s\)/)).toBeVisible();
    await expect(page.getByText('Publié (figé)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Imprimer la classe' }).click();
    await expect(page.getByText(/PDF téléchargé/)).toBeVisible();
    const cards = await request.get(`${origin}/api/report-cards?classroomId=${classroomId}&semesterId=${semester.id}`);
    const cardData = await cards.json() as { lignes: { bulletin: { id: string } | null }[] };
    const bulletinId = cardData.lignes[0]?.bulletin?.id;
    if (!bulletinId) throw new Error(`Le bulletin S${semester.number} doit persister.`);
    await verifyPdf(request, origin, `/api/report-cards/${bulletinId}/pdf`);
  }

  await page.getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Bilan annuel', exact: true })
    .click();
  const calculatedAnnual = await request.get(
    `${origin}/api/calculations/annual?classroomId=${classroomId}&academicYearId=${year.id}`,
  );
  expect(calculatedAnnual.ok()).toBeTruthy();
  const calculatedAnnualData = await calculatedAnnual.json() as {
    eleves: { matricule: string; calculable: boolean }[];
  };
  expect(calculatedAnnualData.eleves.find((item) => item.matricule === 'E2E-001')?.calculable)
    .toBeTruthy();
  await page.getByRole('button', { name: 'Calculer les bilans de la classe' }).click();
  await expect(page.getByText(/1 bilan\(s\) calculé/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Sélectionner Ndiaye' }).check();
  await page.getByRole('button', { name: 'Publier la sélection (1)' }).click();
  await expect(page.getByText(/1 bilan\(s\) figé/)).toBeVisible();
  await page.getByRole('button', { name: 'Imprimer la classe' }).click();
  await expect(page.getByText(/PDF téléchargé/)).toBeVisible();
  const annualSummaries = await request.get(
    `${origin}/api/annual-summaries?classroomId=${classroomId}&academicYearId=${year.id}`,
  );
  const annualData = await annualSummaries.json() as { lignes: { bilan: { id: string } | null }[] };
  const annualSummaryId = annualData.lignes[0]?.bilan?.id;
  if (!annualSummaryId) throw new Error('Le bilan annuel doit persister.');
  await verifyPdf(request, origin, `/api/annual-summaries/${annualSummaryId}/pdf`);
  const assessmentsResponse = await request.get(
    `${origin}/api/assessments?classroomSubjectId=${assignmentId}`,
  );
  const assessments = await assessmentsResponse.json() as { assessments: { id: string }[] };
  expect(assessments.assessments).toHaveLength(2);
  const assessmentId = assessments.assessments[0]?.id;
  if (!assessmentId) throw new Error('Au moins une évaluation publiée doit être disponible.');

  await logout(page);
  await login(page, assistantEmail, assistantPassword);
  const isolatedSchool = await request.get(`${origin}/api/schools/${otherSchool.id}`);
  expect(isolatedSchool.status()).toBe(403);
  const assistantSession = await request.get(`${origin}/api/auth/session`);
  expect(assistantSession.ok()).toBeTruthy();
  const { csrfToken } = await assistantSession.json() as { csrfToken: string };
  const forbiddenValidation = await request.post(
    `${origin}/api/assessments/${assessmentId}/statut`,
    {
      data: { status: 'VALIDEE' },
      headers: { 'X-CSRF-Token': csrfToken },
    },
  );
  expect(forbiddenValidation.status()).toBe(403);

  await logout(page);
  await login(page, schoolAdminEmail, adminPassword);
  const persistedStudent = await request.get(`${origin}/api/students?search=E2E-001`);
  expect(persistedStudent.ok()).toBeTruthy();
  const persistedData = await persistedStudent.json() as {
    students: { matricule: string; enrollments: { classroom: { name: string } }[] }[];
  };
  expect(persistedData.students[0]?.matricule).toBe('E2E-001');
  expect(persistedData.students[0]?.enrollments[0]?.classroom.name).toBe('6e A E2E');
});
