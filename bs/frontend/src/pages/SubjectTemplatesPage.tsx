import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { chargerClasses, type Classe } from '@/lib/notes';

type Modele = {
  niveau: string;
  nom: string;
  matieres: { nom: string; coefficient: string; groupe?: boolean; option?: boolean; actif?: boolean }[];
};

type ResultatApplication = {
  modeles: Modele[];
  ajoutees: number;
};

async function lireReponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as T;
}

export function SubjectTemplatesPage() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [resultat, setResultat] = useState<ResultatApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void chargerClasses()
      .then((reponse) => {
        setClasses(reponse.classes);
        setClassroomId(reponse.classes.find((classe) => classe.academicYear.status === 'ACTIVE')?.id ?? reponse.classes[0]?.id ?? '');
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Chargement impossible'))
      .finally(() => setLoading(false));
  }, []);

  const appliquer = useCallback(async () => {
    if (!classroomId) return;
    setSaving(true);
    setError(null);
    setResultat(null);
    try {
      const response = await api.fetch(`/api/schooling/classes/${classroomId}/apply-subject-templates`, {
        method: 'POST',
      });
      setResultat(await lireReponse<ResultatApplication>(response, 'Application impossible'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Application impossible');
    } finally {
      setSaving(false);
    }
  }, [classroomId]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">Modèles de matières</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Appliquez le modèle officiel du niveau (6e, 5e, 4e, 3e). Les affectations déjà présentes ne
          sont pas écrasées.
        </p>
      </header>

      {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

      <Card className="gap-0 border-border py-0 shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <label className="min-w-64 text-sm">
            <span className="text-muted-foreground">Classe</span>
            <select
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={classroomId}
              onChange={(event) => setClassroomId(event.target.value)}
            >
              {loading ? <option value="">Chargement…</option> : null}
              {!loading && classes.length === 0 ? <option value="">Aucune classe</option> : null}
              {classes.map((classe) => (
                <option key={classe.id} value={classe.id}>
                  {classe.name} — {classe.level?.name ?? 'sans niveau'} ({classe.academicYear.name})
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => void appliquer()} disabled={!classroomId || saving}>
            {saving ? 'Application…' : 'Appliquer le modèle'}
          </Button>
        </CardContent>
      </Card>

      {resultat ? (
        <section className="space-y-3" aria-live="polite">
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            {resultat.ajoutees} nouvelle(s) matière(s) affectée(s) à la classe.
          </p>
          {resultat.modeles.map((modele) => (
            <Card key={modele.niveau} className="border-border shadow-sm">
              <CardContent className="p-4">
                <p className="font-semibold text-foreground">{modele.niveau} — {modele.nom}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {modele.matieres
                    .filter((matiere) => !matiere.groupe && !matiere.option && matiere.actif !== false)
                    .map((matiere) => `${matiere.nom} (${matiere.coefficient})`)
                    .join(' · ')}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  );
}
