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
    tags: [{ name: 'Santé', description: 'État de l’API' }],
  },
  apis: [
    path.join(process.cwd(), 'src', 'routes', '*.ts'),
    path.join(process.cwd(), 'src', 'routes', '*.js'),
    path.join(process.cwd(), 'dist', 'routes', '*.js'),
  ].map((glob) => glob.replaceAll('\\', '/')),
};

export const openApiSpec = swaggerJsdoc(options);
