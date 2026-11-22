import { prisma } from '../../db/prisma';
import { cleNiveau, ensureDefaultLevels, normaliserTexteValeur } from '../levels';

export interface ModeleMatiere {
  cle: string;
  nom: string;
  coefficient: string;
  ordre: number;
  parent?: string;
  groupe?: boolean;
  choix?: boolean;
  option?: boolean;
  actif?: boolean;
}

const FRANCAIS: ModeleMatiere[] = [
  { cle: 'FRANCAIS', nom: 'Français', coefficient: '4', ordre: 1, groupe: true },
  { cle: 'FR_REDACTION', nom: 'Rédaction', coefficient: '2', ordre: 1, parent: 'FRANCAIS' },
  { cle: 'FR_TSQ', nom: 'Texte Suivi de Questions', coefficient: '1', ordre: 2, parent: 'FRANCAIS' },
  { cle: 'FR_ORTHOGRAPHE', nom: 'Orthographe', coefficient: '1', ordre: 3, parent: 'FRANCAIS' },
  {
    cle: 'FR_RECITATION',
    nom: 'Récitation',
    coefficient: '1',
    ordre: 4,
    parent: 'FRANCAIS',
    actif: false,
  },
];

const SOCLE: ModeleMatiere[] = [
  { cle: 'MATHEMATIQUES', nom: 'Mathématiques', coefficient: '3', ordre: 2 },
  { cle: 'ANGLAIS', nom: 'Anglais', coefficient: '2', ordre: 3 },
  { cle: 'HISTOIRE_GEOGRAPHIE', nom: 'Histoire-Géographie', coefficient: '2', ordre: 4 },
  { cle: 'SVT', nom: 'SVT', coefficient: '2', ordre: 5 },
];

const FIN: ModeleMatiere[] = [
  { cle: 'EPS', nom: 'EPS', coefficient: '2', ordre: 90 },
  { cle: 'EDUCATION_CIVIQUE', nom: 'Éducation Civique', coefficient: '1', ordre: 99 },
];

function prefixer(prefix: string, modeles: ModeleMatiere[]): ModeleMatiere[] {
  return modeles.map((modele) => ({
    ...modele,
    cle: `${prefix}_${modele.cle}`,
    parent: modele.parent ? `${prefix}_${modele.parent}` : undefined,
  }));
}

export const MODELES_PAR_NIVEAU: Record<string, ModeleMatiere[]> = {
  '6e': [
    ...prefixer('6E', FRANCAIS),
    ...prefixer('6E', SOCLE),
    { cle: '6E_EPS', nom: 'EPS', coefficient: '2', ordre: 90 },
    { cle: '6E_CONDUITE', nom: 'Conduite', coefficient: '1', ordre: 96 },
    { cle: '6E_EDUCATION_CIVIQUE', nom: 'Éducation Civique', coefficient: '1', ordre: 99 },
  ],
  '5e': [
    ...prefixer('5E', FRANCAIS),
    ...prefixer('5E', SOCLE),
    { cle: '5E_EPS', nom: 'EPS', coefficient: '2', ordre: 90 },
    { cle: '5E_CONDUITE', nom: 'Conduite', coefficient: '1', ordre: 93 },
    { cle: '5E_EDUCATION_ARTISTIQUE', nom: 'Éducation Artistique', coefficient: '1', ordre: 95 },
    { cle: '5E_MUSIQUE', nom: 'Musique', coefficient: '1', ordre: 96 },
    { cle: '5E_EDUCATION_CIVIQUE', nom: 'Éducation Civique', coefficient: '1', ordre: 99 },
  ],
  '4e': [
    ...prefixer('4E', FRANCAIS),
    ...prefixer('4E', SOCLE),
    { cle: '4E_SCIENCES_PHYSIQUES', nom: 'Sciences Physiques', coefficient: '2', ordre: 6 },
    { cle: '4E_LV2', nom: 'LV2', coefficient: '2', ordre: 7, choix: true },
    { cle: '4E_ARABE', nom: 'Arabe', coefficient: '2', ordre: 701, option: true },
    { cle: '4E_ESPAGNOL', nom: 'Espagnol', coefficient: '2', ordre: 702, option: true },
    { cle: '4E_ALLEMAND', nom: 'Allemand', coefficient: '2', ordre: 703, option: true },
    { cle: '4E_ECONOMIE_FAMILIALE', nom: 'Économie Familiale', coefficient: '2', ordre: 8 },
    { cle: '4E_EDUCATION_MUSICALE', nom: 'Éducation Musicale', coefficient: '1', ordre: 95 },
    { cle: '4E_EDUCATION_ARTISTIQUE', nom: 'Éducation Artistique', coefficient: '1', ordre: 96 },
    ...prefixer('4E', FIN),
  ],
  '3e': [
    ...prefixer('3E', FRANCAIS),
    ...prefixer('3E', SOCLE),
    { cle: '3E_SCIENCES_PHYSIQUES', nom: 'Sciences Physiques', coefficient: '2', ordre: 6 },
    { cle: '3E_ALLEMAND', nom: 'Allemand', coefficient: '2', ordre: 7 },
    { cle: '3E_ECONOMIE_FAMILIALE', nom: 'Économie Familiale', coefficient: '2', ordre: 8 },
    { cle: '3E_TECHNOLOGIE', nom: 'Technologie', coefficient: '2', ordre: 9 },
    ...prefixer('3E', FIN),
  ],
};

export interface ResultatModeles {
  creees: number;
  niveaux: string[];
}

export async function ensureDefaultSubjects(schoolId: string): Promise<ResultatModeles> {
  await ensureDefaultLevels(schoolId);
  const niveaux = await prisma.level.findMany({
    where: { schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
  const parCle = new Map(niveaux.map((niveau) => [cleNiveau(niveau.name), niveau]));

  const avant = await prisma.subject.count({ where: { schoolId, deletedAt: null } });
  const modelesParNiveau: { modele: ModeleMatiere; levelId: string }[] = [];
  for (const [cleNiveauCible, modeles] of Object.entries(MODELES_PAR_NIVEAU)) {
    const niveau = parCle.get(cleNiveau(cleNiveauCible));
    if (!niveau) continue;
    for (const modele of modeles) {
      modelesParNiveau.push({ modele, levelId: niveau.id });
    }
  }

  await prisma.subject.createMany({
    data: modelesParNiveau.map(({ modele, levelId }) => ({
      schoolId,
      levelId,
      name: modele.nom,
      code: normaliserTexteValeur(modele.cle).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      coefficient: modele.coefficient,
      sortOrder: modele.ordre,
      isActive: modele.actif !== false,
      isChoice: modele.choix === true || modele.option === true,
    })),
    skipDuplicates: true,
  });

  const codes = new Set(modelesParNiveau.map(({ modele }) => normaliserTexteValeur(modele.cle).toUpperCase().replace(/[^A-Z0-9_]/g, '_')));
  const sujets = await prisma.subject.findMany({
    where: { schoolId, code: { in: [...codes] } },
    select: { id: true, code: true, parentId: true },
  });
  const parCode = new Map(sujets.map((sujet) => [sujet.code, sujet]));
  for (const { modele } of modelesParNiveau) {
    if (!modele.parent) continue;
    const code = normaliserTexteValeur(modele.cle).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const codeParent = normaliserTexteValeur(modele.parent).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const enfant = parCode.get(code);
    const parent = parCode.get(codeParent);
    if (enfant && parent && enfant.parentId === null) {
      await prisma.subject.update({ where: { id: enfant.id }, data: { parentId: parent.id } });
    }
  }

  const apres = await prisma.subject.count({ where: { schoolId, deletedAt: null } });
  return {
    creees: Math.max(0, apres - avant),
    niveaux: Object.keys(MODELES_PAR_NIVEAU),
  };
}

export async function appliquerModelesALaClasse(options: {
  schoolId: string;
  classroomId: string;
}): Promise<{ ajoutees: number }> {
  await ensureDefaultSubjects(options.schoolId);
  const classe = await prisma.classroom.findFirst({
    where: { id: options.classroomId, schoolId: options.schoolId, deletedAt: null },
    include: { level: true },
  });
  if (!classe) return { ajoutees: 0 };
  const modeles = MODELES_PAR_NIVEAU[cleNiveau(classe.level?.name ?? '')];
  if (!modeles) return { ajoutees: 0 };

  const existantes = await prisma.classroomSubject.findMany({
    where: { schoolId: options.schoolId, classroomId: options.classroomId },
    select: { subjectId: true },
  });
  const dejaAffectees = new Set(existantes.map((affectation) => affectation.subjectId));
  const codes = modeles
    .filter((modele) => !modele.groupe && !modele.option && modele.actif !== false)
    .map((modele) => normaliserTexteValeur(modele.cle).toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  const sujets = await prisma.subject.findMany({
    where: { schoolId: options.schoolId, code: { in: codes }, deletedAt: null, isActive: true },
  });
  const parCode = new Map(sujets.map((sujet) => [sujet.code, sujet]));

  let ajoutees = 0;
  for (const modele of modeles) {
    if (modele.groupe || modele.option || modele.actif === false) continue;
    const code = normaliserTexteValeur(modele.cle).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const sujet = parCode.get(code);
    if (!sujet || dejaAffectees.has(sujet.id)) continue;
    await prisma.classroomSubject.create({
      data: {
        schoolId: options.schoolId,
        classroomId: options.classroomId,
        subjectId: sujet.id,
        coefficient: modele.coefficient,
        sortOrder: modele.ordre,
        isActive: true,
      },
    });
    ajoutees += 1;
  }
  return { ajoutees };
}
