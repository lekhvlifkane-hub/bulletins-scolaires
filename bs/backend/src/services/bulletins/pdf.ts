import Decimal from 'decimal.js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { HttpError } from '../../lib/http';
import { formaterNote, type ModeArrondi } from '../calcul';
import type { ModeleOfficielSnapshot, SnapshotBilanAnnuel, SnapshotBulletin } from './types';

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

const LOGO_PDF_LARGEUR = 120;
const LOGO_PDF_HAUTEUR = 34;

/** Dessine le logo figé du snapshot, s'il est présent et lisible par PDFKit. */
function dessinerLogo(plan: Plan, logoDataUrl: string | null | undefined): void {
  if (!logoDataUrl) return;
  const correspondance = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    logoDataUrl,
  );
  if (!correspondance) return;
  try {
    const image = Buffer.from(correspondance[1], 'base64');
    if (image.length === 0) return;
    const x = ZONE.x + (ZONE.largeur - LOGO_PDF_LARGEUR) / 2;
    plan.doc.image(image, x, plan.y, {
      fit: [LOGO_PDF_LARGEUR, LOGO_PDF_HAUTEUR],
      align: 'center',
      valign: 'center',
    });
    signaler(plan, x, plan.y, LOGO_PDF_LARGEUR, LOGO_PDF_HAUTEUR, '[logo]');
    plan.y += LOGO_PDF_HAUTEUR + 3;
  } catch {
    // Un logo corrompu ne doit jamais empêcher l'impression du bulletin.
  }
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
  options: {
    sansEnTete?: boolean;
    tete?: number;
    sansGrille?: boolean;
    fondEntete?: string;
    derniereGrise?: boolean;
    x?: number;
    largeur?: number;
  } = {}
): void {
  const total = colonnes.reduce((somme, colonne) => somme + colonne.largeur, 0);
  const x0 = options.x ?? ZONE.x;
  const largeurTableau = options.largeur ?? ZONE.largeur;
  if (total > largeurTableau + 0.01 || x0 + largeurTableau > ZONE.x + ZONE.largeur + 0.01) {
    plan.journal.tablesRejetes.push({ titre, largeur: total });
    ecrire(plan, `Mise en page refusée : le tableau « ${titre} » mesure ${total.toFixed(1)} pt.`, {
      style: 'gras',
      taille: TAILLE.petit,
      couleur: COULEUR.alerte,
    });
    return;
  }

  const xs: number[] = [];
  let curseur = x0;
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
    if (options.sansGrille) doc.rect(x0, plan.y, total, hauteur).fill(options.fondEntete ?? COULEUR.fondFort);
    else doc.rect(x0, plan.y, total, hauteur).fillAndStroke(options.fondEntete ?? COULEUR.fondFort, COULEUR.trait);
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
    const dernier = rang === lignes.length - 1 && options.derniereGrise;
    const fondLigne = dernier
      ? COULEUR.fondFort
      : rang % 2 === 0
        ? '#ffffff'
        : COULEUR.fond;
    if (options.sansGrille) doc.rect(x0, plan.y, total, hauteur).fill(fondLigne);
    else doc.rect(x0, plan.y, total, hauteur).fillAndStroke(fondLigne, COULEUR.trait);
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
    if (!options.sansGrille) {
      for (let index = 1; index < colonnes.length; index += 1) {
        doc
          .moveTo(xs[index], plan.y)
          .lineTo(xs[index], plan.y + hauteur)
          .lineWidth(0.4)
          .strokeColor(COULEUR.trait)
          .stroke();
      }
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

function celluleNote(
  matiere: Matiere,
  categorie: 'DEVOIR' | 'COMPOSITION',
  position: number
): string {
  const note = matiere.groupes
    .filter((groupe) => groupe.category === categorie)
    .flatMap((groupe) => groupe.notes)
    .find((item) => item.position === position);
  if (!note) return '—';
  if (note.status === 'ABSENT') return 'ABS';
  if (note.status === 'NON_SAISIE' || note.status === 'ANNULEE' || note.score === null) return '—';
  return note.score;
}

function lignesMatieres(s: SnapshotBulletin): Cellule[][] {
  return s.matieres.map((matiere, index) => [
    { texte: String(index + 1), aligne: 'centre' },
    {
      texte:
        (matiere.subjectName || matiere.subjectCode || 'Discipline') +
        (matiere.teacherName ? `\nEnseignant : ${matiere.teacherName}` : ''),
      valeur: matiere.comptabilisee ? undefined : 'Non comptabilisée',
    },
    { texte: celluleNote(matiere, 'DEVOIR', 1), aligne: 'centre' },
    { texte: celluleNote(matiere, 'DEVOIR', 2), aligne: 'centre' },
    { texte: celluleNote(matiere, 'COMPOSITION', 1), aligne: 'centre' },
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
  decisionProposee?: string | null;
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

function blocSignature(
  plan: Plan,
  x: number,
  y: number,
  largeur: number,
  titre: string,
  nom: string | null | undefined
): number {
  const lignes = nom ? [titre, nom] : [titre];
  const hauteurTexte = tracer(
    plan,
    lignes,
    x,
    largeur,
    y,
    'centre',
    'normal',
    TAILLE.petit,
    COULEUR.doux
  );
  const boxY = y + hauteurTexte + 3;
  plan.doc
    .rect(x, boxY, largeur, 36)
    .lineWidth(0.6)
    .strokeColor(COULEUR.trait)
    .stroke();
  plan.doc.strokeColor(COULEUR.encre);
  return boxY + 40 - y;
}

function configCouleur(valeur: string | null | undefined, defaut: string): string {
  return valeur && /^#[0-9a-f]{6}$/i.test(valeur) ? valeur : defaut;
}

function dessinerImageDans(
  plan: Plan,
  dataUrl: string | null | undefined,
  x: number,
  y: number,
  largeur: number,
  hauteur: number
): boolean {
  if (!dataUrl) return false;
  const correspondance = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!correspondance) return false;
  try {
    const image = Buffer.from(correspondance[1], 'base64');
    if (image.length === 0) return false;
    plan.doc.image(image, x, y, { fit: [largeur, hauteur], align: 'center', valign: 'center' });
    signaler(plan, x, y, largeur, hauteur, '[image]');
    return true;
  } catch {
    return false;
  }
}

function dessinerDrapeau(plan: Plan, x: number, y: number): void {
  const doc = plan.doc;
  const largeur = 42;
  const hauteur = 25;
  const bande = largeur / 3;
  const couleurs = ['#00853f', '#fdef42', '#e31b23'];
  couleurs.forEach((couleur, index) => {
    doc.rect(x + index * bande, y, bande, hauteur).fillAndStroke(couleur, COULEUR.trait);
  });
  const centreX = x + bande / 2;
  const centreY = y + hauteur / 2;
  const rayon = 4;
  const interieur = 1.7;
  doc.fillColor('#fdef42');
  doc.moveTo(centreX, centreY - rayon);
  for (let index = 1; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const r = index % 2 === 0 ? rayon : interieur;
    doc.lineTo(centreX + Math.cos(angle) * r, centreY + Math.sin(angle) * r);
  }
  doc.closePath().fill();
  doc.fillColor(COULEUR.encre);
  signaler(plan, x, y, largeur, hauteur, '[drapeau]');
}

function dessinerLogoMinistere(plan: Plan, x: number, y: number): void {
  const doc = plan.doc;
  doc.rect(x, y, 64, 30).lineWidth(0.6).strokeColor(COULEUR.trait).stroke();
  tracer(plan, ['Logo du', 'Ministère'], x + 2, 60, y + 8, 'centre', 'normal', TAILLE.petit, COULEUR.doux);
  doc.strokeColor(COULEUR.encre);
}

function dessinerQr(plan: Plan, contenu: string, x: number, y: number, largeur: number): void {
  const qr = QRCode.create(contenu, { errorCorrectionLevel: 'M' });
  const taille = qr.modules.size;
  const cellule = largeur / taille;
  plan.doc.save();
  plan.doc.fillColor(COULEUR.encre);
  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      if (qr.modules.get(ligne, colonne) === 1) {
        plan.doc.rect(x + colonne * cellule, y + ligne * cellule, cellule + 0.15, cellule + 0.15).fill();
      }
    }
  }
  plan.doc.restore();
  signaler(plan, x, y, largeur, largeur, `[QR:${contenu}]`);
}

function moyenneGroupe(matiere: Matiere, categorie: 'DEVOIR' | 'COMPOSITION'): string {
  const groupe = matiere.groupes.find(
    (item) => item.category === categorie && item.moyenneAffichee !== null
  );
  if (groupe) return groupe.moyenneAffichee ?? '—';
  const incomplet = matiere.groupes.find((item) => item.category === categorie);
  if (incomplet?.notes.some((note) => note.status === 'ABSENT')) return 'ABS';
  if (incomplet?.notes.some((note) => note.status === 'ANNULEE')) return 'ANN';
  return '—';
}

function rangMatiere(matiere: Matiere): string {
  return matiere.rangAffiche ?? (matiere.rang === null ? '—' : String(matiere.rang));
}

function lignesMatieresOfficielles(s: SnapshotBulletin): Cellule[][] {
  const lignes: Cellule[][] = [];
  let parentAffiche: string | null = null;
  const matieres = [...s.matieres].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const idsParents = new Set(matieres.map((matiere) => matiere.parentId).filter(Boolean));

  for (const matiere of matieres) {
    const parent = matiere.parentName ?? (matiere.parentId ? 'Groupe' : null);
    const groupeSansNotePropre =
      idsParents.has(matiere.subjectId) &&
      !matiere.comptabilisee &&
      matiere.coefficientValide === false &&
      (matiere.groupes ?? []).length === 0;
    if (parent && parentAffiche !== parent) {
      lignes.push([
        { texte: parent, style: 'gras' },
        { texte: '' },
        { texte: '' },
        { texte: '' },
        { texte: '' },
        { texte: '' },
        { texte: '' },
        { texte: '' },
      ]);
      parentAffiche = parent;
    }
    if (!parent) parentAffiche = null;
    if (groupeSansNotePropre) continue;
    lignes.push([
      { texte: parent ? `    ${matiere.subjectName}` : matiere.subjectName },
      { texte: deuxDecimales(moyenneGroupe(matiere, 'DEVOIR')), aligne: 'droite' },
      { texte: deuxDecimales(moyenneGroupe(matiere, 'COMPOSITION')), aligne: 'droite' },
      { texte: deuxDecimales(affiche(matiere.moyenneAffichee)), aligne: 'droite', style: 'gras' },
      { texte: matiere.coefficient ?? '—', aligne: 'centre' },
      { texte: deuxDecimales(matiere.pointsPonderes), aligne: 'droite' },
      { texte: rangMatiere(matiere), aligne: 'centre' },
      { texte: matiere.appreciation ?? '—' },
    ]);
  }

  lignes.push([
    { texte: 'TOTAUX', style: 'gras' },
    { texte: '' },
    { texte: '' },
    { texte: '' },
    { texte: s.synthese.totalCoeficients, aligne: 'centre', style: 'gras' },
    { texte: deuxDecimales(s.synthese.totalPoints), aligne: 'droite', style: 'gras' },
    { texte: '' },
    { texte: '' },
  ]);
  return lignes;
}

function lignesCases(cases: string[]): Cellule[][] {
  const lignes: Cellule[][] = [];
  for (let index = 0; index < cases.length; index += 4) {
    lignes.push(cases.slice(index, index + 4).map((libelle) => ({ texte: `[ ] ${libelle}` })));
  }
  return lignes;
}

function moyenneAnnuelle(s: SnapshotBulletin): string {
  const precedent = s.continuite.semestrePrecedent;
  if (!precedent?.moyenneGenerale || !s.synthese.moyenneGenerale) return 'Non calculable';
  try {
    const valeur = new Decimal(precedent.moyenneGenerale)
      .plus(s.synthese.moyenneGenerale)
      .div(2);
    return (
      formaterNote(
        valeur,
        s.regles.arrondiDecimales,
        s.regles.arrondiMode as ModeArrondi
      ) ?? 'Non calculable'
    );
  } catch {
    return 'Non calculable';
  }
}

function dessinerBulletinOfficielHistorique(
  plan: Plan,
  s: SnapshotBulletin,
  meta: MetaBulletin,
  textes: TextesLibres
): void {
  const debut = plan.page;
  const modele = s.modeleOfficiel;
  if (!modele) return;
  const doc = plan.doc;
  const primaire = configCouleur(s.enTete.couleurPrimaire, COULEUR.encre);
  const secondaire = configCouleur(s.enTete.couleurSecondaire, COULEUR.encre);
  const accent = configCouleur(s.enTete.couleurAccent, COULEUR.fondFort);

  const drapeauX = ZONE.x;
  const drapeauY = plan.y;
  if (!dessinerImageDans(plan, s.enTete.drapeauDataUrl, drapeauX, drapeauY, 42, 25)) {
    dessinerDrapeau(plan, drapeauX, drapeauY);
  }
  const ministereX = ZONE.x + ZONE.largeur - 64;
  if (!dessinerImageDans(plan, s.enTete.logoMinistereDataUrl, ministereX, drapeauY, 64, 30)) {
    dessinerLogoMinistere(plan, ministereX, drapeauY);
  }
  tracer(
    plan,
    ['République du Sénégal'],
    drapeauX + 48,
    150,
    drapeauY + 3,
    'gauche',
    'gras',
    TAILLE.petit
  );
  tracer(
    plan,
    ["Ministère de l'Éducation nationale"],
    ministereX - 192,
    188,
    drapeauY + 3,
    'droite',
    'gras',
    TAILLE.petit
  );
  plan.y += 34;
  ecrire(plan, (s.enTete.iefName ?? 'Inspection de l’Éducation et de la Formation').toUpperCase(), {
    aligne: 'centre',
    style: 'gras',
    taille: 8.5,
    apres: 1,
  });
  dessinerImageDans(
    plan,
    s.enTete.logoDataUrl,
    ZONE.x + (ZONE.largeur - 90) / 2,
    plan.y,
    90,
    22
  );
  ecrire(plan, (s.enTete.nomOfficiel ?? s.enTete.nomEtablissement).toUpperCase(), {
    aligne: 'centre',
    style: 'gras',
    taille: 11,
    apres: 1,
  });
  const coordonnees = [s.enTete.ville, s.enTete.telephone ? `Tél. ${s.enTete.telephone}` : null, s.enTete.email]
    .filter((partie): partie is string => Boolean(partie && partie.trim()))
    .join('  ·  ');
  if (coordonnees) {
    ecrire(plan, coordonnees, { aligne: 'centre', taille: TAILLE.petit, couleur: COULEUR.doux });
  }
  filet(plan);

  veillerEspace(plan, 34);
  doc.rect(ZONE.x, plan.y, ZONE.largeur, 21).fillAndStroke(primaire, COULEUR.trait);
  tracer(plan, [modele.titre], ZONE.x, ZONE.largeur, plan.y + 4, 'centre', 'gras', 10.5, '#FFFFFF');
  plan.y += 21;
  ecrire(plan, `ANNEE SCOLAIRE : ${s.enTete.anneeScolaire.nom}`, {
    aligne: 'centre',
    style: 'gras',
    taille: 8,
    apres: 3,
  });

  const colonnesIdentite = 4;
  const largeurIdentite = Math.floor(ZONE.largeur / colonnesIdentite);
  tableau(
    plan,
    'Identité',
    [
      { titre: 'Identité', largeur: largeurIdentite },
      { titre: 'Naissance', largeur: largeurIdentite },
      { titre: 'Scolarité', largeur: largeurIdentite },
      { titre: 'Bulletin', largeur: ZONE.largeur - 3 * largeurIdentite },
    ],
    [
      [
        { texte: 'Nom', valeur: s.eleve.nom },
        { texte: 'Prénom(s)', valeur: s.eleve.prenoms },
        { texte: 'Classe', valeur: s.eleve.classe },
        { texte: 'Sexe', valeur: s.eleve.sexe ?? '—' },
      ],
      [
        { texte: 'Né(e) le', valeur: dateFr(s.eleve.birthDate, false) },
        { texte: 'Lieu de naissance', valeur: s.eleve.birthPlace ?? '—' },
        { texte: 'Matricule', valeur: s.eleve.matricule },
        { texte: 'IEN (identifiant national)', valeur: s.eleve.ien ?? '—' },
      ],
      [
        { texte: 'Niveau', valeur: s.eleve.niveau ?? '—' },
        { texte: 'Série (NON APPLICABLE)', valeur: s.eleve.serie ?? 'NON APPLICABLE' },
        {
          texte: 'Classe doublée (NEANT ou OUI)',
          valeur: s.eleve.isRepeating ? 'OUI' : 'NEANT',
        },
        { texte: 'Effectif', valeur: String(s.synthese.effectif) },
      ],
      [
        { texte: 'Moyenne classe', valeur: affiche(s.synthese.moyenneClasseAffichee) },
        { texte: 'ANNEE SCOLAIRE', valeur: s.enTete.anneeScolaire.nom },
        { texte: 'Semestre', valeur: s.enTete.semestre.nom },
        { texte: 'Statut bulletin', valeur: meta.statut },
      ],
    ],
    { tete: TAILLE.petit }
  );

  ecrire(plan, 'Notes et moyennes par discipline', {
    style: 'gras',
    taille: TAILLE.section,
    avant: 5,
    apres: 1,
  });
  tableau(
    plan,
    'Disciplines',
    [
      { titre: 'Disciplines', largeur: 132 },
      { titre: 'Devoirs', largeur: 44, aligne: 'centre' },
      { titre: 'Compos', largeur: 44, aligne: 'centre' },
      { titre: 'Moy', largeur: 40, aligne: 'centre' },
      { titre: 'Coeff', largeur: 32, aligne: 'centre' },
      { titre: 'Moy×Coef', largeur: 48, aligne: 'centre' },
      { titre: 'Rang', largeur: 38, aligne: 'centre' },
      { titre: 'Appréciations', largeur: ZONE.largeur - 378 },
    ],
    lignesMatieresOfficielles(s),
    { tete: 7 }
  );

  const absences = s.absences;
  tableau(
    plan,
    'Synthèse',
    [
      { titre: 'Moyenne', largeur: 110, aligne: 'centre' },
      { titre: 'Rang', largeur: 110, aligne: 'centre' },
      { titre: 'Retards (h, min)', largeur: 130, aligne: 'centre' },
      { titre: 'Absences (dont justifiées)', largeur: ZONE.largeur - 350, aligne: 'centre' },
    ],
    [
      [
        { texte: affiche(s.synthese.moyenneGeneraleAffichee), aligne: 'centre', style: 'gras' },
        {
          texte: s.synthese.rangAffiche ?? rangCellule(s.synthese.rang),
          aligne: 'centre',
          style: 'gras',
        },
        {
          texte:
            absences?.disponible
              ? `${absences.retards} (${absences.minutesRetard} min)`
              : 'Non renseigné',
          aligne: 'centre',
        },
        {
          texte:
            absences?.disponible
              ? `${absences.absencesTotal} (dont ${absences.absencesJustifiees} justifiées)`
              : 'Non renseigné',
          aligne: 'centre',
        },
      ],
    ],
    { tete: 7 }
  );

  if (s.synthese.incomplet || s.motifs.length > 0) {
    const motif = s.motifs[0] ?? s.synthese.motifNonClasse;
    ecrire(
      plan,
      motif ? `Bulletin incomplet — ${motif}` : 'Bulletin incomplet — données manquantes',
      { couleur: COULEUR.alerte, taille: TAILLE.petit, apres: 2 }
    );
  }

  if (s.enTete.semestre.numero === 2) {
    ecrire(plan, 'Moyennes, rangs et moyenne de classe', {
      style: 'gras',
      taille: TAILLE.section,
      avant: 5,
      apres: 1,
    });
    const precedent = s.continuite.semestrePrecedent;
    tableau(
      plan,
      'Semestres',
      [
        { titre: 'Moyennes', largeur: 175 },
        { titre: 'Rangs', largeur: 160, aligne: 'centre' },
        { titre: 'Moyenne classe', largeur: ZONE.largeur - 335, aligne: 'centre' },
      ],
      [
        [
          { texte: 'Premier semestre' },
          {
            texte: precedent?.rang === null || precedent?.rang === undefined ? '—' : String(precedent.rang),
            aligne: 'centre',
          },
          { texte: precedent?.moyenneGeneraleAffichee ?? 'Non calculable', aligne: 'centre' },
        ],
        [
          { texte: 'Second semestre' },
          {
            texte: s.synthese.rangAffiche ?? rangCellule(s.synthese.rang),
            aligne: 'centre',
          },
          { texte: affiche(s.synthese.moyenneClasseAffichee), aligne: 'centre' },
        ],
        [
          { texte: 'Moyenne générale', style: 'gras' },
          { texte: '—', aligne: 'centre' },
          { texte: moyenneAnnuelle(s), aligne: 'centre', style: 'gras' },
        ],
      ],
      { tete: 7 }
    );
    cadre(plan, 'Absences & Retards second semestre', [
      {
        libelle: 'Absences',
        valeur: absences?.disponible
          ? `${absences.absencesTotal} (dont ${absences.absencesJustifiees} justifiées)`
          : 'Non renseigné',
      },
      {
        libelle: 'Retards',
        valeur: absences?.disponible
          ? `${absences.retards} (${absences.minutesRetard} min)`
          : 'Non renseigné',
      },
    ]);
  }

  const cases = s.enTete.semestre.numero === 1 ? modele.casesS1 : modele.casesS2;
  ecrire(plan, 'Cases à cocher par le conseil', {
    style: 'gras',
    taille: TAILLE.section,
    avant: 5,
    apres: 1,
  });
  const caseColonne = ZONE.largeur / 4;
  tableau(
    plan,
    'Cases',
    [
      { titre: '', largeur: caseColonne },
      { titre: '', largeur: caseColonne },
      { titre: '', largeur: caseColonne },
      { titre: '', largeur: ZONE.largeur - 3 * caseColonne },
    ],
    lignesCases(cases),
    { sansEnTete: true, tete: TAILLE.petit }
  );

  if (s.enTete.semestre.numero === 2) {
    cadre(plan, 'Décision du conseil', [
      {
        libelle: 'Décision proposée (à valider)',
        valeur: textes.decisionConseil ?? modele.decisionProposee ?? 'Non renseigné',
      },
      {
        libelle: 'Observation du conseil',
        valeur: modele.observationConseil ?? textes.appreciation ?? 'Non renseigné',
      },
    ]);
  } else {
    ecrire(plan, 'Observations du conseil des professeurs', {
      style: 'gras',
      taille: TAILLE.section,
      avant: 4,
      apres: 1,
    });
    ecrire(plan, modele.observationConseil ?? textes.appreciation ?? 'Non renseigné', {
      taille: 8,
      apres: 2,
    });
  }

  const signatureY = plan.y + 8;
  const largeurBloc = 190;
  const gauche = blocSignature(
    plan,
    ZONE.x,
    signatureY,
    largeurBloc,
    'Le Professeur principal',
    s.enTete.professeurPrincipal
  );
  const droite = blocSignature(
    plan,
    ZONE.x + ZONE.largeur - largeurBloc,
    signatureY,
    largeurBloc,
    "Le Chef d'établissement",
    s.enTete.chefEtablissement
  );
  doc.fillColor(secondaire);
  filet(plan);
  doc.fillColor(COULEUR.encre);
  plan.y = signatureY + Math.max(gauche, droite) + 2;

  veillerEspace(plan, 62);
  const qrY = plan.y + 4;
  const qrTaille = 44;
  dessinerQr(plan, modele.qrInformations, ZONE.x, qrY, qrTaille);
  tracer(
    plan,
    ['Informations Élève'],
    ZONE.x,
    qrTaille + 30,
    qrY + qrTaille + 3,
    'centre',
    'normal',
    TAILLE.petit
  );
  dessinerQr(plan, modele.qrBulletin, ZONE.x + ZONE.largeur - qrTaille, qrY, qrTaille);
  tracer(
    plan,
    ['Ouvrir le bulletin'],
    ZONE.x + ZONE.largeur - qrTaille - 30,
    qrTaille + 30,
    qrY + qrTaille + 3,
    'centre',
    'normal',
    TAILLE.petit
  );
  plan.y = qrY + qrTaille + 18;

  const etiquette = `${s.eleve.nom} ${s.eleve.prenoms} — ${s.eleve.matricule} — ${s.eleve.classe} — ${s.enTete.semestre.nom}`;
  const mention = mentionDe(meta, s.genereLe);
  for (let page = debut; page <= plan.page; page += 1) {
    plan.etiquettes[page - 1] = etiquette;
    plan.mentions[page - 1] = mention;
    plan.statuts[page - 1] = meta.statut;
  }
  void accent;
}

const CASES_OFFICIELLES_S1 = [
  'Travail excellent',
  'Satisfaisant doit continuer',
  'Peut mieux faire',
  'Insuffisant',
  'Risque de redoubler',
  "Risque l'exclusion",
  'Félicitations',
  'Encouragements',
  "Tableau d'honneur",
  'Passable',
  'Doit redoubler d’effort',
  'Avertissement',
  'Blâme',
];

const CASES_OFFICIELLES_S2 = [
  ['Félicitations', 'Encouragements', "Tableau d'honneur", 'Passable', 'Insuffisant'],
  ['Passe en classe supérieure', 'Autorisé(e) à redoubler', "Exclu(e) de l'établissement"],
];

interface ChampOfficiel {
  libelle: string;
  valeur: string;
}

function deuxDecimales(valeur: string | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const propre = valeur.trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(propre)) return valeur;
  try {
    return new Decimal(propre.replace(',', '.')).toFixed(2);
  } catch {
    return valeur;
  }
}

function dateNaissance(iso: string | null): string {
  const valeur = dateFr(iso, false);
  return valeur === '—' ? valeur : valeur.replace(/\//g, '-');
}

function dureeRetards(minutes: number): string {
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return `${heures} heure(s) ${reste} minute(s)`;
}

function ligneEpaisse(plan: Plan): void {
  plan.doc
    .moveTo(ZONE.x, plan.y)
    .lineTo(ZONE.x + ZONE.largeur, plan.y)
    .lineWidth(1.6)
    .strokeColor('#000000')
    .stroke();
  plan.doc.strokeColor(COULEUR.encre);
  plan.y += 5;
}

function souligner(
  plan: Plan,
  texte: string,
  x: number,
  largeur: number,
  y: number,
  taille: number
): number {
  const doc = plan.doc;
  police(doc, 'gras', taille);
  const lignes = decouper(doc, texte, largeur);
  tracer(plan, lignes, x, largeur, y, 'gauche', 'gras', taille);
  const derniere = lignes[lignes.length - 1] ?? '';
  const mesure = doc.widthOfString(derniere);
  const traitY = y + lignes.length * taille * INTERLIGNE + 1;
  doc.moveTo(x, traitY).lineTo(x + mesure, traitY).lineWidth(0.7).strokeColor('#000000').stroke();
  doc.strokeColor(COULEUR.encre);
  return lignes.length * taille * INTERLIGNE + 2;
}

function coinsBloc(plan: Plan, x: number, y: number, largeur: number, hauteur: number): void {
  const crochet = 10;
  const segments: [number, number, number, number][] = [
    [x, y, x + crochet, y],
    [x, y, x, y + crochet],
    [x + largeur - crochet, y, x + largeur, y],
    [x + largeur, y, x + largeur, y + crochet],
    [x, y + hauteur - crochet, x, y + hauteur],
    [x, y + hauteur, x + crochet, y + hauteur],
    [x + largeur - crochet, y + hauteur, x + largeur, y + hauteur],
    [x + largeur, y + hauteur - crochet, x + largeur, y + hauteur],
  ];
  plan.doc.lineWidth(0.9).strokeColor('#000000');
  segments.forEach(([x1, y1, x2, y2]) => {
    plan.doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  });
  plan.doc.strokeColor(COULEUR.encre);
}

function tracerChamp(
  plan: Plan,
  x: number,
  largeur: number,
  y: number,
  champ: ChampOfficiel,
  taille: number
): number {
  const doc = plan.doc;
  const prefixe = champ.libelle ? `${champ.libelle} : ` : '';
  police(doc, 'normal', taille);
  doc.fillColor(COULEUR.encre);
  const largeurPrefixe = prefixe ? doc.widthOfString(prefixe) : 0;
  if (prefixe) {
    doc.text(prefixe, x, y, { lineBreak: false });
    signaler(plan, x, y, largeurPrefixe, taille * INTERLIGNE, prefixe);
  }
  const largeurValeur = Math.max(largeur - largeurPrefixe, 8);
  return tracer(
    plan,
    decouper(doc, champ.valeur, largeurValeur),
    x + largeurPrefixe,
    largeurValeur,
    y,
    'gauche',
    'gras',
    taille
  );
}

function tracerChamps(
  plan: Plan,
  x: number,
  largeur: number,
  y: number,
  champs: ChampOfficiel[],
  taille: number
): number {
  const doc = plan.doc;
  let curseur = x;
  for (const champ of champs) {
    const prefixe = champ.libelle ? `${champ.libelle} : ` : '';
    police(doc, 'normal', taille);
    doc.fillColor(COULEUR.encre);
    const largeurPrefixe = prefixe ? doc.widthOfString(prefixe) : 0;
    if (prefixe) {
      doc.text(prefixe, curseur, y, { lineBreak: false });
      signaler(plan, curseur, y, largeurPrefixe, taille * INTERLIGNE, prefixe);
    }
    police(doc, 'gras', taille);
    const restant = Math.max(x + largeur - curseur - largeurPrefixe, 8);
    const valeurX = curseur + largeurPrefixe;
    const valeurLargeur = Math.min(doc.widthOfString(champ.valeur), restant);
    doc.text(champ.valeur, valeurX, y, { lineBreak: false });
    signaler(plan, valeurX, y, valeurLargeur, taille * INTERLIGNE, champ.valeur);
    curseur = valeurX + valeurLargeur + 12;
    if (curseur >= x + largeur) break;
  }
  return taille * INTERLIGNE;
}

function blocInfos(
  plan: Plan,
  x: number,
  y: number,
  largeur: number,
  lignes: ChampOfficiel[][],
  taille: number
): number {
  const hauteur = lignes.length * (taille * INTERLIGNE + 2) + 8;
  coinsBloc(plan, x, y, largeur, hauteur);
  let curseur = y + 4;
  for (const ligne of lignes) {
    curseur +=
      ligne.length === 1
        ? tracerChamp(plan, x + 6, largeur - 12, curseur, ligne[0], taille)
        : tracerChamps(plan, x + 6, largeur - 12, curseur, ligne, taille);
    curseur += 2;
  }
  return hauteur;
}

function bandeauGris(plan: Plan, texte: string, hauteur = 18): void {
  plan.doc.rect(ZONE.x, plan.y, ZONE.largeur, hauteur).fill(COULEUR.fondFort);
  tracer(plan, [texte], ZONE.x, ZONE.largeur, plan.y + 4, 'centre', 'gras', 9);
  plan.y += hauteur;
}

function bandeauSynthese(plan: Plan, texte: string): void {
  const doc = plan.doc;
  police(doc, 'gras', 8);
  const lignes = decouper(doc, texte, ZONE.largeur - 10);
  const hauteur = lignes.length * 8 * INTERLIGNE + 6;
  doc.rect(ZONE.x, plan.y, ZONE.largeur, hauteur).fill(COULEUR.fondFort);
  tracer(plan, lignes, ZONE.x + 5, ZONE.largeur - 10, plan.y + 3, 'centre', 'gras', 8);
  plan.y += hauteur;
}

function cadreOfficiel(
  plan: Plan,
  x: number,
  y: number,
  largeur: number,
  hauteur: number,
  titre: string,
  contenu: string
): void {
  coinsBloc(plan, x, y, largeur, hauteur);
  const hauteurTitre = souligner(plan, titre, x + 6, largeur - 12, y + 4, 8.2);
  if (contenu) {
    tracer(
      plan,
      decouper(plan.doc, contenu, largeur - 12),
      x + 6,
      largeur - 12,
      y + 4 + hauteurTitre + 2,
      'gauche',
      'normal',
      8
    );
  }
}

function casesOfficielles(plan: Plan, colonnes: string[][], largeurColonne: number): void {
  const depart = plan.y;
  const hauteurLigne = 10.5;
  colonnes.forEach((liste, index) => {
    const x = ZONE.x + index * largeurColonne;
    liste.forEach((libelle, rang) => {
      tracer(
        plan,
        [`[ ] ${libelle}`],
        x + 2,
        largeurColonne - 4,
        depart + rang * hauteurLigne,
        'gauche',
        'normal',
        TAILLE.petit
      );
    });
  });
  plan.y = depart + Math.max(...colonnes.map((liste) => liste.length)) * hauteurLigne;
}

function blocChef(plan: Plan, x: number, y: number, largeur: number): number {
  const doc = plan.doc;
  const hauteurTitre = souligner(plan, "Le Chef d'établissement", x, largeur, y, 8.2);
  const ligneY = y + hauteurTitre + 32;
  doc.moveTo(x, ligneY).lineTo(x + largeur * 0.55, ligneY).lineWidth(0.6).strokeColor('#000000').stroke();
  doc
    .moveTo(x + largeur * 0.6, ligneY)
    .lineTo(x + largeur, ligneY)
    .lineWidth(0.6)
    .strokeColor('#000000')
    .stroke();
  doc.strokeColor(COULEUR.encre);
  tracer(plan, ['Cachet'], x, largeur * 0.55, ligneY + 2, 'centre', 'normal', TAILLE.petit, COULEUR.doux);
  tracer(
    plan,
    ['Signature'],
    x + largeur * 0.6,
    largeur * 0.4,
    ligneY + 2,
    'centre',
    'normal',
    TAILLE.petit,
    COULEUR.doux
  );
  return hauteurTitre + 46;
}

function piedQrOfficiel(plan: Plan, modele: ModeleOfficielSnapshot): void {
  const qrY = BAS_DE_ZONE - 54;
  const taille = 40;
  dessinerQr(plan, modele.qrInformations, ZONE.x, qrY, taille);
  tracer(plan, ['Informations Élève'], ZONE.x, taille + 26, qrY + taille + 3, 'centre', 'normal', TAILLE.petit);
  dessinerQr(plan, modele.qrBulletin, ZONE.x + ZONE.largeur - taille, qrY, taille);
  tracer(
    plan,
    ['Ouvrir le bulletin'],
    ZONE.x + ZONE.largeur - taille - 26,
    taille + 26,
    qrY + taille + 3,
    'centre',
    'normal',
    TAILLE.petit
  );
}

function dessinerBulletinOfficiel(
  plan: Plan,
  s: SnapshotBulletin,
  meta: MetaBulletin,
  textes: TextesLibres
): void {
  const debut = plan.page;
  const modele = s.modeleOfficiel;
  if (!modele) return;
  const doc = plan.doc;
  const haut = plan.y;

  if (!dessinerImageDans(plan, s.enTete.drapeauDataUrl, ZONE.x, haut, 42, 25)) {
    dessinerDrapeau(plan, ZONE.x, haut);
  }
  const ministereX = ZONE.x + ZONE.largeur - 64;
  if (!dessinerImageDans(plan, s.enTete.logoMinistereDataUrl, ministereX, haut, 64, 30)) {
    dessinerLogoMinistere(plan, ministereX, haut);
  }
  const centreX = ZONE.x + 50;
  const centreLargeur = ZONE.largeur - 100;
  tracer(plan, ['République du Sénégal'], centreX, centreLargeur, haut + 1, 'centre', 'gras', 8.5);
  tracer(
    plan,
    ["Ministère de l'Education nationale"],
    centreX,
    centreLargeur,
    haut + 12,
    'centre',
    'gras',
    8.5
  );
  tracer(
    plan,
    decouper(doc, (s.enTete.nomOfficiel ?? s.enTete.nomEtablissement).toUpperCase(), centreLargeur),
    centreX,
    centreLargeur,
    haut + 23,
    'centre',
    'gras',
    10.5
  );
  tracer(
    plan,
    [`ANNEE SCOLAIRE : ${s.enTete.anneeScolaire.nom}`],
    centreX,
    centreLargeur,
    haut + 38,
    'centre',
    'gras',
    8.5
  );
  plan.y = haut + 49;
  ligneEpaisse(plan);

  plan.y += 4;
  const yBlocs = plan.y;
  const largeurBloc = (ZONE.largeur - 12) / 2;
  const blocGauche: ChampOfficiel[][] = [
    [{ libelle: 'Tel', valeur: s.enTete.telephone ?? '—' }],
    [{ libelle: 'Email', valeur: s.enTete.email ?? '—' }],
    [{ libelle: 'Niveau', valeur: s.eleve.niveau ?? '—' }],
    [{ libelle: 'Série (NON APPLICABLE)', valeur: s.eleve.serie ?? 'NON APPLICABLE' }],
    [{ libelle: 'Effectif', valeur: String(s.synthese.effectif) }],
    [{ libelle: 'Moyenne classe', valeur: affiche(s.synthese.moyenneClasseAffichee) }],
  ];
  const blocDroit: ChampOfficiel[][] = [
    [
      { libelle: 'IEN', valeur: s.eleve.ien ?? '—' },
      { libelle: 'Sexe', valeur: s.eleve.sexe ?? '—' },
    ],
    [{ libelle: 'Classe', valeur: s.eleve.classe }],
    [
      {
        libelle: 'Classe doublée (NEANT ou OUI)',
        valeur: s.eleve.isRepeating ? 'OUI' : 'NEANT',
      },
    ],
    [{ libelle: 'Prénom(s)', valeur: s.eleve.prenoms }],
    [{ libelle: 'Nom', valeur: s.eleve.nom }],
    [
      { libelle: 'Né(e) le', valeur: dateNaissance(s.eleve.birthDate) },
      { libelle: 'à', valeur: s.eleve.birthPlace ?? '—' },
    ],
  ];
  const hauteurBloc = blocInfos(plan, ZONE.x, yBlocs, largeurBloc, blocGauche, 8);
  blocInfos(plan, ZONE.x + largeurBloc + 12, yBlocs, largeurBloc, blocDroit, 8);
  plan.y = yBlocs + hauteurBloc + 6;

  bandeauGris(
    plan,
    s.enTete.semestre.numero === 1
      ? 'BULLETIN DU PREMIER SEMESTRE'
      : 'BULLETIN DU SECOND SEMESTRE'
  );
  plan.y += 4;

  tableau(
    plan,
    'Disciplines',
    [
      { titre: 'Disciplines', largeur: 132 },
      { titre: 'Devoirs', largeur: 44, aligne: 'droite' },
      { titre: 'Compos', largeur: 44, aligne: 'droite' },
      { titre: 'Moy', largeur: 40, aligne: 'droite' },
      { titre: 'Coeff', largeur: 32, aligne: 'centre' },
      { titre: 'Moy×Coef', largeur: 48, aligne: 'droite' },
      { titre: 'Rang', largeur: 38, aligne: 'centre' },
      { titre: 'Appréciations', largeur: ZONE.largeur - 378 },
    ],
    lignesMatieresOfficielles(s),
    { sansGrille: true, fondEntete: COULEUR.fondFort, derniereGrise: true, tete: 7.4 }
  );
  plan.y += 3;

  const absences = s.absences;
  const retardsTexte = absences?.disponible
    ? dureeRetards(absences.minutesRetard)
    : 'Non renseigné';
  const absencesTexte = absences?.disponible
    ? `${absences.absencesTotal} dont ${absences.absencesJustifiees} justifiée(s)`
    : 'Non renseigné';
  bandeauSynthese(
    plan,
    `Moyenne : ${deuxDecimales(affiche(s.synthese.moyenneGeneraleAffichee))} | ` +
      `Rang : ${s.synthese.rangAffiche ?? rangCellule(s.synthese.rang)} | ` +
      `Retards : ${retardsTexte} | Absences : ${absencesTexte}`
  );

  if (s.synthese.incomplet || s.motifs.length > 0) {
    const motif = s.motifs[0] ?? s.synthese.motifNonClasse;
    ecrire(plan, motif ? `Bulletin incomplet — ${motif}` : 'Bulletin incomplet — données manquantes', {
      taille: TAILLE.petit,
      apres: 2,
    });
  }

  if (s.enTete.semestre.numero === 2) {
    const ySemestre = plan.y;
    const largeurSemestre = 300;
    const precedent = s.continuite.semestrePrecedent;
    tableau(
      plan,
      'Semestres',
      [
        { titre: 'Moyennes', largeur: 140 },
        { titre: 'Rangs', largeur: 60, aligne: 'centre' },
        { titre: 'Moy classe', largeur: 100, aligne: 'centre' },
      ],
      [
        [
          { texte: 'Premier semestre' },
          {
            texte: precedent?.rang === null || precedent?.rang === undefined ? '—' : String(precedent.rang),
            aligne: 'centre',
          },
          { texte: deuxDecimales(precedent?.moyenneGeneraleAffichee), aligne: 'centre' },
        ],
        [
          { texte: 'Second semestre' },
          { texte: s.synthese.rangAffiche ?? rangCellule(s.synthese.rang), aligne: 'centre' },
          { texte: deuxDecimales(s.synthese.moyenneClasseAffichee), aligne: 'centre' },
        ],
        [
          { texte: 'Moyenne générale', style: 'gras' },
          { texte: '—', aligne: 'centre' },
          { texte: moyenneAnnuelle(s), aligne: 'centre', style: 'gras' },
        ],
      ],
      { x: ZONE.x, largeur: largeurSemestre, sansGrille: true, tete: 7.4 }
    );
    const hauteurSemestre = plan.y - ySemestre;
    plan.y = ySemestre;
    const xAbsences = ZONE.x + largeurSemestre + 10;
    const largeurAbsences = ZONE.largeur - largeurSemestre - 10;
    const hauteurAbsences = 62;
    coinsBloc(plan, xAbsences, ySemestre, largeurAbsences, hauteurAbsences);
    const hauteurTitre = souligner(
      plan,
      'Absences & Retards second semestre',
      xAbsences + 6,
      largeurAbsences - 12,
      ySemestre + 4,
      8.2
    );
    tracer(
      plan,
      [`Retards : ${retardsTexte}`],
      xAbsences + 6,
      largeurAbsences - 12,
      ySemestre + 5 + hauteurTitre,
      'gauche',
      'normal',
      8
    );
    tracer(
      plan,
      [`Absences : ${absencesTexte}`],
      xAbsences + 6,
      largeurAbsences - 12,
      ySemestre + 17 + hauteurTitre,
      'gauche',
      'normal',
      8
    );
    plan.y = ySemestre + Math.max(hauteurSemestre, hauteurAbsences) + 4;
  }

  ecrire(
    plan,
    `Décision proposée (à valider) : ${textes.decisionConseil ?? modele.decisionProposee ?? 'Non renseigné'}`,
    { taille: 8, avant: 3, apres: 3 }
  );

  ecrire(plan, 'Cases à cocher (×)', { style: 'gras', taille: 8.2, apres: 2 });
  if (s.enTete.semestre.numero === 1) {
    casesOfficielles(
      plan,
      [CASES_OFFICIELLES_S1.slice(0, 6), CASES_OFFICIELLES_S1.slice(6)],
      ZONE.largeur / 2
    );
  } else {
    casesOfficielles(plan, CASES_OFFICIELLES_S2, ZONE.largeur / 2);
  }
  plan.y += 4;
  cadreOfficiel(
    plan,
    ZONE.x,
    plan.y,
    ZONE.largeur,
    54,
    'Observations du conseil des professeurs',
    modele.observationConseil ?? textes.appreciation ?? ''
  );
  plan.y += 58;
  plan.y += blocChef(plan, ZONE.x, plan.y, ZONE.largeur);

  piedQrOfficiel(plan, modele);

  const etiquette = `${s.eleve.nom} ${s.eleve.prenoms} — ${s.eleve.matricule} — ${s.eleve.classe} — ${s.enTete.semestre.nom}`;
  const mention = mentionDe(meta, s.genereLe);
  for (let page = debut; page <= plan.page; page += 1) {
    plan.etiquettes[page - 1] = etiquette;
    plan.mentions[page - 1] = mention;
    plan.statuts[page - 1] = meta.statut;
  }
}

/** Une page par bulletin. Le contenu vient uniquement du snapshot et des colonnes texte. */
function dessinerBulletin(plan: Plan, s: SnapshotBulletin, meta: MetaBulletin, textes: TextesLibres): void {
  const debut = plan.page;
  const etiquette = `${s.eleve.nom} ${s.eleve.prenoms} — ${s.eleve.matricule} — ${s.eleve.classe} — ${s.enTete.semestre.nom}`;
  const mention = mentionDe(meta, s.genereLe);

  dessinerLogo(plan, s.enTete.logoDataUrl);
  if (s.enTete.iefName) {
    ecrire(plan, s.enTete.iefName.toUpperCase(), {
      aligne: 'centre',
      style: 'gras',
      taille: TAILLE.sousTitre,
      apres: 2,
    });
  }
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
  if (s.eleve.isRepeating) {
    ecrire(plan, 'Redoublant', {
      taille: TAILLE.petit,
      style: 'gras',
      couleur: COULEUR.doux,
      apres: 2,
    });
  }

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
      { titre: 'N°', largeur: 20, aligne: 'centre' },
      { titre: 'Disciplines', largeur: 104 },
      { titre: 'Dev 1', largeur: 34, aligne: 'centre' },
      { titre: 'Dev 2', largeur: 34, aligne: 'centre' },
      { titre: 'Compo', largeur: 42, aligne: 'centre' },
      { titre: `Moy./${s.regles.baremeParDefaut}`, largeur: 45, aligne: 'centre' },
      { titre: 'Coef.', largeur: 30, aligne: 'centre' },
      { titre: 'Points', largeur: 40, aligne: 'centre' },
      { titre: 'Rang', largeur: 32, aligne: 'centre' },
      { titre: 'Appréciation', largeur: ZONE.largeur - 381 },
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
    ...(textes.decisionProposee
      ? [{ libelle: 'Proposition automatique (à valider)', valeur: textes.decisionProposee }]
      : []),
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

  const signatureY = plan.y + 12;
  const largeurBloc = 200;
  const gauche = blocSignature(
    plan,
    ZONE.x,
    signatureY,
    largeurBloc,
    'Professeur principal',
    s.enTete.professeurPrincipal
  );
  const droite = blocSignature(
    plan,
    ZONE.x + ZONE.largeur - largeurBloc,
    signatureY,
    largeurBloc,
    "Le Chef d'établissement",
    s.enTete.chefEtablissement
  );
  plan.y = signatureY + Math.max(gauche, droite);

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
  dessinerLogo(plan, s.enTete.logoDataUrl);
  if (s.enTete.iefName) {
    ecrire(plan, s.enTete.iefName.toUpperCase(), {
      aligne: 'centre',
      style: 'gras',
      taille: TAILLE.sousTitre,
      apres: 2,
    });
  }
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
  if (s.eleve.isRepeating) {
    ecrire(plan, 'Redoublant', {
      aligne: 'centre',
      taille: TAILLE.petit,
      style: 'gras',
      couleur: COULEUR.doux,
      apres: 2,
    });
  }

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
    ...(s.decisionProposee
      ? [{ libelle: 'Proposition automatique (à valider)', valeur: s.decisionProposee }]
      : []),
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

function estOfficiel(s: SnapshotBulletin): boolean {
  return Boolean(s.modeleOfficiel && s.enTete.modeleBulletin !== 'SIMPLE');
}

export async function genererPdfBulletin(item: BulletinPourPdf): Promise<PdfProduit> {
  const s = item.snapshot;
  const { plan, finaliser } = creerDocument(
    `Bulletin ${s.eleve.nom} ${s.eleve.prenoms} — ${s.enTete.semestre.nom}`
  );
  if (estOfficiel(s)) dessinerBulletinOfficiel(plan, s, item.meta, item.textes ?? {});
  else dessinerBulletin(plan, s, item.meta, item.textes ?? {});
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
    if (estOfficiel(item.snapshot)) {
      dessinerBulletinOfficiel(plan, item.snapshot, item.meta, item.textes ?? {});
    } else {
      dessinerBulletin(plan, item.snapshot, item.meta, item.textes ?? {});
    }
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
