import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

function reponseJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient.login', () => {
  beforeEach(() => {
    api.setCsrfToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renouvelle le jeton CSRF et réessaie après un rejet 403', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reponseJson({ authenticated: false, user: null, school: null, csrfToken: 'ancien' }),
      )
      .mockResolvedValueOnce(
        reponseJson({ error: 'Jeton CSRF invalide ou expiré' }, 403),
      )
      .mockResolvedValueOnce(
        reponseJson({ authenticated: false, user: null, school: null, csrfToken: 'nouveau' }),
      )
      .mockResolvedValueOnce(
        reponseJson({ user: { id: 'u1' }, school: null, csrfToken: 'apres-login' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const data = await api.login('khadim@oumardiop.sn', 'secret');

    expect(data.csrfToken).toBe('apres-login');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const entetes = (index: number) =>
      (fetchMock.mock.calls[index][1] as RequestInit).headers as Headers;
    expect(entetes(1).get('X-CSRF-Token')).toBe('ancien');
    expect(entetes(3).get('X-CSRF-Token')).toBe('nouveau');
  });

  it('ne réessaie pas une erreur métier 403', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reponseJson({ authenticated: false, user: null, school: null, csrfToken: 'valide' }),
      )
      .mockResolvedValueOnce(
        reponseJson({ error: 'Votre demande est en cours de validation' }, 403),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.login('khadim@oumardiop.sn', 'secret')).rejects.toThrow(
      'Votre demande est en cours de validation',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
