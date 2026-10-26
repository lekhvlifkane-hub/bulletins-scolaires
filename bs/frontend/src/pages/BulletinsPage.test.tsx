import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BulletinsPage } from '@/pages/BulletinsPage';
import { api } from '@/lib/api';

/**
 * La page Bulletins est une vitrine du snapshot servi : elle doit afficher les chaînes du
 * serveur à l'identique (moyenne, rang, motifs), signaler « Non calculable » sans jamais
 * inventer de zéro, et déléguer toute écriture et toute impression au serveur.
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

function bulletin(partial: Partial<BulletinLike> & { id: string }) {
  const base: BulletinLike = {
    id: '',
    enrollmentId: '',
    semesterId: 'sem-1',
    academicYearId: 'an-1',
    version: 1,
    statut: 'BOUILLON',
    estCourant: true,
    motifCorrection: null,
    remplaceReportCardId: null,
    moyenneGenerale: '15.2',
    moyenneGeneraleAffichee: '15.20',
    moyenneGeneraleExacte: '15.2',
    moyenneClasse: '14.8',
    moyenneClasseAffichee: '14.80',
    effectif: 12,
    rang: 1,
    motifNonClasse: null,
    totalPoints: '45.6',
    totalCoeficients: '3',
    incomplet: false,
    motifs: [],
    mention: null,
    decisionConseil: null,
    appreciation: null,
    genereLe: '2026-01-10T08:00:00.000Z',
    valideLe: null,
    publieLe: null,
  };
  return { ...base, ...partial };
}

type BulletinLike = {
  id: string;
  enrollmentId: string;
  semesterId: string;
  academicYearId: string;
  version: number;
  statut: string;
  estCourant: boolean;
  motifCorrection: string | null;
  remplaceReportCardId: string | null;
  moyenneGenerale: string | null;
  moyenneGeneraleAffichee?: string | null;
  moyenneGeneraleExacte: string | null;
  moyenneClasse: string | null;
  moyenneClasseAffichee?: string | null;
  effectif: number;
  rang: number | null;
  motifNonClasse: string | null;
  totalPoints: string;
  totalCoeficients: string;
  incomplet: boolean;
  motifs: string[];
  mention: string | null;
  decisionConseil: string | null;
  appreciation: string | null;
  genereLe: string | null;
  valideLe: string | null;
  publieLe: string | null;
};

const LISTE = {
  semestre: {
    id: 'sem-1',
    numero: 1,
    nom: 'Semestre 1',
    academicYearId: 'an-1',
    anneeScolaire: '2025-2026',
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
      bulletin: bulletin({ id: 'rc-1', enrollmentId: 'enc-1' }),
    },
    {
      enrollmentId: 'enc-2',
      studentId: 'eleve-2',
      matricule: 'MAT2',
      nom: 'Beta',
      prenoms: 'Diallo',
      classe: 'TS 1',
      niveau: 'Terminale',
      bulletin: bulletin({
        id: 'rc-2',
        enrollmentId: 'enc-2',
        statut: 'PUBLIE',
        publieLe: '2026-01-12T08:00:00.000Z',
        moyenneGenerale: null,
        moyenneGeneraleAffichee: null,
        moyenneGeneraleExacte: null,
        rang: null,
        motifNonClasse: 'Aucune moyenne comptabilisée',
        incomplet: true,
        motifs: ['Composition de Mathématiques absente'],
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
      bulletin: null,
    },
  ],
};

type Appel = { url: string; method: string; body?: string; csrf: string | null };

function installer(reponses: Record<string, unknown>, options: { pages?: string } = {}) {
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

    if (url.includes('/api/report-cards/pdf')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="bulletins-classe-2-eleves.pdf"',
          'X-Contenu-Pages': options.pages ?? '2',
        }),
        blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        json: async () => ({}),
      };
    }

    const cle = url.startsWith('/api/schooling/classes')
      ? 'classes'
      : url.startsWith('/api/schooling/years')
        ? 'years'
        : url.startsWith('/api/report-cards/generate-class')
          ? 'generate-class'
          : url.startsWith('/api/report-cards/publish')
            ? 'publish'
            : url.startsWith('/api/report-cards/generate')
              ? 'generate'
              : url.startsWith('/api/report-cards?')
                ? 'liste'
                : url;
    const corps = reponses[cle] ?? {};
    const refuse = (corps as { __status?: number }).__status;
    if (refuse) {
      return {
        ok: false,
        status: refuse,
        headers: new Headers(),
        json: async () => corps,
        blob: async () => new Blob([]),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => corps,
      blob: async () => new Blob([]),
    };
  });
  vi.stubGlobal('fetch', mock);
  return { appels, mock };
}

function ouvrir(reponses: Record<string, unknown> = {}) {
  const { appels } = installer({
    classes: { classes: [CLASSE] },
    years: ANNEES,
    liste: LISTE,
    ...reponses,
  });
  render(
    <MemoryRouter initialEntries={['/bulletins']}>
      <BulletinsPage />
    </MemoryRouter>
  );
  return { appels };
}

describe('BulletinsPage — liste S1 / S2', () => {
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

  it('affiche l’arrondi servi par le serveur et « Non calculable » pour une moyenne absente', async () => {
    ouvrir();
    expect(await screen.findByText('MAT1')).toBeInTheDocument();

    // Moyenne et rang exactement tels que renvoyés : la colonne affiche l'arrondi figé dans
    // le snapshot (15.20), la valeur exacte (15.2) ne reste qu'en infobulle.
    expect(screen.getAllByText('15.20').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Valeur exacte : 15.2').length).toBeGreaterThan(0);
    expect(screen.queryByText('15.2')).not.toBeInTheDocument();
    expect(screen.getByText('Non calculable')).toBeInTheDocument();
    expect(screen.getByText('Aucune moyenne comptabilisée')).toBeInTheDocument();
    expect(screen.getByText('Composition de Mathématiques absente')).toBeInTheDocument();
    // Aucun bulletin généré = ligne vide, pas un zéro.
    expect(screen.getByText('Aucun bulletin')).toBeInTheDocument();
    expect(screen.queryByText('0,00')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('demande la publication au serveur avec le jeton CSRF et les identifiants du bulletin', async () => {
    const { appels } = ouvrir({ publish: { publies: 1, dejaPublies: 0 } });
    await screen.findByText('MAT1');

    fireEvent.click(screen.getByLabelText('Sélectionner Alpha'));
    fireEvent.click(screen.getByRole('button', { name: /Publier la sélection/ }));

    await waitFor(() => {
      const appel = appels.find((a) => a.url === '/api/report-cards/publish');
      return appel !== undefined;
    });
    const appel = appels.find((a) => a.url === '/api/report-cards/publish')!;
    expect(appel.method).toBe('POST');
    expect(appel.csrf).toBe('jeton-test');
    expect(JSON.parse(appel.body!)).toEqual({ ids: ['rc-1'] });
    expect(await screen.findByText(/1 bulletin\(s\) publié\(s\) et figé\(s\)\./)).toBeInTheDocument();
  });

  it('bloque la régénération d’un bulletin publié et propose la correction', async () => {
    ouvrir();
    await screen.findByText('MAT2');
    const regenere = screen.getAllByRole('button', { name: /Régénérer/ });
    expect(regenere[1]).toBeDisabled();
    expect(regenere[1].getAttribute('title')).toMatch(/correction versionnée/);
  });

  it('imprime la classe auprès du serveur et annonce les pages du PDF', async () => {
    const { appels } = ouvrir();
    await screen.findByText('MAT1');

    fireEvent.click(screen.getByRole('button', { name: 'Imprimer la classe' }));

    await waitFor(() =>
      expect(
        appels.some((a) => a.url.includes('/api/report-cards/pdf?classroomId=cls-1&semesterId=sem-1'))
      ).toBe(true)
    );
    expect(await screen.findByText(/bulletins-classe-2-eleves\.pdf \(2 page\(s\)\)/)).toBeInTheDocument();
  });

  it('reste en lecture seule pour un assistant', async () => {
    roleSimule = 'ASSISTANT';
    ouvrir();
    await screen.findByText('MAT1');
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Générer toute la classe/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Générer$/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Ouvrir').length).toBe(2);
  });

  it('rapporte le refus du serveur quand le lot est trop grand', async () => {
    const { appels } = ouvrir({
      'generate-class': { __status: 422, error: 'Lot trop grand : 60 bulletins maximum par impression' },
    });
    await screen.findByText('MAT1');

    fireEvent.click(screen.getByRole('button', { name: 'Générer toute la classe' }));

    expect(await screen.findByText(/Lot trop grand/)).toBeInTheDocument();
    expect(appels.some((a) => a.url === '/api/report-cards/generate-class')).toBe(true);
  });
});
