-- Migration non destructive : ajouts de colonnes et d'une table seulement.
-- La table "session" est gérée hors Prisma : ne jamais la supprimer ici.

-- AlterTable
ALTER TABLE "ClassroomSubject" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "couleurAccent" TEXT NOT NULL DEFAULT '#E5B544',
ADD COLUMN     "couleurPrimaire" TEXT NOT NULL DEFAULT '#0B2D4F',
ADD COLUMN     "couleurSecondaire" TEXT NOT NULL DEFAULT '#0B9B67',
ADD COLUMN     "drapeauDataUrl" TEXT,
ADD COLUMN     "logoMinistereDataUrl" TEXT,
ADD COLUMN     "modeleBulletin" TEXT NOT NULL DEFAULT 'OFFICIEL',
ADD COLUMN     "seuilPassage" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "ien" TEXT;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "coefficient" DECIMAL(6,2) NOT NULL DEFAULT 1,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isChoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "levelId" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StudentSubjectChoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSubjectChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentSubjectChoice_schoolId_subjectId_idx" ON "StudentSubjectChoice"("schoolId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSubjectChoice_enrollmentId_key" ON "StudentSubjectChoice"("enrollmentId");

-- CreateIndex
CREATE INDEX "Subject_schoolId_levelId_sortOrder_idx" ON "Subject"("schoolId", "levelId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubjectChoice" ADD CONSTRAINT "StudentSubjectChoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubjectChoice" ADD CONSTRAINT "StudentSubjectChoice_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubjectChoice" ADD CONSTRAINT "StudentSubjectChoice_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "AppreciationRule" SET "label" = 'Très médiocre'
WHERE "code" IN ('MATIERE_0_5', 'MENTION_0_5', 'GENERALE_0_5') AND "label" = 'Très faible';
UPDATE "AppreciationRule" SET "content" = 'Très médiocre'
WHERE "code" IN ('MATIERE_0_5', 'MENTION_0_5') AND "content" = 'Très faible';
UPDATE "AppreciationRule" SET "isActive" = false, "deletedAt" = COALESCE("deletedAt", NOW())
WHERE "code" IN ('MATIERE_5_8', 'MENTION_5_8', 'GENERALE_5_8') AND "label" = 'Faible';

INSERT INTO "AppreciationRule" ("id", "schoolId", "scope", "code", "label", "minScore", "maxScore", "content", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT md5(e."schoolId" || ':MATIERE_5_6_5'), e."schoolId", 'MATIERE'::"AppreciationRuleScope", 'MATIERE_5_6_5', 'Médiocre', 5, 6.5, 'Médiocre', 2, true, NOW(), NOW()
FROM (SELECT DISTINCT "schoolId" FROM "AppreciationRule") e
ON CONFLICT ("schoolId", "scope", "code") DO NOTHING;

INSERT INTO "AppreciationRule" ("id", "schoolId", "scope", "code", "label", "minScore", "maxScore", "content", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT md5(e."schoolId" || ':MATIERE_6_5_8'), e."schoolId", 'MATIERE'::"AppreciationRuleScope", 'MATIERE_6_5_8', 'Très insuffisant', 6.5, 8, 'Très insuffisant', 3, true, NOW(), NOW()
FROM (SELECT DISTINCT "schoolId" FROM "AppreciationRule") e
ON CONFLICT ("schoolId", "scope", "code") DO NOTHING;

INSERT INTO "AppreciationRule" ("id", "schoolId", "scope", "code", "label", "minScore", "maxScore", "content", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT md5(e."schoolId" || ':MENTION_5_6_5'), e."schoolId", 'MENTION'::"AppreciationRuleScope", 'MENTION_5_6_5', 'Médiocre', 5, 6.5, 'Médiocre', 2, true, NOW(), NOW()
FROM (SELECT DISTINCT "schoolId" FROM "AppreciationRule") e
ON CONFLICT ("schoolId", "scope", "code") DO NOTHING;

INSERT INTO "AppreciationRule" ("id", "schoolId", "scope", "code", "label", "minScore", "maxScore", "content", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT md5(e."schoolId" || ':MENTION_6_5_8'), e."schoolId", 'MENTION'::"AppreciationRuleScope", 'MENTION_6_5_8', 'Très insuffisant', 6.5, 8, 'Très insuffisant', 3, true, NOW(), NOW()
FROM (SELECT DISTINCT "schoolId" FROM "AppreciationRule") e
ON CONFLICT ("schoolId", "scope", "code") DO NOTHING;

INSERT INTO "AppreciationRule" ("id", "schoolId", "scope", "code", "label", "minScore", "maxScore", "content", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT md5(e."schoolId" || ':GENERALE_5_6_5'), e."schoolId", 'GENERALE'::"AppreciationRuleScope", 'GENERALE_5_6_5', 'Médiocre', 5, 6.5, 'Les résultats de {prenom} sont médiocres (moyenne {moyenne}/20).', 2, true, NOW(), NOW()
FROM (SELECT DISTINCT "schoolId" FROM "AppreciationRule") e
ON CONFLICT ("schoolId", "scope", "code") DO NOTHING;

INSERT INTO "AppreciationRule" ("id", "schoolId", "scope", "code", "label", "minScore", "maxScore", "content", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT md5(e."schoolId" || ':GENERALE_6_5_8'), e."schoolId", 'GENERALE'::"AppreciationRuleScope", 'GENERALE_6_5_8', 'Très insuffisant', 6.5, 8, 'Les résultats de {prenom} sont très insuffisants (moyenne {moyenne}/20).', 3, true, NOW(), NOW()
FROM (SELECT DISTINCT "schoolId" FROM "AppreciationRule") e
ON CONFLICT ("schoolId", "scope", "code") DO NOTHING;
