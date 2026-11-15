import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, FileUp, Search, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type StudentCsvData = {
  matricule?: string;
  lastName: string;
  firstNames: string;
  birthDate: string;
  birthPlace?: string;
  sex?: string;
  address?: string;
  guardianName?: string;
  guardianPhone?: string;
  classroom?: string;
  academicYear?: string;
  status: 'NOUVEAU' | 'REDOUBLANT' | 'TRANSFERE';
};

type Student = {
  id: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  birthDate: string | null;
  birthPlace: string | null;
  sex: string | null;
  address: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  enrollments: {
    isRepeating: boolean;
    entryType: 'NEW' | 'TRANSFERRED' | null;
    classroom: { name: string; academicYear: { name: string } };
  }[];
};

type ImportCandidate = {
  id: string;
  matricule: string;
  lastName: string;
  firstNames: string;
  birthDate: string | null;
  deletedAt: string | null;
  activeEnrollments: { classroomId: string; classroomName: string; academicYearName: string }[];
};

type ParsedRow = {
  line: number;
  data: StudentCsvData | null;
  error?: string;
  duplicate?: boolean;
  candidates?: ImportCandidate[];
  action?: 'CREATE' | 'LINK' | 'UPDATE';
  candidateId?: string;
};

type ImportResult = {
  row: number;
  matricule: string | null;
  status: 'created' | 'linked' | 'updated' | 'skipped';
  error?: string;
};

const fields: Record<string, keyof StudentCsvData> = {
  matricule: 'matricule',
  nom: 'lastName',
  lastname: 'lastName',
  prenoms: 'firstNames',
  prenom: 'firstNames',
  firstnames: 'firstNames',
  datenaissance: 'birthDate',
  datedenaissance: 'birthDate',
  birthdate: 'birthDate',
  classe: 'classroom',
  classroom: 'classroom',
  annee: 'academicYear',
  anneescolaire: 'academicYear',
  academicyear: 'academicYear',
  statut: 'status',
  status: 'status',
  lieudenaissance: 'birthPlace',
  birthplace: 'birthPlace',
  sexe: 'sex',
  sex: 'sex',
  adresse: 'address',
  address: 'address',
  nomtuteur: 'guardianName',
  nomparent: 'guardianName',
  guardianname: 'guardianName',
  telephonetuteur: 'guardianPhone',
  telephoneparent: 'guardianPhone',
  guardianphone: 'guardianPhone',
};

const headers = [
  'matricule',
  'nom',
  'prenoms',
  'date_naissance',
  'classe',
  'annee_scolaire',
  'statut',
  'lieu_naissance',
  'sexe',
  'adresse',
  'nom_tuteur',
  'telephone_tuteur',
];

const inputClass =
  'h-11 w-full rounded-lg border-border bg-background px-3 text-sm text-foreground focus-visible:border-primary focus-visible:ring-primary/20';

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]/g, '');
}

function parseRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Le fichier contient un champ entre guillemets qui n’est pas fermé.');
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text: string) {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === '\n' || character === '\r')) {
      break;
    } else if (!quoted && character === ',') commas += 1;
    else if (!quoted && character === ';') semicolons += 1;
    else if (!quoted && character === '\t') tabs += 1;
  }
  return tabs > semicolons && tabs > commas ? '\t' : semicolons >= commas ? ';' : ',';
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed) ??
    /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const year = match[1].length === 4 ? Number(match[1]) : Number(match[3]);
  const month = Number(match[1].length === 4 ? match[2] : match[2]);
  const day = Number(match[1].length === 4 ? match[3] : match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseStudentCsv(text: string): ParsedRow[] {
  const delimiter = detectDelimiter(text);
  const rows = parseRecords(text, delimiter);
  if (rows.length === 0) throw new Error('Le fichier CSV est vide.');
  if (rows.length - 1 > 500) throw new Error('Le fichier ne peut pas contenir plus de 500 élèves à importer.');

  return parseStudentRows(rows);
}

function parseStudentRows(rows: string[][]): ParsedRow[] {
  if (rows.length === 0) throw new Error('Le fichier est vide.');
  const normalizedHeaders = rows[0].map(normalizeHeader);
  const fieldIndexes = new Map<number, keyof StudentCsvData>();
  normalizedHeaders.forEach((header, index) => {
    const field = fields[header];
    if (field) fieldIndexes.set(index, field);
  });
  const mappedFields = new Set(fieldIndexes.values());
  const missing = (['lastName', 'firstNames', 'birthDate'] as const)
    .filter((field) => !mappedFields.has(field));
  if (missing.length) {
    throw new Error(`Colonnes obligatoires manquantes : ${missing.map((field) =>
      field === 'lastName' ? 'nom' : field === 'firstNames' ? 'prenoms' : 'date_naissance',
    ).join(', ')}.`);
  }

  const seenMatricules = new Set<string>();
  const seenIdentities = new Set<string>();
  return rows.slice(1).map((cells, index) => {
    const values: Partial<StudentCsvData> = {};
    for (const [column, field] of fieldIndexes) {
      const value = cells[column]?.trim() ?? '';
      if (value) {
        if (field === 'birthDate') {
          const date = parseDate(value);
          if (!date) {
            return {
              line: index + 2,
              data: null,
              error: 'Date de naissance obligatoire ou invalide (formats acceptés : AAAA-MM-JJ ou JJ/MM/AAAA)',
            };
          }
          values[field] = date;
        } else if (field === 'status') {
          const status = normalizeHeader(value);
          const statuses: Record<string, StudentCsvData['status']> = {
            nouveau: 'NOUVEAU',
            redoublant: 'REDOUBLANT',
            redouble: 'REDOUBLANT',
            transfere: 'TRANSFERE',
          };
          if (!statuses[status]) {
            return { line: index + 2, data: null, error: 'Statut invalide (NOUVEAU, REDOUBLANT ou TRANSFERE)' };
          }
          values.status = statuses[status];
        } else {
          Object.assign(values, { [field]: value });
        }
      }
    }

    const data = { status: 'NOUVEAU' as const, ...values } as StudentCsvData;
    const missingValues = [
      (!data.lastName || data.lastName.length < 2) && 'nom (2 caractères minimum)',
      (!data.firstNames || data.firstNames.length < 2) && 'prénoms (2 caractères minimum)',
      !data.birthDate && 'date de naissance',
    ].filter(Boolean);
    if (missingValues.length) {
      return { line: index + 2, data: null, error: `Champs obligatoires manquants : ${missingValues.join(', ')}` };
    }
    const matriculeKey = data.matricule?.toLocaleUpperCase('fr-FR');
    const identityKey = [
      normalizeHeader(data.lastName),
      normalizeHeader(data.firstNames),
      data.birthDate,
    ].join('|');
    const duplicate = Boolean(
      (matriculeKey && seenMatricules.has(matriculeKey)) || seenIdentities.has(identityKey),
    );
    if (matriculeKey) seenMatricules.add(matriculeKey);
    seenIdentities.add(identityKey);
    return {
      line: index + 2,
      data,
      ...(duplicate ? { duplicate: true, error: 'Matricule ou identité répété dans le fichier' } : {}),
    };
  });
}

export async function parseStudentXlsx(file: File): Promise<ParsedRow[]> {
  const sheet = await readSheet(file, 1);
  if (sheet.length - 1 > 500) throw new Error('Le fichier ne peut pas contenir plus de 500 élèves à importer.');
  const rows = sheet.map((row) => row.map((cell) => {
    if (cell instanceof Date) {
      return `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, '0')}-${String(cell.getDate()).padStart(2, '0')}`;
    }
    return cell === null ? '' : String(cell);
  }));
  return parseStudentRows(rows);
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type ExcelCell = string | number | boolean | Date | null;

async function downloadExcel(filename: string, rows: ExcelCell[][]) {
  await writeXlsxFile(rows, { sheet: 'Élèves' }).toFile(filename);
}

async function lireReponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as T;
}

function lireFichier(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Le contenu du fichier CSV est illisible.'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Impossible de lire le fichier CSV.'));
    reader.readAsText(file, 'UTF-8');
  });
}

export function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ matricule: '', lastName: '', firstNames: '', birthDate: '' });
  const [preview, setPreview] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (query = search) => {
    const response = await api.fetch(`/api/students${query ? `?search=${encodeURIComponent(query)}` : ''}`);
    const body = await lireReponse<{ students: Student[] }>(response, 'Impossible de charger les élèves');
    setStudents(body.students);
  }, [search]);

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Erreur de chargement'));
  }, [load]);

  const previewCounts = useMemo(() => {
    const rows = preview ?? [];
    const ready = (row: ParsedRow) =>
      Boolean(
        row.data &&
        !row.error &&
        (row.action === 'CREATE' ||
          ((row.action === 'LINK' || row.action === 'UPDATE') && row.candidateId)),
      );
    return {
      valid: rows.filter(ready).length,
      skipped: rows.filter((row) => !ready(row)).length,
    };
  }, [preview]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const response = await api.fetch('/api/students', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          matricule: form.matricule.trim() || undefined,
        }),
      });
      await lireReponse(response, 'Impossible de créer l’élève');
      setForm({ matricule: '', lastName: '', firstNames: '', birthDate: '' });
      setMessage('Élève créé.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer l’élève');
    }
  };

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(null);
    setMessage(null);
    setPreview(null);
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Le fichier dépasse la taille maximale de 5 Mo.');
      const localRows = file.name.toLocaleLowerCase('fr-FR').endsWith('.xlsx')
        ? await parseStudentXlsx(file)
        : file.name.toLocaleLowerCase('fr-FR').endsWith('.csv')
          ? parseStudentCsv(await lireFichier(file))
          : (() => { throw new Error('Format non accepté. Choisissez un fichier CSV ou Excel (.xlsx).'); })();
      setPreviewing(true);
      const response = await api.fetch('/api/students/import/preview', {
        method: 'POST',
        body: JSON.stringify({
          students: localRows.map((row) => ({ row: row.line, student: row.data ?? {} })),
        }),
      });
      const serverPreview = await lireReponse<{
        rows: {
          row: number;
          status: 'READY' | 'DUPLICATE' | 'UPDATE' | 'ERROR';
          error: string | null;
          suggestedAction: 'CREATE' | 'LINK' | 'UPDATE';
          suggestedCandidateId: string | null;
          candidates: ImportCandidate[];
          classroom: unknown;
        }[];
      }>(response, 'Impossible de vérifier le fichier');
      const byRow = new Map(serverPreview.rows.map((row) => [row.row, row]));
      setPreview(localRows.map((row) => {
        const checked = byRow.get(row.line);
        if (row.error || !checked) return row;
        return {
          ...row,
          error: checked.error ?? undefined,
          duplicate: checked.status === 'DUPLICATE',
          candidates: checked.candidates,
          ...(checked.status === 'READY'
            ? { action: 'CREATE' as const }
            : checked.status === 'UPDATE' && checked.suggestedCandidateId
              ? { action: 'UPDATE' as const, candidateId: checked.suggestedCandidateId }
              : {}),
        };
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de lire le fichier');
    } finally {
      setPreviewing(false);
    }
  };

  const importStudents = async () => {
    if (!preview) return;
    const rows = preview.filter((row) =>
      row.data &&
      !row.error &&
      (row.action === 'CREATE' ||
        ((row.action === 'LINK' || row.action === 'UPDATE') && row.candidateId)),
    );
    if (rows.length === 0) {
      setError('Aucune ligne valide à importer.');
      return;
    }
    setError(null);
    setMessage(null);
    setImporting(true);
    try {
      const response = await api.fetch('/api/students/import', {
        method: 'POST',
        body: JSON.stringify({
          students: rows.map((row) => ({
            row: row.line,
            student: row.data,
            action: row.action ?? 'CREATE',
            ...(row.candidateId ? { candidateId: row.candidateId } : {}),
          })),
        }),
      });
      const result = await lireReponse<{
        importedCount: number;
        createdCount: number;
        linkedCount: number;
        updatedCount: number;
        skippedCount: number;
        results: ImportResult[];
      }>(response, 'Import impossible');
      const skipped = result.results.filter((item) => item.status === 'skipped');
      const previewSkipped = preview.filter((row) =>
        !row.data ||
        row.error ||
        (row.action !== 'CREATE' &&
          !((row.action === 'LINK' || row.action === 'UPDATE') && row.candidateId)),
      )
        .map((row) =>
          `ligne ${row.line}: ${row.error ?? 'doublon non confirmé'}`,
        );
      const skippedDetails = [
        ...previewSkipped,
        ...skipped.map((item) => `ligne ${item.row}: ${item.error}`),
      ];
      setMessage(
        `${result.createdCount} fiche(s) créée(s), ${result.linkedCount} dossier(s) rattaché(s), ` +
          `${result.updatedCount} fiche(s) mise(s) à jour, ` +
          `${result.skippedCount + previewSkipped.length} ligne(s) ignorée(s).` +
          (skippedDetails.length ? ` ${skippedDetails.join(' · ')}` : ''),
      );
      setPreview(null);
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import impossible');
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = () => {
    downloadCsv('eleves.csv', [
      headers,
      ...students.map((student) => [
        student.matricule,
        student.lastName,
        student.firstNames,
        student.birthDate ? student.birthDate.slice(0, 10) : '',
        student.enrollments[0]?.classroom.name ?? '',
        student.enrollments[0]?.classroom.academicYear.name ?? '',
        student.enrollments[0]?.isRepeating
          ? 'REDOUBLANT'
          : student.enrollments[0]?.entryType === 'TRANSFERRED'
            ? 'TRANSFERE'
            : student.enrollments[0]?.entryType === 'NEW'
              ? 'NOUVEAU'
              : '',
        student.birthPlace,
        student.sex,
        student.address,
        student.guardianName,
        student.guardianPhone,
      ]),
    ]);
  };

  const exportExcel = async () => {
    try {
      await downloadExcel('eleves.xlsx', [
        headers,
        ...students.map((student) => [
          student.matricule,
          student.lastName,
          student.firstNames,
          student.birthDate?.slice(0, 10) ?? '',
          student.enrollments[0]?.classroom.name ?? '',
          student.enrollments[0]?.classroom.academicYear.name ?? '',
          student.enrollments[0]?.isRepeating
            ? 'REDOUBLANT'
            : student.enrollments[0]?.entryType === 'TRANSFERRED'
              ? 'TRANSFERE'
              : student.enrollments[0]?.entryType === 'NEW'
                ? 'NOUVEAU'
                : '',
          student.birthPlace ?? '',
          student.sex ?? '',
          student.address ?? '',
          student.guardianName ?? '',
          student.guardianPhone ?? '',
        ]),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export Excel impossible');
    }
  };

  const downloadTemplate = async () => {
    try {
      await downloadExcel('modele-import-eleves.xlsx', [headers]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Téléchargement du modèle impossible');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">Élèves</h1>
          <p className="mt-2 text-sm text-muted-foreground">Gestion, import et export des dossiers élèves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void downloadTemplate()}>
            Télécharger le modèle Excel
          </Button>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={students.length === 0}>
            <Download aria-hidden="true" className="h-4 w-4" />
            Exporter CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportExcel()}
            disabled={students.length === 0}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Exporter Excel
          </Button>
        </div>
      </header>

      <Card className="gap-0 border-border shadow-sm">
        <CardHeader>
          <CardTitle>Créer un élève</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void create(event)}
            className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          >
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Matricule (facultatif)
              <Input aria-label="Matricule facultatif" placeholder="Vide = attribution ELI automatique" className={inputClass}
                value={form.matricule} onChange={(event) => setForm({ ...form, matricule: event.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Nom
              <Input required aria-label="Nom" placeholder="Nom de famille" className={inputClass}
                value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Prénoms
              <Input required aria-label="Prénoms" placeholder="Prénom(s)" className={inputClass}
                value={form.firstNames} onChange={(event) => setForm({ ...form, firstNames: event.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Date de naissance
              <Input required aria-label="Date de naissance" type="date" className={inputClass}
                value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} />
            </label>
            <Button type="submit" className="h-11 px-5">Créer</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="gap-0 border-border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp aria-hidden="true" className="h-5 w-5 text-primary" />
            Importer des élèves depuis un fichier
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Fichiers Excel (.xlsx) ou CSV de 5 Mo maximum. Nom, prénoms et date de naissance sont
            obligatoires; le matricule, la classe, l’année et le statut sont reconnus s’ils sont fournis.
            Les doublons potentiels exigent une confirmation de rattachement avant toute inscription.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Fichier CSV ou Excel des élèves"
              className="h-11 max-w-full file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
              onChange={(event) => void selectFile(event)}
            />
            {preview && (
              <Button
                type="button"
                onClick={() => void importStudents()}
                disabled={importing || previewing || previewCounts.valid === 0}
              >
                {importing ? 'Import en cours…' : `Importer ${previewCounts.valid} ligne(s) confirmée(s)`}
              </Button>
            )}
          </div>
          {previewing ? <p role="status" className="text-sm text-muted-foreground">Vérification des doublons et des classes…</p> : null}
          {preview && (
            <div className="space-y-3">
              <p role="status" className="text-sm text-foreground">
                Aperçu : {previewCounts.valid} ligne(s) prêtes, {previewCounts.skipped} ligne(s) à ignorer.
              </p>
              <ul className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-accent/50 bg-accent/15 p-3 text-sm text-foreground">
                {preview.map((row) => (
                  <li key={row.line} className="space-y-2 border-b border-accent/30 pb-2 last:border-0">
                    <p>
                      Ligne {row.line}
                      {row.error
                        ? ` — ${row.error}`
                        : row.action === 'UPDATE'
                          ? ' — mise à jour de la fiche existante'
                          : row.duplicate
                            ? ' — Doublon potentiel'
                            : ' — prête'}
                    </p>
                    {row.duplicate && row.candidates?.length ? (
                      <fieldset className="ml-3 space-y-1">
                        <legend className="text-xs font-medium">
                          Confirmer le rattachement à une fiche existante :
                        </legend>
                        {row.candidates.map((candidate) => (
                          <label key={candidate.id} className="flex items-start gap-2 text-xs">
                            <input
                              type="radio"
                              name={`candidate-${row.line}`}
                              disabled={Boolean(candidate.deletedAt) || Boolean(row.error)}
                              checked={row.candidateId === candidate.id}
                              onChange={() => setPreview((current) => current?.map((item) =>
                                item.line === row.line
                                  ? { ...item, action: 'LINK', candidateId: candidate.id }
                                  : item,
                              ) ?? null)}
                            />
                            <span>
                              {candidate.lastName} {candidate.firstNames} · {candidate.matricule}
                              {candidate.birthDate ? ` · ${candidate.birthDate.slice(0, 10)}` : ''}
                              {candidate.deletedAt ? ' · fiche archivée' : ''}
                              {candidate.activeEnrollments.map((enrollment) =>
                                ` · ${enrollment.classroomName} (${enrollment.academicYearName})`,
                              )}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-primary">{message}</p>}

      <section>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void load().catch((cause) =>
              setError(cause instanceof Error ? cause.message : 'Recherche impossible'),
            );
          }}
        >
          <label className="relative min-w-[220px] flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Rechercher un élève"
              className={`${inputClass} pl-9`}
              placeholder="Rechercher par matricule ou nom"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Button type="submit" variant="outline">Rechercher</Button>
        </form>
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Users aria-hidden="true" className="h-4 w-4" />
          {students.length} élève(s){search ? ' dans les résultats' : ''}
        </div>
        <Card className="gap-0 overflow-hidden border-border py-0 shadow-sm">
          <Table className="min-w-[700px] text-left">
            <TableHeader className="bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-12 px-5">Matricule</TableHead>
                <TableHead className="h-12 px-5">Élève</TableHead>
                <TableHead className="h-12 px-5">Date de naissance</TableHead>
                <TableHead className="h-12 px-5">Classe active</TableHead>
                <TableHead className="h-12 px-5">Statut</TableHead>
                <TableHead className="h-12 px-5">Dossier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Aucun élève trouvé.
                  </TableCell>
                </TableRow>
              ) : students.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="px-5 py-3 font-mono text-xs">{student.matricule}</TableCell>
                  <TableCell className="px-5 py-3 font-semibold text-foreground">
                    {student.lastName} {student.firstNames}
                  </TableCell>
                  <TableCell className="px-5 py-3 text-muted-foreground">
                    {student.birthDate?.slice(0, 10) ?? 'Non renseignée'}
                  </TableCell>
                  <TableCell className="px-5 py-3 text-muted-foreground">
                    {student.enrollments[0]?.classroom.name ?? '—'}
                  </TableCell>
                  <TableCell className="px-5 py-3 text-muted-foreground">
                    {student.enrollments[0]?.isRepeating
                      ? 'Redoublant'
                      : student.enrollments[0]?.entryType === 'TRANSFERRED'
                        ? 'Transféré'
                        : student.enrollments[0]?.entryType === 'NEW'
                          ? 'Nouveau'
                          : 'Non renseigné'}
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/eleves/${student.id}`}>Détail</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
