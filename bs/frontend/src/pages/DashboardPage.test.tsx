import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import type { DashboardSchool } from '@/lib/dashboard';

const { chargerDashboard } = vi.hoisted(() => ({ chargerDashboard: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Awa Ndiaye', email: 'awa@example.test', role: 'SCHOOL_ADMIN' },
    school: { name: 'École test' },
  }),
}));

vi.mock('@/lib/dashboard', () => ({ chargerDashboard }));

const dashboard: DashboardSchool = {
  scope: 'school',
  schoolName: 'École test',
  academicYear: { id: 'year-1', name: '2025-2026' },
  indicators: {
    students: 38,
    enrollments: 35,
    classrooms: 4,
    subjects: 9,
    assessments: 12,
    bulletins: 30,
    publishedBulletins: 18,
  },
  semesters: [
    { id: 's1', name: 'Semestre 1', numero: 1, bulletins: 20, bulletinsPublies: 12, absences: 3, retards: 2 },
    { id: 's2', name: 'Semestre 2', numero: 2, bulletins: 10, bulletinsPublies: 6, absences: 1, retards: 0 },
  ],
};

function rendre() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

describe('DashboardPage', () => {
  beforeEach(() => {
    chargerDashboard.mockReset();
  });

  it('affiche les indicateurs reçus de l’API et les graphiques par semestre', async () => {
    chargerDashboard.mockResolvedValue(dashboard);
    rendre();

    expect(await screen.findByText('35')).toBeInTheDocument();
    expect(screen.getByText('Bulletins générés')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Graphique des bulletins générés et publiés par semestre' }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Graphique des absences et retards par semestre' })).toBeInTheDocument();
  });

  it('affiche une erreur explicite et permet une nouvelle tentative', async () => {
    chargerDashboard.mockRejectedValueOnce(new Error('Service indisponible')).mockResolvedValueOnce(dashboard);
    rendre();

    expect(await screen.findByRole('alert')).toHaveTextContent('Service indisponible');
    screen.getByRole('button', { name: 'Réessayer' }).click();
    expect(await screen.findByText('Évaluations')).toBeInTheDocument();
  });
});
