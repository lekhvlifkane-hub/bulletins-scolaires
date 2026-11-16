import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesEntryPage } from '@/pages/NotesEntryPage';

/**
 * Tests d'écran avec le backend simulé : la feuille consolidée n'envoie que les
 * cellules modifiées, affiche les moyennes/appréciations servies par le serveur et
 * laisse les colonnes verrouillées en lecture seule.
 */

const CLASSE = {
  id: 'cls-1',
  name: 'Terminale S1',
  academicYear: { id: 'an-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: 'Terminale' },
  _count: { enrollments: 2 },
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
  ],
};

const TYPES = {
  types: [
    { id: 'ty-1', code: 'DEV', name: 'Devoir', category: 'DEVOIR', defaultOutOf: '20', actif: true },
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

const EVALUATIONS = {
  assessments: [],
};

function feuille(options: { score0?: string | null; saisieAutorisee?: boolean; statut?: string } = {}) {
  const score0 = options.score0 ?? null;
  const saisieAutorisee = options.saisieAutorisee ?? true;
  const statut = options.statut ?? 'SAISIE_EN_COURS';
  return {
    classroomSubject: {
      id: 'cs-1',
      coefficient: '3',
      subject: { id: 'sub-1', name: 'Mathématiques', code: 'MATH' },
      classroom: { id: 'cls-1', name: 'Terminale S1' },
    },
    semester: { id: 'sem-1', number: 1, name: 'Semestre 1', academicYearId: 'an-1' },
    colonnes: [
      {
        id: 'ev-1',
        title: 'Devoir 1',
        position: 1,
        category: 'DEVOIR',
        typeName: 'Devoir',
        outOf: '20',
        status: statut,
        saisieAutorisee,
      },
    ],
    lignes: [
      {
        enrollmentId: 'enc-1',
        studentId: 'eleve-1',
        matricule: 'MAT1',
        nom: 'Alpha',
        prenoms: 'Ndiaye',
        notes: [
          {
            assessmentId: 'ev-1',
            gradeId: score0 === null ? null : 'grade-1',
            score: score0,
            status: score0 === null ? 'NON_SAISIE' : 'SAISIE',
            observation: null,
          },
        ],
        moyenne: score0 === null ? null : '12.50',
        moyenneExacte: score0 === null ? null : '12.5',
        appreciation: score0 === null ? null : 'Assez bien',
        incomplet: score0 === null,
        motifs: score0 === null ? ['Aucune moyenne : aucune note saisie'] : [],
      },
      {
        enrollmentId: 'enc-2',
        studentId: 'eleve-2',
        matricule: 'MAT2',
        nom: 'Beta',
        prenoms: 'Diallo',
        notes: [
          {
            assessmentId: 'ev-1',
            gradeId: null,
            score: null,
            status: 'NON_SAISIE',
            observation: null,
          },
        ],
        moyenne: null,
        moyenneExacte: null,
        appreciation: null,
        incomplet: true,
        motifs: [],
      },
    ],
  };
}

type Appel = { url: string; init: RequestInit };

function installerBackend(reponses: Partial<Record<string, unknown>>, statutPut = 200) {
  const appels: Appel[] = [];
  const putCorps: unknown[] = [];

  const mock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    appels.push({ url, init });
    if (method === 'PUT') putCorps.push(init.body ? JSON.parse(String(init.body)) : null);

    if (url.startsWith('/api/grades')) {
      if (statutPut !== 200) {
        return {
          ok: false,
          status: statutPut,
          headers: new Headers(),
          json: async () => reponses['/api/grades'],
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          reponses['/api/grades'] ?? { enregistrees: 1, indicateur: '1 note(s) enregistrée(s)' },
      };
    }

    if (method === 'POST' && url === '/api/assessments') {
      return {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({ assessment: { id: 'ev-2', title: 'Composition 1' } }),
      };
    }

    const cle =
      url.startsWith('/api/schooling/classes')
        ? '/api/schooling/classes'
        : url.startsWith('/api/schooling/years')
          ? '/api/schooling/years'
          : url.startsWith('/api/schooling/classroom-subjects')
            ? '/api/schooling/classroom-subjects'
            : url.startsWith('/api/assessment-types')
              ? '/api/assessment-types'
              : url.startsWith('/api/assessments')
                ? '/api/assessments'
                : url.startsWith('/api/grade-sheet')
                  ? '/api/grade-sheet'
                  : url;
    const corps = reponses[cle] ?? {};
    return { ok: true, status: 200, headers: new Headers(), json: async () => corps };
  });

  vi.stubGlobal('fetch', mock);
  return { appels, putCorps };
}

function backendParDefaut(put?: unknown, statutPut = 200) {
  return installerBackend(
    {
      '/api/schooling/classes': { classes: [CLASSE] },
      '/api/schooling/years': ANNEES,
      '/api/schooling/classroom-subjects': AFFECTATIONS,
      '/api/assessment-types': TYPES,
      '/api/assessments': EVALUATIONS,
      '/api/grade-sheet': feuille(),
      '/api/grades': put,
    },
    statutPut
  );
}

describe('NotesEntryPage — feuille consolidée', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('charge la feuille consolidée à partir des sélections', async () => {
    backendParDefaut();
    render(<NotesEntryPage />);

    expect(await screen.findByText('Devoir 1')).toBeInTheDocument();
    expect(screen.getByText('Élève')).toBeInTheDocument();
    expect(screen.getByText('Moy.')).toBeInTheDocument();
    expect(screen.getByText('Appréciation')).toBeInTheDocument();
    expect(screen.getByLabelText('Note de Alpha Ndiaye — Devoir 1')).toBeInTheDocument();
  });

  it('le bouton Enregistrer reste inactif tant que rien n’est modifié', async () => {
    backendParDefaut();
    render(<NotesEntryPage />);

    const bouton = await screen.findByRole('button', { name: 'Enregistrer' });
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Toutes les notes sont enregistrées')).toBeInTheDocument();
  });

  it('n’envoie que les cellules modifiées, puis affiche l’indicateur serveur', async () => {
    const { putCorps } = backendParDefaut({
      enregistrees: 1,
      indicateur: '1 note(s) enregistrée(s)',
    });
    render(<NotesEntryPage />);

    const note = await screen.findByLabelText('Note de Alpha Ndiaye — Devoir 1');
    fireEvent.change(note, { target: { value: '12,5' } });

    expect(await screen.findByText('1 note(s) non enregistrée(s)')).toBeInTheDocument();
    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    expect(bouton).toBeEnabled();
    fireEvent.click(bouton);

    await waitFor(() => expect(putCorps.length).toBe(1));
    expect(putCorps[0]).toEqual({
      assessmentId: 'ev-1',
      notes: [{ enrollmentId: 'enc-1', score: '12,5', status: 'SAISIE', observation: null }],
    });

    expect(await screen.findByText('1 note(s) enregistrée(s)')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Toutes les notes sont enregistrées')).toBeInTheDocument()
    );
  });

  it('montre les erreurs par cellule d’un refus 422 et rien n’est enregistré', async () => {
    const refus = {
      error: 'Saisie refusée',
      details: { erreurs: [{ enrollmentId: 'enc-1', message: 'Note hors barème (max 20)' }] },
    };
    const { putCorps } = backendParDefaut(refus, 422);
    render(<NotesEntryPage />);

    const note = await screen.findByLabelText('Note de Alpha Ndiaye — Devoir 1');
    fireEvent.change(note, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(putCorps.length).toBe(1));
    expect(await screen.findByText('Note hors barème (max 20)')).toBeInTheDocument();
    expect(screen.getByText(/Rien n'a été enregistré/)).toBeInTheDocument();
  });

  it('une réévaluation efface l’erreur affichée de la cellule', async () => {
    const refus = {
      error: 'Saisie refusée',
      details: { erreurs: [{ enrollmentId: 'enc-1', message: 'Note hors barème (max 20)' }] },
    };
    backendParDefaut(refus, 422);
    render(<NotesEntryPage />);

    const note = await screen.findByLabelText('Note de Alpha Ndiaye — Devoir 1');
    fireEvent.change(note, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Note hors barème (max 20)')).toBeInTheDocument();

    fireEvent.change(note, { target: { value: '15' } });
    await waitFor(() =>
      expect(screen.queryByText('Note hors barème (max 20)')).not.toBeInTheDocument()
    );
  });

  it('laisse les évaluations validées visibles mais verrouillées', async () => {
    installerBackend({
      '/api/schooling/classes': { classes: [CLASSE] },
      '/api/schooling/years': ANNEES,
      '/api/schooling/classroom-subjects': AFFECTATIONS,
      '/api/assessment-types': TYPES,
      '/api/assessments': EVALUATIONS,
      '/api/grade-sheet': feuille({ saisieAutorisee: false, statut: 'VALIDEE' }),
    });
    render(<NotesEntryPage />);

    expect(await screen.findByText(/Les évaluations non validées/)).toBeInTheDocument();
    expect(screen.getByText(/1 verrouillée\(s\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Note de Alpha Ndiaye — Devoir 1')).toBeDisabled();
  });

  it('crée une évaluation avec le type choisi, sans inventer de barème', async () => {
    const { appels } = installerBackend({
      '/api/schooling/classes': { classes: [CLASSE] },
      '/api/schooling/years': ANNEES,
      '/api/schooling/classroom-subjects': AFFECTATIONS,
      '/api/assessment-types': TYPES,
      '/api/assessments': EVALUATIONS,
      '/api/grade-sheet': feuille(),
    });
    render(<NotesEntryPage />);

    await screen.findByLabelText('Note de Alpha Ndiaye — Devoir 1');
    fireEvent.change(screen.getByPlaceholderText('Titre (ex. Devoir 1)'), {
      target: { value: 'Composition 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));

    await waitFor(() =>
      expect(appels.some((a) => a.url === '/api/assessments' && a.init.method === 'POST')).toBe(true)
    );
    const post = appels.find((a) => a.url === '/api/assessments' && a.init.method === 'POST');
    expect(JSON.parse(String(post!.init.body))).toEqual({
      classroomSubjectId: 'cs-1',
      semesterId: 'sem-1',
      typeId: 'ty-1',
      title: 'Composition 1',
    });
  });
});
