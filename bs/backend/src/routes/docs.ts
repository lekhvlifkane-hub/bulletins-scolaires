import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import helmet from 'helmet';
import { openApiSpec } from '../docs/openapi';

const router = Router();

const docsCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'", "data:"],
  },
});

router.use(docsCsp);
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(openApiSpec));

export const docsRouter = router;
