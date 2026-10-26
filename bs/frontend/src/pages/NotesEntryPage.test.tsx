import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesEntryPage } from '@/pages/NotesEntryPage';

/**
 * Tests d'écran avec le backend simulé : on vérifie que la page n'envoie que les
 * lignes modifiées, qu'elle n'affiche que ce que le serveur renvoie (indicateur,
 * erreurs par ligne) et qu'elle ne calcule rien elle-même.
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
  assessments: [
    {
      id: 'ev-1',
      title: 'Devoir 1',
      position: 1,
      status: 'SAISIE_EN_COURS',
      outOf: '20',
      date: null,
      validatedAt: null,
      publishedAt: null,
      classroomId: 'cls-1',
      classroomName: 'Terminale S1',
      subjectId: 'sub-1',
      subjectName: 'Mathématiques',
      semesterId: 'sem-1',
      semesterName: 'Semestre 1',
      typeId: 'ty-1',
      typeName: 'Devoir',
      category: 'DEVOIR',
      notesSaisies: 0,
    },
  ],
};

function grille(score0: string | null = null) {
  return {
    assessment: { id: 'ev-1', title: 'Devoir 1', status: 'SAISIE_EN_COURS', outOf: '20', saisieAutorisee: true },
    lignes: [
      {
        enrollmentId: 'enc-1',
        studentId: 'eleve-1',
        matricule: 'MAT1',
        nom: 'Alpha',
        prenoms: 'Ndiaye',
        gradeId: null,
        score: score0,
        status: score0 === null ? 'NON_SAISIE' : 'SAISIE',
        observation: null,
      },
      {
        enrollmentId: 'enc-2',
        studentId: 'eleve-2',
        matricule: 'MAT2',
        nom: 'Beta',
        prenoms: 'Diallo',
        gradeId: null,
        score: null,
        status: 'NON_SAISIE',
        observation: null,
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
        json: async () => reponses['/api/grades'] ?? { enregistrees: 1, indicateur: '1 note(s) enregistrée(s)' },
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
                : url.startsWith('/api/grade-grid')
                  ? '/api/grade-grid'
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
      '/api/grade-grid': grille(),
      '/api/grades': put,
    },
    statutPut
  );
}

describe('NotesEntryPage — saisie rapide', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('charge la grille à partir des sélections', async () => {
    backendParDefaut();
    render(<NotesEntryPage />);

    expect(await screen.findByText('Devoir 1')).toBeInTheDocument();
    expect(screen.getByText('Note / 20')).toBeInTheDocument();
    expect(screen.getByLabelText('Note de Alpha Ndiaye')).toBeInTheDocument();
  });

  it('le bouton Enregistrer reste inactif tant que rien n’est modifié', async () => {
    backendParDefaut();
    render(<NotesEntryPage />);

    const bouton = await screen.findByRole('button', { name: 'Enregistrer' });
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Toutes les lignes sont enregistrées')).toBeInTheDocument();
  });

  it('n’envoie que les lignes modifiées, puis affiche l’indicateur serveur', async () => {
    const { putCorps } = backendParDefaut({ enregistrees: 1, indicateur: '1 note(s) enregistrée(s)' });
    render(<NotesEntryPage />);

    const note = await screen.findByLabelText('Note de Alpha Ndiaye');
    fireEvent.change(note, { target: { value: '12,5' } });

    expect(await screen.findByText('1 ligne(s) non enregistrée(s)')).toBeInTheDocument();
    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    expect(bouton).toBeEnabled();
    fireEvent.click(bouton);

    await waitFor(() => expect(putCorps.length).toBe(1));
    expect(putCorps[0]).toEqual({
      assessmentId: 'ev-1',
      notes: [
        { enrollmentId: 'enc-1', score: '12,5', status: 'SAISIE', observation: null },
      ],
    });

    expect(await screen.findByText('1 note(s) enregistrée(s)')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Toutes les lignes sont enregistrées')).toBeInTheDocument()
    );
  });

  it('montre les erreurs par ligne d’un refus 422 et rien n’est enregistré', async () => {
    const refus = {
      error: 'Saisie refusée',
      details: { erreurs: [{ enrollmentId: 'enc-1', message: 'Note hors barème (max 20)' }] },
    };
    const { putCorps } = backendParDefaut(refus, 422);
    render(<NotesEntryPage />);

    const note = await screen.findByLabelText('Note de Alpha Ndiaye');
    fireEvent.change(note, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(putCorps.length).toBe(1));
    expect(await screen.findByText('Note hors barème (max 20)')).toBeInTheDocument();
    expect(
      screen.getByText(/Rien n'a été enregistré\./)
    ).toBeInTheDocument();
  });

  it('une réévaluation efface l’erreur affichée de la ligne', async () => {
    const refus = {
      error: 'Saisie refusée',
      details: { erreurs: [{ enrollmentId: 'enc-1', message: 'Note hors barème (max 20)' }] },
    };
    backendParDefaut(refus, 422);
    render(<NotesEntryPage />);

    const note = await screen.findByLabelText('Note de Alpha Ndiaye');
    fireEvent.change(note, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Note hors barème (max 20)')).toBeInTheDocument();

    fireEvent.change(note, { target: { value: '15' } });
    await waitFor(() =>
      expect(screen.queryByText('Note hors barème (max 20)')).not.toBeInTheDocument()
    );
  });

  it('signale une saisie fermée et bloque l’enregistrement', async () => {
    installerBackend({
      '/api/schooling/classes': { classes: [CLASSE] },
      '/api/schooling/years': ANNEES,
      '/api/schooling/classroom-subjects': AFFECTATIONS,
      '/api/assessment-types': TYPES,
      '/api/assessments': EVALUATIONS,
      '/api/grade-grid': {
        assessment: { id: 'ev-1', title: 'Devoir 1', status: 'VALIDEE', outOf: '20', saisieAutorisee: false },
        lignes: grille().lignes,
      },
    });
    render(<NotesEntryPage />);

    expect(await screen.findByText(/Saisie fermée/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    expect(screen.getByLabelText('Note de Alpha Ndiaye')).toBeDisabled();
  });

  it('crée une évaluation avec le type choisi, sans inventer de barème', async () => {
    const { appels } = installerBackend({
      '/api/schooling/classes': { classes: [CLASSE] },
      '/api/schooling/years': ANNEES,
      '/api/schooling/classroom-subjects': AFFECTATIONS,
      '/api/assessment-types': TYPES,
      '/api/assessments': EVALUATIONS,
      '/api/grade-grid': grille(),
    });
    render(<NotesEntryPage />);

    await screen.findByLabelText('Note de Alpha Ndiaye');
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
