import { Pool } from 'pg';
import { env } from '../config/env';

// connectionTimeoutMillis = 10 s : sans lui, une base injoignable fait « pendre »
// chaque requête portant un cookie de session jusqu'au timeout TCP du noyau
// (constaté en production sur Railway : ~2 min de ETIMEDOUT répétés).
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
});
