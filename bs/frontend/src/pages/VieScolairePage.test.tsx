import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VieScolairePage } from '@/pages/VieScolairePage';

let roleSimule = 'SCHOOL_ADMIN';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: roleSimule } }),
}));

const CLASSE = {
  id: 'cls-1',
  name: 'Terminale S1',
  academicYear: { id: 'an-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: 'Terminale' },
  _count: { enrollments: 1 },
};

const ANNEES = {
  years: [
    {
      id: 'an-1',
      name: '2025-2026',
      status: 'ACTIVE',
      semesters: [
        { id: 'sem-1', number: 1, name: 'Semestre 1' },
        { id: 'sem-2', number: 2, name: 'Semestre 2' },
      ],
    },
    {
      id: 'an-0',
      name: '2024-2025',
      status: 'CLOSED',
      semesters: [{ id: 'sem-0', number: 1, name: 'Semestre 1' }],
    },
  ],
};

const AFFECTATIONS = {
  classroomSubjects: [
    {
      id: 'cs-1',
      classroomId: 'cls-1',
      subjectId: 'sub-1',
      coefficient: '3',
      subject: { id: 'sub-1', name: 'Mathématiques', code: 'MATH' },
      classroom: { id: 'cls-1', name: 'Terminale S1' },
    },
  ],
};

const BULLETINS = {
  semestre: { id: 'sem-1', numero: 1, nom: 'Semestre 1', academicYearId: 'an-1', anneeScolaire: '2025-2026' },
  lignes: [
    {
      enrollmentId: 'enc-1',
      studentId: 'eleve-1',
      matricule: 'MAT1',
      nom: 'Ndiaye',
      prenoms: 'Awa',
      classe: 'Terminale S1',
      niveau: 'Terminale',
      bulletin: null,
    },
  ],
};

type Appel = { url: string; init: RequestInit; corps: unknown };

function reponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function installerBackend(annees = ANNEES) {
  const appels: Appel[] = [];
  const presences: Record<string, unknown>[] = [
    {
      id: 'att-1',
      date: '2025-11-10T12:00:00.000Z',
      kind: 'ABSENCE',
      justified: true,
      durationMinutes: null,
      reason: 'Maladie',
    },
  ];
  let appreciations: Record<string, unknown>[] = [
    {
      id: 'app-1',
      subjectId: 'sub-1',
      content: 'Bon travail.',
      subject: { id: 'sub-1', name: 'Mathématiques' },
    },
  ];
  let decisions: Record<string, unknown>[] = [
    {
      id: 'dec-1',
      enrollmentId: 'enc-1',
      academicYearId: 'an-1',
      content: 'Admis en Terminale.',
      status: 'BROUILLON',
      validatedAt: null,
      enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
    },
  ];

  const mock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const corps = init.body ? JSON.parse(String(init.body)) : null;
    appels.push({ url, init, corps });

    if (url.startsWith('/api/schooling/classes')) return reponse({ classes: [CLASSE] });
    if (url.startsWith('/api/schooling/years')) return reponse(annees);
    if (url.startsWith('/api/schooling/classroom-subjects')) return reponse(AFFECTATIONS);
    if (url.startsWith('/api/report-cards')) return reponse(BULLETINS);

    if (url.startsWith('/api/school-life/attendance')) {
      if (method === 'POST') {
        const record = {
          id: 'att-2',
          date: corps.date,
          kind: corps.kind,
          justified: corps.justified,
          durationMinutes: corps.durationMinutes ?? null,
          reason: corps.reason ?? null,
        };
        presences.unshift(record);
        return reponse({ record }, 201);
      }
      return reponse({ records: presences, resume: {} });
    }

    if (url.startsWith('/api/school-life/appreciations')) {
      if (method === 'PUT') {
        const record = {
          id: 'app-1',
          subjectId: corps.subjectId,
          content: corps.content,
          subject: { id: corps.subjectId, name: 'Mathématiques' },
        };
        appreciations = [record];
        return reponse({ appreciation: corps.content ? record : null });
      }
      return reponse({ appreciations });
    }

    if (url.startsWith('/api/school-life/history')) {
      return reponse({
        history: [
          {
            id: 'aud-1',
            action: 'APPRECIATION_UPDATED',
            createdAt: '2026-11-16T10:00:00.000Z',
            metadata: { after: { content: 'Excellent travail.' } },
            user: { name: 'Administrateur Vie Scolaire' },
          },
        ],
      });
    }

    if (url.startsWith('/api/school-life/archives')) {
      return reponse({
        annee: { id: 'an-0', name: '2024-2025' },
        bulletins: [
          {
            id: 'rc-1',
            version: 1,
            statut: 'PUBLIE',
            semester: { name: 'Semestre 1' },
            enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
          },
        ],
        bilansAnnuels: [],
        presences: [
          {
            id: 'att-arch-1',
            date: '2025-05-10T12:00:00.000Z',
            kind: 'ABSENCE',
            justified: false,
            durationMinutes: null,
            reason: null,
            enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
          },
        ],
        appreciations: [
          {
            id: 'app-arch-1',
            content: 'Élève sérieuse.',
            subject: { name: 'Mathématiques' },
            semester: { name: 'Semestre 1' },
            enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
          },
        ],
        decisionsConseil: [],
      });
    }

    if (url.startsWith('/api/school-life/council-decisions/') && url.endsWith('/validate')) {
      const id = url.split('/')[4];
      decisions = decisions.map((item) =>
        item.id === id ? { ...item, status: 'VALIDEE', validatedAt: '2026-11-16T11:00:00.000Z' } : item,
      );
      return reponse({ decision: decisions.find((item) => item.id === id), dejaValidee: false });
    }

    if (url.startsWith('/api/school-life/council-decisions')) {
      if (method === 'POST') {
        const record = {
          id: 'dec-2',
          enrollmentId: corps.enrollmentId,
          academicYearId: corps.academicYearId,
          content: corps.content,
          status: 'BROUILLON',
          validatedAt: null,
          enrollment: { student: { lastName: 'Ndiaye', firstNames: 'Awa' } },
        };
        decisions = [record];
        return reponse({ decision: record }, 201);
      }
      return reponse({ decisions });
    }

    throw new Error(`Requête inattendue : ${method} ${url}`);
  });

  vi.stubGlobal('fetch', mock);
  return { appels };
}

describe('VieScolairePage — phase 6', () => {
  beforeEach(() => {
    roleSimule = 'SCHOOL_ADMIN';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enregistre un retard avec sa durée et recharge les événements', async () => {
    const { appels } = installerBackend();
    render(<VieScolairePage />);

    expect(await screen.findByText('Absence · 10/11/2025')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'RETARD' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-12' } });
    fireEvent.change(screen.getByLabelText(/Durée/), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Transport' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Événement de présence enregistré.')).toBeInTheDocument();
    const envoi = appels.find(
      (appel) => appel.url === '/api/school-life/attendance' && appel.init.method === 'POST',
    );
    expect(envoi?.corps).toMatchObject({
      enrollmentId: 'enc-1',
      semesterId: 'sem-1',
      kind: 'RETARD',
      date: '2026-01-12T12:00:00.000Z',
      justified: false,
      durationMinutes: 15,
      reason: 'Transport',
    });
    expect(await screen.findByText('Retard — 15 min · 12/01/2026')).toBeInTheDocument();
  });

  it('enregistre une appréciation et affiche son historique de modification', async () => {
    const { appels } = installerBackend();
    render(<VieScolairePage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Appréciations' }));
    const zone = await screen.findByLabelText(/Texte \(500 caractères maximum\)/);
    expect(zone).toHaveValue('Bon travail.');
    fireEvent.change(zone, { target: { value: 'Excellent travail, poursuivez ainsi.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Appréciation enregistrée.')).toBeInTheDocument();
    const envoi = appels.find(
      (appel) => appel.url === '/api/school-life/appreciations' && appel.init.method === 'PUT',
    );
    expect(envoi?.corps).toMatchObject({
      enrollmentId: 'enc-1',
      semesterId: 'sem-1',
      subjectId: 'sub-1',
      content: 'Excellent travail, poursuivez ainsi.',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Historique' }));
    expect(await screen.findByText('Journal de modification')).toBeInTheDocument();
    expect(screen.getByText(/APPRECIATION_UPDATED/)).toBeInTheDocument();
  });

  it('crée un brouillon de décision puis le valide en administrateur', async () => {
    const { appels } = installerBackend();
    render(<VieScolairePage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Conseil de classe' }));
    fireEvent.change(await screen.findByLabelText(/Décision \(500 caractères maximum\)/), {
      target: { value: 'Admis avec mention.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));

    expect(await screen.findByText('Décision du conseil enregistrée en brouillon.')).toBeInTheDocument();
    const envoi = appels.find(
      (appel) => appel.url === '/api/school-life/council-decisions' && appel.init.method === 'POST',
    );
    expect(envoi?.corps).toMatchObject({
      enrollmentId: 'enc-1',
      academicYearId: 'an-1',
      content: 'Admis avec mention.',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));
    expect(await screen.findByText('Décision validée et datée.')).toBeInTheDocument();
    expect(screen.getByText('Validée')).toBeInTheDocument();
    expect(
      appels.some((appel) => appel.url === '/api/school-life/council-decisions/dec-2/validate'),
    ).toBe(true);
  });

  it('ne propose pas la validation au surveillant général', async () => {
    roleSimule = 'SURVEILLANT_GENERAL';
    installerBackend();
    render(<VieScolairePage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Conseil de classe' }));
    expect(await screen.findByRole('button', { name: 'Enregistrer le brouillon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('consulte l’archive d’une année clôturée', async () => {
    installerBackend();
    render(<VieScolairePage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Archives' }));
    const select = await screen.findByLabelText('Année scolaire clôturée');
    expect(select).toHaveValue('an-0');
    fireEvent.click(screen.getByRole('button', { name: 'Consulter l’archive' }));

    expect(await screen.findByText('2024-2025')).toBeInTheDocument();
    expect(screen.getByText('Versions de bulletins')).toBeInTheDocument();
    expect(screen.getByText('Appréciation de Ndiaye Awa — Mathématiques, Semestre 1 : Élève sérieuse.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Ndiaye Awa — Semestre 1 · v1 · PUBLIE')).toBeInTheDocument(),
    );
  });

  it('borne la date de présence aux dates du semestre sélectionné', async () => {
    // Semestre terminé depuis longtemps : la date du jour en est forcément
    // hors période, le formulaire doit la ramener à la borne la plus proche.
    const anneesPassees = {
      years: [
        {
          id: 'an-1',
          name: '2019-2020',
          status: 'ACTIVE',
          semesters: [
            { id: 'sem-1', number: 1, name: 'Semestre 1', startsAt: '2019-09-02T00:00:00.000Z', endsAt: '2020-06-30T00:00:00.000Z' },
            { id: 'sem-2', number: 2, name: 'Semestre 2', startsAt: '2020-07-01T00:00:00.000Z', endsAt: '2021-07-31T00:00:00.000Z' },
          ],
        },
      ],
    };
    installerBackend(anneesPassees);
    render(<VieScolairePage />);

    const champ = await screen.findByLabelText('Date');
    await waitFor(() => expect(champ).toHaveValue('2020-06-30'));
    expect(champ).toHaveAttribute('min', '2019-09-02');
    expect(champ).toHaveAttribute('max', '2020-06-30');
  });
});
