import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentsPage, parseStudentCsv } from './StudentsPage';
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

describe('StudentsPage CSV', () => {
  beforeEach(() => {
    vi.mocked(api.fetch).mockReset();
  });

  it('parses French semicolon CSV, quoted delimiters and dates', () => {
    const rows = parseStudentCsv(
      'Matricule;Nom;Prénoms;Date de naissance;Adresse\r\n' +
        'EL-1;Fall;"Awa; Marie";03/04/2012;"Dakar, Sénégal"\r\n' +
        'EL-2;Diop;Moussa;;',
    );

    expect(rows).toEqual([
      {
        line: 2,
        data: {
          matricule: 'EL-1',
          lastName: 'Fall',
          firstNames: 'Awa; Marie',
          birthDate: '2012-04-03',
          address: 'Dakar, Sénégal',
        },
      },
      {
        line: 3,
        data: { matricule: 'EL-2', lastName: 'Diop', firstNames: 'Moussa' },
      },
    ]);
  });

  it('previews valid records and imports them while ignoring duplicates', async () => {
    let imported: unknown[] = [];
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/students/import' && init?.method === 'POST') {
        imported = (JSON.parse(String(init.body)) as { students: unknown[] }).students;
        return reponse({
          importedCount: imported.length,
          skippedCount: 0,
          results: imported.map((value) => {
            const row = value as { row: number; student: { matricule: string } };
            return { row: row.row, matricule: row.student.matricule, status: 'created' };
          }),
        }, 201);
      }
      return reponse({ students: [] });
    });

    render(<MemoryRouter><StudentsPage /></MemoryRouter>);
    const file = new File(
      [
        'matricule;nom;prenoms;date_naissance\n' +
          'EL-1;Fall;Awa;2012-04-03\n' +
          'EL-1;Diop;Moussa;2011-05-04\n' +
          'EL-2;Ba;Fatou;date-invalid',
      ],
      'eleves.csv',
      { type: 'text/csv' },
    );
    Object.defineProperty(file, 'text', {
      value: async () =>
        'matricule;nom;prenoms;date_naissance\n' +
        'EL-1;Fall;Awa;2012-04-03\n' +
        'EL-1;Diop;Moussa;2011-05-04\n' +
        'EL-2;Ba;Fatou;date-invalid',
    });
    fireEvent.change(screen.getByLabelText('Fichier CSV des élèves'), {
      target: { files: [file] },
    });

    expect(await screen.findByText('Aperçu : 1 ligne(s) prêtes, 2 ligne(s) à ignorer.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 3 — Matricule répété dans le fichier')).toBeInTheDocument();
    expect(screen.getByText(/Ligne 4 — Date de naissance invalide/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Importer 1 ligne(s) valide(s)' }));

    expect(await screen.findByText(
      /1 élève\(s\) importé\(s\), 2 ligne\(s\) ignorée\(s\)\. ligne 3: Matricule répété/,
    )).toBeInTheDocument();
    expect(imported).toEqual([
      {
        row: 2,
        student: {
          matricule: 'EL-1',
          lastName: 'Fall',
          firstNames: 'Awa',
          birthDate: '2012-04-03',
        },
      },
    ]);
  });

  it('rejects a CSV without all required columns', () => {
    expect(() => parseStudentCsv('matricule;nom\nEL-1;Fall')).toThrow(
      'Colonnes obligatoires manquantes : prenoms.',
    );
  });
});
