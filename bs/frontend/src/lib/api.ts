const API_BASE_URL = (() => {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, '');
  // En développement Tauri, le backend local reste pratique ; l'app distribuée
  // se connecte au backend de production (bulletins-scolaires-production,
  // comptes et données des établissements). Cette valeur de secours est
  // utilisée si la Variable GitHub VITE_API_BASE_URL n'était pas définie au
  // build — le workflow release.yml la fige aussi.
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return import.meta.env.PROD
      ? 'https://bulletins-scolaires-production.up.railway.app'
      : 'http://localhost:4000';
  }
  // Dev navigateur : URL relative → le proxy Vite (/api → :4000) prend le relais.
  return '';
})();

function resoudreUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `${API_BASE_URL}${input.startsWith('/') ? input : `/${input}`}`;
}

type SessionUser = {
  id: string;
  schoolId: string | null;
  name: string;
  email: string;
  role: 'PLATFORM_ADMIN' | 'SCHOOL_ADMIN' | 'SURVEILLANT_GENERAL' | 'ASSISTANT';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

/** Règles de calcul de l'établissement (voir backend `services/calcul/etablissement.ts`). */
type SchoolRules = {
  regleCalculMatiere: 'POIDS_GROUPES' | 'MOYENNE_TOUTES_NOTES';
  poidsDevoirs: string;
  poidsCompositions: string;
  poidsAutres: string;
  absencesComptentZero: boolean;
  groupeSansNote: 'EXCLURE' | 'BLOQUANT';
  coefficientInvalide: 'EXCLURE' | 'ERREUR';
  baremeParDefaut: string;
  arrondiDecimales: number;
  arrondiMode: 'HALF_UP' | 'HALF_EVEN';
  rangMode: 'STANDARD' | 'DENSE';
  classerResultatsIncomplets: boolean;
  poidsSemestre1: string;
  poidsSemestre2: string;
  annuelSiSemestreManquant: 'NULL' | 'PARTIEL';
};

type SessionSchool = {
  id: string;
  name: string;
  officialName: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  accreditationNumber: string | null;
  logoDataUrl: string | null;
  isActive: boolean;
  createdAt: string;
} & SchoolRules;

type SessionResponse = {
  authenticated: boolean;
  user: SessionUser | null;
  school: SessionSchool | null;
  csrfToken: string;
};

class ApiClient {
  private csrfToken: string | null = null;

  setCsrfToken(token: string | null) {
    this.csrfToken = token;
  }

  getCsrfToken() {
    return this.csrfToken;
  }

  async fetch(input: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers || {});
    const method = (init.method || 'GET').toUpperCase();

    if (this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.set('X-CSRF-Token', this.csrfToken);
    }

    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(resoudreUrl(input), {
      ...init,
      headers,
      credentials: 'include',
    });

    const newCsrf = response.headers.get('X-CSRF-Token');
    if (newCsrf) {
      this.csrfToken = newCsrf;
    }

    return response;
  }

  async getSession(): Promise<SessionResponse> {
    const res = await this.fetch('/api/auth/session');
    if (!res.ok) {
      throw new Error('Impossible de charger la session');
    }
    const data = (await res.json()) as SessionResponse;
    this.csrfToken = data.csrfToken ?? this.csrfToken;
    return data;
  }

  async login(email: string, password: string) {
    // Sans jeton CSRF (ex. juste après une déconnexion), on en obtient un
    // auprès du serveur : sinon le middleware CSRF rejette la requête.
    if (!this.csrfToken) {
      await this.getSession().catch(() => undefined);
    }
    const res = await this.fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Erreur de connexion' }));
      throw new Error(body.error || 'Erreur de connexion');
    }
    const data = await res.json();
    if (data.csrfToken) {
      this.csrfToken = data.csrfToken;
    }
    return data;
  }

  async logout() {
    await this.fetch('/api/auth/logout', { method: 'POST' });
    this.csrfToken = null;
  }

  async me() {
    const res = await this.fetch('/api/auth/me');
    if (!res.ok) throw new Error('Non authentifié');
    return res.json();
  }
}

export const api = new ApiClient();
export type { SessionUser, SessionSchool, SessionResponse };
