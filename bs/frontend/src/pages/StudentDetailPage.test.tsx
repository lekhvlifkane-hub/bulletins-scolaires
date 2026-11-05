import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentDetailPage } from './StudentDetailPage';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { fetch: vi.fn() } }));

const classes = [
  {
    id: 'class-1',
    name: '6e A',
    academicYear: { name: '2025-2026', status: 'ACTIVE' },
    level: { name: '6e' },
    series: null,
  },
  {
    id: 'class-2',
    name: '5e A',
    academicYear: { name: '2026-2027', status: 'PREPARATION' },
    level: { name: '5e' },
    series: null,
  },
];

const student = {
  id: 'student-1',
  matricule: 'EL-1',
  lastName: 'Fall',
  firstNames: 'Awa',
  birthDate: '2012-04-03T00:00:00.000Z',
  birthPlace: 'Dakar',
  sex: null,
  address: 'Plateau',
  guardianName: 'Parent Fall',
  guardianPhone: '770000000',
  enrollments: [{
    id: 'enrollment-1',
    status: 'ACTIVE',
    enrolledAt: '2025-09-01T00:00:00.000Z',
    endedAt: null,
    classroom: { id: 'class-1', name: '6e A', academicYear: { name: '2025-2026' } },
  }],
};
type StudentFixture = Omit<typeof student, 'enrollments'> & {
  enrollments: Array<Omit<(typeof student.enrollments)[number], 'status' | 'endedAt'> & {
    status: string;
    endedAt: string | null;
  }>;
};

function reponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('StudentDetailPage', () => {
  beforeEach(() => {
    vi.mocked(api.fetch).mockReset();
  });

  it('updates the student profile and transfers while preserving the previous enrollment', async () => {
    let updatedStudent: StudentFixture = student;
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/schooling/classes') return reponse({ classes });
      if (path === '/api/students/student-1' && init?.method === 'PATCH') {
        const changes = JSON.parse(String(init.body)) as { address: string };
        updatedStudent = { ...updatedStudent, ...changes };
        return reponse({ student: updatedStudent });
      }
      if (path === '/api/students/student-1/enrollments') {
        expect(JSON.parse(String(init?.body))).toEqual({ classroomId: 'class-2' });
        updatedStudent = {
          ...updatedStudent,
          enrollments: [
            {
              ...student.enrollments[0],
              status: 'TRANSFERRED',
              endedAt: '2026-02-01T00:00:00.000Z',
            },
            {
              ...student.enrollments[0],
              id: 'enrollment-2',
              status: 'ACTIVE',
              classroom: { id: 'class-2', name: '5e A', academicYear: { name: '2026-2027' } },
            },
          ],
        };
        return reponse({ message: 'Inscription créée' }, 201);
      }
      if (path === '/api/students/student-1') return reponse({ student: updatedStudent });
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={['/eleves/student-1']}>
        <Routes>
          <Route path="/eleves/:id" element={<StudentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText('Adresse'), { target: { value: 'Médina' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dossier élève mis à jour.');
    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledWith('/api/students/student-1', expect.objectContaining({
        method: 'PATCH',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Transférer l’élève' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Inscription créée');
    expect(await screen.findByText('5e A · 2026-2027')).toBeInTheDocument();
    expect(await screen.findByText(/6e A · 2025-2026/)).toBeInTheDocument();
  });

  it('confirms archive and returns to the student list', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/schooling/classes') return reponse({ classes });
      if (path === '/api/students/student-1' && init?.method === 'DELETE') return reponse(null, 204);
      if (path === '/api/students/student-1') return reponse({ student });
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={['/eleves/student-1']}>
        <Routes>
          <Route path="/eleves/:id" element={<StudentDetailPage />} />
          <Route path="/eleves" element={<h1>Liste des élèves</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Archiver l’élève' }));
    expect(await screen.findByRole('heading', { name: 'Liste des élèves' })).toBeInTheDocument();
    expect(api.fetch).toHaveBeenCalledWith('/api/students/student-1', { method: 'DELETE' });
  });
});
