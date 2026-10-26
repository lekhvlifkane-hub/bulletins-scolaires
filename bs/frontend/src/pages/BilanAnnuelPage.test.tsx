import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BilanAnnuelPage } from '@/pages/BilanAnnuelPage';
import { api } from '@/lib/api';

/**
 * Le bilan annuel est calculé par le serveur à partir des bulletins des deux semestres.
 * La page doit garder les chaînes servies, écrire « non calculable » quand un semestre
 * manque, et ne jamais publier un bilan sans le demander au serveur.
 */

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: roleSimule } }),
}));

let roleSimule = 'SCHOOL_ADMIN';

const CLASSE = {
  id: 'cls-1',
  name: 'TS 1',
  academicYear: { id: 'an-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: 'Terminale' },
  _count: { enrollments: 3 },
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

function bilan(partial: Record<string, unknown>) {
  return {
    id: '',
    enrollmentId: '',
    academicYearId: 'an-1',
    version: 1,
    statut: 'BOUILLON',
    estCourant: true,
    s1ReportCardId: 'rc-1',
    s2ReportCardId: 'rc-2',
    moyenneS1: '15.2',
    moyenneS2: '18.2',
    moyenneAnnuelle: '16.7',
    moyenneAnnuelleExacte: '16.7',
    calculable: true,
    partiel: false,
    rangAnnuel: 1,
    effectif: 12,
    motifs: [],
    mention: null,
    decisionConseil: null,
    appreciation: null,
    genereLe: '2026-06-02T08:00:00.000Z',
    publieLe: null,
    ...partial,
  };
}

const LISTE = {
  anneeScolaire: {
    id: 'an-1',
    nom: '2025-2026',
    semestres: [
      { id: 'sem-1', numero: 1, nom: 'Semestre 1' },
      { id: 'sem-2', numero: 2, nom: 'Semestre 2' },
    ],
  },
  lignes: [
    {
      enrollmentId: 'enc-1',
      studentId: 'eleve-1',
      matricule: 'MAT1',
      nom: 'Alpha',
      prenoms: 'Ndiaye',
      classe: 'TS 1',
      niveau: 'Terminale',
      bilan: bilan({ id: 'as-1', enrollmentId: 'enc-1' }),
    },
    {
      enrollmentId: 'enc-2',
      studentId: 'eleve-2',
      matricule: 'MAT2',
      nom: 'Beta',
      prenoms: 'Diallo',
      classe: 'TS 1',
      niveau: 'Terminale',
      bilan: bilan({
        id: 'as-2',
        enrollmentId: 'enc-2',
        statut: 'PUBLIE',
        publieLe: '2026-06-03T08:00:00.000Z',
        moyenneAnnuelle: '14.1',
        moyenneAnnuelleExacte: '14.1',
        rangAnnuel: 4,
      }),
    },
    {
      enrollmentId: 'enc-3',
      studentId: 'eleve-3',
      matricule: 'MAT3',
      nom: 'Gamma',
      prenoms: 'Sow',
      classe: 'TS 1',
      niveau: 'Terminale',
      bilan: bilan({
        id: 'as-3',
        enrollmentId: 'enc-3',
        s2ReportCardId: null,
        moyenneS2: null,
        moyenneAnnuelle: null,
        moyenneAnnuelleExacte: null,
        calculable: false,
        partiel: true,
        rangAnnuel: null,
        motifs: ['Semestre 2 sans bulletin : bilan non calculable'],
      }),
    },
    {
      enrollmentId: 'enc-4',
      studentId: 'eleve-4',
      matricule: 'MAT4',
      nom: 'Delta',
      prenoms: 'Ba',
      classe: 'TS 1',
      niveau: 'Terminale',
      bilan: null,
    },
  ],
};

type Appel = { url: string; method: string; body?: string; csrf: string | null };

function installer(reponses: Record<string, unknown>) {
  const appels: Appel[] = [];
  const mock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? {});
    appels.push({
      url,
      method,
      body: typeof init?.body === 'string' ? init.body : undefined,
      csrf: headers.get('X-CSRF-Token'),
    });

    if (url.includes('/api/annual-summaries/pdf')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="bilans-annuels-2-eleves.pdf"',
          'X-Contenu-Pages': '2',
        }),
        blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        json: async () => ({}),
      };
    }

    const cle = url.startsWith('/api/schooling/classes')
      ? 'classes'
      : url.startsWith('/api/schooling/years')
        ? 'years'
        : url.startsWith('/api/annual-summaries/generate')
          ? 'generate'
          : url.startsWith('/api/annual-summaries/publish')
            ? 'publish'
            : url.startsWith('/api/annual-summaries?')
              ? 'liste'
              : url;
    const corps = reponses[cle] ?? {};
    const status = (corps as { __status?: number }).__status;
    if (status) {
      return {
        ok: false,
        status,
        headers: new Headers(),
        json: async () => corps,
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => corps,
    };
  });
  vi.stubGlobal('fetch', mock);
  return { appels };
}

function ouvrir(reponses: Record<string, unknown> = {}) {
  const { appels } = installer({
    classes: { classes: [CLASSE] },
    years: ANNEES,
    liste: LISTE,
    generate: { bilan: LISTE.lignes[0].bilan, cree: false },
    ...reponses,
  });
  render(
    <MemoryRouter initialEntries={['/bilan-annuel']}>
      <BilanAnnuelPage />
    </MemoryRouter>
  );
  return { appels };
}

describe('BilanAnnuelPage — moyenne annuelle', () => {
  beforeEach(() => {
    roleSimule = 'SCHOOL_ADMIN';
    api.setCsrfToken('jeton-test');
    vi.stubGlobal('fetch', vi.fn());
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    api.setCsrfToken(null);
  });

  it('affiche la moyenne annuelle servie et « non calculable » avec son motif', async () => {
    ouvrir();
    expect(await screen.findByText('MAT1')).toBeInTheDocument();

    expect(screen.getByText('16.7')).toBeInTheDocument();
    expect(screen.getByText('Semestre 2 sans bulletin : bilan non calculable')).toBeInTheDocument();
    expect(screen.getByText('non calculable')).toBeInTheDocument();
    // Le semestre manquant reste vide, jamais remplacé par une note.
    expect(screen.getByText('bilan partiel')).toBeInTheDocument();
    expect(screen.getByText('Aucun bilan')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('ne régénère pas un bilan publié et calcule les autres élève par élève', async () => {
    const { appels } = ouvrir();
    await screen.findByText('MAT1');

    const recalculs = screen.getAllByRole('button', { name: /^(Recalculer|Calculer)$/ });
    expect(recalculs[1]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Calculer les bilans de la classe' }));

    await waitFor(() =>
      expect(
        appels.filter((a) => a.url === '/api/annual-summaries/generate').length
      ).toBeGreaterThanOrEqual(3)
    );
    const envoyes = appels
      .filter((a) => a.url === '/api/annual-summaries/generate')
      .map((a) => JSON.parse(a.body!) as { enrollmentId: string });
    expect(envoyes.map((e) => e.enrollmentId)).toEqual(['enc-1', 'enc-3', 'enc-4']);
    expect(screen.getByText(/1 non traité\(s\)/)).toBeInTheDocument();
  });

  it('publie la sélection auprès du serveur avec le jeton CSRF', async () => {
    const { appels } = ouvrir({ publish: { publies: 1, dejaPublies: 0 } });
    await screen.findByText('MAT1');

    fireEvent.click(screen.getByLabelText('Sélectionner Alpha'));
    fireEvent.click(screen.getByRole('button', { name: /Publier la sélection/ }));

    await waitFor(() =>
      expect(appels.some((a) => a.url === '/api/annual-summaries/publish')).toBe(true)
    );
    const appel = appels.find((a) => a.url === '/api/annual-summaries/publish')!;
    expect(appel.csrf).toBe('jeton-test');
    expect(JSON.parse(appel.body!)).toEqual({ ids: ['as-1'] });
    expect(await screen.findByText(/1 bilan\(s\) figé\(s\)\./)).toBeInTheDocument();
  });

  it('délègue l’impression du lot au serveur', async () => {
    const { appels } = ouvrir();
    await screen.findByText('MAT1');

    fireEvent.click(screen.getByRole('button', { name: 'Imprimer la classe' }));

    await waitFor(() =>
      expect(
        appels.some(
          (a) =>
            a.url.startsWith('/api/annual-summaries/pdf?') &&
            a.url.includes('classroomId=cls-1') &&
            a.url.includes('academicYearId=an-1')
        )
      ).toBe(true)
    );
    expect(await screen.findByText(/bilans-annuels-2-eleves\.pdf \(2 page\(s\)\)/)).toBeInTheDocument();
  });

  it('reste en lecture seule pour un assistant', async () => {
    roleSimule = 'ASSISTANT';
    ouvrir();
    await screen.findByText('MAT1');
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Calculer les bilans de la classe' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sélectionner Alpha')).not.toBeInTheDocument();
  });
});
