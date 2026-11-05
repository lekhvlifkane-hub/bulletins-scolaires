import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluationTypesPage } from './EvaluationTypesPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { fetch: vi.fn() } }));

function reponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('EvaluationTypesPage', () => {
  beforeEach(() => {
    vi.mocked(api.fetch).mockReset();
  });

  it('creates a configurable assessment type with category and default scale', async () => {
    const types: Array<Record<string, unknown>> = [];
    vi.mocked(api.fetch).mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          code: string;
          name: string;
          category: string;
          defaultOutOf: string;
        };
        const type = {
          id: 'type-1',
          ...body,
          defaultOutOf: '40',
          actif: true,
        };
        types.push(type);
        return reponse({ type }, 201);
      }
      return reponse({ types });
    });

    render(<EvaluationTypesPage />);
    fireEvent.change(await screen.findByLabelText('Code du type'), {
      target: { value: 'DEVOIR_MAISON' },
    });
    fireEvent.change(screen.getByLabelText('Nom du type'), {
      target: { value: 'Devoir maison' },
    });
    fireEvent.change(screen.getByLabelText('Catégorie'), {
      target: { value: 'DEVOIR' },
    });
    fireEvent.change(screen.getByLabelText('Barème par défaut'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le type' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Le type « Devoir maison » a été ajouté.',
    );
    expect(await screen.findByText('DEVOIR_MAISON')).toBeInTheDocument();
    expect(screen.getByText('/40')).toBeInTheDocument();
    expect(api.fetch).toHaveBeenCalledWith('/api/assessment-types', {
      method: 'POST',
      body: JSON.stringify({
        code: 'DEVOIR_MAISON',
        name: 'Devoir maison',
        category: 'DEVOIR',
        defaultOutOf: '40',
      }),
    });
  });
});
