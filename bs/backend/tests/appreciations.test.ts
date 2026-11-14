import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import {
  DEFAULT_APPRECIATION_RULES,
  appreciationMatiere,
  chargerReglesAppreciation,
  choisirRegle,
  choisirVarianteStable,
  decisionPour,
  ensureDefaultAppreciationRules,
  genererAppreciationGenerale,
  mentionPour,
} from '../src/services/appreciations';
import { cleanTestDb, createSchool, createUser } from './helpers';

async function loginAs(email: string) {
  const agent = request.agent(app);
  const session = await agent.get('/api/auth/session');
  const csrf = session.body.csrfToken as string;
  const login = await agent.post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: 'MotDePasse123456' });
  return { agent, csrf: (login.body.csrfToken as string | undefined) ?? csrf };
}

describe('Appréciations automatiques', () => {
  let schoolId: string;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('École appréciations');
    schoolId = school.id;
  });

  it('crée les 30 règles par défaut et reste idempotent', async () => {
    await ensureDefaultAppreciationRules(schoolId);
    await ensureDefaultAppreciationRules(schoolId);

    expect(DEFAULT_APPRECIATION_RULES).toHaveLength(30);
    expect(await prisma.appreciationRule.count({ where: { schoolId } })).toBe(30);
    expect(
      await prisma.appreciationRule.count({ where: { schoolId, scope: 'MATIERE' } }),
    ).toBe(8);
    expect(
      await prisma.appreciationRule.count({ where: { schoolId, scope: 'DECISION' } }),
    ).toBe(6);
  });

  it('ne remplace jamais une règle personnalisée', async () => {
    await ensureDefaultAppreciationRules(schoolId);
    await prisma.appreciationRule.update({
      where: { schoolId_scope_code: { schoolId, scope: 'MENTION', code: 'MENTION_14_16' } },
      data: { label: 'Honneur établissement', content: 'Honneur établissement' },
    });

    await ensureDefaultAppreciationRules(schoolId);

    const regle = await prisma.appreciationRule.findUnique({
      where: { schoolId_scope_code: { schoolId, scope: 'MENTION', code: 'MENTION_14_16' } },
    });
    expect(regle?.label).toBe('Honneur établissement');
    expect(await prisma.appreciationRule.count({ where: { schoolId } })).toBe(30);
  });

  it('applique les bons seuils aux mentions et décisions', async () => {
    const rules = await chargerReglesAppreciation(schoolId);

    expect(mentionPour(rules.mention, '4.99')).toBe('Très faible');
    expect(mentionPour(rules.mention, '5')).toBe('Faible');
    expect(mentionPour(rules.mention, '9.99')).toBe('Insuffisant');
    expect(mentionPour(rules.mention, '10')).toBe('Passable');
    expect(mentionPour(rules.mention, '15.99')).toBe('Bien');
    expect(mentionPour(rules.mention, '16')).toBe('Très bien');
    expect(mentionPour(rules.mention, '20')).toBe('Excellent');
    expect(mentionPour(rules.mention, '20.01')).toBeNull();
    expect(mentionPour(rules.mention, null)).toBeNull();

    expect(decisionPour(rules.decision, '7.99')).toBe('Avertissement travail');
    expect(decisionPour(rules.decision, '8')).toBe('Avertissement travail');
    expect(decisionPour(rules.decision, '10')).toBe('Passable');
    expect(decisionPour(rules.decision, '12')).toBe('Encouragements');
    expect(decisionPour(rules.decision, '14')).toBe("Tableau d'honneur");
    expect(decisionPour(rules.decision, '16')).toBe('Félicitations');
    expect(decisionPour(rules.decision, null)).toBeNull();
  });

  it('applique les bons seuils aux appréciations de matière', async () => {
    const rules = await chargerReglesAppreciation(schoolId);
    expect(appreciationMatiere(rules.matiere, '4.99')).toBe('Très faible');
    expect(appreciationMatiere(rules.matiere, '5')).toBe('Faible');
    expect(appreciationMatiere(rules.matiere, '8')).toBe('Insuffisant');
    expect(appreciationMatiere(rules.matiere, '13')).toBe('Assez bien');
    expect(appreciationMatiere(rules.matiere, '18')).toBe('Excellent');
    expect(appreciationMatiere(rules.matiere, null)).toBeNull();
  });

  it('génère un texte stable, sans placeholder, avec mention et décision', async () => {
    const rules = await chargerReglesAppreciation(schoolId);
    const commun = {
      studentId: 'eleve-1',
      prenom: 'Awa',
      moyenne: '13.50',
      matieres: [
        { subjectName: 'Mathématiques', moyenne: '18' },
        { subjectName: 'Histoire-Géographie', moyenne: '15' },
        { subjectName: 'SVT', moyenne: '6' },
      ],
      rules,
      seed: 'eleve-1:semestre-1',
    };

    const premier = genererAppreciationGenerale(commun);
    const second = genererAppreciationGenerale(commun);

    expect(premier).toEqual(second);
    expect(premier.mention).toBe('Assez bien');
    expect(premier.decision).toBe('Encouragements');
    expect(premier.appreciation).toContain('Awa');
    expect(premier.appreciation).toContain('13,50/20');
    expect(premier.appreciation).toContain('Mathématiques');
    expect(premier.appreciation).toContain('SVT');
    expect(premier.appreciation).not.toContain('{');
    expect(premier.appreciation).not.toContain('}');
    expect(premier.appreciation?.split(/[.!?]+/).filter(Boolean).length).toBeLessThanOrEqual(3);
  });

  it('mentionne la progression et les absences sans inventer de moyenne', async () => {
    const rules = await chargerReglesAppreciation(schoolId);
    const resultat = genererAppreciationGenerale({
      studentId: 'eleve-2',
      prenom: 'Moussa',
      moyenne: '14.20',
      moyennePrecedente: '11.40',
      absences: { total: 2, nonJustifiees: 1 },
      matieres: [{ subjectName: 'Mathématiques', moyenne: '14.20' }],
      rules,
    });

    expect(resultat.appreciation).toContain('progression');
    expect(resultat.appreciation).toContain('2 absence(s)');
    expect(resultat.appreciation).toContain('1 non justifiée(s)');

    expect(
      genererAppreciationGenerale({
        studentId: 'eleve-3',
        prenom: 'Sans note',
        moyenne: null,
        matieres: [],
        rules,
      }),
    ).toEqual({ appreciation: null, mention: null, decision: null });
  });

  it('sélectionne une variante de façon déterministe', () => {
    const texte = 'Première phrase.||Deuxième phrase.||Troisième phrase.';
    expect(choisirVarianteStable(texte, 'seed-a')).toBe(choisirVarianteStable(texte, 'seed-a'));
    expect(texte.split('||')).toContain(choisirVarianteStable(texte, 'seed-a'));
  });

  it('retourne null quand aucun seuil ne correspond', () => {
    expect(choisirRegle([], '12')).toBeNull();
  });

  it('expose et enregistre uniquement les règles de l’établissement connecté', async () => {
    await createUser({
      email: 'admin-appreciations@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId,
    });
    const { agent, csrf } = await loginAs('admin-appreciations@test.sn');
    const initial = await agent.get('/api/schooling/appreciation-rules');
    expect(initial.status).toBe(200);
    expect(initial.body.rules).toHaveLength(30);

    const rule = initial.body.rules.find(
      (item: { scope: string; code: string }) =>
        item.scope === 'MENTION' && item.code === 'MENTION_14_16',
    );
    const updated = await agent
      .put('/api/schooling/appreciation-rules')
      .set('x-csrf-token', csrf)
      .send({
        rules: [{
          scope: rule.scope,
          code: rule.code,
          label: 'Mention établissement',
          minScore: rule.minScore,
          maxScore: rule.maxScore,
          content: 'Mention établissement',
          sortOrder: rule.sortOrder,
          isActive: true,
        }],
      });

    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.rules[0].label).toBe('Mention établissement');
    expect(
      await prisma.appreciationRule.findUniqueOrThrow({
        where: { schoolId_scope_code: { schoolId, scope: 'MENTION', code: 'MENTION_14_16' } },
      }),
    ).toMatchObject({ label: 'Mention établissement' });
  });
});
