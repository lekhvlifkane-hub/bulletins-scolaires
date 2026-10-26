import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  chargerAffectations,
  chargerAnnees,
  chargerClasses,
  type Affectation,
  type Classe,
  type YearSemestre,
} from '@/lib/notes';
import { chargerBulletins, type LigneBulletin } from '@/lib/bulletins';
import {
  chargerAppreciations,
  chargerArchive,
  chargerDecisions,
  chargerHistorique,
  chargerPresences,
  enregistrerAppreciation,
  enregistrerDecision,
  enregistrerPresence,
  validerDecision,
  type AppreciationRecord,
  type AttendanceRecord,
  type AuditEntry,
  type CouncilDecision,
  type SchoolArchive,
} from '@/lib/schoolLife';

type Onglet = 'presences' | 'appreciations' | 'conseil' | 'archives';

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function aujourdHui() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function Erreur({ children }: { children: string }) {
  return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{children}</p>;
}

export function VieScolairePage() {
  const { user } = useAuth();
  const [onglet, setOnglet] = useState<Onglet>('presences');
  const [classes, setClasses] = useState<Classe[]>([]);
  const [annees, setAnnees] = useState<YearSemestre[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [eleves, setEleves] = useState<LigneBulletin[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [presences, setPresences] = useState<AttendanceRecord[]>([]);
  const [appreciations, setAppreciations] = useState<AppreciationRecord[]>([]);
  const [decisions, setDecisions] = useState<CouncilDecision[]>([]);
  const [historique, setHistorique] = useState<AuditEntry[]>([]);
  const [archive, setArchive] = useState<SchoolArchive | null>(null);
  const [archiveYearId, setArchiveYearId] = useState('');
  const [typePresence, setTypePresence] = useState<'ABSENCE' | 'RETARD'>('ABSENCE');
  const [datePresence, setDatePresence] = useState(aujourdHui());
  const [justifiee, setJustifiee] = useState(false);
  const [minutesRetard, setMinutesRetard] = useState('');
  const [motif, setMotif] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [contenuAppreciation, setContenuAppreciation] = useState('');
  const [contenuDecision, setContenuDecision] = useState('');
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const classe = classes.find((item) => item.id === classroomId) ?? null;
  const annee = annees.find((item) => item.id === classe?.academicYear.id) ?? null;
  const semestres = annee?.semesters ?? [];
  const eleve = eleves.find((item) => item.enrollmentId === enrollmentId) ?? null;
  const peutEcrireDecision = user?.role === 'SCHOOL_ADMIN' || user?.role === 'SURVEILLANT_GENERAL';
  const anneesArchivees = annees.filter((item) => item.status === 'CLOSED');

  const chargerEleves = useCallback(async () => {
    if (!classroomId || !semesterId) {
      setEleves([]);
      setEnrollmentId('');
      return;
    }
    const result = await chargerBulletins({ classroomId, semesterId });
    setEleves(result.lignes);
    setEnrollmentId((previous) => result.lignes.some((item) => item.enrollmentId === previous)
      ? previous
      : result.lignes[0]?.enrollmentId ?? '');
  }, [classroomId, semesterId]);

  const chargerDonneesEleve = useCallback(async () => {
    if (!enrollmentId || !semesterId || !annee) {
      setPresences([]);
      setAppreciations([]);
      return;
    }
    const [attendanceResult, appreciationResult, decisionResult] = await Promise.all([
      chargerPresences(enrollmentId, semesterId),
      chargerAppreciations(enrollmentId, semesterId),
      chargerDecisions(annee.id),
    ]);
    setPresences(attendanceResult.records);
    setAppreciations(appreciationResult.appreciations);
    setDecisions(decisionResult.decisions);
  }, [enrollmentId, semesterId, annee]);

  useEffect(() => {
    Promise.all([chargerClasses(), chargerAnnees()])
      .then(([classResult, yearResult]) => {
        setClasses(classResult.classes);
        setAnnees(yearResult.years);
        const activeClass = classResult.classes.find((item) => item.academicYear.status === 'ACTIVE');
        setClassroomId(activeClass?.id ?? classResult.classes[0]?.id ?? '');
        const closedYear = yearResult.years.find((item) => item.status === 'CLOSED');
        setArchiveYearId(closedYear?.id ?? '');
      })
      .catch((e: Error) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    if (semestres.length && !semestres.some((item) => item.id === semesterId)) {
      setSemesterId(semestres[0].id);
    } else if (!semestres.length) {
      setSemesterId('');
    }
  }, [semestres, semesterId]);

  useEffect(() => {
    if (!classroomId) {
      setAffectations([]);
      return;
    }
    chargerAffectations(classroomId)
      .then((result) => {
        setAffectations(result.classroomSubjects);
        setSubjectId((current) => result.classroomSubjects.some((item) => item.subjectId === current)
          ? current
          : result.classroomSubjects[0]?.subjectId ?? '');
      })
      .catch((e: Error) => setErreur(e.message));
  }, [classroomId]);

  useEffect(() => {
    setChargement(true);
    chargerEleves()
      .catch((e: Error) => {
        setEleves([]);
        setEnrollmentId('');
        setErreur(e.message);
      })
      .finally(() => setChargement(false));
  }, [chargerEleves]);

  useEffect(() => {
    if (!enrollmentId || !semesterId || !annee) return;
    chargerDonneesEleve().catch((e: Error) => setErreur(e.message));
  }, [chargerDonneesEleve, enrollmentId, semesterId, annee]);

  useEffect(() => {
    const current = appreciations.find((item) => item.subjectId === subjectId);
    setContenuAppreciation(current?.content ?? '');
  }, [appreciations, subjectId]);

  const chargerArchiveSelectionnee = async () => {
    if (!archiveYearId) return;
    setErreur(null);
    setArchive(null);
    try {
      setArchive(await chargerArchive(archiveYearId));
    } catch (e) {
      setErreur((e as Error).message);
    }
  };

  const recharger = async () => {
    setErreur(null);
    try {
      await Promise.all([chargerEleves(), chargerDonneesEleve()]);
    } catch (e) {
      setErreur((e as Error).message);
    }
  };

  const enregistrerPresenceForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollmentId || !semesterId) return;
    setEnregistrement(true);
    setErreur(null);
    setMessage(null);
    try {
      await enregistrerPresence({
        enrollmentId,
        semesterId,
        kind: typePresence,
        date: `${datePresence}T12:00:00.000Z`,
        justified: typePresence === 'ABSENCE' && justifiee,
        ...(typePresence === 'RETARD' && minutesRetard ? { durationMinutes: Number(minutesRetard) } : {}),
        reason: motif.trim() || null,
      });
      setMotif('');
      setMinutesRetard('');
      setMessage('Événement de présence enregistré.');
      await recharger();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  };

  const enregistrerAppreciationForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollmentId || !semesterId || !subjectId) return;
    setEnregistrement(true);
    setErreur(null);
    setMessage(null);
    try {
      await enregistrerAppreciation({ enrollmentId, semesterId, subjectId, content: contenuAppreciation });
      setMessage('Appréciation enregistrée.');
      await recharger();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  };

  const enregistrerDecisionForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollmentId || !annee) return;
    setEnregistrement(true);
    setErreur(null);
    setMessage(null);
    try {
      await enregistrerDecision({ enrollmentId, academicYearId: annee.id, content: contenuDecision });
      setContenuDecision('');
      setMessage('Décision du conseil enregistrée en brouillon.');
      await recharger();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  };

  const valider = async (decision: CouncilDecision) => {
    setEnregistrement(true);
    setErreur(null);
    try {
      await validerDecision(decision.id);
      setMessage('Décision validée et datée.');
      await recharger();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnregistrement(false);
    }
  };

  const afficherHistorique = async (entityType: string, entityId: string) => {
    setErreur(null);
    try {
      setHistorique((await chargerHistorique(entityType, entityId)).history);
    } catch (e) {
      setErreur((e as Error).message);
    }
  };

  const optionsOnglets: { id: Onglet; label: string }[] = [
    { id: 'presences', label: 'Absences et retards' },
    { id: 'appreciations', label: 'Appréciations' },
    { id: 'conseil', label: 'Conseil de classe' },
    { id: 'archives', label: 'Archives' },
  ];
  const appreciationSelectionnee = useMemo(
    () => appreciations.find((item) => item.subjectId === subjectId),
    [appreciations, subjectId]
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-primary">{classe?.academicYear.name ?? 'Établissement'}</p>
        <h1 className="mt-1 text-2xl font-semibold">Vie scolaire</h1>
        <p className="mt-1 text-sm text-muted-foreground">Présences, appréciations, décisions du conseil et archives.</p>
      </header>

      {erreur && <Erreur>{erreur}</Erreur>}
      {message && <p role="status" className="rounded-md border border-secondary/30 bg-secondary/5 p-3 text-sm">{message}</p>}

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm font-medium">
          Classe
          <select className={inputClass} value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.academicYear.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Semestre
          <select className={inputClass} value={semesterId} onChange={(event) => setSemesterId(event.target.value)}>
            {semestres.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Élève
          <select className={inputClass} value={enrollmentId} onChange={(event) => setEnrollmentId(event.target.value)}>
            {eleves.map((item) => <option key={item.enrollmentId} value={item.enrollmentId}>{item.nom} {item.prenoms} — {item.matricule}</option>)}
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="Rubriques de vie scolaire" className="flex gap-2 overflow-x-auto border-b border-border">
        {optionsOnglets.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={onglet === item.id}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm ${onglet === item.id ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => { setOnglet(item.id); setErreur(null); setMessage(null); }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {chargement ? (
        <div role="status" className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Chargement des données scolaires…</div>
      ) : !classes.length ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <h2 className="font-medium">Aucune classe disponible</h2>
          <p className="mt-1 text-sm text-muted-foreground">Créez une classe et inscrivez des élèves pour commencer.</p>
        </div>
      ) : onglet !== 'archives' && !eleve ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <h2 className="font-medium">Aucun élève actif dans cette classe</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choisissez une autre classe ou vérifiez les inscriptions.</p>
        </div>
      ) : onglet === 'presences' ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form onSubmit={enregistrerPresenceForm} className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div><h2 className="font-semibold">Enregistrer un événement</h2><p className="mt-1 text-sm text-muted-foreground">{eleve?.nom} {eleve?.prenoms}</p></div>
            <label className="block space-y-1 text-sm font-medium">Type
              <select className={inputClass} value={typePresence} onChange={(event) => setTypePresence(event.target.value as 'ABSENCE' | 'RETARD')}>
                <option value="ABSENCE">Absence</option><option value="RETARD">Retard</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">Date
              <input required type="date" className={inputClass} value={datePresence} onChange={(event) => setDatePresence(event.target.value)} />
            </label>
            {typePresence === 'ABSENCE' ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={justifiee} onChange={(event) => setJustifiee(event.target.checked)} /> Absence justifiée</label>
            ) : (
              <label className="block space-y-1 text-sm font-medium">Durée (minutes, facultative)
                <input type="number" min="1" step="1" className={inputClass} value={minutesRetard} onChange={(event) => setMinutesRetard(event.target.value)} />
              </label>
            )}
            <label className="block space-y-1 text-sm font-medium">Motif ou précision (facultatif)
              <textarea maxLength={300} rows={3} className={inputClass} value={motif} onChange={(event) => setMotif(event.target.value)} />
            </label>
            <Button type="submit" disabled={enregistrement || !semesterId}>{enregistrement ? 'Enregistrement…' : 'Enregistrer'}</Button>
          </form>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Historique des présences</h2>
            {presences.length ? (
              <ul className="mt-4 divide-y divide-border">
                {presences.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div>
                      <p className="font-medium">{record.kind === 'ABSENCE' ? 'Absence' : `Retard${record.durationMinutes ? ` — ${record.durationMinutes} min` : ''}`} · {new Date(record.date).toLocaleDateString('fr-FR')}</p>
                      <p className="text-muted-foreground">{record.kind === 'ABSENCE' ? (record.justified ? 'Justifiée' : 'Non justifiée') : (record.reason || 'Aucun motif précisé')}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void afficherHistorique('AttendanceRecord', record.id)}>Historique</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 rounded-md bg-muted p-4 text-sm text-muted-foreground">Aucun événement de présence pour cet élève et ce semestre.</p>}
          </div>
        </section>
      ) : onglet === 'appreciations' ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <form onSubmit={enregistrerAppreciationForm} className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div><h2 className="font-semibold">Appréciation disciplinaire</h2><p className="mt-1 text-sm text-muted-foreground">Les bulletins publiés restent figés ; les brouillons sont synchronisés.</p></div>
            <label className="block space-y-1 text-sm font-medium">Discipline
              <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                {affectations.map((item) => <option key={item.subjectId} value={item.subjectId}>{item.subject.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">Texte (500 caractères maximum)
              <textarea maxLength={500} rows={5} className={inputClass} value={contenuAppreciation} onChange={(event) => setContenuAppreciation(event.target.value)} />
            </label>
            <Button type="submit" disabled={enregistrement || !subjectId || !semesterId}>{enregistrement ? 'Enregistrement…' : 'Enregistrer'}</Button>
          </form>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Appréciations saisies</h2>
            {appreciations.length ? (
              <ul className="mt-3 space-y-3">{appreciations.map((item) => (
                <li key={item.id} className="rounded-lg bg-muted p-3">
                  <p className="text-sm font-semibold">{item.subject.name}</p><p className="mt-1 whitespace-pre-wrap text-sm">{item.content}</p>
                  <Button className="mt-2" variant="outline" size="sm" onClick={() => void afficherHistorique('Appreciation', item.id)}>Historique</Button>
                </li>
              ))}</ul>
            ) : <p className="mt-3 text-sm text-muted-foreground">Aucune appréciation enregistrée.</p>}
            {appreciationSelectionnee && <p className="mt-3 text-xs text-muted-foreground">La discipline sélectionnée possède déjà une appréciation modifiable.</p>}
          </div>
        </section>
      ) : onglet === 'conseil' ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <form onSubmit={enregistrerDecisionForm} className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div><h2 className="font-semibold">Décision du conseil de classe</h2><p className="mt-1 text-sm text-muted-foreground">La décision reste un brouillon jusqu’à validation par l’établissement.</p></div>
            <label className="block space-y-1 text-sm font-medium">Décision (500 caractères maximum)
              <textarea required maxLength={500} rows={5} className={inputClass} value={contenuDecision} onChange={(event) => setContenuDecision(event.target.value)} />
            </label>
            {peutEcrireDecision ? <Button type="submit" disabled={enregistrement || !annee}>{enregistrement ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button> : <p className="text-sm text-muted-foreground">La création des décisions est réservée au surveillant général et à l’administrateur.</p>}
          </form>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Décisions pour {annee?.name ?? 'cette année'}</h2>
            {decisions.length ? <ul className="mt-3 divide-y divide-border">{decisions.map((decision) => (
              <li key={decision.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{decision.enrollment.student.lastName} {decision.enrollment.student.firstNames}</p>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs">{decision.status === 'VALIDEE' ? 'Validée' : 'Brouillon'}</span>
                </div>
                <p className="text-sm">{decision.content}</p>
                {decision.validatedAt && <p className="text-xs text-muted-foreground">Validée le {new Date(decision.validatedAt).toLocaleDateString('fr-FR')}</p>}
                {decision.status === 'BROUILLON' && user?.role === 'SCHOOL_ADMIN' && <Button size="sm" variant="outline" disabled={enregistrement} onClick={() => void valider(decision)}>Valider</Button>}
                <Button className="ml-2" size="sm" variant="outline" onClick={() => void afficherHistorique('CouncilDecision', decision.id)}>Historique</Button>
              </li>
            ))}</ul> : <p className="mt-3 text-sm text-muted-foreground">Aucune décision pour cette année scolaire.</p>}
          </div>
        </section>
      ) : (
        <section className="space-y-5 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="font-semibold">Archives des années clôturées</h2>
            <p className="mt-1 text-sm text-muted-foreground">Les données archivées restent consultables sans modifier les versions figées.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <select aria-label="Année scolaire clôturée" className={`${inputClass} max-w-sm`} value={archiveYearId} onChange={(event) => { setArchiveYearId(event.target.value); setArchive(null); }}>
              <option value="">Choisir une année clôturée</option>
              {anneesArchivees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void chargerArchiveSelectionnee()} disabled={!archiveYearId}>Consulter l’archive</Button>
          </div>
          {!anneesArchivees.length ? <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">Aucune année scolaire clôturée.</p> : null}
          {archive && (
            <div>
              <h3 className="font-medium">{archive.annee.name}</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['Versions de bulletins', archive.bulletins.length],
                  ['Bilans annuels', archive.bilansAnnuels.length],
                  ['Événements de présence', archive.presences.length],
                  ['Appréciations', archive.appreciations.length],
                  ['Décisions du conseil', archive.decisionsConseil.length],
                ].map(([label, count]) => <div key={label} className="rounded-lg bg-muted p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{count}</dd></div>)}
              </dl>
              <div className="mt-4 space-y-2">
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Bulletins et versions</summary>
                  <ul className="mt-2 divide-y divide-border">
                    {archive.bulletins.map((item) => <li key={item.id} className="py-2 text-sm">
                      {item.enrollment.student.lastName} {item.enrollment.student.firstNames} — {item.semester.name} · v{item.version} · {item.statut}
                    </li>)}
                    {!archive.bulletins.length && <li className="py-2 text-sm text-muted-foreground">Aucun bulletin archivé.</li>}
                  </ul>
                </details>
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Bilans annuels</summary>
                  <ul className="mt-2 divide-y divide-border">
                    {archive.bilansAnnuels.map((item) => <li key={item.id} className="py-2 text-sm">
                      {item.enrollment.student.lastName} {item.enrollment.student.firstNames} · v{item.version} · {item.statut}
                    </li>)}
                    {!archive.bilansAnnuels.length && <li className="py-2 text-sm text-muted-foreground">Aucun bilan archivé.</li>}
                  </ul>
                </details>
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Présences, appréciations et décisions</summary>
                  <ul className="mt-2 divide-y divide-border">
                    {archive.presences.map((item) => <li key={item.id} className="py-2 text-sm">
                      {item.enrollment.student.lastName} {item.enrollment.student.firstNames} — {item.kind === 'ABSENCE' ? 'Absence' : 'Retard'} · {new Date(item.date).toLocaleDateString('fr-FR')}
                    </li>)}
                    {archive.appreciations.map((item) => <li key={item.id} className="py-2 text-sm">
                      Appréciation de {item.enrollment.student.lastName} {item.enrollment.student.firstNames} — {item.subject.name}, {item.semester.name} : {item.content}
                    </li>)}
                    {archive.decisionsConseil.map((item) => <li key={item.id} className="py-2 text-sm">
                      Décision du conseil — {item.enrollment.student.lastName} {item.enrollment.student.firstNames} · {item.status}
                    </li>)}
                    {!archive.presences.length && !archive.appreciations.length && !archive.decisionsConseil.length && <li className="py-2 text-sm text-muted-foreground">Aucune donnée de vie scolaire archivée.</li>}
                  </ul>
                </details>
              </div>
            </div>
          )}
        </section>
      )}

      {historique.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Journal de modification</h2>
            <Button variant="ghost" size="sm" onClick={() => setHistorique([])}>Fermer</Button>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {historique.map((entry) => <li key={entry.id} className="py-2 text-sm">
              <p className="font-medium">{entry.action} — {entry.user.name}</p>
              <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString('fr-FR')}</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{JSON.stringify(entry.metadata, null, 2)}</pre>
            </li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
