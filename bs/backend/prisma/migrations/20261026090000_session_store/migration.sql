-- Table de sessions gérée par connect-pg-simple.
-- Elle était jusqu'ici créée à l'exécution par le magasin de sessions
-- (`createTableIfMissing`), ce qui faisait apparaître un écart (drift) entre la
-- base et l'historique Prisma. On la versionne ici pour que l'historique reste
-- la seule source de vérité.
-- La migration est volontairement idempotente : sur une base où la table a déjà
-- été créée à l'exécution, elle ne doit rien casser.
CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
    ) THEN
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
