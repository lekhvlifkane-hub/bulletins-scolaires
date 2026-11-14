import { render, screen, within } from '@testing-library/react';
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
    evaluationTypes: 3,
    assessments: 12,
    bulletins: 30,
    publishedBulletins: 18,
  },
  semesters: [
    { id: 's1', name: 'Semestre 1', numero: 1, bulletins: 20, bulletinsPublies: 12, absences: 3, retards: 2 },
    { id: 's2', name: 'Semestre 2', numero: 2, bulletins: 10, bulletinsPublies: 6, absences: 1, retards: 0 },
  ],
};

// Établissement à l'installation : une étape au moins est incomplète.
const dashboardVierge: DashboardSchool = {
  ...dashboard,
  academicYear: null,
  indicators: {
    ...dashboard.indicators,
    students: 0,
    enrollments: 0,
    classrooms: 0,
    subjects: 0,
    evaluationTypes: 0,
    assessments: 0,
    bulletins: 0,
    publishedBulletins: 0,
  },
  semesters: [],
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

  it('propose la liste de contrôle Premiers pas quand l’installation est incomplète', async () => {
    chargerDashboard.mockResolvedValue(dashboardVierge);
    rendre();

    const section = await screen.findByRole('region', { name: 'Premiers pas' });
    expect(section).toBeInTheDocument();
    expect(within(section).getAllByRole('link').map((lien) => lien.textContent)).toEqual([
      expect.stringContaining('Créer l’année scolaire'),
      expect.stringContaining('Créer les classes'),
      expect.stringContaining('Ajouter les matières'),
      expect.stringContaining('Définir devoirs et compositions'),
    ]);
  });

  it('masque la liste de contrôle quand les 4 étapes sont terminées', async () => {
    chargerDashboard.mockResolvedValue(dashboard);
    rendre();

    expect(await screen.findByText('Bulletins générés')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Premiers pas' })).not.toBeInTheDocument();
  });
});
