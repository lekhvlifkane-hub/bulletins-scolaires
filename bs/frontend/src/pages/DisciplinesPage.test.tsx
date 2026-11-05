import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisciplinesPage } from './DisciplinesPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { fetch: vi.fn() } }));

const classroom = {
  id: 'class-1',
  name: '6e A',
  academicYear: { id: 'year-1', name: '2026-2027', status: 'ACTIVE' },
  level: { name: '6e' },
  series: null,
};

function reponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('DisciplinesPage', () => {
  beforeEach(() => {
    vi.mocked(api.fetch).mockReset();
  });

  it('creates a subject and assigns it to a class with its coefficient', async () => {
    const subjects: Array<{ id: string; name: string; code: string }> = [];
    const assignments: Array<Record<string, unknown>> = [];
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/schooling/subjects' && init?.method === 'POST') {
        const data = JSON.parse(String(init.body)) as { name: string; code: string };
        const subject = { id: 'subject-1', ...data };
        subjects.push(subject);
        return reponse({ subject }, 201);
      }
      if (path === '/api/schooling/subjects') return reponse({ subjects });
      if (path === '/api/schooling/classes') return reponse({ classes: [classroom] });
      if (path === '/api/schooling/classroom-subjects' && init?.method === 'POST') {
        const data = JSON.parse(String(init.body)) as {
          classroomId: string;
          subjectId: string;
          coefficient: string;
        };
        expect(data).toEqual({
          classroomId: 'class-1',
          subjectId: 'subject-1',
          coefficient: '3',
        });
        assignments.push({
          id: 'assignment-1',
          coefficient: data.coefficient,
          effectiveTo: null,
          subject: subjects[0],
          classroom,
        });
        return reponse({ classroomSubject: assignments[0] }, 201);
      }
      if (path === '/api/schooling/classroom-subjects') {
        return reponse({ classroomSubjects: assignments });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(<DisciplinesPage />);
    fireEvent.change(await screen.findByLabelText('Nom de la discipline'), {
      target: { value: 'Mathématiques' },
    });
    fireEvent.change(screen.getByLabelText('Code de la discipline'), {
      target: { value: 'MATH' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'La discipline « Mathématiques » a été ajoutée.',
    );
    fireEvent.change(screen.getByLabelText('Coefficient'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Affecter la discipline' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Discipline affectée à la classe avec le coefficient indiqué.',
    );
    await waitFor(() => {
      expect(screen.getByText('Mathématiques')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
    expect(api.fetch).toHaveBeenCalledWith('/api/schooling/classroom-subjects', {
      method: 'POST',
      body: JSON.stringify({
        classroomId: 'class-1',
        subjectId: 'subject-1',
        coefficient: '3',
      }),
    });
  });

  it('updates a coefficient while displaying the previous coefficient in history', async () => {
    const subjects = [{ id: 'subject-1', name: 'Mathématiques', code: 'MATH' }];
    const previous = {
      id: 'assignment-1',
      coefficient: '2',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveTo: null as string | null,
      subject: subjects[0],
      classroom,
    };
    const assignments = [previous];
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/schooling/subjects') return reponse({ subjects });
      if (path === '/api/schooling/classes') return reponse({ classes: [classroom] });
      if (path.endsWith('/coefficient') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { coefficient: string };
        const changedAt = '2026-10-01T00:00:00.000Z';
        previous.effectiveTo = changedAt;
        const next = {
          ...previous,
          id: 'assignment-2',
          coefficient: body.coefficient,
          effectiveFrom: changedAt,
          effectiveTo: null,
        };
        assignments.push(next);
        return reponse({ classroomSubject: next }, 201);
      }
      if (path === '/api/schooling/classroom-subjects') {
        return reponse({ classroomSubjects: assignments });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(<DisciplinesPage />);
    await screen.findByText('2');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(
      screen.getByLabelText('Nouveau coefficient Mathématiques 6e A'),
      { target: { value: '3.5' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Coefficient de Mathématiques modifié. L’ancien coefficient est conservé dans l’historique.',
    );
    expect(await screen.findByText('3.5')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Historique des coefficients (1)'));
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(api.fetch).toHaveBeenCalledWith(
      '/api/schooling/classroom-subjects/assignment-1/coefficient',
      { method: 'PATCH', body: JSON.stringify({ coefficient: '3.5' }) },
    );
  });
});
