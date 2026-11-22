import Decimal from 'decimal.js';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import {
  arrondirNote,
  classerEleves,
  DEFAULT_PARAMETRES,
  formaterNote,
  formaterRang,
  calculerResultatsEleve,
  type EvaluationInput,
  type MatiereInput,
} from '../src/services/calcul';
import { appreciationMatiere, DEFAULT_APPRECIATION_RULES } from '../src/services/appreciations/rules';
import { appliquerModelesALaClasse, MODELES_PAR_NIVEAU } from '../src/services/subjects/templates';
import { cleanTestDb, createSchool } from './helpers';

function evaluation(categorie: 'DEVOIR' | 'COMPOSITION', id: string, note?: number): EvaluationInput {
  return {
    assessmentId: id,
    category: categorie,
    notes: [
      {
        status: note === undefined ? 'NON_SAISIE' : 'SAISIE',
        score: note === undefined ? null : String(note),
      },
    ],
  };
}

function matiere(
  subjectId: string,
  coefficient: number,
  devoir1: number,
  devoir2: number | undefined,
  composition?: number
): MatiereInput {
  const evaluations: EvaluationInput[] = [
    evaluation('DEVOIR', `${subjectId}-d1`, devoir1),
    evaluation('DEVOIR', `${subjectId}-d2`, devoir2),
    evaluation('COMPOSITION', `${subjectId}-c`, composition),
  ];
  return { subjectId, coefficient: String(coefficient), evaluations };
}

afterEach(async () => {
  await cleanTestDb();
});

describe('Bulletins officiels — calculs', () => {
  it('calcule le vecteur 6e S1 attendu', () => {
    const resultat = calculerResultatsEleve(
      [
        matiere('redaction', 2, 8, 7),
        matiere('tsq', 1, 8.5, 14),
        matiere('orthographe', 1, 7, 10),
        matiere('maths', 3, 13, 8),
        matiere('anglais', 2, 15, 15),
        matiere('hg', 2, 14, 7),
        matiere('svt', 2, 10, 10),
        matiere('eps', 2, 19.5, undefined),
        matiere('conduite', 1, 18, undefined),
        matiere('civique', 1, 9, 11),
      ],
      DEFAULT_PARAMETRES
    );

    expect(resultat.totalCoeficients.toString()).toBe('17');
    expect(resultat.totalPoints.toString()).toBe('204.25');
    expect(formaterNote(resultat.moyenneGenerale)).toBe('12.01');
  });

  it('applique Moy×Coef sur la moyenne arrondie', () => {
    const resultat = calculerResultatsEleve(
      [matiere('exemple', 2, 16.12, 16.14)],
      DEFAULT_PARAMETRES
    );
    expect(resultat.matieres[0].pointsPonderes?.toString()).toBe('32.26');
    expect(arrondirNote(resultat.matieres[0].moyenne)?.toString()).toBe('16.13');
  });

  it('exclut du dénominateur une matière sans aucune note', () => {
    const resultat = calculerResultatsEleve(
      [
        matiere('maths', 3, 10, 10),
        matiere('vide', 2, undefined, undefined, undefined),
      ],
      DEFAULT_PARAMETRES
    );
    expect(resultat.totalCoeficients.toString()).toBe('3');
    expect(resultat.matieres.find((m) => m.subjectId === 'vide')?.pointsPonderes).toBeNull();
  });

  it('marque les ex æquo et formate leur rang', () => {
    const rangs = classerEleves(
      [
        { eleveId: 'a', moyenne: new Decimal(12) },
        { eleveId: 'b', moyenne: new Decimal(10) },
        { eleveId: 'c', moyenne: new Decimal(10) },
      ],
      DEFAULT_PARAMETRES
    );
    expect(rangs.find((r) => r.eleveId === 'a')?.rang).toBe(1);
    expect(rangs.find((r) => r.eleveId === 'b')?.exAequo).toBe(true);
    expect(formaterRang(2, true)).toBe('2ex');
  });
});

describe('Appréciations — nouveaux seuils', () => {
  const regles = DEFAULT_APPRECIATION_RULES.filter((rule) => rule.scope === 'MATIERE').map((rule) => ({
    ...rule,
    minScore: new Decimal(rule.minScore),
    maxScore: new Decimal(rule.maxScore),
  })) as Parameters<typeof appreciationMatiere>[0];

  it.each([
    ['Très médiocre', 4],
    ['Médiocre', 5.5],
    ['Très insuffisant', 7],
    ['Insuffisant', 9],
    ['Passable', 11],
    ['Assez bien', 13],
    ['Bien', 15],
    ['Très bien', 17],
    ['Excellent', 18],
  ])('retourne %s', (attendu, note) => {
    expect(appreciationMatiere(regles, note)).toBe(attendu);
  });
});

describe('Modèles de matières', () => {
  it('couvre les coefficients officiels 6e à 3e', () => {
    const total = (niveau: string) =>
      MODELES_PAR_NIVEAU[niveau]
        .filter((modele) => !modele.groupe && !modele.option && modele.actif !== false)
        .reduce((somme, modele) => somme + Number(modele.coefficient), 0);
    expect(total('6e')).toBe(17);
    expect(total('5e')).toBe(19);
    expect(total('4e')).toBe(24);
    expect(total('3e')).toBe(24);
  });

  it('applique le modèle 6e à une classe sans écraser les affectations existantes', async () => {
    const school = await createSchool();
    const year = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: '2026-2027',
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2027-06-30'),
      },
    });
    const level = await prisma.level.findFirstOrThrow({
      where: { schoolId: school.id, name: '6e' },
    }).catch(async () => prisma.level.create({
      data: { schoolId: school.id, name: '6e', sortOrder: 1 },
    }));
    const classroom = await prisma.classroom.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        levelId: level.id,
        name: '6e A',
      },
    });

    const resultat = await appliquerModelesALaClasse({ schoolId: school.id, classroomId: classroom.id });
    expect(resultat.ajoutees).toBe(10);
    const applyAgain = await appliquerModelesALaClasse({ schoolId: school.id, classroomId: classroom.id });
    expect(applyAgain.ajoutees).toBe(0);

    const affectations = await prisma.classroomSubject.findMany({
      where: { schoolId: school.id, classroomId: classroom.id },
      include: { subject: true },
    });
    expect(affectations).toHaveLength(10);
    expect(affectations.some((row) => row.subject.name === 'Récitation')).toBe(false);
    expect(affectations.some((row) => row.subject.name === 'Français')).toBe(false);
    const total = affectations.reduce((somme, row) => somme.plus(row.coefficient), new Decimal(0));
    expect(total.toString()).toBe('17');
  });
});
