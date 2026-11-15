import PDFDocument from 'pdfkit';

type StudentPourListe = {
  matricule: string;
  lastName: string;
  firstNames: string;
  birthDate: Date | null;
  sex: string | null;
  enrollments: Array<{
    classroom: {
      name: string;
      academicYear: { name: string };
    };
  }>;
};

type EcolePourListe = {
  name: string;
  officialName: string | null;
  city: string | null;
  phone: string | null;
};

const MARGE = 36;
const LARGEUR_PAGE = 595.28;
const HAUTEUR_PAGE = 841.89;
const LARGEUR_ZONE = LARGEUR_PAGE - MARGE * 2;
const BAS_PAGE = HAUTEUR_PAGE - MARGE;

const COLONNES = [
  { titre: 'Matricule', largeur: 72 },
  { titre: 'Nom', largeur: 92 },
  { titre: 'Prénoms', largeur: 112 },
  { titre: 'Naissance', largeur: 70 },
  { titre: 'Sexe', largeur: 42 },
  { titre: 'Classe', largeur: LARGEUR_ZONE - 388 },
] as const;

function dateFr(value: Date | null): string {
  if (!value) return '—';
  const jour = String(value.getUTCDate()).padStart(2, '0');
  const mois = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${jour}/${mois}/${value.getUTCFullYear()}`;
}

function texteCellule(value: string | null | undefined): string {
  const texte = value?.trim();
  return texte ? texte : '—';
}

export async function genererPdfListeEleves(
  ecole: EcolePourListe,
  eleves: StudentPourListe[],
  recherche: string,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE },
    bufferPages: true,
    info: {
      Title: 'Liste des élèves',
      Author: 'Bulletins Scolaires',
      Creator: 'Bulletins Scolaires',
    },
  });

  const morceaux: Buffer[] = [];
  doc.on('data', (segment: Buffer) => morceaux.push(segment));
  const fini = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', (error: Error) => reject(error));
  });

  const enteteTableau = (y: number): number => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0B2D4F');
    let x = MARGE;
    doc.rect(MARGE, y, LARGEUR_ZONE, 22).fill('#EEF3F7');
    doc.fillColor('#0B2D4F');
    for (const colonne of COLONNES) {
      doc.text(colonne.titre, x + 4, y + 7, {
        width: colonne.largeur - 8,
        align: colonne.titre === 'Sexe' ? 'center' : 'left',
        lineBreak: false,
      });
      x += colonne.largeur;
    }
    doc
      .moveTo(MARGE, y + 22)
      .lineTo(MARGE + LARGEUR_ZONE, y + 22)
      .lineWidth(0.6)
      .strokeColor('#C9D5DF')
      .stroke();
    return y + 22;
  };

  doc.font('Helvetica-Bold').fontSize(13).fillColor('#0B2D4F');
  doc.text((ecole.officialName ?? ecole.name).toUpperCase(), {
    align: 'center',
    width: LARGEUR_ZONE,
  });
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  const coordonnees = [ecole.city, ecole.phone ? `Tél. ${ecole.phone}` : null]
    .filter((partie): partie is string => Boolean(partie))
    .join('  ·  ');
  if (coordonnees) doc.text(coordonnees, { align: 'center', width: LARGEUR_ZONE });
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0B2D4F');
  doc.text('LISTE DES ÉLÈVES', { align: 'center', width: LARGEUR_ZONE });
  doc.font('Helvetica').fontSize(8).fillColor('#475569');
  const details = [
    `${eleves.length} élève(s)`,
    recherche ? `Recherche : ${recherche}` : null,
    `Éditée le ${new Date().toLocaleDateString('fr-FR')}`,
  ]
    .filter((partie): partie is string => Boolean(partie))
    .join('  ·  ');
  doc.text(details, { align: 'center', width: LARGEUR_ZONE });
  doc.moveDown(0.7);

  let y = enteteTableau(doc.y);
  const hauteurLigne = 20;

  eleves.forEach((eleve, index) => {
    if (y + hauteurLigne > BAS_PAGE) {
      doc.addPage();
      y = enteteTableau(MARGE);
    }
    if (index % 2 === 1) {
      doc.rect(MARGE, y, LARGEUR_ZONE, hauteurLigne).fill('#F8FAFC');
    }
    const classe = eleve.enrollments[0]?.classroom;
    const valeurs = [
      eleve.matricule,
      eleve.lastName,
      eleve.firstNames,
      dateFr(eleve.birthDate),
      texteCellule(eleve.sex),
      classe ? `${classe.name} (${classe.academicYear.name})` : 'Non inscrit',
    ];
    doc.font('Helvetica').fontSize(8).fillColor('#1E293B');
    let x = MARGE;
    valeurs.forEach((valeur, colonneIndex) => {
      const colonne = COLONNES[colonneIndex]!;
      doc.text(texteCellule(valeur), x + 4, y + 6, {
        width: colonne.largeur - 8,
        height: hauteurLigne - 4,
        ellipsis: true,
        align: colonne.titre === 'Sexe' ? 'center' : 'left',
      });
      x += colonne.largeur;
    });
    doc
      .moveTo(MARGE, y + hauteurLigne)
      .lineTo(MARGE + LARGEUR_ZONE, y + hauteurLigne)
      .lineWidth(0.3)
      .strokeColor('#DCE5EC')
      .stroke();
    y += hauteurLigne;
  });

  if (eleves.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B');
    doc.text('Aucun élève ne correspond à cette liste.', MARGE, y + 10, {
      width: LARGEUR_ZONE,
      align: 'center',
    });
  }

  const pages = doc.bufferedPageRange().count;
  for (let index = 0; index < pages; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(7).fillColor('#64748B');
    doc.text(`Page ${index + 1}/${pages}`, MARGE, HAUTEUR_PAGE - MARGE + 12, {
      width: LARGEUR_ZONE,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  await fini;
  return Buffer.concat(morceaux);
}
