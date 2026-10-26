import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  calculerMoyenneMatiere,
  calculerResultatsEleve,
  classerEleves,
  calculerMoyenneAnnuelle,
  formaterNote,
  DEFAULT_PARAMETRES,
  type MatiereInput,
  type ParametresCalcul,
} from '../src/services/calcul';

/** Construit une matière avec des évaluations. `notes` : [statut, score, bareme]. */
function matiere(
  id: string,
  coefficient: string | number,
  evals: { id: string; categorie: 'DEVOIR' | 'COMPOSITION' | 'AUTRE'; notes: [string, (string | number | null)?, (string | number)?][] }[],
  extra: Partial<MatiereInput> = {}
): MatiereInput {
  return {
    subjectId: id,
    subjectName: id,
    coefficient,
    evaluations: evals.map((e) => ({
      assessmentId: e.id,
      category: e.categorie,
      notes: e.notes.map(([status, score, outOf]) => ({
        status: status as 'SAISIE' | 'ABSENT' | 'ANNULEE' | 'NON_SAISIE',
        score: score ?? null,
        outOf,
      })),
    })),
    ...extra,
  };
}

describe('§10 — moyenne par matière', () => {
  it('moyenne simple : (devoirs + compositions) / 2 par défaut', () => {
    const m = matiere('FRAN', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 12]] },
      { id: 'd2', categorie: 'DEVOIR', notes: [['SAISIE', 14]] },
      { id: 'c1', categorie: 'COMPOSITION', notes: [['SAISIE', 8]] },
    ]);
    const r = calculerMoyenneMatiere(m);
    // moy. devoirs = 13, moy. compositions = 8 → (13 + 8) / 2 = 10,5
    expect(r.moyenne?.toString()).toBe('10.5');
    expect(r.motifs).toEqual([]);
  });

  it('moyenne pondérée par groupe quand les poids diffèrent', () => {
    const m = matiere('MATH', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] },
      { id: 'c1', categorie: 'COMPOSITION', notes: [['SAISIE', 16]] },
    ]);
    const r = calculerMoyenneMatiere(m, { poidsGroupes: { DEVOIR: 1, COMPOSITION: 3 } });
    // (10*1 + 16*3) / 4 = 14,5
    expect(r.moyenne?.toString()).toBe('14.5');
  });

  it('note manquante (NON_SAISIE) : ignorée, jamais convertie en 0', () => {
    const m = matiere('SVT', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 12]] },
      { id: 'd2', categorie: 'DEVOIR', notes: [['NON_SAISIE', null]] },
    ]);
    const r = calculerMoyenneMatiere(m);
    expect(r.moyenne?.toString()).toBe('12');
    expect(r.incomplet).toBe(true);
    expect(r.motifs.join(' ')).toContain('note manquante');
  });

  it('absence : exclue par défaut, comptée comme 0 seulement sur règle explicite', () => {
    const m = matiere('HG', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 16]] },
      { id: 'd2', categorie: 'DEVOIR', notes: [['ABSENT', null]] },
    ]);
    expect(calculerMoyenneMatiere(m).moyenne?.toString()).toBe('16');
    const avecRegle = calculerMoyenneMatiere(m, { absencesComptentZero: true });
    expect(avecRegle.moyenne?.toString()).toBe('8');
  });

  it('zéro saisi est une note valide ; zéro absent n’en est pas une', () => {
    const mZero = matiere('PC', 1, [{ id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 0]] }]);
    expect(calculerMoyenneMatiere(mZero).moyenne?.toString()).toBe('0');
    const mAb = matiere('PC', 1, [{ id: 'd1', categorie: 'DEVOIR', notes: [['ABSENT', 0]] }]);
    expect(mAb.evaluations[0].notes[0].score).toBe(0);
    expect(calculerMoyenneMatiere(mAb).moyenne).toBeNull();
  });

  it('note annulée : exclue du calcul', () => {
    const m = matiere('ANG', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] },
      { id: 'd2', categorie: 'DEVOIR', notes: [['ANNULEE', 20]] },
    ]);
    expect(calculerMoyenneMatiere(m).moyenne?.toString()).toBe('10');
  });

  it('barème hors /20 : normalisation sur 20', () => {
    const m = matiere('PHILO', 1, [
      { id: 'c1', categorie: 'COMPOSITION', notes: [['SAISIE', 36, 40]] },
    ]);
    expect(calculerMoyenneMatiere(m).moyenne?.toString()).toBe('18');
  });

  it('matière sans aucune note valide : moyenne non calculable', () => {
    const m = matiere('EPS', 1, [{ id: 'd1', categorie: 'DEVOIR', notes: [['NON_SAISIE', null]] }]);
    const r = calculerMoyenneMatiere(m);
    expect(r.moyenne).toBeNull();
    expect(r.motifs.join(' ')).toContain('aucune note exploitable');
  });

  it('groupe attendu vide : bloquant si configuré, sinon exclu du dénominateur', () => {
    const m = matiere('ESP', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 12]] },
      { id: 'c1', categorie: 'COMPOSITION', notes: [['NON_SAISIE', null]] },
    ]);
    expect(calculerMoyenneMatiere(m).moyenne?.toString()).toBe('12');
    const bloquant = calculerMoyenneMatiere(m, { groupeSansNote: 'bloquant' });
    expect(bloquant.moyenne).toBeNull();
  });

  it('catégorie AUTRE hors formule par défaut, comptée si poids configuré', () => {
    const m = matiere('ARABE', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] },
      { id: 'a1', categorie: 'AUTRE', notes: [['SAISIE', 18]] },
    ]);
    expect(calculerMoyenneMatiere(m).moyenne?.toString()).toBe('10');
    expect(calculerMoyenneMatiere(m, { poidsGroupes: { DEVOIR: 1, AUTRE: 1 } }).moyenne?.toString()).toBe('14');
  });

  it('décimales : précision interne conservée avant affichage', () => {
    const m = matiere('INFO', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] },
      { id: 'd2', categorie: 'DEVOIR', notes: [['SAISIE', 11]] },
      { id: 'c1', categorie: 'COMPOSITION', notes: [['SAISIE', 12]] },
    ]);
    const r = calculerMoyenneMatiere(m);
    // moy devoirs = 10.5 ; (10.5 + 12)/2 = 11.25 exactement
    expect(r.moyenne?.toString()).toBe('11.25');
    expect(formaterNote(r.moyenne, 1)).toBe('11.3');
  });

  it('règle « toutes notes confondues » : les poids de groupes ne s’appliquent plus', () => {
    const m = matiere('MATH', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] },
      { id: 'd2', categorie: 'DEVOIR', notes: [['SAISIE', 12]] },
      { id: 'c1', categorie: 'COMPOSITION', notes: [['SAISIE', 16]] },
    ]);
    // réglage par défaut : moy. devoirs 11, composition 16 → (11 + 16) / 2 = 13,5
    expect(calculerMoyenneMatiere(m).moyenne?.toString()).toBe('13.5');
    // toutes notes confondues : (10 + 12 + 16) / 3 = 12,6667
    const r = calculerMoyenneMatiere(m, { regleMatiere: 'MOYENNE_TOUTES_NOTES' });
    expect(formaterNote(r.moyenne, 2)).toBe('12.67');
    // un poids de composition écrasant ne change rien : la règle ignore les groupes
    const pondere = calculerMoyenneMatiere(m, {
      regleMatiere: 'MOYENNE_TOUTES_NOTES',
      poidsGroupes: { DEVOIR: 1, COMPOSITION: 9 },
    });
    expect(formaterNote(pondere.moyenne, 2)).toBe('12.67');
    expect(r.motifs.join(' ')).toMatch(/toutes notes confondues/);
  });

  it('toutes notes confondues sans note exploitable : moyenne null et matière incomplète', () => {
    const m = matiere('MATH', 1, [
      { id: 'd1', categorie: 'DEVOIR', notes: [['ABSENT', null]] },
      { id: 'c1', categorie: 'COMPOSITION', notes: [['ANNULEE', null]] },
    ]);
    const r = calculerMoyenneMatiere(m, { regleMatiere: 'MOYENNE_TOUTES_NOTES' });
    expect(r.moyenne).toBeNull();
    expect(r.incomplet).toBe(true);
    expect(r.motifs.join(' ')).toMatch(/aucune note exploitable/);
  });
});

describe('§10 — moyenne générale et points pondérés', () => {
  it('M = Σ(moy × coef) / Σ(coef)', () => {
    const matieres = [
      matiere('A', 2, [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] }]),
      matiere('B', 3, [{ id: 'b1', categorie: 'DEVOIR', notes: [['SAISIE', 15]] }]),
    ];
    const r = calculerResultatsEleve(matieres);
    expect(r.totalCoeficients.toString()).toBe('5');
    expect(r.totalPoints.toString()).toBe('65'); // 20 + 45
    expect(r.moyenneGenerale?.toString()).toBe('13');
  });

  it('coefficient nul ou négatif : matière exclue du dénominateur', () => {
    const matieres = [
      matiere('A', 0, [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 0]] }]),
      matiere('B', 2, [{ id: 'b1', categorie: 'DEVOIR', notes: [['SAISIE', 14]] }]),
      matiere('C', -1, [{ id: 'c1', categorie: 'DEVOIR', notes: [['SAISIE', 6]] }]),
    ];
    const r = calculerResultatsEleve(matieres);
    expect(r.moyenneGenerale?.toString()).toBe('14');
    expect(r.matieres.find((m) => m.subjectId === 'A')?.comptabilisee).toBe(false);
    expect(r.matieres.find((m) => m.subjectId === 'C')?.comptabilisee).toBe(false);
  });

  it('coefficient invalide (non numérique) : matière exclue avec motif', () => {
    const r = calculerResultatsEleve([
      matiere('A', 'abc', [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 12]] }]),
      matiere('B', 1, [{ id: 'b1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] }]),
    ]);
    expect(r.moyenneGenerale?.toString()).toBe('10');
    expect(r.motifs.join(' ')).toContain('coefficient');
  });

  it('matière non comptabilisée : ignorée même si la moyenne existe', () => {
    const matieres = [
      matiere('A', 4, [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 4]] }], { comptabilisee: false }),
      matiere('B', 1, [{ id: 'b1', categorie: 'DEVOIR', notes: [['SAISIE', 18]] }]),
    ];
    const r = calculerResultatsEleve(matieres);
    expect(r.moyenneGenerale?.toString()).toBe('18');
  });

  it('matière sans moyenne calculable : hors dénominateur, résultat signalé incomplet', () => {
    const matieres = [
      matiere('A', 3, [{ id: 'a1', categorie: 'DEVOIR', notes: [['NON_SAISIE', null]] }]),
      matiere('B', 1, [{ id: 'b1', categorie: 'DEVOIR', notes: [['SAISIE', 12]] }]),
    ];
    const r = calculerResultatsEleve(matieres);
    expect(r.moyenneGenerale?.toString()).toBe('12');
    expect(r.incomplet).toBe(true);
  });

  it('changement de coefficient en cours d’année : seule la version effective compte', () => {
    const avecVersion = matiere('A', 1, [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] }]);
    const remplacee = { ...avecVersion, effectiveTo: new Date('2026-06-30') };
    const r = calculerResultatsEleve([
      remplacee,
      { ...matiere('A', 3, [{ id: 'b1', categorie: 'DEVOIR', notes: [['SAISIE', 16]] }]) },
    ]);
    // A(v1) exclue (version close), A(v2) coef 3 → 16
    expect(r.moyenneGenerale?.toString()).toBe('16');
    expect(r.matieres.find((m) => m.effectiveTo instanceof Date)?.comptabilisee).toBe(false);
  });

  it('aucune matière comptabilisée : moyenne non calculable, jamais 0', () => {
    const r = calculerResultatsEleve([
      matiere('A', 0, [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 12]] }]),
    ]);
    expect(r.moyenneGenerale).toBeNull();
    expect(r.totalCoeficients.isZero()).toBe(true);
  });
});

describe('§10 — rangs et ex æquo', () => {
  it('ex æquo : rang identique, rang suivant sauté (1, 2, 2, 4)', () => {
    const rangs = classerEleves([
      { eleveId: 'x', moyenne: new Decimal('15') },
      { eleveId: 'a', moyenne: new Decimal('12') },
      { eleveId: 'b', moyenne: new Decimal('12') },
      { eleveId: 'c', moyenne: new Decimal('10') },
    ]);
    expect(rangs.map((r) => [r.eleveId, r.rang])).toEqual([
      ['x', 1],
      ['a', 2],
      ['b', 2],
      ['c', 4],
    ]);
  });

  it('mode dense : pas de rang sauté (1, 2, 2, 3)', () => {
    const rangs = classerEleves(
      [
        { eleveId: 'a', moyenne: new Decimal('12') },
        { eleveId: 'b', moyenne: new Decimal('12') },
        { eleveId: 'c', moyenne: new Decimal('10') },
      ],
      { rangMode: 'dense' }
    );
    expect(rangs.map((r) => r.rang)).toEqual([1, 1, 2]);
  });

  it('l’ex æquo est jugé sur la valeur exacte, pas sur l’arrondi', () => {
    const rangs = classerEleves([
      { eleveId: 'a', moyenne: new Decimal('12.441') },
      { eleveId: 'b', moyenne: new Decimal('12.442') },
    ]);
    expect(rangs[0].rang).not.toBe(rangs[1].rang);
    expect(formaterNote(rangs[0].moyenne, 2)).toBe(formaterNote(rangs[1].moyenne, 2));
  });

  it('élève sans moyenne : non classé, jamais classé dernier par défaut', () => {
    const rangs = classerEleves([
      { eleveId: 'a', moyenne: new Decimal('10') },
      { eleveId: 'z', moyenne: null },
    ]);
    expect(rangs.find((r) => r.eleveId === 'z')?.rang).toBeNull();
    expect(rangs.find((r) => r.eleveId === 'a')?.rang).toBe(1);
  });

  it('classe incomplète : élève à résultats partiels écarté du classement', () => {
    const rangs = classerEleves([
      { eleveId: 'a', moyenne: new Decimal('10'), incomplet: true },
      { eleveId: 'b', moyenne: new Decimal('9') },
    ]);
    expect(rangs.find((r) => r.eleveId === 'a')?.rang).toBeNull();
    expect(rangs.find((r) => r.eleveId === 'b')?.rang).toBe(1);
    const toutClass = classerEleves(
      [
        { eleveId: 'a', moyenne: new Decimal('10'), incomplet: true },
        { eleveId: 'b', moyenne: new Decimal('9') },
      ],
      { classerResultatsIncomplets: true }
    );
    expect(toutClass.find((r) => r.eleveId === 'a')?.rang).toBe(1);
  });
});

describe('§10 — continuité S1 / S2 et moyenne annuelle', () => {
  const p1 : ParametresCalcul = { ...DEFAULT_PARAMETRES };

  it('moyenne annuelle par défaut : (S1 + S2) / 2', () => {
    const r = calculerMoyenneAnnuelle(new Decimal('12'), new Decimal('14'), p1);
    expect(r.moyenne?.toString()).toBe('13');
    expect(r.calculable).toBe(true);
  });

  it('pondération personnalisée des semestres', () => {
    const r = calculerMoyenneAnnuelle(new Decimal('10'), new Decimal('16'), {
      ...p1,
      poidsSemestres: { s1: 1, s2: 3 },
    });
    expect(r.moyenne?.toString()).toBe('14.5');
  });

  it('un seul semestre : annuel non calculable par défaut, partiel sur demande', () => {
    const défaut = calculerMoyenneAnnuelle(new Decimal('12'), null, p1);
    expect(défaut.moyenne).toBeNull();
    expect(défaut.motifs.join(' ')).toContain('second semestre');
    const partiel = calculerMoyenneAnnuelle(new Decimal('12'), null, {
      ...p1,
      annuelSiSemestreManquant: 'partiel',
    });
    expect(partiel.moyenne?.toString()).toBe('12');
    expect(partiel.partiel).toBe(true);
  });

  it('S1 et S2 indépendants : la saisie du S2 ne touche pas au S1', () => {
    const s1 = calculerResultatsEleve([matiere('A', 1, [{ id: 'a1', categorie: 'DEVOIR', notes: [['SAISIE', 10]] }])]);
    const s2 = calculerResultatsEleve([matiere('A', 1, [{ id: 'a2', categorie: 'DEVOIR', notes: [['SAISIE', 16]] }])]);
    expect(s1.moyenneGenerale?.toString()).toBe('10');
    expect(s2.moyenneGenerale?.toString()).toBe('16');
    expect(calculerMoyenneAnnuelle(s1.moyenneGenerale ?? null, s2.moyenneGenerale ?? null, p1).moyenne?.toString()).toBe('13');
  });

  it('le calcul ne produit aucune valeur quand la matière est absente des deux semestres', () => {
    const r = calculerMoyenneAnnuelle(null, null, p1);
    expect(r.moyenne).toBeNull();
    expect(r.calculable).toBe(false);
  });
});

describe('Arrondi à l’affichage seulement', () => {
  it('half-up par défaut, 2 décimales', () => {
    expect(formaterNote(new Decimal('12.345'), 2)).toBe('12.35');
    expect(formaterNote(new Decimal('12.5'), 0)).toBe('13');
  });

  it('half-even configurable', () => {
    expect(formaterNote(new Decimal('12.5'), 0, 'half-even')).toBe('12');
    expect(formaterNote(new Decimal('13.5'), 0, 'half-even')).toBe('14');
  });

  it('valeur interne inchangée par l’affichage', () => {
    const d = new Decimal('10.6666666667');
    expect(formaterNote(d, 2)).toBe('10.67');
    expect(d.toString()).toBe('10.6666666667');
  });

  it('null reste null : aucune valeur fictive', () => {
    expect(formaterNote(null, 2)).toBeNull();
  });
});
