import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { env, corsOrigins } from './config/env';
import { pool } from './db/pool';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { schoolsRouter } from './routes/schools';
import { temporaryAccessRouter } from './routes/temporary-access';
import { auditLogsRouter } from './routes/audit-logs';
import { studentsRouter } from './routes/students';
import { schoolingRouter } from './routes/schooling';
import { gradesRouter } from './routes/grades';
import { reportCardsRouter } from './routes/report-cards';
import { schoolLifeRouter } from './routes/school-life';
import { dashboardRouter } from './routes/dashboard';
import { docsRouter } from './routes/docs';
import { openApiSpec } from './docs/openapi';
import { HttpError } from './lib/http';
import { errorHandler } from './middleware/error-handler';

const app = express();
const PgSession = connectPgSimple(session);

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (corsOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        callback(null, true);
        return;
      }
      // HttpError 403 explicite : sans lui, ce rejet sortait comme
      // « Erreur non gérée » … puis une réponse 500 trompeuse pour le client.
      callback(new HttpError(403, 'Origine non autorisée par CORS'));
    },
    credentials: true,
  }),
);

// Le logo d'établissement est transmis en data URL dans le JSON (1 Mio décodé).
app.use(express.json({ limit: '2mb' }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    name: env.SESSION_COOKIE_NAME,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.SESSION_COOKIE_SECURE,
      sameSite: env.SESSION_COOKIE_SAMESITE,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.get('/api/docs.json', (_req, res) => {
  res.json(openApiSpec);
});

app.use('/api/health', healthRouter);
app.use('/api/docs', docsRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/schools', schoolsRouter);
app.use('/api/temporary-access', temporaryAccessRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/students', studentsRouter);
app.use('/api/schooling', schoolingRouter);
app.use('/api/dashboard', dashboardRouter);
// Évaluations, notes et calculs : monté sur /api pour rester fidèle au §16 du cahier des charges.
app.use('/api', gradesRouter);
// Bulletins, comparaison des semestres et bilans annuels : même convention de chemin.
app.use('/api', reportCardsRouter);
app.use('/api/school-life', schoolLifeRouter);

app.use(errorHandler);

export default app;
