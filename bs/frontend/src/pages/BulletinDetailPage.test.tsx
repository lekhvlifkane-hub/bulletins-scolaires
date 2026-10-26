import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BulletinDetailPage } from '@/pages/BulletinDetailPage';
import { api } from '@/lib/api';

/**
 * Le détail d'un bulletin est la relecture du snapshot figé. La page doit montrer les
 * valeurs servies telles quelles, distinguer bulletin modifiable et bulletin publié,
 * et ne proposer la correction que motivée qu'à partir d'un bulletin publié.
 */

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: roleSimule } }),
}));

let roleSimule = 'SCHOOL_ADMIN';

function matiere(partial: Record<string, unknown> = {}) {
  return {
    subjectId: 'sub-math',
    subjectName: 'Mathématiques',
    subjectCode: 'MATH',
    coefficient: '3',
    coefficientValide: true,
    comptabilisee: true,
    moyenne: '15.2',
    moyenneExacte: '15.2',
    moyenneAffichee: '15.20',
    pointsPonderes: '45.6',
    rang: 1,
    incomplet: false,
    motifs: [],
    groupes: [
      {
        category: 'DEVOIR',
        poids: '1',
        moyenne: '15.2',
        moyenneAffichee: '15.20',
        notesValides: 2,
        notesAttendues: 3,
        notes: [
          {
            assessmentId: 'a-1',
            title: 'Devoir 1',
            typeName: 'Devoir',
            category: 'DEVOIR',
            statutEvaluation: 'VALIDEE',
            outOf: '20',
            score: '14',
            status: 'SAISIE',
          },
          {
            assessmentId: 'a-2',
            title: 'Devoir 2',
            typeName: 'Devoir',
            category: 'DEVOIR',
            statutEvaluation: 'VALIDEE',
            outOf: '20',
            score: '16',
            status: 'SAISIE',
          },
          {
            assessmentId: 'a-3',
            title: 'Devoir 3',
            typeName: 'Devoir',
            category: 'DEVOIR',
            statutEvaluation: 'VALIDEE',
            outOf: '20',
            score: null,
            status: 'ABSENT',
          },
        ],
      },
    ],
    appreciation: null,
    ...partial,
  };
}

function detail(statut: 'BOUILLON' | 'PUBLIE') {
  return {
    bulletin: {
      id: 'rc-1',
      enrollmentId: 'enc-1',
      semesterId: 'sem-1',
      academicYearId: 'an-1',
      version: 1,
      statut,
      estCourant: true,
      motifCorrection: null,
      remplaceReportCardId: null,
      moyenneGenerale: '15.2',
      moyenneGeneraleExacte: '15.2',
      moyenneClasse: '14.8',
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
      publieLe: statut === 'PUBLIE' ? '2026-01-12T08:00:00.000Z' : null,
    },
    snapshot: {
      versionSchema: 1,
      genereLe: '2026-01-10T08:00:00.000Z',
      dateCalcul: '2026-01-10T08:00:00.000Z',
      enTete: {
        nomEtablissement: 'Lycée de Touba Toul',
        ville: 'Touba Toul',
        intituleDocument: 'BULLETIN DE NOTES',
        anneeScolaire: { id: 'an-1', nom: '2025-2026', statut: 'ACTIVE' },
        semestre: { id: 'sem-1', numero: 1, nom: 'Semestre 1' },
      },
      eleve: {
        enrollmentId: 'enc-1',
        classroomId: 'cls-1',
        matricule: 'MAT1',
        nom: 'Alpha',
        prenoms: 'Ndiaye',
        classe: 'TS 1',
        niveau: 'Terminale',
      },
      regles: {
        formuleMatiere: 'MOYENNE_PONDEREE_PAR_GROUPES',
        arrondiDecimales: 2,
        baremeParDefaut: '20',
        poidsSemestres: { s1: '1', s2: '1' },
      },
      matieres: [
        matiere(),
        matiere({
          subjectId: 'sub-hige',
          subjectName: 'Histoire-Géographie',
          subjectCode: 'HIGE',
          coefficient: '2',
          moyenne: null,
          moyenneExacte: null,
          moyenneAffichee: null,
          pointsPonderes: null,
          rang: null,
          incomplet: true,
          motifs: ['Aucune moyenne : aucune note saisie'],
          groupes: [],
        }),
      ],
      synthese: {
        totalPoints: '45.6',
        totalCoeficients: '3',
        moyenneGenerale: '15.2',
        moyenneGeneraleExacte: '15.2',
        moyenneGeneraleAffichee: '15.20',
        rang: 1,
        motifNonClasse: null,
        effectif: 12,
        moyenneClasse: '14.8',
        moyenneClasseExacte: '14.8',
        moyenneClasseAffichee: '14.80',
        incomplet: false,
      },
      continuite: { semestrePrecedent: null, changementClasse: false, classePrecedente: null },
      absences: {
        disponible: true,
        absencesJustifiees: 0,
        absencesNonJustifiees: 0,
        absencesTotal: 0,
        retards: 0,
        minutesRetard: 0,
      },
      motifs: [],
    },
    historique: [
      {
        id: 'rc-1',
        version: 1,
        statut,
        estCourant: true,
        motifCorrection: null,
        moyenneGenerale: '15.2',
        genereLe: '2026-01-10T08:00:00.000Z',
        publieLe: statut === 'PUBLIE' ? '2026-01-12T08:00:00.000Z' : null,
      },
    ],
  };
}

type Appel = { url: string; method: string; body?: string; csrf: string | null };

function installer(reponse: unknown, options: { refus?: { status: number; error: string } } = {}) {
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
    if (options.refus && url.endsWith('/correct')) {
      return {
        ok: false,
        status: options.refus.status,
        headers: new Headers(),
        json: async () => ({ error: options.refus?.error }),
      };
    }
    if (url.endsWith('/pdf')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="bulletin-MAT1-S1-v1.pdf"',
          'X-Contenu-Pages': '1',
        }),
        blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        json: async () => ({}),
      };
    }
    if (method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => reponse,
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ bulletin: (reponse as { bulletin: unknown }).bulletin }),
    };
  });
  vi.stubGlobal('fetch', mock);
  return { appels, mock };
}

function ouvrir(reponse: unknown, options: { refus?: { status: number; error: string } } = {}) {
  const { appels } = installer(reponse, options);
  render(
    <MemoryRouter initialEntries={['/bulletins/rc-1']}>
      <Routes>
        <Route path="/bulletins/:id" element={<BulletinDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  return { appels };
}

describe('BulletinDetailPage — snapshot figé', () => {
  beforeEach(() => {
    roleSimule = 'SCHOOL_ADMIN';
    api.setCsrfToken('jeton-test');
    vi.stubGlobal('fetch', vi.fn());
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    api.setCsrfToken(null);
  });

  it('rend le snapshot : moyenne servie, matière sans moyenne affichée comme telle', async () => {
    ouvrir(detail('BOUILLON'));

    expect(await screen.findByText('Mathématiques')).toBeInTheDocument();
    // La moyenne du snapshot, pas une valeur recomposée : discipline, groupe et synthèse
    // affichent l'arrondi de l'établissement (15.20), la valeur exacte (15.2) ne reste
    // qu'en infobulle.
    expect(screen.getAllByText('15.20').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('15.2')).not.toBeInTheDocument();
    expect(screen.getByText(/2\/3 note\(s\)/)).toBeInTheDocument();
    expect(screen.getByText('Histoire-Géographie')).toBeInTheDocument();
    expect(screen.getByText('Non calculable')).toBeInTheDocument();
    expect(screen.getByText('Aucune moyenne : aucune note saisie')).toBeInTheDocument();
    expect(screen.getByText(/Absences justifiées : 0/)).toBeInTheDocument();
    expect(screen.queryByText('0/20')).not.toBeInTheDocument();
  });

  it('laisse les champs libres modifiables tant que le bulletin est brouillon', async () => {
    const { appels } = ouvrir(detail('BOUILLON'));
    await screen.findByText('Mathématiques');

    const mention = screen.getByLabelText('Mention') as HTMLInputElement;
    fireEvent.change(mention, { target: { value: 'Bien' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les champs libres' }));

    await waitFor(() =>
      expect(appels.some((a) => a.method === 'PATCH' && a.url === '/api/report-cards/rc-1')).toBe(true)
    );
    const patch = appels.find((a) => a.method === 'PATCH')!;
    expect(patch.csrf).toBe('jeton-test');
    const corps = JSON.parse(patch.body!) as Record<string, unknown>;
    expect(corps.mention).toBe('Bien');
    // Un champ laissé vide part à null : rien n'est inventé.
    expect(corps.appreciation).toBeNull();
    const appreciations = appels.filter(
      (appel) => appel.method === 'PUT' && appel.url === '/api/school-life/appreciations'
    );
    expect(appreciations.map((appel) => JSON.parse(appel.body!))).toEqual([
      {
        enrollmentId: 'enc-1',
        semesterId: 'sem-1',
        subjectId: 'sub-math',
        content: '',
      },
      {
        enrollmentId: 'enc-1',
        semesterId: 'sem-1',
        subjectId: 'sub-hige',
        content: '',
      },
    ]);
  });

  it('gèle un bulletin publié : lecture seule et correction motivée uniquement', async () => {
    const { appels } = ouvrir(detail('PUBLIE'));
    await screen.findByText('Mathématiques');

    // Le statut figé apparaît dans l'en-tête et dans l'historique des versions.
    expect(screen.getAllByText(/Publié \(figé\)/)).toHaveLength(2);
    expect(screen.queryByLabelText('Mention')).not.toBeInTheDocument();
    expect(screen.getAllByText('Non renseigné').length).toBe(2);

    const bouton = screen.getByRole('button', { name: 'Créer une version corrigée' });
    expect(bouton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Motif de la correction/), {
      target: { value: 'Note de composition régularisée' },
    });
    await waitFor(() => expect(bouton).toBeEnabled());
    fireEvent.click(bouton);

    await waitFor(() =>
      expect(
        appels.some((a) => a.method === 'POST' && a.url === '/api/report-cards/rc-1/correct')
      ).toBe(true)
    );
    const correction = appels.find((a) => a.url.endsWith('/correct'))!;
    expect(JSON.parse(correction.body!)).toEqual({ motif: 'Note de composition régularisée' });
  });

  it('imprime depuis le serveur et signale un refus de correction', async () => {
    const { appels } = ouvrir(detail('PUBLIE'), {
      refus: { status: 409, error: 'Le bulletin doit être publié avant correction' },
    });
    await screen.findByText('Mathématiques');

    fireEvent.click(screen.getByRole('button', { name: 'Imprimer en PDF' }));
    expect(await screen.findByText(/bulletin-MAT1-S1-v1\.pdf \(1 page\(s\)\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Motif de la correction/), {
      target: { value: 'Erreur de report de note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer une version corrigée' }));

    expect(await screen.findByText(/doit être publié avant correction/)).toBeInTheDocument();
    expect(appels.some((a) => a.url === '/api/report-cards/rc-1/pdf')).toBe(true);
  });
});
