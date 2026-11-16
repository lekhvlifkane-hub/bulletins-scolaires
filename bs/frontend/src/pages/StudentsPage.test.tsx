import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentsPage, parseStudentCsv, parseStudentXlsx } from './StudentsPage';
import { api } from '@/lib/api';
import writeXlsxFile from 'write-excel-file/browser';

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

  it('parses French CSV, quoted delimiters, dates, classes and statuses', () => {
    const rows = parseStudentCsv(
      'Matricule;Nom;Prénoms;Date de naissance;Adresse;Classe;Année scolaire;Statut\r\n' +
        'EL-1;Fall;"Awa; Marie";03/04/2012;"Dakar, Sénégal";6e A;2026-2027;Nouveau\r\n' +
        ';Diop;Moussa;2011-05-04;;5e A;2026-2027;Redoublant',
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
          classroom: '6e A',
          academicYear: '2026-2027',
          status: 'NOUVEAU',
        },
      },
      {
        line: 3,
        data: {
          lastName: 'Diop',
          firstNames: 'Moussa',
          birthDate: '2011-05-04',
          classroom: '5e A',
          academicYear: '2026-2027',
          status: 'REDOUBLANT',
        },
      },
    ]);
  });

  it('requires confirmation before linking a potential duplicate during import', async () => {
    let imported: { row: number; student: unknown; action: string; candidateId?: string }[] = [];
    const candidate = {
      id: 'existing-student',
      matricule: 'EL-OLD',
      lastName: 'Diallo',
      firstNames: 'Awa',
      birthDate: '2012-04-03T00:00:00.000Z',
      deletedAt: null,
      activeEnrollments: [],
    };
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/students/import/preview' && init?.method === 'POST') {
        return reponse({
          rows: [
            { row: 2, status: 'READY', error: null, candidates: [], classroom: { id: 'class-1' } },
            { row: 3, status: 'DUPLICATE', error: null, candidates: [candidate], classroom: { id: 'class-1' } },
            { row: 4, status: 'ERROR', error: 'Date invalide', candidates: [], classroom: null },
          ],
        });
      }
      if (path === '/api/students/import' && init?.method === 'POST') {
        imported = (JSON.parse(String(init.body)) as { students: typeof imported }).students;
        return reponse({
          importedCount: 2,
          createdCount: 1,
          linkedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          results: [
            { row: 2, matricule: 'EL-1', status: 'created' },
            { row: 3, matricule: 'EL-OLD', status: 'linked' },
          ],
        }, 201);
      }
      return reponse({ students: [] });
    });

    render(<MemoryRouter><StudentsPage /></MemoryRouter>);
    const file = new File(
      [
        'matricule;nom;prenoms;date_naissance;classe;annee_scolaire;statut\n' +
          'EL-1;Fall;Moussa;2012-04-03;6e A;2026-2027;NOUVEAU\n' +
          ';Diallo;Awa;2012-04-03;6e A;2026-2027;REDOUBLANT\n' +
          'EL-2;Ba;Fatou;date-invalid;6e A;2026-2027;NOUVEAU',
      ],
      'eleves.csv',
      { type: 'text/csv' },
    );
    Object.defineProperty(file, 'text', {
      value: async () =>
        'matricule;nom;prenoms;date_naissance;classe;annee_scolaire;statut\n' +
        'EL-1;Fall;Moussa;2012-04-03;6e A;2026-2027;NOUVEAU\n' +
        ';Diallo;Awa;2012-04-03;6e A;2026-2027;REDOUBLANT\n' +
        'EL-2;Ba;Fatou;date-invalid;6e A;2026-2027;NOUVEAU',
    });
    fireEvent.change(screen.getByLabelText('Fichier CSV ou Excel des élèves'), {
      target: { files: [file] },
    });

    expect(await screen.findByText('Aperçu : 1 ligne(s) prête(s), 2 ligne(s) à ignorer.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 3 — Doublon potentiel')).toBeInTheDocument();
    expect(screen.getByText(/Ligne 4 — Date de naissance obligatoire ou invalide/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Diallo Awa · EL-OLD/));
    fireEvent.click(screen.getByRole('button', { name: 'Importer 2 ligne(s) confirmée(s)' }));

    expect(await screen.findByText(/1 fiche\(s\) créée\(s\), 1 dossier\(s\) rattaché\(s\), 0 fiche\(s\) mise\(s\) à jour, 1 ligne\(s\) ignorée\(s\)/)).toBeInTheDocument();
    expect(imported).toEqual([
      {
        row: 2,
        student: {
          matricule: 'EL-1',
          lastName: 'Fall',
          firstNames: 'Moussa',
          birthDate: '2012-04-03',
          classroom: '6e A',
          academicYear: '2026-2027',
          status: 'NOUVEAU',
        },
        action: 'CREATE',
      },
      {
        row: 3,
        student: {
          lastName: 'Diallo',
          firstNames: 'Awa',
          birthDate: '2012-04-03',
          classroom: '6e A',
          academicYear: '2026-2027',
          status: 'REDOUBLANT',
        },
        action: 'LINK',
        candidateId: 'existing-student',
      },
    ]);
  });

  it('requires a date of birth column in the import file', () => {
    expect(() => parseStudentCsv('matricule;nom\nEL-1;Fall')).toThrow(
      'Colonnes obligatoires manquantes : prenoms, date_naissance.',
    );
  });

  it('reads student records from an Excel workbook', async () => {
    const workbook = await writeXlsxFile([
      ['matricule', 'nom', 'prenoms', 'date_naissance', 'classe', 'statut'],
      ['MAT-01', 'Fall', 'Awa', '2012-04-03', '6e A', 'REDOUBLANT'],
    ], { sheet: 'Élèves' }).toBlob();
    const file = new File([workbook], 'eleves.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
        reader.readAsArrayBuffer(file);
      }),
    });

    await expect(parseStudentXlsx(file)).resolves.toMatchObject([
      {
        line: 2,
        data: {
          matricule: 'MAT-01',
          lastName: 'Fall',
          firstNames: 'Awa',
          birthDate: '2012-04-03',
          classroom: '6e A',
          status: 'REDOUBLANT',
        },
      },
    ]);
  });

  it('lets the server assign the matricule when the field is empty', async () => {
    let bodySent: Record<string, unknown> | null = null;
    vi.mocked(api.fetch).mockImplementation(async (path, init) => {
      if (path === '/api/students' && init?.method === 'POST') {
        bodySent = JSON.parse(String(init.body)) as Record<string, unknown>;
        return reponse({ student: { id: 'student-1', matricule: 'ELI001' } }, 201);
      }
      return reponse({ students: [] });
    });

    render(<MemoryRouter><StudentsPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Nom'), { target: { value: 'Fall' } });
    fireEvent.change(screen.getByLabelText('Prénoms'), { target: { value: 'Awa' } });
    fireEvent.change(screen.getByLabelText('Date de naissance'), { target: { value: '2012-04-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));

    expect(await screen.findByText('Élève créé.')).toBeInTheDocument();
    expect(bodySent).toEqual({ lastName: 'Fall', firstNames: 'Awa', birthDate: '2012-04-03' });
  });
});
