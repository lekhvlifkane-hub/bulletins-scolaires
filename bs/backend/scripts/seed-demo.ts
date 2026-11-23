/* eslint-disable no-console */
/**
 * Jeu de données de démonstration — LOCAL UNIQUEMENT.
 *
 * Toutes les lignes créées portent la mention « FICTIF » (nom de l'établissement,
 * matricules `FIC-…`, e-mails `@demo.local`) : elles ne doivent jamais rejoindre une
 * base d'un établissement réel (règle AGENTS.md « Aucune donnée fictive dans les
 * données réelles »).
 *
 * Le script est additif : s'il détecte déjà la classe de démonstration il s'arrête
 * sans rien modifier. Il n'efface et n'écrase aucune ligne existante.
 *
 * Utilisation : npm run seed:demo
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';
import { genererBulletinsClasse, publierBulletins } from '../src/services/bulletins/bulletin';
import { appliquerModelesALaClasse } from '../src/services/subjects/templates';

const NOM_ETABLISSEMENT = 'Lycée FICTIF — Démonstration (ne pas utiliser)';
const NOM_CLASSE = 'TS 1 — FICTIF';
const MOT_DE_PASSE_DEMO = process.env.SEED_PASSWORD ?? `${randomBytes(18).toString('base64url')}aA1!`;

const NOM_ETABLISSEMENT_6E_3E = 'Collège FICTIF 6e-3e — Test bulletins';
const MOT_DE_PASSE_6E_3E = 'DemoFictif2026!';
const NIVEAUX_BULLETINS = [
  { nom: '6e', classe: '6e A FICTIF', prefixe: 'FIC6', naissance: '2013-05-02' },
  { nom: '5e', classe: '5e A FICTIF', prefixe: 'FIC5', naissance: '2012-05-02' },
  { nom: '4e', classe: '4e A FICTIF', prefixe: 'FIC4', naissance: '2011-05-02' },
  { nom: '3e', classe: '3e A FICTIF', prefixe: 'FIC3', naissance: '2010-05-02' },
] as const;
const ELEVES_BULLETINS = [
  { nom: 'Ndiaye', prenoms: 'Awa', sexe: 'F' },
  { nom: 'Sow', prenoms: 'Ibrahima', sexe: 'M' },
  { nom: 'Diagne', prenoms: 'Fatou', sexe: 'F' },
  { nom: 'Mbaye', prenoms: 'Ousmane', sexe: 'M' },
] as const;

type Note = number | 'ABSENT' | 'ANNULEE' | null;

/** Une ligne par élève : [S1 devoir, S1 composition, S2 devoir, S2 composition] par matière. */
interface ElveDemo {
  matricule: string;
  nom: string;
  prenoms: string;
  sexe: 'M' | 'F';
  notes: Note[][]; // dans l'ordre de MATIERES
}

const MATIERES = [
  { code: 'MATH', name: 'Mathématiques', coefficient: '4' },
  { code: 'PHYC', name: 'Physique-Chimie', coefficient: '4' },
  { code: 'FRAN', name: 'Français', coefficient: '3' },
  { code: 'HIGE', name: 'Histoire-Géographie', coefficient: '3' },
  { code: 'SVT', name: 'Sciences de la Vie et de la Terre', coefficient: '2' },
  { code: 'ANGL', name: 'Anglais', coefficient: '2' },
] as const;

const ELEVES: ElveDemo[] = [
  {
    matricule: 'FIC-001', nom: 'Ndiaye', prenoms: 'Awa', sexe: 'F',
    notes: [[16, 17, 18, 15], [14, 15, 16, 17], [13, 12, 15, 14], [17, 16, 15, 18], [15, 14, 16, 16], [18, 17, 19, 18]],
  },
  {
    matricule: 'FIC-002', nom: 'Sow', prenoms: 'Ibrahima', sexe: 'M',
    notes: [[12, 13, 11, 12], [13, 14, 12, 13], [11, 12, 13, 12], [14, 13, 12, 15], [12, 11, 13, 14], [15, 16, 14, 13]],
  },
  {
    // Absent au devoir de mathématiques du semestre 2 : l'absence est exclue du
    // calcul (jamais remplacée par 0) et doit rester visible sur le bulletin.
    matricule: 'FIC-003', nom: 'Ba', prenoms: 'Mariama', sexe: 'F',
    notes: [[10, 11, 'ABSENT', 12], [9, 12, 11, 10], [12, 13, 11, 'ABSENT'], [11, 10, 13, 12], [10, 12, 11, 13], [13, 12, 14, 15]],
  },
  {
    // Une composition de physique annulée au semestre 1 : le groupe sans note
    // valable est exclu et la pondération se renormalise.
    matricule: 'FIC-004', nom: 'Fall', prenoms: 'Cheikh', sexe: 'M',
    notes: [[8, 9, 10, 9], [11, 'ANNULEE', 12, 11], [9, 8, 10, 11], [10, 9, 8, 10], [12, 10, 9, 11], [11, 12, 10, 9]],
  },
  {
    matricule: 'FIC-005', nom: 'Gueye', prenoms: 'Ndeye Fatou', sexe: 'F',
    notes: [[15, 14, 16, 15], [12, 13, 14, 15], [14, 15, 13, 14], [13, 14, 15, 16], [16, 15, 14, 13], [12, 13, 15, 16]],
  },
  {
    // SVT jamais saisie au semestre 2 : la discipline doit s'afficher « non
    // calculable », sans valeur inventée.
    matricule: 'FIC-006', nom: 'Mbaye', prenoms: 'Ousmane', sexe: 'M',
    notes: [[13, 12, 14, 13], [15, 14, 13, 12], [10, 11, 12, 13], [12, 13, 11, 12], [11, 12, null, null], [16, 15, 17, 16]],
  },
  {
    matricule: 'FIC-007', nom: 'Diouf', prenoms: 'Adama', sexe: 'M',
    notes: [[9, 10, 8, 11], [8, 9, 10, 8], [13, 12, 14, 13], [9, 10, 11, 9], [10, 9, 12, 11], [10, 11, 12, 13]],
  },
  {
    // Pas de semestre 2 du tout : comparaison et bilan annuel doivent expliquer
    // le manque au lieu de fabriquer une moyenne.
    matricule: 'FIC-008', nom: 'Sarr', prenoms: 'Bineta', sexe: 'F',
    notes: [[14, 15, null, null], [13, 12, null, null], [15, 14, null, null], [16, 15, null, null], [12, 13, null, null], [14, 13, null, null]],
  },
];

function noteFictive(niveau: number, matiere: number, eleve: number, evaluation: number): number {
  return 10 + ((niveau * 11 + matiere * 7 + eleve * 5 + evaluation * 3) % 9);
}

function verifierCibleLocale() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Le seed de démonstration est interdit en production.');
  }

  const database = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '::1', 'db'].includes(database.hostname)) {
    throw new Error('Le seed de démonstration est limité à une base locale (localhost ou service Docker « db »).');
  }
  if (process.env.SEED_PASSWORD && process.env.SEED_PASSWORD.length < 12) {
    throw new Error('SEED_PASSWORD doit comporter au moins 12 caractères.');
  }
}

async function main() {
  verifierCibleLocale();
  const existingSchool = await prisma.school.findFirst({ where: { name: NOM_ETABLISSEMENT } });
  if (existingSchool) {
    const existingClass = await prisma.classroom.findFirst({
      where: { name: NOM_CLASSE, schoolId: existingSchool.id },
    });
    if (!existingClass) {
      throw new Error('Un jeu de démonstration incomplet existe déjà. Aucune donnée n’a été modifiée ; restaurez la base ou terminez le nettoyage manuellement.');
    }
    console.log(`La classe de démonstration « ${NOM_CLASSE} » existe déjà : rien n'est ajouté.`);
    console.log('Le mot de passe n’est pas réaffiché. Utilisez celui généré au premier lancement ou définissez SEED_PASSWORD avant le seed initial.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: NOM_ETABLISSEMENT,
        officialName: `${NOM_ETABLISSEMENT} — toutes les notes ci-dessous sont fictives`,
        city: 'Dakar (FICTIF)',
        email: 'contact@demo.local',
        // Règles par défaut : elles restent « à valider par l'établissement » (docs/A_VALIDER.md).
      },
    });

    const comptes = [
      { email: 'admin.fictif@demo.local', name: 'Direction — FICTIF', role: 'SCHOOL_ADMIN' as const },
      { email: 'surveillant.fictif@demo.local', name: 'Surveillance générale — FICTIF', role: 'SURVEILLANT_GENERAL' as const },
      { email: 'assistant.fictif@demo.local', name: 'Assistant (lecture seule) — FICTIF', role: 'ASSISTANT' as const },
    ];
    const passwordHash = await hashPassword(MOT_DE_PASSE_DEMO);
    for (const compte of comptes) {
      await tx.user.create({
        data: { schoolId: school.id, email: compte.email, name: compte.name, role: compte.role, passwordHash },
      });
    }

    const annee = await tx.academicYear.create({
      data: {
        schoolId: school.id,
        name: '2025-2026',
        startsAt: new Date('2025-10-01'),
        endsAt: new Date('2026-07-31'),
        status: 'ACTIVE',
        semesters: {
          create: [
            { number: 1, name: 'Semestre 1', startsAt: new Date('2025-10-01'), endsAt: new Date('2026-02-28') },
            { number: 2, name: 'Semestre 2', startsAt: new Date('2026-03-01'), endsAt: new Date('2026-07-31') },
          ],
        },
      },
      include: { semesters: { orderBy: { number: 'asc' } } },
    });
    const [semestre1, semestre2] = annee.semesters;

    const niveau = await tx.level.create({ data: { schoolId: school.id, name: 'Terminale S' } });
    const classe = await tx.classroom.create({
      data: { schoolId: school.id, academicYearId: annee.id, levelId: niveau.id, name: NOM_CLASSE },
    });

    const liensMatieres: import('@prisma/client').ClassroomSubject[] = [];
    for (const matiere of MATIERES) {
      const subject = await tx.subject.create({
        data: { schoolId: school.id, code: matiere.code, name: matiere.name },
      });
      liensMatieres.push(
        await tx.classroomSubject.create({
          data: {
            schoolId: school.id,
            classroomId: classe.id,
            subjectId: subject.id,
            coefficient: new Prisma.Decimal(matiere.coefficient),
          },
        }),
      );
    }

    const devoir = await tx.assessmentType.create({
      data: { schoolId: school.id, code: 'DEV', name: 'Devoir surveillé', category: 'DEVOIR' },
    });
    const composition = await tx.assessmentType.create({
      data: { schoolId: school.id, code: 'COMP', name: 'Composition', category: 'COMPOSITION' },
    });

    const eleves: { eleve: ElveDemo; enrollmentId: string }[] = [];
    for (const eleve of ELEVES) {
      const student = await tx.student.create({
        data: {
          schoolId: school.id,
          matricule: eleve.matricule,
          lastName: `${eleve.nom} (FICTIF)`,
          firstNames: eleve.prenoms,
          birthDate: new Date('2007-05-02'),
          birthPlace: 'Dakar (FICTIF)',
          sex: eleve.sexe,
        },
      });
      const enrollment = await tx.enrollment.create({
        data: { schoolId: school.id, studentId: student.id, classroomId: classe.id, status: 'ACTIVE' },
      });
      eleves.push({ eleve, enrollmentId: enrollment.id });
    }

    const creerEvaluation = async (options: {
      classroomSubjectId: string;
      semesterId: string;
      typeId: string;
      title: string;
      values: (Note | undefined)[];
    }) => {
      const assessment = await tx.assessment.create({
        data: {
          schoolId: school.id,
          classroomSubjectId: options.classroomSubjectId,
          semesterId: options.semesterId,
          typeId: options.typeId,
          title: options.title,
          position: 1,
          outOf: new Prisma.Decimal('20'),
          status: 'VALIDEE',
          validatedAt: new Date(),
        },
      });
      for (let index = 0; index < eleves.length; index += 1) {
        const valeur = options.values[index];
        if (valeur === undefined) continue;
        await tx.grade.create({
          data: {
            schoolId: school.id,
            assessmentId: assessment.id,
            enrollmentId: eleves[index].enrollmentId,
            score: typeof valeur === 'number' ? new Prisma.Decimal(String(valeur)) : null,
            status:
              valeur === 'ABSENT' ? 'ABSENT' : valeur === 'ANNULEE' ? 'ANNULEE' : valeur === null ? 'NON_SAISIE' : 'SAISIE',
            observation: valeur === 'ANNULEE' ? 'Copie illisible (donnée fictive)' : null,
          },
        });
      }
      return assessment;
    };

    for (let i = 0; i < liensMatieres.length; i += 1) {
      const csf = liensMatieres[i];
      const matiere = MATIERES[i];
      await creerEvaluation({
        classroomSubjectId: csf.id,
        semesterId: semestre1.id,
        typeId: devoir.id,
        title: `Devoir 1 ${matiere.code} S1 (FICTIF)`,
        values: ELEVES.map((e) => e.notes[i][0]),
      });
      await creerEvaluation({
        classroomSubjectId: csf.id,
        semesterId: semestre1.id,
        typeId: composition.id,
        title: `Composition ${matiere.code} S1 (FICTIF)`,
        values: ELEVES.map((e) => e.notes[i][1]),
      });
      await creerEvaluation({
        classroomSubjectId: csf.id,
        semesterId: semestre2.id,
        typeId: devoir.id,
        title: `Devoir 1 ${matiere.code} S2 (FICTIF)`,
        values: ELEVES.map((e) => e.notes[i][2]),
      });
      await creerEvaluation({
        classroomSubjectId: csf.id,
        semesterId: semestre2.id,
        typeId: composition.id,
        title: `Composition ${matiere.code} S2 (FICTIF)`,
        values: ELEVES.map((e) => e.notes[i][3]),
      });
    }

    const nbEvaluations = await tx.assessment.count({ where: { schoolId: school.id } });
    const nbNotes = await tx.grade.count({ where: { schoolId: school.id } });

    console.log('Données de démonstration créées (toutes marquées FICTIF).');
    console.log(`Établissement : ${school.name}`);
    console.log(`Classe        : ${classe.name} · année ${annee.name} · semestre 1/2`);
    console.log(`Effectif      : ${eleves.length} élèves · ${MATIERES.length} matières · ${nbEvaluations} évaluations · ${nbNotes} notes`);
    console.log('Comptes de démonstration (même mot de passe) :');
    for (const compte of comptes) {
      console.log(`  ${compte.email} / ${MOT_DE_PASSE_DEMO}  [${compte.role}]`);
    }
    console.log('Cas volontairement imparfaits à observer : absence (FIC-003), note annulée (FIC-004),');
    console.log('matière non calculable (FIC-006 en SVT S2), semestre 2 absent (FIC-008).');
  }, { maxWait: 10_000, timeout: 60_000 });
}

async function mainBulletins6e3e() {
  verifierCibleLocale();
  const existante = await prisma.school.findFirst({ where: { name: NOM_ETABLISSEMENT_6E_3E } });
  if (existante) {
    const nbClasses = await prisma.classroom.count({
      where: { schoolId: existante.id, name: { in: NIVEAUX_BULLETINS.map((niveau) => niveau.classe) } },
    });
    const nbEleves = await prisma.student.count({ where: { schoolId: existante.id, deletedAt: null } });
    const nbBulletins = await prisma.reportCard.count({ where: { schoolId: existante.id } });
    const nbAttendu = NIVEAUX_BULLETINS.length * ELEVES_BULLETINS.length * 2;
    if (
      nbClasses === NIVEAUX_BULLETINS.length &&
      nbEleves === NIVEAUX_BULLETINS.length * ELEVES_BULLETINS.length &&
      nbBulletins === nbAttendu
    ) {
      console.log(`Le jeu FICTIF 6e-3e existe déjà : ${nbClasses} classes, ${nbEleves} élèves, ${nbBulletins} bulletins.`);
      console.log(`Connexion : admin.test@demo.local / ${MOT_DE_PASSE_6E_3E}`);
      return;
    }
    throw new Error('Le jeu FICTIF 6e-3e existe mais est incomplet. Aucune donnée n’a été modifiée ; nettoyez cet établissement avant de relancer le seed.');
  }

  const contexte = await prisma.$transaction(async (tx) => {
    const motDePasse = await hashPassword(MOT_DE_PASSE_6E_3E);
    const school = await tx.school.create({
      data: {
        name: NOM_ETABLISSEMENT_6E_3E,
        officialName: 'COLLEGE FICTIF 6E-3E — DONNEES DE TEST',
        iefName: 'IEF DE DAKAR (FICTIF)',
        city: 'Dakar (FICTIF)',
        address: 'Quartier Fictif, Dakar',
        phone: '+221 33 000 00 01',
        email: 'contact6e3e@demo.local',
        modeleBulletin: 'OFFICIEL',
      },
    });
    const admin = await tx.user.create({
      data: {
        schoolId: school.id,
        email: 'admin.test@demo.local',
        name: 'Administration FICTIF 6e-3e',
        role: 'SCHOOL_ADMIN',
        passwordHash: motDePasse,
      },
    });
    await tx.user.create({
      data: {
        schoolId: school.id,
        email: 'surveillant.test@demo.local',
        name: 'Surveillance FICTIF 6e-3e',
        role: 'SURVEILLANT_GENERAL',
        passwordHash: motDePasse,
      },
    });
    const annee = await tx.academicYear.create({
      data: {
        schoolId: school.id,
        name: '2025-2026',
        startsAt: new Date('2025-10-01'),
        endsAt: new Date('2026-07-31'),
        status: 'ACTIVE',
        semesters: {
          create: [
            { number: 1, name: 'Semestre 1', startsAt: new Date('2025-10-01'), endsAt: new Date('2026-02-28') },
            { number: 2, name: 'Semestre 2', startsAt: new Date('2026-03-01'), endsAt: new Date('2026-07-31') },
          ],
        },
      },
      include: { semesters: { orderBy: { number: 'asc' } } },
    });
    const niveaux = new Map<string, string>();
    for (const [index, niveau] of NIVEAUX_BULLETINS.entries()) {
      const cree = await tx.level.create({
        data: { schoolId: school.id, name: niveau.nom, sortOrder: index + 1 },
      });
      niveaux.set(niveau.nom, cree.id);
    }
    const classes: { id: string; nom: string; classe: string; prefixe: string; naissance: string }[] = [];
    for (const niveau of NIVEAUX_BULLETINS) {
      const cree = await tx.classroom.create({
        data: {
          schoolId: school.id,
          academicYearId: annee.id,
          levelId: niveaux.get(niveau.nom)!,
          name: niveau.classe,
        },
      });
      classes.push({ id: cree.id, nom: niveau.nom, classe: niveau.classe, prefixe: niveau.prefixe, naissance: niveau.naissance });
    }
    const devoir = await tx.assessmentType.create({
      data: { schoolId: school.id, code: 'DEV', name: 'Devoir surveillé', category: 'DEVOIR' },
    });
    const composition = await tx.assessmentType.create({
      data: { schoolId: school.id, code: 'COMP', name: 'Composition', category: 'COMPOSITION' },
    });
    const inscriptions = new Map<string, string[]>();
    for (const classe of classes) {
      const ids: string[] = [];
      for (const [index, eleve] of ELEVES_BULLETINS.entries()) {
        const matricule = `${classe.prefixe}-${String(index + 1).padStart(3, '0')}`;
        const student = await tx.student.create({
          data: {
            schoolId: school.id,
            matricule,
            lastName: `${eleve.nom} (FICTIF)`,
            firstNames: eleve.prenoms,
            birthDate: new Date(classe.naissance),
            birthPlace: 'Dakar (FICTIF)',
            sex: eleve.sexe,
            ien: `IEN-${matricule}`,
          },
        });
        const inscription = await tx.enrollment.create({
          data: { schoolId: school.id, studentId: student.id, classroomId: classe.id, status: 'ACTIVE' },
        });
        ids.push(inscription.id);
      }
      inscriptions.set(classe.id, ids);
    }
    return {
      school,
      semestres: annee.semesters,
      classes,
      inscriptions,
      adminId: admin.id,
      devoirId: devoir.id,
      compositionId: composition.id,
    };
  }, { maxWait: 10_000, timeout: 120_000 });

  for (const [niveauIndex, classe] of contexte.classes.entries()) {
    await appliquerModelesALaClasse({ schoolId: contexte.school.id, classroomId: classe.id });
    const liens = await prisma.classroomSubject.findMany({
      where: { schoolId: contexte.school.id, classroomId: classe.id, isActive: true },
      include: { subject: true },
      orderBy: [{ sortOrder: 'asc' }, { subject: { name: 'asc' } }],
    });
    const inscriptions = contexte.inscriptions.get(classe.id) ?? [];
    for (const [matiereIndex, lien] of liens.entries()) {
      for (const [semestreIndex, semestre] of contexte.semestres.entries()) {
        const evaluations = [
          { titre: 'Devoir 1', typeId: contexte.devoirId, position: 1, rang: semestreIndex * 3 },
          { titre: 'Devoir 2', typeId: contexte.devoirId, position: 2, rang: semestreIndex * 3 + 1 },
          { titre: 'Composition', typeId: contexte.compositionId, position: 1, rang: semestreIndex * 3 + 2 },
        ];
        for (const evaluation of evaluations) {
          const assessment = await prisma.assessment.create({
            data: {
              schoolId: contexte.school.id,
              classroomSubjectId: lien.id,
              semesterId: semestre.id,
              typeId: evaluation.typeId,
              title: `${evaluation.titre} ${lien.subject.name} S${semestre.number} (FICTIF)`,
              position: evaluation.position,
              outOf: new Prisma.Decimal('20'),
              status: 'VALIDEE',
              validatedAt: new Date(),
            },
          });
          await prisma.grade.createMany({
            data: inscriptions.map((enrollmentId, eleveIndex) => ({
              schoolId: contexte.school.id,
              assessmentId: assessment.id,
              enrollmentId,
              score: new Prisma.Decimal(String(noteFictive(niveauIndex, matiereIndex, eleveIndex, evaluation.rang))),
              status: 'SAISIE' as const,
              observation: 'Note fictive de test',
            })),
          });
        }
      }
    }
  }

  for (const semestre of contexte.semestres) {
    for (const classe of contexte.classes) {
      const generation = await genererBulletinsClasse({
        schoolId: contexte.school.id,
        classroomId: classe.id,
        semesterId: semestre.id,
        userId: contexte.adminId,
      });
      const bulletins = await prisma.reportCard.findMany({
        where: {
          schoolId: contexte.school.id,
          semesterId: semestre.id,
          enrollment: { classroomId: classe.id },
          statut: { not: 'PUBLIE' },
        },
        select: { id: true },
      });
      const publication = bulletins.length > 0
        ? await publierBulletins({
            schoolId: contexte.school.id,
            ids: bulletins.map((bulletin) => bulletin.id),
            userId: contexte.adminId,
          })
        : { publies: 0, dejaPublies: 0 };
      console.log(`${classe.classe} S${semestre.number} : ${generation.generes} bulletin(s) créé(s), ${publication.publies} publié(s), ${generation.ignores.length} ignoré(s).`);
    }
  }

  const nbEvaluations = await prisma.assessment.count({ where: { schoolId: contexte.school.id } });
  const nbNotes = await prisma.grade.count({ where: { schoolId: contexte.school.id } });
  const nbBulletins = await prisma.reportCard.count({ where: { schoolId: contexte.school.id } });
  console.log('Jeu FICTIF 6e-3e créé.');
  console.log(`Établissement : ${contexte.school.name}`);
  console.log(`Classes       : ${contexte.classes.map((classe) => classe.classe).join(' · ')}`);
  console.log(`Effectif      : ${NIVEAUX_BULLETINS.length * ELEVES_BULLETINS.length} élèves · ${nbEvaluations} évaluations · ${nbNotes} notes · ${nbBulletins} bulletins`);
  console.log('Connexion :');
  console.log(`  admin.test@demo.local / ${MOT_DE_PASSE_6E_3E}  [SCHOOL_ADMIN]`);
  console.log(`  surveillant.test@demo.local / ${MOT_DE_PASSE_6E_3E}  [SURVEILLANT_GENERAL]`);
}

main()
  .then(() => mainBulletins6e3e())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
