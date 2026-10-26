import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/** Une variable déclarée mais laissée vide dans `.env` vaut « non configurée ». */
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://bulletins:bulletins@localhost:5432/bulletins'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:1420,http://tauri.localhost,tauri://localhost'),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default('dev-session-secret-change-me-1234567890'),
  SESSION_COOKIE_NAME: z.string().min(1).default('bs.sid'),
  SESSION_COOKIE_SECURE: booleanString.default(false),
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  /** Adresse publique de l'interface, utilisée dans les liens envoyés par e-mail. */
  APP_BASE_URL: z.string().url().default('http://localhost:1420'),
  SMTP_HOST: optionalString.optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: optionalString.optional(),
  SMTP_PASS: optionalString.optional(),
  /** Expéditeur des e-mails, au format `Nom <adresse@domaine>`. */
  SMTP_FROM: optionalString.optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return;

  if (value.SESSION_SECRET === 'dev-session-secret-change-me-1234567890' || /change[-_ ]?me|example|default/i.test(value.SESSION_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SESSION_SECRET'],
      message: 'Un SESSION_SECRET aléatoire et propre à la production est obligatoire.',
    });
  }
  if (!value.SESSION_COOKIE_SECURE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SESSION_COOKIE_SECURE'],
      message: 'SESSION_COOKIE_SECURE=true est obligatoire en production HTTPS.',
    });
  }
  if (!value.SMTP_HOST) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SMTP_HOST'],
      message:
        "Un fournisseur d'e-mail (SMTP_HOST) est obligatoire en production : sans lui, aucun mot de passe ne peut être réinitialisé ni aucun compte ouvert à distance.",
    });
  }
  if (!value.SMTP_FROM) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SMTP_FROM'],
      message: "L'expéditeur des e-mails (SMTP_FROM) est obligatoire en production.",
    });
  }
  if (/(^|\W)localhost(\W|$)|127\.0\.0\.1/.test(value.APP_BASE_URL)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_BASE_URL'],
      message:
        "APP_BASE_URL doit être l'adresse publique de l'interface : les liens des e-mails doivent être joignables par les établissements.",
    });
  }
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
