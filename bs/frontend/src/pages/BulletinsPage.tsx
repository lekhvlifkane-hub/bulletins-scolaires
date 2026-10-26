import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { chargerAnnees, chargerClasses, type Classe, type YearSemestre } from '@/lib/notes';
import {
  LIBELLES_STATUT_BULLETIN,
  ROLES_EDITION_BULLETIN,
  chargerBulletins,
  genererBulletin,
  genererBulletinsClasse,
  publierBulletins,
  telechargerPdf,
  urlPdfBulletins,
  type LigneBulletin,
  type ListeBulletins,
} from '@/lib/bulletins';

/**
 * Page « Bulletins » (S1 / S2).
 *
 * Rien n'est calculé ici : la liste affiche le snapshot figé renvoyé par le serveur, et le
 * PDF est composé côté serveur. Une moyenne absente reste « Non calculable » — jamais un 0.
 */

function dateCourte(valeur: string | null): string {
  if (!valeur) return '—';
  return new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function BulletinsPage() {
  const { user } = useAuth();
  const peutEditer = user ? ROLES_EDITION_BULLETIN.includes(user.role) : false;

  const [classes, setClasses] = useState<Classe[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [liste, setListe] = useState<ListeBulletins | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [etat, setEtat] = useState<'charge' | 'chargement' | 'enregistrement'>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([chargerClasses(), chargerAnnees()]);
      setClasses(c.classes);
      setAnnees(a.years);
      if (c.classes[0]) setClassroomId(c.classes[0].id);
    })().catch((e) => {
      setErreur((e as Error).message);
      setEtat('charge');
    });
  }, []);

  const classe = useMemo(() => classes.find((c) => c.id === classroomId), [classes, classroomId]);
  const semestres = useMemo(
    () => annees.find((a) => a.id === classe?.academicYear.id)?.semesters ?? [],
    [annees, classe]
  );

  useEffect(() => {
    if (semestres.length && !semestres.some((s) => s.id === semesterId)) {
      setSemesterId(semestres[0].id);
    }
  }, [semestres, semesterId]);

  const recharger = useCallback(async () => {
    if (!classroomId || !semesterId) return;
    setEtat('chargement');
    setErreur(null);
    try {
      const reponse = await chargerBulletins({ classroomId, semesterId });
      setListe(reponse);
      setSelection([]);
    } catch (e) {
      setListe(null);
      setErreur((e as Error).message);
    } finally {
      setEtat('charge');
    }
  }, [classroomId, semesterId]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const lignes = liste?.lignes ?? [];
  const bulletinsIds = lignes
    .filter((l) => selection.includes(l.enrollmentId) && l.bulletin)
    .map((l) => l.bulletin!.id);

  const cocherTout = (coche: boolean) => {
    setSelection(coche ? lignes.filter((l) => l.bulletin).map((l) => l.enrollmentId) : []);
  };

  const basculer = (enrollmentId: string) => {
    setSelection((actuel) =>
      actuel.includes(enrollmentId)
        ? actuel.filter((id) => id !== enrollmentId)
        : [...actuel, enrollmentId]
    );
  };

  const signaler = (texte: string) => {
    setMessage(texte);
    setErreur(null);
  };

  const surErreur = (e: Error) => {
    setMessage(null);
    setErreur(e.message);
  };

  async function surGenerer(ligne: LigneBulletin) {
    if (!semesterId) return;
    setEtat('enregistrement');
    try {
      const { bulletin, cree } = await genererBulletin(ligne.enrollmentId, semesterId);
      signaler(
        `Bulletin ${ligne.nom} ${ligne.prenoms} ${cree ? 'créé' : 'régénéré'} (v${bulletin.version}, brouillon).`
      );
      await recharger();
    } catch (e) {
      surErreur(e as Error);
    } finally {
      setEtat('charge');
    }
  }

  async function surGenererClasse() {
    if (!classroomId || !semesterId) return;
    setEtat('enregistrement');
    try {
      const lot = await genererBulletinsClasse(classroomId, semesterId);
      signaler(
        `Classe : ${lot.generes} bulletin(s) créé(s), ${lot.maj} mis à jour` +
          (lot.ignores.length ? `, ${lot.ignores.length} ignoré(s) — ${lot.ignores[0].motif}` : '.')
      );
      await recharger();
    } catch (e) {
      surErreur(e as Error);
    } finally {
      setEtat('charge');
    }
  }

  async function surPublier() {
    if (bulletinsIds.length === 0) return;
    if (!window.confirm(`Figer définitivement ${bulletinsIds.length} bulletin(s) publié(s) ?`)) return;
    setEtat('enregistrement');
    try {
      const { publies, dejaPublies } = await publierBulletins(bulletinsIds);
      signaler(`${publies} bulletin(s) publié(s) et figé(s)` + (dejaPublies ? `, ${dejaPublies} déjà publié(s).` : '.'));
      await recharger();
    } catch (e) {
      surErreur(e as Error);
    } finally {
      setEtat('charge');
    }
  }

  async function surImprimer(mode: 'selection' | 'classe') {
    if (!liste) return;
    const url =
      mode === 'selection'
        ? urlPdfBulletins({ ids: bulletinsIds })
        : urlPdfBulletins({ classroomId, semesterId });
    if (mode === 'selection' && bulletinsIds.length === 0) {
      setErreur('Sélectionnez au moins un bulletin à imprimer.');
      return;
    }
    setEtat('enregistrement');
    try {
      const pdf = await telechargerPdf(url);
      signaler(
        `PDF téléchargé : ${pdf.nom}${pdf.pages ? ` (${pdf.pages} page(s))` : ''}.`
      );
    } catch (e) {
      surErreur(e as Error);
    } finally {
      setEtat('charge');
    }
  }

  const enCours = etat === 'chargement' || etat === 'enregistrement';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bulletins scolaires</h1>
        <p className="text-sm text-muted-foreground">
          Moyennes, rangs et mentions viennent du serveur et sont figés dans le bulletin. Un bulletin
          publié ne se recalcule plus : une correction passe par une nouvelle version.
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
        <label className="text-sm">
          <span className="text-muted-foreground">Semestre</span>
          <select
            className="mt-1 block rounded-md border border-input px-2 py-2 text-sm"
            value={semesterId}
            onChange={(event) => setSemesterId(event.target.value)}
          >
            {semestres.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {liste ? `${liste.semestre.anneeScolaire} · ${liste.semestre.nom}` : '—'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to={
              classroomId && classe
                ? `/comparaison-semestres?classroomId=${classroomId}&academicYearId=${classe.academicYear.id}`
                : '/comparaison-semestres'
            }
          >
            Comparaison S1 / S2
          </Link>
          <Link
            className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
            to={
              classroomId && classe
                ? `/bilan-annuel?classroomId=${classroomId}&academicYearId=${classe.academicYear.id}`
                : '/bilan-annuel'
            }
          >
            Bilan annuel
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {peutEditer ? (
          <>
            <Button size="sm" onClick={() => void surGenererClasse()} disabled={enCours || !semesterId}>
              Générer toute la classe
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void surPublier()}
              disabled={enCours || bulletinsIds.length === 0}
            >
              Publier la sélection ({selection.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void surImprimer('selection')}
              disabled={enCours || bulletinsIds.length === 0}
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
            Lecture seule : générer, publier ou corriger un bulletin est réservé à l’administrateur et
            au surveillant général.
          </span>
        ) : null}
      </div>

      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {etat === 'chargement' ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}

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
                      checked={
                        selection.length > 0 &&
                        selection.length === lignes.filter((l) => l.bulletin).length
                      }
                      onChange={(event) => cocherTout(event.target.checked)}
                    />
                  </th>
                ) : null}
                <th className="p-3 text-left">Matricule</th>
                <th className="p-3 text-left">Élève</th>
                <th className="p-3 text-left">Statut</th>
                <th className="p-3 text-right">Moyenne générale</th>
                <th className="p-3 text-right">Rang</th>
                <th className="p-3 text-right">Moyenne de classe</th>
                <th className="p-3 text-left">Version</th>
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
                  const bulletin = ligne.bulletin;
                  return (
                    <tr key={ligne.enrollmentId} className="border-t border-border align-top">
                      {peutEditer ? (
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${ligne.nom}`}
                            className="h-4 w-4 rounded border-input"
                            disabled={!bulletin}
                            checked={Boolean(bulletin) && selection.includes(ligne.enrollmentId)}
                            onChange={() => basculer(ligne.enrollmentId)}
                          />
                        </td>
                      ) : null}
                      <td className="p-3">{ligne.matricule}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="hover:underline"
                            to={`/eleves/${ligne.studentId}`}
                          >
                            {ligne.nom} {ligne.prenoms}
                          </Link>
                          {bulletin?.incomplet ? (
                            <span className="text-xs text-accent-foreground">bulletin incomplet</span>
                          ) : null}
                        </div>
                        {bulletin && bulletin.motifs.length > 0 ? (
                          <p className="text-xs text-muted-foreground">{bulletin.motifs.join(' · ')}</p>
                        ) : null}
                      </td>
                      <td className="p-3">
                        {bulletin ? LIBELLES_STATUT_BULLETIN[bulletin.statut] : 'Aucun bulletin'}
                      </td>
                      <td
                        className="p-3 text-right font-medium"
                        title={
                          bulletin?.moyenneGeneraleExacte
                            ? `Valeur exacte : ${bulletin.moyenneGeneraleExacte}`
                            : undefined
                        }
                      >
                        {bulletin
                          ? bulletin.moyenneGeneraleAffichee ??
                            bulletin.moyenneGenerale ??
                            'Non calculable'
                          : '—'}
                      </td>
                      <td className="p-3 text-right">
                        {bulletin?.rang ?? '—'}
                        {bulletin?.motifNonClasse ? (
                          <p className="text-xs text-muted-foreground">{bulletin.motifNonClasse}</p>
                        ) : null}
                      </td>
                      <td className="p-3 text-right text-muted-foreground">
                        {bulletin
                          ? bulletin.moyenneClasseAffichee ?? bulletin.moyenneClasse ?? '—'
                          : '—'}
                        {bulletin ? (
                          <span className="text-xs"> (effectif {bulletin.effectif})</span>
                        ) : null}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {bulletin ? `v${bulletin.version} · ${dateCourte(bulletin.genereLe)}` : '—'}
                        {bulletin?.motifCorrection ? (
                          <p className="text-muted-foreground">Motif : {bulletin.motifCorrection}</p>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {bulletin ? (
                            <Link
                              className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
                              to={`/bulletins/${bulletin.id}`}
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
                              disabled={enCours || bulletin?.statut === 'PUBLIE'}
                              title={
                                bulletin?.statut === 'PUBLIE'
                                  ? 'Bulletin publié et figé : ouvrir une correction versionnée'
                                  : bulletin
                                    ? 'Recalculer le brouillon depuis les notes validées'
                                    : 'Calculer le bulletin depuis les notes validées'
                              }
                            >
                              {bulletin ? 'Régénérer' : 'Générer'}
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
        Le PDF A4 est généré par le serveur à partir du snapshot du bulletin : il ne dépend donc pas
        des paramètres modifiés depuis la génération.
      </p>
    </div>
  );
}
