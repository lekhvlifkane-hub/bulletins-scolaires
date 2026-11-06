import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">Bulletins scolaires</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Moyennes, rangs et mentions viennent du serveur et sont figés dans le bulletin. Un bulletin
          publié ne se recalcule plus : une correction passe par une nouvelle version.
        </p>
      </header>

      <Card className="gap-0 border-border py-0 shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-0 text-sm">
            <span className="text-muted-foreground">Classe</span>
            <select
              className="mt-1 block h-11 w-full max-w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 sm:w-auto"
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
          <label className="min-w-0 text-sm">
            <span className="text-muted-foreground">Semestre</span>
            <select
              className="mt-1 block h-11 w-full max-w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 sm:w-auto"
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
          <p className="flex h-11 items-center text-sm text-muted-foreground">
            {liste ? `${liste.semestre.anneeScolaire} · ${liste.semestre.nom}` : '—'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                to={
                  classroomId && classe
                    ? `/comparaison-semestres?classroomId=${classroomId}&academicYearId=${classe.academicYear.id}`
                    : '/comparaison-semestres'
                }
              >
                Comparaison S1 / S2
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link
                to={
                  classroomId && classe
                    ? `/bilan-annuel?classroomId=${classroomId}&academicYearId=${classe.academicYear.id}`
                    : '/bilan-annuel'
                }
              >
                Bilan annuel
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {peutEditer ? (
          <>
            <Button onClick={() => void surGenererClasse()} disabled={enCours || !semesterId}>
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

      {erreur ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {erreur}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-primary">
          {message}
        </p>
      ) : null}
      {etat === 'chargement' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Chargement…
        </p>
      ) : null}

      {liste ? (
        <Card className="gap-0 overflow-hidden border-border py-0 shadow-sm">
          <Table className="text-sm">
            <TableHeader className="bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <TableRow className="hover:bg-transparent">
                {peutEditer ? (
                  <TableHead className="h-12 px-3">
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
                  </TableHead>
                ) : null}
                <TableHead className="h-12 px-3">Matricule</TableHead>
                <TableHead className="h-12 px-3">Élève</TableHead>
                <TableHead className="h-12 px-3">Statut</TableHead>
                <TableHead className="h-12 px-3 text-right">Moyenne générale</TableHead>
                <TableHead className="h-12 px-3 text-right">Rang</TableHead>
                <TableHead className="h-12 px-3 text-right">Moyenne de classe</TableHead>
                <TableHead className="h-12 px-3">Version</TableHead>
                <TableHead className="h-12 px-3">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={peutEditer ? 9 : 8} className="h-24 px-3 text-center text-muted-foreground">
                    Aucun élève actif dans cette classe.
                  </TableCell>
                </TableRow>
              ) : (
                lignes.map((ligne) => {
                  const bulletin = ligne.bulletin;
                  return (
                    <TableRow key={ligne.enrollmentId} className="align-top">
                      {peutEditer ? (
                        <TableCell className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${ligne.nom}`}
                            className="h-4 w-4 rounded border-input"
                            disabled={!bulletin}
                            checked={Boolean(bulletin) && selection.includes(ligne.enrollmentId)}
                            onChange={() => basculer(ligne.enrollmentId)}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell className="px-3 py-3 font-mono text-xs">{ligne.matricule}</TableCell>
                      <TableCell className="whitespace-normal px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link className="font-semibold text-foreground hover:underline" to={`/eleves/${ligne.studentId}`}>
                            {ligne.nom} {ligne.prenoms}
                          </Link>
                          {bulletin?.incomplet ? (
                            <span className="rounded-full bg-accent/25 px-2 py-0.5 text-xs font-medium text-amber-800">
                              bulletin incomplet
                            </span>
                          ) : null}
                        </div>
                        {bulletin && bulletin.motifs.length > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">{bulletin.motifs.join(' · ')}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        {bulletin ? LIBELLES_STATUT_BULLETIN[bulletin.statut] : 'Aucun bulletin'}
                      </TableCell>
                      <TableCell
                        className="px-3 py-3 text-right font-medium"
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
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right">
                        {bulletin?.rang ?? '—'}
                        {bulletin?.motifNonClasse ? (
                          <p className="text-xs text-muted-foreground">{bulletin.motifNonClasse}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right text-muted-foreground">
                        {bulletin
                          ? bulletin.moyenneClasseAffichee ?? bulletin.moyenneClasse ?? '—'
                          : '—'}
                        {bulletin ? (
                          <span className="text-xs"> (effectif {bulletin.effectif})</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-normal px-3 py-3 text-xs text-muted-foreground">
                        {bulletin ? `v${bulletin.version} · ${dateCourte(bulletin.genereLe)}` : '—'}
                        {bulletin?.motifCorrection ? (
                          <p className="text-muted-foreground">Motif : {bulletin.motifCorrection}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {bulletin ? (
                            <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                              <Link to={`/bulletins/${bulletin.id}`}>Ouvrir</Link>
                            </Button>
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
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Le PDF A4 est généré par le serveur à partir du snapshot du bulletin : il ne dépend donc pas
        des paramètres modifiés depuis la génération.
      </p>
    </div>
  );
}
