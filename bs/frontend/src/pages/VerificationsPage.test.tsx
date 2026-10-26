import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { VerificationsPage } from '@/pages/VerificationsPage';
import { LIBELLES_STATUT_EVALUATION, type Evaluation, type StatutEvaluation } from '@/lib/notes';

/**
 * L'interface ne sécurise rien : le serveur refuse les transitions interdites.
 * Ces tests vérifient seulement que la page propose les transitions attendues et
 * qu'elle désactive ce que le rôle ne permet pas.
 */

const CLASSE = {
  id: 'cls-1',
  name: 'Terminale S1',
  academicYear: { id: 'an-1', name: '2025-2026', status: 'ACTIVE' },
  level: { name: 'Terminale' },
  _count: { enrollments: 12 },
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

function evaluation(statut: StatutEvaluation): Evaluation {
  return {
    id: 'ev-1',
    title: 'Devoir 1',
    position: 1,
    status: statut,
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
    notesSaisies: 12,
  };
}

type Appel = { url: string; method: string; corps: unknown };

function installer(role: 'ASSISTANT' | 'SCHOOL_ADMIN' | 'SURVEILLANT_GENERAL', statut: StatutEvaluation) {
  const appels: Appel[] = [];
  let renduStatut = statut;
  const evaluations = () => ({ assessments: [evaluation(renduStatut)] });

  const mock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') appels.push({ url, method, corps: init.body ? JSON.parse(String(init.body)) : null });

    if (url === '/api/auth/session') {
      return reponseJson({
        authenticated: true,
        user: {
          id: 'u-1',
          schoolId: 'sch-1',
          name: 'Utilisateur',
          email: 'u@school.test',
          role,
          isActive: true,
          lastLoginAt: null,
          createdAt: new Date().toISOString(),
        },
        school: null,
        csrfToken: 'csrf-test',
      });
    }
    if (url.startsWith('/api/schooling/classes')) return reponseJson({ classes: [CLASSE] });
    if (url.startsWith('/api/schooling/years')) return reponseJson(ANNEES);
    if (url.endsWith('/statut')) {
      renduStatut = (corpsAppelle(init) as { status: StatutEvaluation }).status;
      return reponseJson({ assessment: evaluation(renduStatut) });
    }
    if (url.startsWith('/api/assessments')) return reponseJson(evaluations());
    return reponseJson({});
  });

  vi.stubGlobal('fetch', mock);
  return { appels };
}

function corpsAppelle(init: RequestInit) {
  return JSON.parse(String(init.body));
}

function reponseJson(corps: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => corps };
}

function rendre() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <VerificationsPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('VerificationsPage — workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('propose la validation et la publication à un administrateur', async () => {
    const { appels } = installer('SCHOOL_ADMIN', 'A_VERIFIER');
    rendre();

    const valider = await screen.findByRole('button', { name: 'Valider' });
    expect(valider).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Renvoyer en saisie' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Publier' })).not.toBeInTheDocument();

    fireEvent.click(valider);

    await waitFor(() => expect(appels.length).toBe(1));
    expect(await screen.findByText('Validée')).toBeInTheDocument();
  });

  it('désactive valider et publier pour un assistant, sans cacher la transition', async () => {
    installer('ASSISTANT', 'VALIDEE');
    rendre();

    const publier = await screen.findByRole('button', { name: 'Publier' });
    expect(publier).toBeDisabled();
    expect(publier).toHaveAttribute(
      'title',
      "Réservé à l'administrateur et au surveillant général"
    );
    expect(screen.getByText(/Seuls l'administrateur/)).toBeInTheDocument();
  });

  it('une évaluation publiée n’offre plus aucune transition', async () => {
    installer('SCHOOL_ADMIN', 'PUBLIEE');
    rendre();

    expect(await screen.findByText('Publiée')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publier' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saisir' })).toHaveAttribute('href', '/saisie-notes');
  });

  it('le surveillant général valide, puis la ligne passe à « Validée »', async () => {
    const { appels } = installer('SURVEILLANT_GENERAL', 'A_VERIFIER');
    rendre();

    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));

    await waitFor(() => expect(appels.length).toBe(1));
    expect(appels[0].url).toBe('/api/assessments/ev-1/statut');
    expect(appels[0].corps).toEqual({ status: 'VALIDEE' });
    expect(
      await screen.findByText(`« Devoir 1 » : ${LIBELLES_STATUT_EVALUATION.A_VERIFIER} → Validée`)
    ).toBeInTheDocument();
  });
});
