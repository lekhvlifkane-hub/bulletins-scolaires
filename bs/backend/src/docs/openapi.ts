import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Bulletins Scolaires API',
      version: '0.1.0',
      description:
        'API REST du logiciel Bulletins Scolaires. Toutes les données sont isolées par établissement.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Santé', description: 'État de l’API' },
      { name: 'Tableau de bord', description: 'Indicateurs agrégés filtrés selon le périmètre et les droits du compte.' },
      {
        name: 'Notes et calculs',
        description:
          'Évaluations, saisie des notes, workflow de validation et calculs (moyennes, rangs, bilan annuel). Aucun calcul côté interface.',
      },
      {
        name: 'Bulletins',
        description:
          'Bulletins versionnés à snapshot figé, comparaison des semestres, bilans annuels et impression PDF A4. Le PDF et les écarts sont produits côté serveur.',
      },
      {
        name: 'Vie scolaire',
        description:
          'Absences, retards, appréciations, décisions validées du conseil, archives et historique des modifications.',
      },
    ],
  },
  apis: [
    path.join(process.cwd(), 'src', 'routes', '*.ts'),
    path.join(process.cwd(), 'src', 'routes', '*.js'),
    path.join(process.cwd(), 'dist', 'routes', '*.js'),
  ].map((glob) => glob.replaceAll('\\', '/')),
};

export const openApiSpec = swaggerJsdoc(options);
