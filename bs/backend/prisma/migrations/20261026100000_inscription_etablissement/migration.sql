-- Statut d'inscription d'un établissement : une demande créée depuis la page
-- publique d'inscription reste PENDING jusqu'à la décision de l'administrateur
-- de la plateforme (ACTIVE ou REJECTED).
-- La migration est volontairement idempotente : sur une base où la colonne a
-- déjà été ajoutée hors historique (prisma db push), elle ne doit rien casser.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SchoolStatus') THEN
        CREATE TYPE "SchoolStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');
    END IF;
END $$;

ALTER TABLE "School"
    ADD COLUMN IF NOT EXISTS "status" "SchoolStatus" NOT NULL DEFAULT 'ACTIVE';
