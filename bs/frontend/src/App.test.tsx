import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('Application', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          authenticated: false,
          user: null,
          school: null,
          csrfToken: 'test-csrf-token',
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirige un visiteur non authentifié vers la connexion', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByAltText('Bulletins Scolaires')).toBeInTheDocument();
    expect(screen.queryByText('Mot de passe oublié ?')).not.toBeInTheDocument();
  });
});
