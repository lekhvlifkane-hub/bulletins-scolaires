-- CreateEnum
CREATE TYPE "AccountMode" AS ENUM ('SOLO', 'EQUIPE');

-- AlterTable
ALTER TABLE "Classroom" ADD COLUMN     "mainTeacherName" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "accountMode" "AccountMode" NOT NULL DEFAULT 'EQUIPE',
ADD COLUMN     "headmasterName" TEXT;

-- La table "session" est gérée hors Prisma par connect-pg-simple
-- (voir migrations/20261026090000_session_store) : ne jamais la supprimer ici.
