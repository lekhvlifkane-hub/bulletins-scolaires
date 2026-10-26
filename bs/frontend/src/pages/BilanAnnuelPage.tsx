import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { chargerAnnees, chargerClasses, type Classe, type YearSemestre } from '@/lib/notes';
import {
  LIBELLES_STATUT_BULLETIN,
  ROLES_EDITION_BULLETIN,
  chargerBilansAnnuels,
  genererBilanAnnuel,
  publierBilansAnnuels,
  telechargerPdf,
  urlPdfBilansAnnuels,
  type BilanResume,
  type LigneBilan,
  type ListeBilans,
} from '@/lib/bulletins';

/**
 * Page « Bilan annuel » : moyenne annuelle et rang par élève, à partir des bulletins
 * des deux semestres. La formule (poids des semestres, conduite en cas de semestre
 * manquant) est configurée côté serveur et enregistrée dans le snapshot ; l'interface
 * ne calcule rien et affiche « non calculable » avec le motif renvoyé.
 */

function dateCourte(valeur: string | null): string {
  if (!valeur) return '—';
  return new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function BilanAnnuelPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const peutEditer = user ? ROLES_EDITION_BULLETIN.includes(user.role) : false;

  const [classes, setClasses] = useState<Classe[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [classroomId, setClassroomId] = useState(params.get('classroomId') ?? '');
  const [liste, setListe] = useState<ListeBilans | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [chargement, setChargement] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([chargerClasses(), chargerAnnees()]);
      setClasses(c.classes);
      setAnnees(a.years);
      if (!classroomId && c.classes[0]) setClassroomId(c.classes[0].id);
    })().catch((e) => setErreur((e as Error).message));
    // Référentiels chargés une fois à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const classe = useMemo(() => classes.find((c) => c.id === classroomId), [classes, classroomId]);

  /** L'année scolaire est celle de la classe choisie : une classe n'appartient qu'à une année. */
  const academicYearId = classe?.academicYear.id ?? params.get('academicYearId') ?? '';

  const charger = useCallback(async () => {
    if (!classroomId || !academicYearId) {
      setListe(null);
      return;
    }
    setChargement(true);
    try {
      const donnees = await chargerBilansAnnuels({ classroomId, academicYearId });
      setListe(donnees);
      setSelection([]);
      setErreur(null);
    } catch (e) {
      setListe(null);
      setErreur((e as Error).message);
    } finally {
      setChargement(false);
    }
  }, [classroomId, academicYearId]);

  useEffect(() => {
    void charger();
  }, [charger]);

  useEffect(() => {
    if (!classroomId) return;
    setParams((actuels) => {
      const suivant = new URLSearchParams(actuels);
      suivant.set('classroomId', classroomId);
      suivant.set('academicYearId', academicYearId);
      return suivant;
    });
  }, [classroomId, academicYearId, setParams]);

  const lignes = liste?.lignes ?? [];
  const bilansIds = lignes
    .filter((l) => selection.includes(l.enrollmentId) && l.bilan)
    .map((l) => l.bilan!.id);

  const basculer = (enrollmentId: string) => {
    setSelection((actuel) =>
      actuel.includes(enrollmentId)
        ? actuel.filter((id) => id !== enrollmentId)
        : [...actuel, enrollmentId]
    );
  };

  const cocherTout = (coche: boolean) => {
    setSelection(coche ? lignes.filter((l) => l.bilan).map((l) => l.enrollmentId) : []);
  };

  async function surGenerer(ligne: LigneBilan) {
    setEnCours(true);
    try {
      const { bilan } = await genererBilanAnnuel(ligne.enrollmentId, academicYearId);
      setMessage(`Bilan ${ligne.nom} ${ligne.prenoms} : ${libelleMoyenne(bilan)} (v${bilan.version}).`);
      setErreur(null);
      await charger();
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  async function surGenererClasse() {
    setEnCours(true);
    setMessage(null);
    let faits = 0;
    const ignores: string[] = [];
    for (const ligne of lignes) {
      if (ligne.bilan?.statut === 'PUBLIE') {
        ignores.push(`${ligne.nom} ${ligne.prenoms} : bilan publié et figé`);
        continue;
      }
      try {
        await genererBilanAnnuel(ligne.enrollmentId, academicYearId);
        faits += 1;
      } catch (e) {
        ignores.push(`${ligne.nom} ${ligne.prenoms} : ${(e as Error).message}`);
      }
    }
    try {
      await charger();
    } finally {
      setEnCours(false);
    }
    setMessage(
      `${faits} bilan(s) calculé(s)` + (ignores.length ? ` · ${ignores.length} non traité(s) : ${ignores[0]}` : '.')
    );
  }

  async function surPublier() {
    if (bilansIds.length === 0) return;
    if (!window.confirm(`Figer définitivement ${bilansIds.length} bilan(s) annuel(s) ?`)) return;
    setEnCours(true);
    try {
      const { publies, dejaPublies } = await publierBilansAnnuels(bilansIds);
      setMessage(
        `${publies} bilan(s) figé(s)` + (dejaPublies ? `, ${dejaPublies} déjà publié(s).` : '.')
      );
      setErreur(null);
      await charger();
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  async function surImprimer(mode: 'selection' | 'classe') {
    if (mode === 'selection' && bilansIds.length === 0) {
      setErreur('Sélectionnez au moins un bilan à imprimer.');
      return;
    }
    setEnCours(true);
    try {
      const url =
        mode === 'selection'
          ? urlPdfBilansAnnuels({ ids: bilansIds })
          : urlPdfBilansAnnuels({ classroomId, academicYearId });
      const pdf = await telechargerPdf(url);
      setMessage(`PDF téléchargé : ${pdf.nom}${pdf.pages ? ` (${pdf.pages} page(s))` : ''}.`);
      setErreur(null);
    } catch (e) {
      setMessage(null);
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  const poids = liste?.anneeScolaire.semestres.length
    ? `${liste.anneeScolaire.semestres.map((s) => s.nom).join(' + ')}`
    : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bilan annuel</h1>
        <p className="text-sm text-muted-foreground">
          Moyenne annuelle et rang calculés par le serveur à partir des bulletins S1 et S2. Un bilan
          publié est figé : il se corrige par une nouvelle version, comme le bulletin.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="text-muted-foreground">Classe</span>
          <select
            className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm">
          <span className="text-muted-foreground">Année scolaire</span>
          <span className="mt-1 block font-medium">
            {annees.find((a) => a.id === academicYearId)?.name ?? '—'}
          </span>
        </p>
        {liste ? (
          <p className="text-sm text-muted-foreground">
            {liste.anneeScolaire.nom} · {poids || 'aucun semestre'}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to="/bulletins"
          >
            Bulletins
          </Link>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to={`/comparaison-semestres?classroomId=${classroomId}&academicYearId=${academicYearId}`}
          >
            Comparaison S1 / S2
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {peutEditer ? (
          <>
            <Button size="sm" onClick={() => void surGenererClasse()} disabled={enCours || chargement}>
              Calculer les bilans de la classe
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void surPublier()}
              disabled={enCours || bilansIds.length === 0}
            >
              Publier la sélection ({selection.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void surImprimer('selection')}
              disabled={enCours || bilansIds.length === 0}
            >
              Imprimer la sélection
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void surImprimer('classe')} disabled={enCours}>
          Imprimer la classe
        </Button>
        {!peutEditer ? (
          <span className="text-sm text-muted-foreground">
            Lecture seule : calculer, publier ou corriger un bilan est réservé à l’administrateur et au
            surveillant général.
          </span>
        ) : null}
      </div>

      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {chargement ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}

      {liste ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {peutEditer ? (
                  <th className="p-3 text-left">
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner"
                      className="h-4 w-4 rounded border-input"
                      checked={selection.length > 0 && selection.length === lignes.filter((l) => l.bilan).length}
                      onChange={(event) => cocherTout(event.target.checked)}
                    />
                  </th>
                ) : null}
                <th className="p-3 text-left">Matricule</th>
                <th className="p-3 text-left">Élève</th>
                <th className="p-3 text-right">Semestre 1</th>
                <th className="p-3 text-right">Semestre 2</th>
                <th className="p-3 text-right">Moyenne annuelle</th>
                <th className="p-3 text-right">Rang annuel</th>
                <th className="p-3 text-left">Statut</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lignes.length === 0 ? (
                <tr>
                  <td colSpan={peutEditer ? 9 : 8} className="p-3 text-muted-foreground">
                    Aucun élève actif dans cette classe.
                  </td>
                </tr>
              ) : (
                lignes.map((ligne) => {
                  const bilan = ligne.bilan;
                  return (
                    <tr key={ligne.enrollmentId} className="border-t border-border align-top">
                      {peutEditer ? (
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${ligne.nom}`}
                            className="h-4 w-4 rounded border-input"
                            disabled={!bilan}
                            checked={Boolean(bilan) && selection.includes(ligne.enrollmentId)}
                            onChange={() => basculer(ligne.enrollmentId)}
                          />
                        </td>
                      ) : null}
                      <td className="p-3">{ligne.matricule}</td>
                      <td className="p-3">
                        <Link className="hover:underline" to={`/eleves/${ligne.studentId}`}>
                          {ligne.nom} {ligne.prenoms}
                        </Link>
                        {bilan?.partiel ? (
                          <p className="text-xs text-accent-foreground">bilan partiel</p>
                        ) : null}
                        {bilan && bilan.motifs.length > 0 ? (
                          <p className="text-xs text-muted-foreground">{bilan.motifs.join(' · ')}</p>
                        ) : null}
                      </td>
                      <td className="p-3 text-right">
                        {bilan?.moyenneS1Affichee ?? bilan?.moyenneS1 ?? '—'}
                      </td>
                      <td className="p-3 text-right">
                        {bilan?.moyenneS2Affichee ?? bilan?.moyenneS2 ?? '—'}
                      </td>
                      <td
                        className="p-3 text-right font-medium"
                        title={
                          bilan?.moyenneAnnuelleExacte
                            ? `Valeur exacte : ${bilan.moyenneAnnuelleExacte}`
                            : undefined
                        }
                      >
                        {bilan ? libelleMoyenne(bilan) : '—'}
                      </td>
                      <td className="p-3 text-right">
                        {bilan?.rangAnnuel ?? '—'}
                        {bilan ? (
                          <span className="text-xs text-muted-foreground"> /{bilan.effectif}</span>
                        ) : null}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {bilan
                          ? `${LIBELLES_STATUT_BULLETIN[bilan.statut]} · v${bilan.version} · ${dateCourte(bilan.genereLe)}`
                          : 'Aucun bilan'}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {bilan ? (
                            <Link
                              className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
                              to={`/bilan-annuel/${bilan.id}`}
                            >
                              Ouvrir
                            </Link>
                          ) : null}
                          {peutEditer ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs"
                              onClick={() => void surGenerer(ligne)}
                              disabled={enCours || bilan?.statut === 'PUBLIE'}
                              title={
                                bilan?.statut === 'PUBLIE'
                                  ? 'Bilan publié et figé : régénération impossible'
                                  : 'Recalculer à partir des bulletins des deux semestres'
                              }
                            >
                              {bilan ? 'Recalculer' : 'Calculer'}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        La pondération S1 / S2 et la conduite tenant à un semestre manquant sont des paramètres
        d’établissement : elles sont enregistrées dans le snapshot du bilan, pas déduites ici.
      </p>
    </div>
  );
}

/** Une moyenne absente reste « non calculable » : aucun zéro implicite. */
export function libelleMoyenne(bilan: BilanResume): string {
  if (!bilan.calculable) return 'non calculable';
  return bilan.moyenneAnnuelleAffichee ?? bilan.moyenneAnnuelle ?? 'non calculable';
}
