import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassesPage } from './ClassesPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { fetch: vi.fn() } }));

const classroom = {
  id: 'class-1',
  name: '6e A',
  academicYear: {
    id: 'year-1',
    name: '2025-2026',
    status: 'ACTIVE',
    startsAt: '2025-09-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.999Z',
    semesters: [],
  },
  level: { id: 'level-1', name: 'Sixième' },
  series: null,
  _count: { enrollments: 0 },
};

function reponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('ClassesPage', () => {
  beforeEach(() => {
    vi.mocked(api.fetch).mockReset();
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/schooling/years' && init?.method === 'POST') {
        return reponse({ year: { id: 'year-2', name: '2026-2027' } }, 201);
      }
      if (path === '/api/schooling/years') {
        return reponse({
          years: [{
            id: 'year-1',
            name: '2025-2026',
            status: 'ACTIVE',
            startsAt: '2025-09-01T00:00:00.000Z',
            endsAt: '2026-07-31T23:59:59.999Z',
            semesters: [
              { id: 'semester-1', number: 1, name: 'Semestre 1', startsAt: '2025-09-01T00:00:00.000Z', endsAt: '2026-02-14T23:59:59.999Z' },
              { id: 'semester-2', number: 2, name: 'Semestre 2', startsAt: '2026-02-15T00:00:00.000Z', endsAt: '2026-07-31T23:59:59.999Z' },
            ],
          }],
        });
      }
      if (path === '/api/schooling/levels' && init?.method === 'POST') {
        return reponse({ level: { id: 'level-new', name: '5e', sortOrder: 1 } }, 201);
      }
      if (path === '/api/schooling/levels') {
        return reponse({ levels: [{ id: 'level-1', name: 'Sixième', sortOrder: 0 }] });
      }
      if (path === '/api/schooling/series') {
        return reponse({ series: [{ id: 'series-1', name: 'S2', levelId: 'level-1' }] });
      }
      if (path === '/api/schooling/classes' && init?.method === 'POST') {
        return reponse({ classroom }, 201);
      }
      if (path === '/api/schooling/classes') {
        return reponse({ classes: [] });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  it('creates a classroom with its school year, level and optional series', async () => {
    render(<MemoryRouter><ClassesPage /></MemoryRouter>);

    expect(await screen.findByText('Aucune classe pour le moment')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nom de la classe'), { target: { value: '6e A' } });
    fireEvent.change(screen.getByLabelText('Série (facultatif)'), {
      target: { value: 'series-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la classe' }));

    expect(await screen.findByRole('status')).toHaveTextContent('La classe a été créée.');
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith('/api/schooling/classes', {
        method: 'POST',
        body: JSON.stringify({
          name: '6e A',
          academicYearId: 'year-1',
          levelId: 'level-1',
          seriesId: 'series-1',
        }),
      });
    });
  });

  it('creates a school year with the supplied start and end dates', async () => {
    render(<MemoryRouter><ClassesPage /></MemoryRouter>);

    await screen.findByDisplayValue('2025-2026');
    fireEvent.change(screen.getByPlaceholderText('Ex. 2026-2027'), {
      target: { value: '2026-2027' },
    });
    fireEvent.change(screen.getByLabelText('Date de début'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Date de fin'), {
      target: { value: '2027-07-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’année scolaire' }));

    expect(await screen.findByText('L’année scolaire et ses deux semestres ont été créés.')).toBeInTheDocument();
    expect(api.fetch).toHaveBeenCalledWith('/api/schooling/years', {
      method: 'POST',
      body: JSON.stringify({
        name: '2026-2027',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2027-07-31T23:59:59.999Z',
        status: 'PREPARATION',
      }),
    });
  });

  it('creates missing recommended levels and one class per level, then remains idempotent', async () => {
    let levels = [{ id: 'level-1', name: 'Sixième', sortOrder: 0 }];
    let classes = [classroom];
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/schooling/years') {
        return reponse({
          years: [{
            id: 'year-1',
            name: '2025-2026',
            status: 'ACTIVE',
            startsAt: '2025-09-01T00:00:00.000Z',
            endsAt: '2026-07-31T23:59:59.999Z',
            semesters: [],
          }],
        });
      }
      if (path === '/api/schooling/levels' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { name: string; sortOrder: number };
        const level = { id: `level-${body.name}`, ...body };
        levels = [...levels, level];
        return reponse({ level }, 201);
      }
      if (path === '/api/schooling/levels') return reponse({ levels });
      if (path === '/api/schooling/series') return reponse({ series: [] });
      if (path === '/api/schooling/classes' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          name: string;
          levelId: string;
          academicYearId: string;
        };
        const level = levels.find((item) => item.id === body.levelId)!;
        classes = [...classes, {
          ...classroom,
          id: `class-${classes.length + 1}`,
          name: body.name,
          academicYear: { ...classroom.academicYear, id: body.academicYearId },
          level,
        }];
        return reponse({ classroom: classes.at(-1) }, 201);
      }
      if (path === '/api/schooling/classes') return reponse({ classes });
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(<MemoryRouter><ClassesPage /></MemoryRouter>);
    const createAllButton = await screen.findByRole('button', {
      name: 'Créer les 7 classes · année active',
    });
    fireEvent.click(createAllButton);

    expect(await screen.findByRole('status')).toHaveTextContent(
      '6 niveau(x) ajouté(s), 6 classe(s) créée(s) pour 2025-2026. 1 classe(s) déjà présente(s) ignorée(s).',
    );
    expect(levels).toHaveLength(7);
    expect(classes).toHaveLength(7);
    expect(classes.map((item) => item.level.id)).toContain('level-1');

    fireEvent.click(createAllButton);
    expect(await screen.findByRole('status')).toHaveTextContent(
      '0 niveau(x) ajouté(s), 0 classe(s) créée(s) pour 2025-2026. 7 classe(s) déjà présente(s) ignorée(s).',
    );
    expect(levels).toHaveLength(7);
    expect(classes).toHaveLength(7);
  });

  it('requires an active school year before enabling the bulk class action', async () => {
    vi.mocked(api.fetch).mockImplementation(async (path) => {
      if (path === '/api/schooling/years') return reponse({ years: [] });
      if (path === '/api/schooling/levels') return reponse({ levels: [] });
      if (path === '/api/schooling/series') return reponse({ series: [] });
      if (path === '/api/schooling/classes') return reponse({ classes: [] });
      throw new Error(`Unexpected API request: ${path}`);
    });
    render(<MemoryRouter><ClassesPage /></MemoryRouter>);

    expect(await screen.findByText(
      'Activez une année scolaire pour créer automatiquement une classe par niveau.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Créer les 7 classes · année active',
    })).toBeDisabled();
  });
});
