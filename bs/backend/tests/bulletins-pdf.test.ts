/**
 * Tests de rendu PDF (phase 5) — sans base de données.
 *
 * Le journal de mise en page (`journal.emplacements`) contient le texte réellement dessiné,
 * avec sa position et sa largeur mesurées par PDFKit. Ces tests vérifient donc le document
 * produit : rien ne sort de la page A4, rien ne sort de la zone imprimable pour le contenu,
 * aucun caractère n'est perdu par l'encodage, et les données manquantes s'affichent comme
 * telles au lieu de se muer en zéros.
 */
import { describe, expect, it } from 'vitest';
import {
  LARGEUR_A4,
  HAUTEUR_A4,
  ZONE,
  genererPdfBilanAnnuel,
  genererPdfBulletin,
  genererPdfBulletins,
  type JournalPdf,
  type MetaBulletin,
} from '../src/services/bulletins/pdf';
import {
  VERSION_SNAPSHOT,
  type GroupeSnapshot,
  type MatiereSnapshot,
  type NoteSnapshot,
  type SnapshotBilanAnnuel,
  type SnapshotBulletin,
} from '../src/services/bulletins/types';

const TOLERANCE = 0.01;

function note(overrides: Partial<NoteSnapshot> = {}): NoteSnapshot {
  return {
    assessmentId: 'ev-1',
    title: 'Devoir 1',
    typeId: 'ty-1',
    typeName: 'Devoir surveillé',
    category: 'DEVOIR',
    statutEvaluation: 'VALIDEE',
    outOf: '20',
    score: '16',
    status: 'SAISIE',
    ...overrides,
  };
}

function groupe(overrides: Partial<GroupeSnapshot> = {}): GroupeSnapshot {
  return {
    category: 'DEVOIR',
    poids: '1',
    moyenne: '16',
    moyenneAffichee: '16.00',
    notesValides: 2,
    notesAttendues: 2,
    notes: [note(), note({ assessmentId: 'ev-2', title: 'Devoir 2', score: '16' })],
    ...overrides,
  };
}

function matiere(overrides: Partial<MatiereSnapshot> = {}): MatiereSnapshot {
  return {
    subjectId: 'sub-maths',
    subjectName: 'Mathématiques',
    subjectCode: 'MATH',
    coefficient: '3',
    coefficientValide: true,
    comptabilisee: true,
    moyenne: '16',
    moyenneExacte: '16',
    moyenneAffichee: '16.00',
    pointsPonderes: '48',
    rang: 1,
    incomplet: false,
    motifs: [],
    groupes: [groupe(), groupe({ category: 'COMPOSITION', moyenne: '15', moyenneAffichee: '15.00' })],
    appreciation: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SnapshotBulletin> = {}): SnapshotBulletin {
  return {
    versionSchema: VERSION_SNAPSHOT,
    genereLe: '2026-06-05T09:12:00.000Z',
    dateCalcul: '2026-06-05T09:12:00.000Z',
    enTete: {
      etablissementId: 'sc-1',
      nomEtablissement: 'Lycée de Touba Toul',
      nomOfficiel: 'LYCÉE DE TOUBA TOUL',
      ville: 'Touba Toul',
      adresse: 'Quartier Darou Salam',
      telephone: '+221 33 000 00 00',
      email: 'lycee@exemple.sn',
      agrement: null,
      autorite: null,
      devise: null,
      intituleDocument: 'Bulletin de notes',
      anneeScolaire: { id: 'an-1', nom: '2025-2026', statut: 'ACTIVE' },
      semestre: { id: 'sem-1', numero: 1, nom: 'Semestre 1' },
    },
    eleve: {
      enrollmentId: 'enc-1',
      studentId: 'stu-1',
      classroomId: 'cls-1',
      matricule: 'ELV-1',
      nom: 'Ndiaye',
      prenoms: 'Alpha',
      birthDate: '2007-03-14T00:00:00.000Z',
      birthPlace: 'Touba',
      sexe: 'M',
      niveau: 'Terminale S',
      classe: 'TS 1',
      serie: 'S2',
    },
    regles: {
      formuleMatiere: 'POIDS_GROUPES',
      poidsGroupes: { DEVOIR: '1', COMPOSITION: '1', AUTRE: '0' },
      arrondiDecimales: 2,
      arrondiMode: 'half-up',
      rangMode: 'standard',
      baremeParDefaut: '20',
      normaliserSur20: true,
      absencesComptentZero: false,
      groupeSansNote: 'exclure',
      coefficientInvalide: 'exclure',
      classerResultatsIncomplets: false,
      poidsSemestres: { s1: '1', s2: '1' },
      annuelSiSemestreManquant: 'null',
    },
    matieres: [
      matiere(),
      matiere({
        subjectId: 'sub-histoire',
        subjectName: 'Histoire-Géographie',
        subjectCode: 'HIGE',
        coefficient: '2',
        moyenne: '14',
        moyenneExacte: '14',
        moyenneAffichee: '14.00',
        pointsPonderes: '28',
        rang: 2,
        groupes: [
          groupe({ moyenne: '14', moyenneAffichee: '14.00' }),
          groupe({ category: 'COMPOSITION', moyenne: '14', moyenneAffichee: '14.00' }),
        ],
      }),
    ],
    synthese: {
      totalPoints: '76',
      totalCoeficients: '5',
      moyenneGenerale: '15.2',
      moyenneGeneraleExacte: '15.2',
      moyenneGeneraleAffichee: '15.20',
      rang: 1,
      motifNonClasse: null,
      effectif: 4,
      moyenneClasse: '13.85',
      moyenneClasseExacte: '13.85',
      moyenneClasseAffichee: '13.85',
      incomplet: false,
    },
    continuite: {
      semestrePrecedent: null,
      changementClasse: false,
      classePrecedente: null,
    },
    absences: {
      disponible: false,
      absencesJustifiees: 0,
      absencesNonJustifiees: 0,
      absencesTotal: 0,
      retards: 0,
      minutesRetard: 0,
    },
    motifs: [],
    ...overrides,
  };
}

function meta(overrides: Partial<MetaBulletin> = {}): MetaBulletin {
  return { version: 1, statut: 'BOUILLON', genereLe: '2026-06-05T09:12:00.000Z', ...overrides };
}

function texteDe(journal: JournalPdf, page?: number): string {
  return journal.emplacements
    .filter((e) => page === undefined || e.page === page)
    .map((e) => e.texte)
    .join('\n');
}

/** Le contenu comme les pieds de page restent dans la page A4. */
function assertDansLaPage(journal: JournalPdf): void {
  expect(journal.largeurPage).toBeCloseTo(LARGEUR_A4, 2);
  expect(journal.hauteurPage).toBeCloseTo(HAUTEUR_A4, 2);
  const horsPage = journal.emplacements.filter(
    (e) =>
      e.x < -TOLERANCE ||
      e.x + e.largeur > journal.largeurPage + TOLERANCE ||
      e.y < -TOLERANCE ||
      e.y + e.hauteur > journal.hauteurPage + TOLERANCE
  );
  expect(horsPage.map((e) => `${e.texte} en ${e.x},${e.y} (${e.largeur}x${e.hauteur})`)).toEqual([]);
}

/** Le contenu (hors pied de page et filigrane) reste dans la zone imprimable. */
function assertDansLaZoneImprimable(journal: JournalPdf): void {
  const gauche = ZONE.x;
  const droite = ZONE.x + ZONE.largeur;
  const bas = ZONE.y + ZONE.hauteur;
  const debordements = journal.emplacements
    .filter((e) => e.role === 'contenu')
    .filter(
      (e) =>
        e.x < gauche - TOLERANCE ||
        e.x + e.largeur > droite + TOLERANCE ||
        e.y < ZONE.y - TOLERANCE ||
        e.y + e.hauteur > bas + TOLERANCE
    );
  expect(
    debordements.map((e) => `${e.texte} | page ${e.page} | x=${e.x.toFixed(1)} w=${e.largeur.toFixed(1)}`)
  ).toEqual([]);
}

function assertRenduSain(journal: JournalPdf): void {
  expect(journal.tablesRejetes).toEqual([]);
  expect(journal.caracteresNonEncodes).toEqual([]);
  assertDansLaPage(journal);
  assertDansLaZoneImprimable(journal);
}

describe('Phase 5 — PDF d’un bulletin', () => {
  it('produit un PDF A4 dont aucun élément ne déborde', async () => {
    const resultat = await genererPdfBulletin({ snapshot: snapshot(), meta: meta() });

    expect(resultat.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(resultat.pdf.length).toBeGreaterThan(2000);
    expect(resultat.pages).toBe(1);
    assertRenduSain(resultat.journal);

    const texte = texteDe(resultat.journal);
    expect(texte).toContain('LYCÉE DE TOUBA TOUL');
    expect(texte).toContain('BULLETIN DE NOTES');
    expect(texte).toContain('Ndiaye');
    expect(texte).toContain('15.20');
    expect(texte).toContain('Histoire-Géographie');
    expect(texte).toContain('1 sur 4');
    // rien d'inventé : l'agrément et les textes libres ne sont pas posés
    expect(texte).not.toContain('Agrément');
    expect(texte).toContain('Non renseigné');
  });

  it('un bulletin publié ne porte pas de filigrane, un brouillon si', async () => {
    const brouillon = await genererPdfBulletin({ snapshot: snapshot(), meta: meta() });
    expect(
      brouillon.journal.emplacements.filter((e) => e.role === 'filigrane').map((e) => e.texte)
    ).toEqual(['BROUILLON']);

    const publie = await genererPdfBulletin({
      snapshot: snapshot(),
      meta: meta({ statut: 'PUBLIE', publieLe: '2026-06-06T08:00:00.000Z' }),
    });
    expect(publie.journal.emplacements.filter((e) => e.role === 'filigrane')).toEqual([]);
    expect(texteDe(publie.journal)).toContain('document figé');
    assertRenduSain(publie.journal);
  });

  it('des noms de discipline et des appréciations démesurés tiennent dans la page', async () => {
    const nomInterminable =
      'Sciences physiques et chimie analytique appliquées aux procédés industriels de transformation';
    const motSansEspaces = 'Supramoléculaire'.repeat(14);
    const appreciationAuLong =
      'Élève sérieux et régulier, dont les progrès sont constants ; la participation en classe reste ' +
      'excellente et l’attention soutenue, même si quelques lacunes méthodiques doivent être comblées ' +
      'avant le prochain conseil de classe, notamment en rigueur de rédaction et en gestion du temps.';

    const s = snapshot();
    s.matieres = Array.from({ length: 28 }, (_, index) =>
      matiere({
        subjectId: `sub-${index}`,
        subjectName: index % 3 === 0 ? `${motSansEspaces}${index}` : nomInterminable,
        appreciation: index % 2 === 0 ? appreciationAuLong : null,
        moyenneAffichee: `${10 + (index % 10)}.00`,
      })
    );
    s.synthese.moyenneGeneraleAffichee = '15.20';

    const resultat = await genererPdfBulletin({ snapshot: s, meta: meta() });
    expect(resultat.pages).toBeGreaterThanOrEqual(2);
    assertRenduSain(resultat.journal);
    expect(resultat.journal.tablesRejetes).toEqual([]);

    // l'en-tête du tableau est réimprimé après le saut de page
    expect(
      resultat.journal.emplacements.some((e) => e.page === 2 && e.texte === 'Appréciation')
    ).toBe(true);
  });

  it('les données manquantes s’affichent comme manquantes, jamais comme des zéros', async () => {
    const s = snapshot();
    s.matieres = [
      matiere({
        moyenne: null,
        moyenneExacte: null,
        moyenneAffichee: null,
        pointsPonderes: null,
        rang: null,
        incomplet: true,
        motifs: ['aucune note validée : moyenne non calculable'],
        groupes: [
          groupe({
            moyenne: null,
            moyenneAffichee: null,
            notesValides: 0,
            notes: [note({ status: 'ABSENT', score: null }), note({ status: 'NON_SAISIE', score: null })],
          }),
        ],
      }),
    ];
    s.synthese = {
      totalPoints: '0',
      totalCoeficients: '0',
      moyenneGenerale: null,
      moyenneGeneraleExacte: null,
      moyenneGeneraleAffichee: null,
      rang: null,
      motifNonClasse: 'Aucune moyenne comptabilisée : élève non classé',
      effectif: 4,
      moyenneClasse: null,
      moyenneClasseExacte: null,
      moyenneClasseAffichee: null,
      incomplet: true,
    };
    s.motifs = ['Mathématiques : aucune note validée : moyenne non calculable'];

    const resultat = await genererPdfBulletin({ snapshot: s, meta: meta() });
    assertRenduSain(resultat.journal);

    const texte = texteDe(resultat.journal);
    expect(texte).toContain('Non calculable');
    expect(texte).toContain('(0/2 note(s))');
    expect(texte).toContain('Aucune moyenne comptabilisée : élève non classé');
    expect(texte).toContain('Bulletin incomplet');
    expect(texte).toContain('Données non enregistrées sur ce document');

    // aucun faux zéro : ni moyenne, ni total, ni points affichés comme 0
    const fauxZero = resultat.journal.emplacements
      .filter((e) => e.role === 'contenu')
      .filter((e) => /^0([.,]0+)?$/.test(e.texte.trim()));
    expect(fauxZero.map((e) => e.texte)).toEqual([]);
  });

  it('l’impression par lot met un élève par page dans un seul PDF', async () => {
    const items = ['Ndiaye', 'Diallo', 'Sow'].map((nom, index) => {
      const s = snapshot();
      s.eleve.nom = nom;
      s.eleve.matricule = `ELV-${index + 1}`;
      return { snapshot: s, meta: meta({ statut: 'PUBLIE', publieLe: '2026-06-06T08:00:00.000Z' }) };
    });

    const resultat = await genererPdfBulletins(items);
    expect(resultat.pages).toBe(3);
    assertRenduSain(resultat.journal);
    expect(texteDe(resultat.journal, 1)).toContain('Ndiaye');
    expect(texteDe(resultat.journal, 2)).toContain('Diallo');
    expect(texteDe(resultat.journal, 2)).not.toContain('Ndiaye');
    expect(texteDe(resultat.journal, 3)).toContain('Sow');
    expect(texteDe(resultat.journal, 1)).toContain('Page 1/3');
    expect(texteDe(resultat.journal, 3)).toContain('Page 3/3');
  });

  it('signale les caractères qu’Helvetica ne peut pas imprimer', async () => {
    const s = snapshot();
    s.motifs = ['Écart → à vérifier'];
    const resultat = await genererPdfBulletin({ snapshot: s, meta: meta() });
    expect(resultat.journal.caracteresNonEncodes.map((c) => c.caractere)).toContain('→');
    assertDansLaPage(resultat.journal);
    assertDansLaZoneImprimable(resultat.journal);
  });

  it('le bilan annuel affiche une moyenne non calculable quand le S2 manque', async () => {
    const bilan = bilanAnnuel();
    bilan.semestres[1] = {
      numero: 2,
      nom: 'Semestre 2',
      reportCardId: null,
      version: null,
      statut: null,
      moyenneGenerale: null,
      moyenneGeneraleAffichee: null,
      rang: null,
      effectif: null,
    };
    bilan.annuelle = {
      moyenne: null,
      moyenneExacte: null,
      moyenneAffichee: null,
      calculable: false,
      partiel: false,
      rangAnnuel: null,
      effectif: 4,
      motifs: ['Semestre(s) sans moyenne : S2', 'Moyenne annuelle non calculable'],
    };
    bilan.matieres = bilan.matieres.map((m) => ({
      ...m,
      s2: null,
      s2Affichee: null,
      annuelle: null,
      annuelleAffichee: null,
    }));

    const resultat = await genererPdfBilanAnnuel(
      bilan,
      meta({ statut: 'PUBLIE', publieLe: '2026-07-02T08:00:00.000Z', genereLe: '2026-07-01T08:00:00.000Z' })
    );
    assertRenduSain(resultat.journal);
    const texte = texteDe(resultat.journal);
    expect(texte).toContain('Moyenne annuelle non calculable');
    expect(texte).toContain('Aucun bulletin');
    expect(texte).toContain('Non classé');
    expect(texte).toContain('Bilan annuel');
    expect(texte).toContain('document figé');
    expect(resultat.journal.emplacements.filter((e) => e.role === 'filigrane')).toEqual([]);
  });
});

function bilanAnnuel(): SnapshotBilanAnnuel {
  const s = snapshot();
  return {
    versionSchema: VERSION_SNAPSHOT,
    genereLe: '2026-07-01T08:00:00.000Z',
    enTete: { ...s.enTete, intituleDocument: 'Bilan annuel' },
    eleve: s.eleve,
    regles: s.regles,
    semestres: [
      {
        numero: 1,
        nom: 'Semestre 1',
        reportCardId: 'rc-1',
        version: 1,
        statut: 'PUBLIE',
        moyenneGenerale: '15.2',
        moyenneGeneraleAffichee: '15.20',
        rang: 1,
        effectif: 4,
      },
      {
        numero: 2,
        nom: 'Semestre 2',
        reportCardId: 'rc-2',
        version: 1,
        statut: 'PUBLIE',
        moyenneGenerale: '18.2',
        moyenneGeneraleAffichee: '18.20',
        rang: 1,
        effectif: 4,
      },
    ],
    matieres: [
      {
        subjectId: 'sub-maths',
        subjectName: 'Mathématiques',
        coefficient: '3',
        s1: '16',
        s2: '19',
        s1Affichee: '16.00',
        s2Affichee: '19.00',
        annuelle: '17.5',
        annuelleAffichee: '17.50',
        motifs: [],
      },
    ],
    annuelle: {
      moyenne: '16.7',
      moyenneExacte: '16.7',
      moyenneAffichee: '16.70',
      calculable: true,
      partiel: false,
      rangAnnuel: 1,
      effectif: 4,
      motifs: [],
    },
    appreciation: 'Année solide, progrès réguliers.',
    mention: null,
    decisionConseil: null,
  };
}
