/**
 * Tests d'intégration de la phase 5 — bulletins versionnés, snapshots figés, bilan annuel.
 *
 * Les quatre cas imposés par le prompt de phase sont couverts ici :
 * 1. lien S1 / S2 (continuité du snapshot et liens de l'AnnualSummary) ;
 * 2. bulletin publié inchangé après modification des paramètres de l'établissement ;
 * 3. données manquantes affichées comme telles (jamais converties en 0) ;
 * 4. PDF sans débordement (journal de mise en page, contrôlé aussi sur des données réelles).
 *
 * Les cas limites de rendu (noms démesurés, lot multi-pages) sont dans bulletins-pdf.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/db/prisma';
import { HttpError } from '../src/lib/http';
import { cleanTestDb, createSchool, createUser } from './helpers';
import { creerContexte, creerScenarioSemestres, type Contexte } from './aide-bulletins';
import { construireSnapshot } from '../src/services/bulletins/construction';
import {
  corrigerBulletin,
  genererBulletin,
  genererBulletinsClasse,
  historiqueVersions,
  lireSnapshot,
  modifierChampsLibres,
  publierBulletins,
} from '../src/services/bulletins/bulletin';
import { construireSnapshotAnnuel, genererBilanAnnuel } from '../src/services/bulletins/annual';
import { genererPdfBulletin, ZONE } from '../src/services/bulletins/pdf';

const PASSWORD_USER = 'MotDePasse123456';

describe('Phase 5 — snapshot du bulletin', () => {
  let ctx: Contexte;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée de Touba Toul');
    const admin = await createUser({
      email: 'admin@bulletins.sn',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
      password: PASSWORD_USER,
    });
    ctx = await creerContexte(school.id, admin.id);
    await creerScenarioSemestres(ctx);
  });

  it('fige les notes, coefficients, règles et classements utilisés', async () => {
    const { card, cree } = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    expect(cree).toBe(true);
    expect(card.version).toBe(1);
    expect(card.statut).toBe('BOUILLON');
    expect(card.estCourant).toBe(true);
    expect(card.academicYearId).toBe(ctx.academicYearId);
    expect(card.moyenneGenerale?.toString()).toBe('15.2');
    expect(card.moyenneGeneraleExacte).toBe('15.2');
    expect(card.rang).toBe(1);
    expect(card.effectif).toBe(4);
    expect(card.totalPoints?.toString()).toBe('76');
    expect(card.totalCoeficients?.toString()).toBe('5');
    expect(card.incomplet).toBe(false);

    const snapshot = lireSnapshot(card);
    expect(snapshot.versionSchema).toBe(1);
    expect(snapshot.enTete.nomEtablissement).toBe('Lycée de Touba Toul');
    expect(snapshot.enTete.anneeScolaire.nom).toBe('2025-2026');
    expect(snapshot.enTete.semestre.numero).toBe(1);
    expect(snapshot.eleve.classe).toBe('TS 1');
    expect(snapshot.regles.poidsGroupes).toEqual({ DEVOIR: '1', COMPOSITION: '1', AUTRE: '0' });
    expect(snapshot.regles.formuleMatiere).toBe('POIDS_GROUPES');
    expect(snapshot.matieres).toHaveLength(2);

    const maths = snapshot.matieres.find((m) => m.subjectCode === 'MATH');
    expect(maths?.moyenne).toBe('16');
    expect(maths?.moyenneAffichee).toBe('16.00');
    expect(maths?.coefficient).toBe('3');
    expect(maths?.pointsPonderes).toBe('48');
    expect(maths?.rang).toBe(1);
    expect(maths?.groupes.map((g) => [g.category, g.moyenneAffichee, g.notesValides])).toEqual([
      ['DEVOIR', '16.00', 1],
      ['COMPOSITION', '16.00', 1],
    ]);
    expect(maths?.groupes[0].notes[0].title).toBe('Devoir 1 Maths S1');
    expect(maths?.groupes[0].notes[0].score).toBe('16');

    expect(snapshot.synthese.moyenneClasseAffichee).toBe('13.85');
    expect(snapshot.synthese.rang).toBe(1);
    expect(snapshot.absences).toMatchObject({
      disponible: true,
      absencesJustifiees: 0,
      absencesNonJustifiees: 0,
      retards: 0,
    });
    expect(snapshot.continuite.semestrePrecedent).toBeNull();

    // la génération est auditée même appelée sans requête HTTP
    const journal = await prisma.auditLog.findFirst({
      where: { schoolId: ctx.schoolId, action: 'REPORT_CARD_GENERATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(journal?.entityId).toBe(card.id);
  });

  it('un brouillon régénéré remplace la même version, sans multipliquer les lignes', async () => {
    const premier = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    const avant = await prisma.grade.findFirstOrThrow({
      where: {
        assessmentId: (await prisma.assessment.findFirstOrThrow({ where: { title: 'Devoir 1 Maths S1' } })).id,
        enrollmentId: ctx.eleves[0].enrollmentId,
      },
    });
    expect(avant.score?.toString()).toBe('16');
    await prisma.grade.update({
      where: { id: avant.id },
      data: { score: new Prisma.Decimal('18'), status: 'SAISIE' },
    });

    const second = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    expect(second.cree).toBe(false);
    expect(second.card.id).toBe(premier.card.id);
    expect(second.card.version).toBe(1);
    // 18 au lieu de 16 en devoirs : maths (18+16)/2 = 17 -> MG (51+28)/5 = 15.8
    expect(second.card.moyenneGeneraleExacte).toBe('15.8');
    expect(await prisma.reportCard.count({ where: { schoolId: ctx.schoolId } })).toBe(1);
  });

  it('un bulletin publié ne bouge pas quand les paramètres de l’établissement changent', async () => {
    const { card } = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[2].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    await publierBulletins({
      schoolId: ctx.schoolId,
      ids: [card.id],
      userId: ctx.userId,
    });

    const publie = await prisma.reportCard.findUniqueOrThrow({ where: { id: card.id } });
    const snapshotAvant = JSON.stringify(publie.snapshot);

    // L'établissement change de règles APRÈS publication : compositions à poids 2
    // et affichage à 4 décimales.
    await prisma.school.update({
      where: { id: ctx.schoolId },
      data: {
        poidsCompositions: new Prisma.Decimal('2'),
        arrondiDecimales: 4,
      },
    });

    await expect(
      genererBulletin({
        schoolId: ctx.schoolId,
        enrollmentId: ctx.eleves[2].enrollmentId,
        semesterId: ctx.semestre1Id,
        userId: ctx.userId,
      })
    ).rejects.toBeInstanceOf(HttpError);

    const apres = await prisma.reportCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(JSON.stringify(apres.snapshot)).toBe(snapshotAvant);
    expect(apres.moyenneGeneraleExacte).toBe('14.8');
    expect(apres.statut).toBe('PUBLIE');
    expect(apres.publieLe).not.toBeNull();

    // preuve que le gel change quelque chose : le même calcul refait
    // avec les nouveaux paramètres donne un autre résultat
    const frais = await construireSnapshot({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[2].enrollmentId,
      semesterId: ctx.semestre1Id,
    });
    expect(frais.synthese.moyenneGenerale).not.toBe(apres.moyenneGeneraleExacte);
    expect(frais.regles.poidsGroupes.COMPOSITION).toBe('2');
    expect(frais.regles.arrondiDecimales).toBe(4);
    expect(frais.regles.formuleMatiere).toBe('POIDS_GROUPES');
    // (13 + 2*15)/3 = 14,3333 en maths ; (17 + 2*15)/3 = 15,6667 en histoire -> 14,8667
    expect(frais.synthese.moyenneGeneraleAffichee).toBe('14.8667');
  });

  it('la correction après publication crée une nouvelle version et conserve l’ancienne', async () => {
    const { card } = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    await publierBulletins({ schoolId: ctx.schoolId, ids: [card.id], userId: ctx.userId });
    const avant = await prisma.reportCard.findUniqueOrThrow({ where: { id: card.id } });

    await expect(
      corrigerBulletin({
        schoolId: ctx.schoolId,
        reportCardId: card.id,
        userId: ctx.userId,
        motif: '  ',
      })
    ).rejects.toThrow(/motif/i);

    // une note corrigée entre en compte dans la nouvelle version
    const devoir = await prisma.assessment.findFirstOrThrow({ where: { title: 'Devoir 1 Maths S1' } });
    await prisma.grade.update({
      where: { assessmentId_enrollmentId: { assessmentId: devoir.id, enrollmentId: ctx.eleves[0].enrollmentId } },
      data: { score: new Prisma.Decimal('20') },
    });

    const nouvelle = await corrigerBulletin({
      schoolId: ctx.schoolId,
      reportCardId: card.id,
      userId: ctx.userId,
      motif: 'Note de devoir relevée après vérification',
    });

    expect(nouvelle.version).toBe(2);
    expect(nouvelle.estCourant).toBe(true);
    expect(nouvelle.statut).toBe('BOUILLON');
    expect(nouvelle.remplaceReportCardId).toBe(card.id);
    expect(nouvelle.motifCorrection).toBe('Note de devoir relevée après vérification');
    // maths (20+16)/2 = 18 -> MG (54+28)/5 = 16.4
    expect(nouvelle.moyenneGeneraleExacte).toBe('16.4');

    const archivee = await prisma.reportCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(archivee.estCourant).toBe(false);
    expect(archivee.statut).toBe('PUBLIE');
    expect(JSON.stringify(archivee.snapshot)).toBe(JSON.stringify(avant.snapshot));
    expect(archivee.moyenneGeneraleExacte).toBe('15.2');

    const historique = await historiqueVersions({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
    });
    expect(historique.map((v) => v.version)).toEqual([2, 1]);

    const journal = await prisma.auditLog.findFirst({
      where: { schoolId: ctx.schoolId, action: 'REPORT_CARD_CORRECTED' },
    });
    expect(journal?.entityId).toBe(nouvelle.id);
  });

  it('refuse les champs libres modifiés sur un bulletin publié', async () => {
    const { card } = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    const maj = await modifierChampsLibres({
      schoolId: ctx.schoolId,
      reportCardId: card.id,
      userId: ctx.userId,
      mention: 'Félicitations',
      appreciationsParMatiere: [{ subjectId: 'matiere-inconnue', appreciation: 'test' }],
    }).catch((erreur: unknown) => erreur);
    // matière absente du bulletin : refus explicite, aucune écriture partielle
    expect(maj).toBeInstanceOf(HttpError);

    const modifie = await modifierChampsLibres({
      schoolId: ctx.schoolId,
      reportCardId: card.id,
      userId: ctx.userId,
      mention: 'Félicitations',
      appreciationsParMatiere: [
        { subjectId: lireSnapshot(card).matieres[0].subjectId, appreciation: 'Très bon trimestre.' },
      ],
    });
    expect(modifie.mention).toBe('Félicitations');
    expect(lireSnapshot(modifie).matieres[0].appreciation).toBe('Très bon trimestre.');

    await publierBulletins({ schoolId: ctx.schoolId, ids: [card.id], userId: ctx.userId });
    await expect(
      modifierChampsLibres({
        schoolId: ctx.schoolId,
        reportCardId: card.id,
        userId: ctx.userId,
        mention: 'Changement après publication',
      })
    ).rejects.toThrow(/correction versionnée/);

    // l'appréciation saisie survit à une régénération ultérieure du brouillon
    const brouillon = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[1].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    await modifierChampsLibres({
      schoolId: ctx.schoolId,
      reportCardId: brouillon.card.id,
      userId: ctx.userId,
      appreciationsParMatiere: [
        { subjectId: lireSnapshot(brouillon.card).matieres[0].subjectId, appreciation: 'À renforcer.' },
      ],
    });
    const regenere = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[1].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    expect(lireSnapshot(regenere.card).matieres[0].appreciation).toBe('À renforcer.');
  });

  it('les données manquantes restent manquantes : aucune moyenne inventée', async () => {
    // Évaluation de Gamma en composition d'histoire annulée + devoir absent
    const composition = await prisma.assessment.findFirstOrThrow({ where: { title: 'Composition Histoire S1' } });
    await prisma.grade.update({
      where: { assessmentId_enrollmentId: { assessmentId: composition.id, enrollmentId: ctx.eleves[2].enrollmentId } },
      data: { score: null, status: 'ANNULEE' },
    });
    const devoirHistoire = await prisma.assessment.findFirstOrThrow({ where: { title: 'Devoir 1 Histoire S1' } });
    await prisma.grade.update({
      where: { assessmentId_enrollmentId: { assessmentId: devoirHistoire.id, enrollmentId: ctx.eleves[2].enrollmentId } },
      data: { score: null, status: 'ABSENT' },
    });

    const { card } = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[2].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    const snapshot = lireSnapshot(card);

    const histoire = snapshot.matieres.find((m) => m.subjectCode === 'HIGE');
    expect(histoire?.moyenne).toBeNull();
    expect(histoire?.moyenneAffichee).toBeNull();
    expect(histoire?.pointsPonderes).toBeNull();
    expect(histoire?.incomplet).toBe(true);
    expect(histoire?.groupes.find((g) => g.category === 'DEVOIR')?.notesValides).toBe(0);
    expect(histoire?.motifs.join(' ')).toMatch(/note/i);

    // aucune moyenne transformée en 0 : total des coefficients ramené à ceux du maths
    expect(card.moyenneGenerale?.toString()).toBe('14');
    expect(card.totalCoeficients?.toString()).toBe('3');
    expect(card.incomplet).toBe(true);
    expect(card.rang).toBeNull();
    expect(card.motifNonClasse).toBe('résultats incomplets');
    expect(snapshot.motifs.join(' ')).toContain('Histoire-Géographie');

    // le PDF dit le manque au lieu de masquer
    const pdf = await genererPdfBulletin({
      snapshot,
      meta: { version: card.version, statut: card.statut, genereLe: card.genereLe.toISOString() },
    });
    // Le journal consigne chaque ligne tracée : une cellule étroite peut couper
    // « Non calculable » sur deux lignes, on reconstitue donc le texte rendu.
    const rendu = pdf.journal.emplacements.map((e) => e.texte).join(' ').replace(/\s+/g, ' ');
    expect(rendu).toContain('Non calculable');
    expect(rendu).toMatch(/\(0\/\d note\(s\)\)/);
    expect(rendu).toContain('Bulletin incomplet');
    // Les seuls zéros isolés de ce PDF sont les deux compteurs d'absences.
    const emplacementsZero = pdf.journal.emplacements.filter((e) => /^0([.,]0+)?$/.test(e.texte.trim()));
    const lignesAbsences = pdf.journal.emplacements.filter((e) =>
      /^Absences (justifiées|non justifiées)$/.test(e.texte.trim())
    );
    expect(emplacementsZero).toHaveLength(2);
    expect(emplacementsZero.every((zero) =>
      lignesAbsences.some((libelle) => Math.abs(libelle.y - zero.y) < 0.01)
    )).toBe(true);
    expect(pdf.journal.tablesRejetes).toEqual([]);
    expect(pdf.journal.caracteresNonEncodes).toEqual([]);
  });

  it('le bulletin de S2 est lié à celui de S1', async () => {
    const s1 = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    await publierBulletins({ schoolId: ctx.schoolId, ids: [s1.card.id], userId: ctx.userId });

    const s2 = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre2Id,
      userId: ctx.userId,
    });
    const snapshotS2 = lireSnapshot(s2.card);
    expect(snapshotS2.enTete.semestre.numero).toBe(2);
    expect(snapshotS2.continuite.semestrePrecedent).not.toBeNull();
    expect(snapshotS2.continuite.semestrePrecedent?.reportCardId).toBe(s1.card.id);
    expect(snapshotS2.continuite.semestrePrecedent?.numero).toBe(1);
    expect(snapshotS2.continuite.semestrePrecedent?.moyenneGeneraleAffichee).toBe('15.20');
    expect(snapshotS2.continuite.semestrePrecedent?.statut).toBe('PUBLIE');
    expect(snapshotS2.continuite.changementClasse).toBe(false);

    // S1 seul ne produit jamais une annuelle ; S1 + S2 sí
    const bilan = await construireSnapshotAnnuel({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      academicYearId: ctx.academicYearId,
    });
    expect(bilan.semestres[0].reportCardId).toBe(s1.card.id);
    expect(bilan.semestres[1].reportCardId).toBe(s2.card.id);
    expect(bilan.annuelle.moyenne).toBe('16.7');
    expect(bilan.annuelle.calculable).toBe(true);
    expect(bilan.annuelle.rangAnnuel).toBe(1);
    expect(bilan.matieres.find((m) => m.subjectName === 'Mathématiques')?.annuelle).toBe('17.5');

    const { summary } = await genererBilanAnnuel({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      academicYearId: ctx.academicYearId,
      userId: ctx.userId,
    });
    expect(summary.s1ReportCardId).toBe(s1.card.id);
    expect(summary.s2ReportCardId).toBe(s2.card.id);
    expect(summary.moyenneAnnuelleExacte).toBe('16.7');
    expect(summary.calculable).toBe(true);
  });

  it('le bilan annuel refuse une moyenne sur un seul semestre', async () => {
    await prisma.assessment.updateMany({
      where: { schoolId: ctx.schoolId, semesterId: ctx.semestre2Id },
      data: { status: 'BOUILLON' },
    });

    const bilan = await construireSnapshotAnnuel({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      academicYearId: ctx.academicYearId,
    });
    expect(bilan.semestres[1].moyenneGenerale).toBeNull();
    expect(bilan.annuelle.moyenne).toBeNull();
    expect(bilan.annuelle.calculable).toBe(false);
    expect(bilan.annuelle.motifs.join(' ')).toContain('S2');
    expect(bilan.annuelle.rangAnnuel).toBeNull();

    // réglage explicite « partiel » : la valeur est marquée comme partielle, jamais présentée comme définitive
    await prisma.school.update({
      where: { id: ctx.schoolId },
      data: { annuelSiSemestreManquant: 'PARTIEL' },
    });
    const partiel = await genererBilanAnnuel({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      academicYearId: ctx.academicYearId,
      userId: ctx.userId,
    });
    expect(partiel.summary.partiel).toBe(true);
    expect(partiel.summary.calculable).toBe(false);
    expect(partiel.summary.moyenneAnnuelleExacte).toBe('15.2');
    expect(partiel.summary.motifs.join(' ')).toContain('partielle');
  });

  it('l’impression par lot génère toute la classe sans écraser les publiés', async () => {
    const un = await genererBulletin({
      schoolId: ctx.schoolId,
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    await publierBulletins({ schoolId: ctx.schoolId, ids: [un.card.id], userId: ctx.userId });

    const lot = await genererBulletinsClasse({
      schoolId: ctx.schoolId,
      classroomId: ctx.classroomId,
      semesterId: ctx.semestre1Id,
      userId: ctx.userId,
    });
    expect(lot.generes).toBe(3);
    expect(lot.maj).toBe(0);
    expect(lot.ignores).toEqual([
      { enrollmentId: ctx.eleves[0].enrollmentId, motif: 'bulletin déjà publié' },
    ]);
    expect(await prisma.reportCard.count({ where: { schoolId: ctx.schoolId } })).toBe(4);

    const publie = await prisma.reportCard.findUniqueOrThrow({ where: { id: un.card.id } });
    expect(publie.publieLe).not.toBeNull();
    const pdf = await genererPdfBulletin({
      snapshot: lireSnapshot(publie),
      meta: {
        version: publie.version,
        statut: publie.statut,
        publieLe: publie.publieLe?.toISOString() ?? null,
        genereLe: publie.genereLe?.toISOString() ?? null,
      },
      textes: { mention: publie.mention, decisionConseil: publie.decisionConseil },
    });
    expect(pdf.pages).toBe(1);
    // le contenu tient dans la zone imprimable, les pieds de page dans la marge basse
    const { journal } = pdf;
    expect(journal.tablesRejetes).toEqual([]);
    expect(journal.caracteresNonEncodes).toEqual([]);
    const debordants = journal.emplacements
      .filter((e) => e.role === 'contenu')
      .filter(
        (e) =>
          e.x < ZONE.x ||
          e.x + e.largeur > ZONE.x + ZONE.largeur + 0.01 ||
          e.y < ZONE.y ||
          e.y + e.hauteur > ZONE.y + ZONE.hauteur + 0.01
      )
      .map((e) => `${e.role} | ${e.texte} | y=${e.y.toFixed(1)} h=${e.hauteur.toFixed(1)}`);
    expect(debordants).toEqual([]);
    const horsFeuille = journal.emplacements
      .filter((e) => e.x < 0 || e.y < 0 || e.x + e.largeur > journal.largeurPage || e.y + e.hauteur > journal.hauteurPage)
      .map((e) => `${e.role} | ${e.texte}`);
    expect(horsFeuille).toEqual([]);
    const textes = journal.emplacements.map((e) => e.texte);
    expect(textes.some((t) => t.includes('Alpha'))).toBe(true);
    expect(textes.some((t) => t.includes('document figé'))).toBe(true);
  });

  it('un élève d’un autre établissement ne peut pas être atteint', async () => {
    const autre = await createSchool('Autre Lycée');
    await expect(
      construireSnapshot({
        schoolId: autre.id,
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
      })
    ).rejects.toThrow(/Inscription introuvable/);
    expect(await prisma.reportCard.count({ where: { schoolId: autre.id } })).toBe(0);
  });
});
