import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { SchoolSettingsPage } from '@/pages/SchoolSettingsPage';

/**
 * Les règles de calcul sont enregistrées par l'établissement depuis cet écran.
 * Les tests vérifient qu'elles sont affichées telles que le serveur les renvoie,
 * qu'elles partent en nombres (jamais en chaînes) et qu'une saisie invalide
 * n'atteint pas le serveur.
 */

const ECOLE = {
  id: 'sch-1',
  name: 'Lycée Test',
  officialName: null,
  city: null,
  address: null,
  phone: null,
  email: null,
  accreditationNumber: null,
  isActive: true,
  createdAt: new Date().toISOString(),
  regleCalculMatiere: 'POIDS_GROUPES',
  poidsDevoirs: '1',
  poidsCompositions: '1',
  poidsAutres: '0',
  absencesComptentZero: false,
  groupeSansNote: 'EXCLURE',
  coefficientInvalide: 'EXCLURE',
  baremeParDefaut: '20',
  arrondiDecimales: 2,
  arrondiMode: 'HALF_UP',
  rangMode: 'STANDARD',
  classerResultatsIncomplets: false,
  poidsSemestre1: '1',
  poidsSemestre2: '1',
  annuelSiSemestreManquant: 'NULL',
};

type Appel = { url: string; method: string; corps: Record<string, unknown> };

function reponseJson(corps: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => corps };
}

function installer() {
  const appels: Appel[] = [];
  const mock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();

    if (url === '/api/auth/session') {
      return reponseJson({
        authenticated: true,
        user: {
          id: 'u-1',
          schoolId: ECOLE.id,
          name: 'Administrateur',
          email: 'admin@ecole.test',
          role: 'SCHOOL_ADMIN',
          isActive: true,
          lastLoginAt: null,
          createdAt: new Date().toISOString(),
        },
        school: ECOLE,
        csrfToken: 'csrf-test',
      });
    }

    const corps = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'PATCH') {
      appels.push({ url, method, corps });
      return reponseJson({ school: { ...ECOLE, ...corps } });
    }
    return reponseJson({});
  });

  vi.stubGlobal('fetch', mock);
  return { appels };
}

function rendre() {
  return render(
    <AuthProvider>
      <SchoolSettingsPage />
    </AuthProvider>,
  );
}

describe('SchoolSettingsPage — règles de calcul', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('affiche les règles enregistrées de l’établissement', async () => {
    installer();
    rendre();

    expect(await screen.findByDisplayValue('Lycée Test')).toBeInTheDocument();
    expect(screen.getByLabelText(/Moyenne par matière/)).toHaveValue('POIDS_GROUPES');
    expect(screen.getByLabelText(/Poids des compositions/)).toHaveValue(1);
    expect(screen.getByLabelText(/Décimales d'affichage/)).toHaveValue(2);
    expect(screen.getByLabelText(/Poids du semestre 2/)).toHaveValue(1);
    expect(screen.getByLabelText(/Compter une absence comme 0/)).not.toBeChecked();
  });

  it('enregistre les règles en nombres, tels que le serveur les attend', async () => {
    const { appels } = installer();
    rendre();

    // Attendre la session : les règles affichées viennent de l'établissement chargé.
    await screen.findByDisplayValue('Lycée Test');
    fireEvent.change(screen.getByLabelText(/Moyenne par matière/), {
      target: { value: 'MOYENNE_TOUTES_NOTES' },
    });
    fireEvent.change(screen.getByLabelText(/Poids des compositions/), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText(/Poids du semestre 2/), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText(/Compter une absence comme 0/));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(appels).toHaveLength(1));
    const [appel] = appels;
    expect(appel.url).toBe('/api/schools/sch-1');
    expect(appel.method).toBe('PATCH');
    expect(appel.corps.regleCalculMatiere).toBe('MOYENNE_TOUTES_NOTES');
    expect(appel.corps.absencesComptentZero).toBe(true);
    expect(appel.corps.poidsCompositions).toBe(3);
    expect(appel.corps.poidsSemestre2).toBe(2);
    expect(typeof appel.corps.arrondiDecimales).toBe('number');
    expect(await screen.findByText('Paramètres enregistrés')).toBeInTheDocument();
  });

  it('n’envoie rien quand une règle numérique est vide', async () => {
    const { appels } = installer();
    rendre();

    await screen.findByDisplayValue('Lycée Test');
    fireEvent.change(screen.getByLabelText(/Poids des devoirs/), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/Poids des devoirs : saisir un nombre/)).toBeInTheDocument();
    expect(appels).toHaveLength(0);
  });
});
