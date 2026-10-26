import Decimal from 'decimal.js';
import PDFDocument from 'pdfkit';
import { HttpError } from '../../lib/http';
import { formaterNote, type ModeArrondi } from '../calcul';
import type { SnapshotBilanAnnuel, SnapshotBulletin } from './types';

/**
 * Génération PDF des bulletins (phase 5) — PDFKit, A4 portrait.
 *
 * Deux principes :
 * 1. Le PDF n'est qu'un **rendu du snapshot** : il ne recalcule rien et n'invente rien.
 *    Ce qui n'est pas calculable s'affiche « Non calculable », jamais un 0 implicite ;
 *    une mention non saisie s'affiche « Non renseigné ».
 * 2. La mise en page est **journalisée** : chaque ligne écrite déclare sa position et sa
 *    largeur réelles dans `journal.emplacements`. Le test de non-débordement vérifie donc le
 *    document produit, pas une intention. Rien ne peut sortir de la page : les mots trop
 *    longs sont coupés, un tableau trop large est refusé, et les éléments « pied de page »
 *    restent dans la page tandis que le contenu reste dans la zone imprimable.
 *
 * Polices standard 14 (Helvetica) uniquement : encodage WinAnsi/cp1252, les accents français
 * sont sûrs. Tout caractère hors de cet encodage est consigné au journal — donc repéré par les
 * tests — au lieu d'être silencieusement perdu à l'impression.
 */

type Doc = InstanceType<typeof PDFDocument>;

export const LARGEUR_A4 = 595.28;
export const HAUTEUR_A4 = 841.89;
export const MARGE = { top: 32, bottom: 40, left: 36, right: 36 } as const;
export const ZONE = {
  x: MARGE.left,
  y: MARGE.top,
  largeur: LARGEUR_A4 - MARGE.left - MARGE.right,
  hauteur: HAUTEUR_A4 - MARGE.top - MARGE.bottom,
};
const BAS_DE_ZONE = ZONE.y + ZONE.hauteur;

const TAILLE = {
  titre: 13,
  sousTitre: 10.5,
  section: 9,
  corps: 8.5,
  tableau: 8,
  petit: 7,
  pied: 6.8,
} as const;

const COULEUR = {
  encre: '#111827',
  doux: '#4b5563',
  trait: '#6b7280',
  fond: '#f1f3f6',
  fondFort: '#dde2ea',
  alerte: '#9a3412',
  filigrane: '#d9dde4',
} as const;

const INTERLIGNE = 1.28;
const PADDING = 3;

type Style = 'normal' | 'gras' | 'italique';
type Alignement = 'gauche' | 'droite' | 'centre';
type Role = 'contenu' | 'pied' | 'filigrane';

const POLICES: Record<Style, string> = {
  normal: 'Helvetica',
  gras: 'Helvetica-Bold',
  italique: 'Helvetica-Oblique',
};

/** Caractères du bloc cp1252 0x80–0x9F ; le reste des accents utiles est en Latin-1. */
const SPECIAUX_CP1252 =
  '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152' +
  '\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017D\u017E';

function encodableEnWinAnsi(caractere: string): boolean {
  const code = caractere.codePointAt(0) ?? 0;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return SPECIAUX_CP1252.includes(caractere);
}

export interface Emplacement {
  page: number;
  role: Role;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  texte: string;
  rotation: boolean;
}

export interface JournalPdf {
  largeurPage: number;
  hauteurPage: number;
  zone: { x: number; y: number; largeur: number; hauteur: number };
  emplacements: Emplacement[];
  /** Caractères qu'Helvetica (WinAnsi) ne sait pas imprimer. */
  caracteresNonEncodes: { texte: string; caractere: string }[];
  /** Tableau refusé car plus large que la page : le PDF ne déborde pas, il refuse. */
  tablesRejetes: { titre: string; largeur: number }[];
}

export interface PdfProduit {
  pdf: Buffer;
  pages: number;
  journal: JournalPdf;
}

interface Colonne {
  titre: string;
  largeur: number;
  aligne?: Alignement;
}

interface Cellule {
  texte: string;
  valeur?: string;
  aligne?: Alignement;
  style?: Style;
  couleur?: string;
}

interface Plan {
  doc: Doc;
  journal: JournalPdf;
  page: number;
  y: number;
  role: Role;
  etiquettes: string[];
  mentions: string[];
  statuts: string[];
  reprendreEnTete: (() => void) | null;
}

function creerDocument(titre: string): { doc: Doc; plan: Plan; finaliser: () => Promise<Buffer> } {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: MARGE,
    bufferPages: true,
    info: {
      Title: titre,
      Author: 'Bulletin scolaire',
      Creator: 'Bulletin scolaire',
      Producer: 'Bulletin scolaire',
    },
  });
  const plan: Plan = {
    doc,
    journal: {
      largeurPage: LARGEUR_A4,
      hauteurPage: HAUTEUR_A4,
      zone: { ...ZONE },
      emplacements: [],
      caracteresNonEncodes: [],
      tablesRejetes: [],
    },
    page: 1,
    y: ZONE.y,
    role: 'contenu',
    etiquettes: [''],
    mentions: [''],
    statuts: [''],
    reprendreEnTete: null,
  };

  const morceaux: Buffer[] = [];
  doc.on('data', (segment: Buffer) => morceaux.push(segment));
  const fini = new Promise<void>((resoudre, rejeter) => {
    doc.on('end', () => resoudre());
    doc.on('error', (erreur: Error) => rejeter(erreur));
  });

  return {
    doc,
    plan,
    finaliser: async () => {
      doc.end();
      await fini;
      return Buffer.concat(morceaux);
    },
  };
}

function police(doc: Doc, style: Style, taille: number): void {
  doc.font(POLICES[style]).fontSize(taille);
}

/** Découpe en lignes tenant dans `largeur`, en coupant d'office les mots trop longs. */
function decouper(doc: Doc, texte: string, largeur: number): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texte.split('\n')) {
    const mots = paragraphe.split(/\s+/).filter((mot) => mot.length > 0);
    if (mots.length === 0) {
      lignes.push('');
      continue;
    }
    let courante = '';
    for (let mot of mots) {
      while (mot.length > 1 && doc.widthOfString(mot) > largeur) {
        let coupe = mot.length;
        while (coupe > 1 && doc.widthOfString(mot.slice(0, coupe)) > largeur) coupe -= 1;
        if (courante) {
          lignes.push(courante);
          courante = '';
        }
        lignes.push(mot.slice(0, coupe));
        mot = mot.slice(coupe);
      }
      const candidate = courante ? `${courante} ${mot}` : mot;
      if (courante && doc.widthOfString(candidate) > largeur) {
        lignes.push(courante);
        courante = mot;
      } else {
        courante = candidate;
      }
    }
    if (courante) lignes.push(courante);
  }
  return lignes.length ? lignes : [''];
}

function signaler(plan: Plan, x: number, y: number, largeur: number, hauteur: number, texte: string, rotation = false): void {
  for (const caractere of texte) {
    if (!encodableEnWinAnsi(caractere)) {
      plan.journal.caracteresNonEncodes.push({ texte, caractere });
    }
  }
  plan.journal.emplacements.push({
    page: plan.page,
    role: plan.role,
    x,
    y,
    largeur,
    hauteur,
    texte,
    rotation,
  });
}

/** Dessine des lignes à une position absolue, sans gestion de pagination. */
function tracer(
  plan: Plan,
  lignes: string[],
  x: number,
  largeur: number,
  y: number,
  aligne: Alignement,
  style: Style,
  taille: number,
  couleur?: string
): number {
  const doc = plan.doc;
  police(doc, style, taille);
  doc.fillColor(couleur ?? COULEUR.encre);
  const hauteurLigne = taille * INTERLIGNE;
  lignes.forEach((ligne, index) => {
    const position = y + index * hauteurLigne;
    const mesure = ligne.length ? doc.widthOfString(ligne) : 0;
    let gx = x;
    if (aligne === 'droite') gx = x + largeur - mesure;
    else if (aligne === 'centre') gx = x + Math.max(0, (largeur - mesure) / 2);
    if (ligne.length) doc.text(ligne, gx, position, { lineBreak: false });
    signaler(plan, gx, position, mesure, hauteurLigne, ligne);
  });
  doc.fillColor(COULEUR.encre);
  return lignes.length * hauteurLigne;
}

function nouvellePage(plan: Plan): void {
  plan.doc.addPage({ size: 'A4', layout: 'portrait', margins: MARGE });
  plan.page += 1;
  plan.y = ZONE.y;
  const reprise = plan.reprendreEnTete;
  if (reprise) {
    // garde anti-récursion : réimprimer un en-tête ne déclenche pas un nouveau saut de page
    plan.reprendreEnTete = null;
    reprise();
    plan.reprendreEnTete = reprise;
  }
}

function veillerEspace(plan: Plan, hauteur: number): void {
  if (plan.y + hauteur <= BAS_DE_ZONE) return;
  nouvellePage(plan);
}

interface OptionsTexte {
  x?: number;
  largeur?: number;
  aligne?: Alignement;
  style?: Style;
  taille?: number;
  couleur?: string;
  avant?: number;
  apres?: number;
}

function ecrire(plan: Plan, texte: string, options: OptionsTexte = {}): void {
  const doc = plan.doc;
  const style = options.style ?? 'normal';
  const taille = options.taille ?? TAILLE.corps;
  const x = options.x ?? ZONE.x;
  const largeur = options.largeur ?? ZONE.x + ZONE.largeur - x;
  police(doc, style, taille);
  const lignes = decouper(doc, texte, largeur);
  veillerEspace(plan, lignes.length * taille * INTERLIGNE);
  plan.y += options.avant ?? 0;
  plan.y += tracer(
    plan,
    lignes,
    x,
    largeur,
    plan.y,
    options.aligne ?? 'gauche',
    style,
    taille,
    options.couleur
  );
  plan.y += options.apres ?? 0;
}

function filet(plan: Plan): void {
  veillerEspace(plan, 7);
  plan.doc
    .moveTo(ZONE.x, plan.y + 2)
    .lineTo(ZONE.x + ZONE.largeur, plan.y + 2)
    .lineWidth(0.6)
    .strokeColor(COULEUR.trait)
    .stroke();
  plan.doc.strokeColor(COULEUR.encre);
  plan.y += 7;
}

function hauteurCellule(doc: Doc, cellule: Cellule, largeur: number, taille: number): number {
  let total = 0;
  if (cellule.texte) {
    police(doc, cellule.style ?? 'normal', taille);
    total += decouper(doc, cellule.texte, largeur).length * taille * INTERLIGNE;
  }
  if (cellule.valeur) {
    police(doc, 'gras', taille);
    total += decouper(doc, cellule.valeur, largeur).length * taille * INTERLIGNE;
  }
  return Math.max(total, taille * INTERLIGNE);
}

/**
 * Tableau à colonnes fixes, dans la zone imprimable. Si la somme des largeurs dépasse la
 * page, le tableau est refusé et consigné au journal : il ne déborde jamais.
 */
function tableau(
  plan: Plan,
  titre: string,
  colonnes: Colonne[],
  lignes: Cellule[][],
  options: { sansEnTete?: boolean; tete?: number } = {}
): void {
  const total = colonnes.reduce((somme, colonne) => somme + colonne.largeur, 0);
  if (total > ZONE.largeur + 0.01) {
    plan.journal.tablesRejetes.push({ titre, largeur: total });
    ecrire(plan, `Mise en page refusée : le tableau « ${titre} » mesure ${total.toFixed(1)} pt.`, {
      style: 'gras',
      taille: TAILLE.petit,
      couleur: COULEUR.alerte,
    });
    return;
  }

  const xs: number[] = [];
  let curseur = ZONE.x;
  for (const colonne of colonnes) {
    xs.push(curseur);
    curseur += colonne.largeur;
  }
  const tete = options.tete ?? TAILLE.tableau;
  const doc = plan.doc;

  const dessinerEnTete = (): void => {
    police(doc, 'gras', tete);
    const lignesTitres = colonnes.map((colonne) =>
      decouper(doc, colonne.titre, colonne.largeur - 2 * PADDING)
    );
    const hauteur =
      Math.max(...lignesTitres.map((l) => l.length), 1) * tete * INTERLIGNE + 2 * PADDING;
    doc.rect(ZONE.x, plan.y, total, hauteur).fillAndStroke(COULEUR.fondFort, COULEUR.trait);
    doc.lineWidth(0.5);
    colonnes.forEach((colonne, index) => {
      tracer(
        plan,
        lignesTitres[index],
        xs[index] + PADDING,
        colonne.largeur - 2 * PADDING,
        plan.y + PADDING,
        colonne.aligne ?? 'gauche',
        'gras',
        tete
      );
    });
    plan.y += hauteur;
  };

  if (!options.sansEnTete) {
    plan.reprendreEnTete = dessinerEnTete;
    veillerEspace(plan, tete * INTERLIGNE + 2 * PADDING);
    dessinerEnTete();
  }

  lignes.forEach((cellules, rang) => {
    const hauteurs = cellules.map((cellule, index) =>
      hauteurCellule(doc, cellule, Math.max((colonnes[index]?.largeur ?? 0) - 2 * PADDING, 8), tete)
    );
    const hauteur = Math.max(...hauteurs, tete * INTERLIGNE) + 2 * PADDING;
    veillerEspace(plan, hauteur);
    doc
      .rect(ZONE.x, plan.y, total, hauteur)
      .fillAndStroke(rang % 2 === 0 ? '#ffffff' : COULEUR.fond, COULEUR.trait);
    doc.lineWidth(0.5);
    for (let index = 0; index < colonnes.length; index += 1) {
      const colonne = colonnes[index];
      const cellule = cellules[index] ?? { texte: '' };
      const x = xs[index] + PADDING;
      const largeurCellule = colonne.largeur - 2 * PADDING;
      let y = plan.y + PADDING;
      if (cellule.texte) {
        y += tracer(
          plan,
          decouper(doc, cellule.texte, largeurCellule),
          x,
          largeurCellule,
          y,
          cellule.aligne ?? colonne.aligne ?? 'gauche',
          cellule.style ?? 'normal',
          tete,
          cellule.valeur ? COULEUR.doux : cellule.couleur
        );
      }
      if (cellule.valeur) {
        tracer(
          plan,
          decouper(doc, cellule.valeur, largeurCellule),
          x,
          largeurCellule,
          y,
          cellule.aligne ?? colonne.aligne ?? 'gauche',
          'gras',
          tete,
          cellule.couleur
        );
      }
    }
    for (let index = 1; index < colonnes.length; index += 1) {
      doc
        .moveTo(xs[index], plan.y)
        .lineTo(xs[index], plan.y + hauteur)
        .lineWidth(0.4)
        .strokeColor(COULEUR.trait)
        .stroke();
    }
    doc.strokeColor(COULEUR.encre);
    plan.y += hauteur;
  });

  plan.reprendreEnTete = null;
}

/** Bloc « libellé / valeur » sur deux colonnes : continuité, absences, décisions. */
function cadre(plan: Plan, titre: string, lignes: { libelle: string; valeur: string }[]): void {
  const premiere = Math.round(ZONE.largeur * 0.34);
  tableau(
    plan,
    titre,
    [
      { titre, largeur: premiere },
      { titre: 'Valeur', largeur: ZONE.largeur - premiere },
    ],
    lignes.map((ligne) => [{ texte: ligne.libelle }, { texte: ligne.valeur }]),
    { tete: TAILLE.petit }
  );
}

function dateFr(iso: string | null, avecHeure = true): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Dakar',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(avecHeure ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).formatToParts(date);
  const valeur = (type: Intl.DateTimeFormatPartTypes): string =>
    parties.find((partie) => partie.type === type)?.value ?? '';
  const base = `${valeur('day')}/${valeur('month')}/${valeur('year')}`;
  return avecHeure ? `${base} ${valeur('hour')}:${valeur('minute')}` : base;
}

function affiche(valeur: string | null): string {
  return valeur ?? 'Non calculable';
}

/**
 * Aucune moyenne générale : les totaux ne doivent pas s'afficher comme de vrais zéros.
 * Un total de points à 0 n'est pas un résultat, c'est l'absence de résultat.
 */
function sansMoyenne(s: SnapshotBulletin): boolean {
  return s.synthese.moyenneGenerale === null;
}

function rangCellule(rang: number | null): string {
  return rang === null ? '—' : String(rang);
}

type Matiere = SnapshotBulletin['matieres'][number];

/** Cellule d'une catégorie : pas de groupe, moyenne affichée, ou manque chiffré. */
function celluleGroupe(matiere: Matiere, categorie: 'DEVOIR' | 'COMPOSITION'): string {
  const groupe = matiere.groupes.find((g) => g.category === categorie);
  if (!groupe) return '—';
  if (groupe.moyenneAffichee === null) {
    return `Non calculable (${groupe.notesValides}/${groupe.notesAttendues} note(s))`;
  }
  return groupe.moyenneAffichee;
}

function lignesMatieres(s: SnapshotBulletin): Cellule[][] {
  return s.matieres.map((matiere, index) => [
    { texte: String(index + 1), aligne: 'centre' },
    {
      texte: matiere.subjectName || matiere.subjectCode || 'Discipline',
      valeur: matiere.comptabilisee ? undefined : 'Non comptabilisée',
    },
    { texte: celluleGroupe(matiere, 'DEVOIR'), aligne: 'centre' },
    { texte: celluleGroupe(matiere, 'COMPOSITION'), aligne: 'centre' },
    {
      texte: matiere.moyenneAffichee ?? 'Non calculable',
      aligne: 'centre',
      style: 'gras',
      couleur: matiere.moyenneAffichee === null ? COULEUR.alerte : undefined,
    },
    {
      texte: matiere.coefficient ?? '—',
      aligne: 'centre',
      couleur: matiere.coefficientValide ? undefined : COULEUR.alerte,
    },
    { texte: matiere.pointsPonderes ?? 'Non calculable', aligne: 'centre' },
    { texte: rangCellule(matiere.rang), aligne: 'centre' },
    {
      texte: matiere.appreciation ?? '—',
      style: matiere.appreciation ? 'normal' : 'italique',
      couleur: matiere.appreciation ? undefined : COULEUR.doux,
    },
  ]);
}

export interface MetaBulletin {
  version: number;
  statut: string;
  publieLe?: string | null;
  genereLe?: string | null;
  motifCorrection?: string | null;
}

export interface TextesLibres {
  mention?: string | null;
  decisionConseil?: string | null;
  appreciation?: string | null;
}

const FILIGRANE: Record<string, string> = {
  BOUILLON: 'BROUILLON',
  PRET: 'BULLETIN PRET',
  ANNULE: 'ANNULE',
  PUBLIE: '',
};

/** Mention diagonale du statut non officiel, seulement si elle tient dans la zone. */
function filigrane(plan: Plan, texte: string): void {
  const doc = plan.doc;
  const angle = 42;
  const taille = 32;
  police(doc, 'gras', taille);
  const largeurTexte = doc.widthOfString(texte);
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const empreinteLargeur = largeurTexte * cos + taille * INTERLIGNE * sin;
  const empreinteHauteur = largeurTexte * sin + taille * INTERLIGNE * cos;
  if (empreinteLargeur > ZONE.largeur || empreinteHauteur > ZONE.hauteur) return;

  const centreX = LARGEUR_A4 / 2;
  const centreY = HAUTEUR_A4 / 2;
  const coinX = centreX - empreinteLargeur / 2;
  const coinY = centreY - empreinteHauteur / 2;
  const role = plan.role;
  plan.role = 'filigrane';
  doc.save();
  doc.rotate(-angle, { origin: [centreX, centreY] });
  doc.fillColor(COULEUR.filigrane);
  doc.text(texte, coinX, coinY, { lineBreak: false });
  doc.fillColor(COULEUR.encre);
  doc.restore();
  signaler(plan, coinX, coinY, empreinteLargeur, empreinteHauteur, texte, true);
  plan.role = role;
}

/** Pieds de page et filigranes : appliqués à toutes les pages, après la génération du contenu. */
function habillerPages(plan: Plan): void {
  const doc = plan.doc;
  const pages = doc.bufferedPageRange().count;
  const role = plan.role;
  plan.role = 'pied';
  for (let index = 0; index < pages; index += 1) {
    doc.switchToPage(index);
    plan.page = index + 1;
    const statut = plan.statuts[index];
    if (statut && statut !== 'PUBLIE') {
      const mention = FILIGRANE[statut];
      if (mention) filigrane(plan, mention);
    }
    const y = HAUTEUR_A4 - MARGE.bottom + 12;
    const etiquette = plan.etiquettes[index] ?? '';
    if (etiquette) {
      tracer(plan, [etiquette], ZONE.x, ZONE.largeur * 0.68, y, 'gauche', 'normal', TAILLE.pied, COULEUR.doux);
    }
    tracer(
      plan,
      [`Page ${index + 1}/${pages}`],
      ZONE.x + ZONE.largeur * 0.75,
      ZONE.largeur * 0.25,
      y,
      'droite',
      'normal',
      TAILLE.pied,
      COULEUR.doux
    );
    const mention = plan.mentions[index];
    if (mention) {
      tracer(plan, [mention], ZONE.x, ZONE.largeur, y - 10, 'gauche', 'normal', TAILLE.pied, COULEUR.doux);
    }
  }
  plan.role = role;
}

function mentionDe(meta: MetaBulletin, genereLe: string | null): string {
  const publication = meta.publieLe
    ? ` — publié le ${dateFr(meta.publieLe, false)}, document figé`
    : ' — non publié';
  const correction = meta.motifCorrection ? ` — correction : ${meta.motifCorrection}` : '';
  return (
    `Version ${meta.version}, statut ${meta.statut}${publication}${correction}` +
    ` — calcul figé du ${dateFr(meta.genereLe ?? genereLe)}`
  );
}

/** Une page par bulletin. Le contenu vient uniquement du snapshot et des colonnes texte. */
function dessinerBulletin(plan: Plan, s: SnapshotBulletin, meta: MetaBulletin, textes: TextesLibres): void {
  const debut = plan.page;
  const etiquette = `${s.eleve.nom} ${s.eleve.prenoms} — ${s.eleve.matricule} — ${s.eleve.classe} — ${s.enTete.semestre.nom}`;
  const mention = mentionDe(meta, s.genereLe);

  ecrire(plan, (s.enTete.nomOfficiel ?? s.enTete.nomEtablissement).toUpperCase(), {
    aligne: 'centre',
    style: 'gras',
    taille: TAILLE.titre,
    apres: 1,
  });
  const coordonnees = [
    s.enTete.ville,
    s.enTete.telephone ? `Tél. ${s.enTete.telephone}` : null,
    s.enTete.email,
    s.enTete.agrement ? `Agrément ${s.enTete.agrement}` : null,
  ]
    .filter((partie): partie is string => Boolean(partie && partie.trim()))
    .join('  ·  ');
  if (coordonnees) {
    ecrire(plan, coordonnees, { aligne: 'centre', taille: TAILLE.petit, couleur: COULEUR.doux });
  }
  if (s.enTete.autorite) {
    ecrire(plan, s.enTete.autorite, { aligne: 'centre', taille: TAILLE.petit, couleur: COULEUR.doux });
  }
  if (s.enTete.devise) {
    ecrire(plan, s.enTete.devise, {
      aligne: 'centre',
      taille: TAILLE.petit,
      style: 'italique',
      couleur: COULEUR.doux,
    });
  }
  filet(plan);

  ecrire(plan, s.enTete.intituleDocument.toUpperCase(), {
    aligne: 'centre',
    style: 'gras',
    taille: TAILLE.sousTitre,
    avant: 3,
  });
  const serie = s.eleve.serie ? ` — ${s.eleve.serie}` : '';
  ecrire(plan, `Année ${s.enTete.anneeScolaire.nom} — ${s.enTete.semestre.nom} — ${s.eleve.classe}${serie}`, {
    aligne: 'centre',
    taille: TAILLE.corps,
    apres: 5,
  });

  tableau(
    plan,
    'Élève',
    [
      { titre: 'Nom', largeur: 110 },
      { titre: 'Prénoms', largeur: 120 },
      { titre: 'Matricule', largeur: 95, aligne: 'centre' },
      { titre: 'Né(e) le', largeur: 80, aligne: 'centre' },
      { titre: 'Lieu de naissance', largeur: ZONE.largeur - 405 },
    ],
    [
      [
        { texte: s.eleve.nom },
        { texte: s.eleve.prenoms },
        { texte: s.eleve.matricule, aligne: 'centre' },
        { texte: dateFr(s.eleve.birthDate, false), aligne: 'centre' },
        { texte: s.eleve.birthPlace ?? '—' },
      ],
    ]
  );

  ecrire(plan, 'Notes et moyennes par discipline', {
    style: 'gras',
    taille: TAILLE.section,
    avant: 7,
    apres: 1,
  });
  tableau(
    plan,
    'Disciplines',
    [
      { titre: 'N°', largeur: 22, aligne: 'centre' },
      { titre: 'Disciplines', largeur: 116 },
      { titre: 'Devoirs', largeur: 50, aligne: 'centre' },
      { titre: 'Compositions', largeur: 58, aligne: 'centre' },
      { titre: `Moy./${s.regles.baremeParDefaut}`, largeur: 48, aligne: 'centre' },
      { titre: 'Coef.', largeur: 32, aligne: 'centre' },
      { titre: 'Points', largeur: 42, aligne: 'centre' },
      { titre: 'Rang', largeur: 34, aligne: 'centre' },
      { titre: 'Appréciation', largeur: ZONE.largeur - 402 },
    ],
    lignesMatieres(s)
  );

  ecrire(plan, 'Synthèse', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
  const tiers = Math.round(ZONE.largeur / 3);
  tableau(
    plan,
    'Synthèse',
    [
      { titre: 'Élément', largeur: tiers },
      { titre: 'Élément', largeur: tiers },
      { titre: 'Élément', largeur: ZONE.largeur - 2 * tiers },
    ],
    [
      [
        {
          texte: `Moyenne générale /${s.regles.baremeParDefaut}`,
          valeur: affiche(s.synthese.moyenneGeneraleAffichee),
        },
        {
          texte: 'Total des points',
          valeur: sansMoyenne(s) ? 'Non calculable' : s.synthese.totalPoints,
        },
        {
          texte: 'Total des coefficients',
          valeur: sansMoyenne(s) ? 'Non calculable' : s.synthese.totalCoeficients,
        },
      ],
      [
        {
          texte: 'Rang',
          valeur:
            s.synthese.rang !== null
              ? `${s.synthese.rang} sur ${s.synthese.effectif}`
              : (s.synthese.motifNonClasse ?? 'Non classé'),
        },
        { texte: 'Moyenne de la classe', valeur: affiche(s.synthese.moyenneClasseAffichee) },
        { texte: 'Effectif', valeur: String(s.synthese.effectif) },
      ],
    ],
    { sansEnTete: true, tete: TAILLE.petit }
  );

  if (s.synthese.incomplet) {
    ecrire(plan, 'Bulletin incomplet : des données manquent (voir les motifs).', {
      style: 'italique',
      taille: TAILLE.petit,
      couleur: COULEUR.alerte,
      avant: 2,
    });
  }

  const precedent = s.continuite.semestrePrecedent;
  if (precedent) {
    ecrire(plan, 'Continuité avec le semestre précédent', {
      style: 'gras',
      taille: TAILLE.section,
      avant: 8,
      apres: 1,
    });
    cadre(plan, 'Semestre précédent', [
      {
        libelle: precedent.numero ? `Semestre ${precedent.numero}` : 'Semestre précédent',
        valeur: [
          `Moyenne : ${affiche(precedent.moyenneGeneraleAffichee)}`,
          precedent.rang !== null ? `Rang : ${precedent.rang}` : 'Non classé',
          precedent.statut ? `Bulletin ${precedent.statut.toLowerCase()} v${precedent.version ?? 1}` : null,
        ]
          .filter((partie): partie is string => Boolean(partie))
          .join(' — '),
      },
      { libelle: 'Évolution de la moyenne', valeur: ecart(precedent.moyenneGenerale, s) },
      {
        libelle: 'Classe',
        valeur: s.continuite.changementClasse
          ? `Nouvelle classe (${s.continuite.classePrecedente ?? 'inconnue'} -> ${s.eleve.classe})`
          : `${s.eleve.classe} (inchangée)`,
      },
    ]);
  }

  ecrire(plan, 'Absences', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
  cadre(plan, 'Absences', [
    ...(s.absences?.disponible
      ? [
          { libelle: 'Absences justifiées', valeur: String(s.absences.absencesJustifiees) },
          { libelle: 'Absences non justifiées', valeur: String(s.absences.absencesNonJustifiees) },
          { libelle: 'Retards', valeur: `${s.absences.retards} (${s.absences.minutesRetard} min)` },
        ]
      : [{ libelle: 'Suivi des absences', valeur: 'Données non enregistrées sur ce document' }]),
  ]);

  ecrire(plan, 'Mentions et décisions', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
  cadre(plan, 'Décisions', [
    { libelle: 'Mention', valeur: textes.mention ?? 'Non renseigné' },
    { libelle: 'Décision du conseil de classe', valeur: textes.decisionConseil ?? 'Non renseigné' },
    { libelle: 'Appréciation générale', valeur: textes.appreciation ?? 'Non renseigné' },
  ]);

  if (s.motifs.length > 0) {
    ecrire(plan, 'Motifs du calcul figé', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
    const montres = s.motifs.slice(0, 6);
    for (const motif of montres) {
      ecrire(plan, `- ${motif}`, { taille: TAILLE.petit, couleur: COULEUR.doux });
    }
    if (s.motifs.length > montres.length) {
      ecrire(
        plan,
        `- ... ${s.motifs.length - montres.length} autre(s) motif(s) au détail, consultable en ligne.`,
        { taille: TAILLE.petit, couleur: COULEUR.doux }
      );
    }
  }

  ecrire(plan, 'Cachet et signature de l\'établissement', {
    x: ZONE.x + ZONE.largeur - 200,
    largeur: 200,
    aligne: 'droite',
    taille: TAILLE.petit,
    couleur: COULEUR.doux,
    avant: 12,
  });
  plan.doc
    .rect(ZONE.x + ZONE.largeur - 200, plan.y, 200, 40)
    .lineWidth(0.6)
    .strokeColor(COULEUR.trait)
    .stroke();
  plan.doc.strokeColor(COULEUR.encre);
  plan.y += 44;

  // pied de page commun à toutes les pages de ce bulletin
  for (let page = debut; page <= plan.page; page += 1) {
    plan.etiquettes[page - 1] = etiquette;
    plan.mentions[page - 1] = mention;
    plan.statuts[page - 1] = meta.statut;
  }
}

/** Écart entre le snapshot du semestre précédent et celui-ci : Decimal, jamais de flottant. */
function ecart(de: string | null, s: SnapshotBulletin): string {
  const vers = s.synthese.moyenneGenerale;
  if (de === null || vers === null) return 'Non calculable (donnée manquante)';
  try {
    const difference = new Decimal(vers).minus(de);
    const valeur = formaterNote(
      difference,
      s.regles.arrondiDecimales,
      s.regles.arrondiMode as ModeArrondi
    );
    if (valeur === null) return 'Non calculable';
    return `${difference.gt(0) ? '+' : ''}${valeur} /${s.regles.baremeParDefaut}`;
  } catch {
    return 'Non calculable';
  }
}

function dessinerBilan(plan: Plan, s: SnapshotBilanAnnuel, meta: MetaBulletin): void {
  const debut = plan.page;
  ecrire(plan, (s.enTete.nomOfficiel ?? s.enTete.nomEtablissement).toUpperCase(), {
    aligne: 'centre',
    style: 'gras',
    taille: TAILLE.titre,
  });
  ecrire(plan, 'Bilan annuel', { aligne: 'centre', style: 'gras', taille: TAILLE.sousTitre, avant: 2 });
  ecrire(plan, `Année ${s.enTete.anneeScolaire.nom} — ${s.eleve.classe}`, {
    aligne: 'centre',
    taille: TAILLE.corps,
  });
  ecrire(plan, `${s.eleve.nom} ${s.eleve.prenoms} — Matricule ${s.eleve.matricule}`, {
    aligne: 'centre',
    taille: TAILLE.corps,
    apres: 6,
  });

  tableau(
    plan,
    'Semestres',
    [
      { titre: 'Semestre', largeur: 130 },
      { titre: 'Bulletin', largeur: 130, aligne: 'centre' },
      { titre: 'Moyenne', largeur: 90, aligne: 'centre' },
      { titre: 'Rang', largeur: 60, aligne: 'centre' },
      { titre: 'Effectif', largeur: ZONE.largeur - 410, aligne: 'centre' },
    ],
    s.semestres.map((semestre) => [
      { texte: `${semestre.nom} (S${semestre.numero})` },
      {
        texte:
          semestre.reportCardId === null
            ? 'Aucun bulletin'
            : `v${semestre.version ?? 1} — ${semestre.statut ?? 'brouillon'}`,
        aligne: 'centre',
      },
      { texte: semestre.moyenneGeneraleAffichee ?? 'Non calculable', aligne: 'centre' },
      { texte: rangCellule(semestre.rang), aligne: 'centre' },
      { texte: semestre.effectif === null ? '—' : String(semestre.effectif), aligne: 'centre' },
    ])
  );

  ecrire(plan, 'Moyennes par discipline', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
  tableau(
    plan,
    'Disciplines',
    [
      { titre: 'N°', largeur: 22, aligne: 'centre' },
      { titre: 'Disciplines', largeur: 170 },
      { titre: 'Coef.', largeur: 40, aligne: 'centre' },
      { titre: 'Semestre 1', largeur: 76, aligne: 'centre' },
      { titre: 'Semestre 2', largeur: 76, aligne: 'centre' },
      { titre: `Annuelle /${s.regles.baremeParDefaut}`, largeur: ZONE.largeur - 384, aligne: 'centre' },
    ],
    s.matieres.map((matiere, index) => [
      { texte: String(index + 1), aligne: 'centre' },
      { texte: matiere.subjectName },
      { texte: matiere.coefficient ?? '—', aligne: 'centre' },
      { texte: matiere.s1Affichee ?? 'Non calculable', aligne: 'centre' },
      { texte: matiere.s2Affichee ?? 'Non calculable', aligne: 'centre' },
      {
        texte: matiere.annuelleAffichee ?? 'Non calculable',
        aligne: 'centre',
        style: 'gras',
        couleur: matiere.annuelleAffichee === null ? COULEUR.alerte : undefined,
      },
    ])
  );

  ecrire(plan, 'Synthèse annuelle', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
  const tiers = Math.round(ZONE.largeur / 3);
  tableau(
    plan,
    'Annuel',
    [
      { titre: 'Élément', largeur: tiers },
      { titre: 'Élément', largeur: tiers },
      { titre: 'Élément', largeur: ZONE.largeur - 2 * tiers },
    ],
    [
      [
        { texte: 'Moyenne annuelle', valeur: s.annuelle.moyenneAffichee ?? 'Non calculable' },
        {
          texte: 'Rang annuel',
          valeur: s.annuelle.rangAnnuel === null ? 'Non classé' : String(s.annuelle.rangAnnuel),
        },
        { texte: 'Effectif', valeur: String(s.annuelle.effectif) },
      ],
    ],
    { sansEnTete: true, tete: TAILLE.petit }
  );

  if (!s.annuelle.calculable || s.annuelle.partiel) {
    ecrire(
      plan,
      `${s.annuelle.calculable ? 'Moyenne annuelle partielle' : 'Moyenne annuelle non calculable'} : ${
        s.annuelle.motifs.join(' ') || 'données insuffisantes'
      }.`,
      { taille: TAILLE.petit, couleur: COULEUR.alerte, avant: 3 }
    );
  }

  ecrire(plan, 'Absences et retards sur l’année', {
    style: 'gras',
    taille: TAILLE.section,
    avant: 8,
    apres: 1,
  });
  cadre(plan, 'Absences annuelles', [
    ...(s.absences?.disponible
      ? [
          { libelle: 'Absences justifiées', valeur: String(s.absences.absencesJustifiees) },
          { libelle: 'Absences non justifiées', valeur: String(s.absences.absencesNonJustifiees) },
          { libelle: 'Retards', valeur: `${s.absences.retards} (${s.absences.minutesRetard} min)` },
        ]
      : [{ libelle: 'Suivi des absences', valeur: 'Données non enregistrées sur ce document' }]),
  ]);

  ecrire(plan, 'Mentions et décisions', { style: 'gras', taille: TAILLE.section, avant: 8, apres: 1 });
  cadre(plan, 'Décisions', [
    { libelle: 'Mention', valeur: s.mention ?? 'Non renseigné' },
    {
      libelle: s.decisionConseil
        ? s.decisionConseilValideeLe
          ? `Décision validée le ${dateFr(s.decisionConseilValideeLe, false)}`
          : 'Décision historique (validation non consignée)'
        : 'Décision du conseil de classe',
      valeur: s.decisionConseil ?? 'Non renseigné',
    },
    { libelle: 'Appréciation générale', valeur: s.appreciation ?? 'Non renseigné' },
  ]);

  const etiquette = `Bilan annuel — ${s.eleve.nom} ${s.eleve.prenoms} — ${s.eleve.classe} — ${s.enTete.anneeScolaire.nom}`;
  const mention = mentionDe(meta, s.genereLe);
  for (let page = debut; page <= plan.page; page += 1) {
    plan.etiquettes[page - 1] = etiquette;
    plan.mentions[page - 1] = mention;
    plan.statuts[page - 1] = meta.statut;
  }
}

export interface BulletinPourPdf {
  snapshot: SnapshotBulletin;
  meta: MetaBulletin;
  textes?: TextesLibres;
}

export async function genererPdfBulletin(item: BulletinPourPdf): Promise<PdfProduit> {
  const s = item.snapshot;
  const { plan, finaliser } = creerDocument(
    `Bulletin ${s.eleve.nom} ${s.eleve.prenoms} — ${s.enTete.semestre.nom}`
  );
  dessinerBulletin(plan, s, item.meta, item.textes ?? {});
  habillerPages(plan);
  const pdf = await finaliser();
  return { pdf, pages: plan.page, journal: plan.journal };
}

/** Impression par lot : un seul PDF multi-pages, un bulletin par élève, page propre. */
export async function genererPdfBulletins(items: BulletinPourPdf[]): Promise<PdfProduit> {
  if (items.length === 0) throw new HttpError(400, 'Aucun bulletin à imprimer');
  const premier = items[0].snapshot;
  const { doc, plan, finaliser } = creerDocument(
    `Bulletins — ${items.length} élève(s) — ${premier.eleve.classe}`
  );
  items.forEach((item, index) => {
    if (index > 0) {
      doc.addPage({ size: 'A4', layout: 'portrait', margins: MARGE });
      plan.page += 1;
      plan.y = ZONE.y;
    }
    dessinerBulletin(plan, item.snapshot, item.meta, item.textes ?? {});
  });
  habillerPages(plan);
  const pdf = await finaliser();
  return { pdf, pages: plan.page, journal: plan.journal };
}

export interface BilanPourPdf {
  snapshot: SnapshotBilanAnnuel;
  meta: MetaBulletin;
}

export async function genererPdfBilanAnnuel(
  s: SnapshotBilanAnnuel,
  meta: MetaBulletin
): Promise<PdfProduit> {
  const { plan, finaliser } = creerDocument(`Bilan annuel — ${s.eleve.nom} ${s.eleve.prenoms}`);
  dessinerBilan(plan, s, meta);
  habillerPages(plan);
  const pdf = await finaliser();
  return { pdf, pages: plan.page, journal: plan.journal };
}

/** Lot de bilans annuels : un PDF multi-pages, un élève par page de départ. */
export async function genererPdfBilansAnnuels(items: BilanPourPdf[]): Promise<PdfProduit> {
  if (items.length === 0) throw new HttpError(400, 'Aucun bilan annuel à imprimer');
  const premier = items[0].snapshot;
  const { doc, plan, finaliser } = creerDocument(
    `Bilans annuels — ${items.length} élève(s) — ${premier.eleve.classe}`
  );
  items.forEach((item, index) => {
    if (index > 0) {
      doc.addPage({ size: 'A4', layout: 'portrait', margins: MARGE });
      plan.page += 1;
      plan.y = ZONE.y;
    }
    dessinerBilan(plan, item.snapshot, item.meta);
  });
  habillerPages(plan);
  const pdf = await finaliser();
  return { pdf, pages: plan.page, journal: plan.journal };
}
