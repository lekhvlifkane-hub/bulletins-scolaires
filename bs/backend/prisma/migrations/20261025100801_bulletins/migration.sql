-- CreateEnum
CREATE TYPE "ReportCardStatus" AS ENUM ('BOUILLON', 'PRET', 'PUBLIE', 'ANNULE');

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "statut" "ReportCardStatus" NOT NULL DEFAULT 'BOUILLON',
    "estCourant" BOOLEAN NOT NULL DEFAULT true,
    "remplaceReportCardId" TEXT,
    "motifCorrection" TEXT,
    "snapshot" JSONB NOT NULL,
    "moyenneGenerale" DECIMAL(6,4),
    "moyenneGeneraleExacte" TEXT,
    "moyenneClasse" DECIMAL(6,4),
    "effectif" INTEGER,
    "rang" INTEGER,
    "motifNonClasse" TEXT,
    "totalPoints" DECIMAL(10,4),
    "totalCoeficients" DECIMAL(10,2),
    "incomplet" BOOLEAN NOT NULL DEFAULT false,
    "motifs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mention" TEXT,
    "decisionConseil" TEXT,
    "appreciation" TEXT,
    "genereLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valideLe" TIMESTAMP(3),
    "publieLe" TIMESTAMP(3),
    "genereParId" TEXT,
    "publieParId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualSummary" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "statut" "ReportCardStatus" NOT NULL DEFAULT 'BOUILLON',
    "estCourant" BOOLEAN NOT NULL DEFAULT true,
    "snapshot" JSONB NOT NULL,
    "s1ReportCardId" TEXT,
    "s2ReportCardId" TEXT,
    "moyenneS1" DECIMAL(6,4),
    "moyenneS2" DECIMAL(6,4),
    "moyenneAnnuelle" DECIMAL(6,4),
    "moyenneAnnuelleExacte" TEXT,
    "calculable" BOOLEAN NOT NULL DEFAULT false,
    "partiel" BOOLEAN NOT NULL DEFAULT false,
    "rangAnnuel" INTEGER,
    "effectif" INTEGER,
    "motifs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mention" TEXT,
    "decisionConseil" TEXT,
    "appreciation" TEXT,
    "genereLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publieLe" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportCard_schoolId_semesterId_statut_idx" ON "ReportCard"("schoolId", "semesterId", "statut");

-- CreateIndex
CREATE INDEX "ReportCard_schoolId_enrollmentId_idx" ON "ReportCard"("schoolId", "enrollmentId");

-- CreateIndex
CREATE INDEX "ReportCard_schoolId_academicYearId_idx" ON "ReportCard"("schoolId", "academicYearId");

-- CreateIndex
CREATE INDEX "ReportCard_remplaceReportCardId_idx" ON "ReportCard"("remplaceReportCardId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_enrollmentId_semesterId_version_key" ON "ReportCard"("enrollmentId", "semesterId", "version");

-- CreateIndex
CREATE INDEX "AnnualSummary_schoolId_academicYearId_statut_idx" ON "AnnualSummary"("schoolId", "academicYearId", "statut");

-- CreateIndex
CREATE INDEX "AnnualSummary_schoolId_enrollmentId_idx" ON "AnnualSummary"("schoolId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualSummary_enrollmentId_academicYearId_version_key" ON "AnnualSummary"("enrollmentId", "academicYearId", "version");

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_remplaceReportCardId_fkey" FOREIGN KEY ("remplaceReportCardId") REFERENCES "ReportCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_genereParId_fkey" FOREIGN KEY ("genereParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_publieParId_fkey" FOREIGN KEY ("publieParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualSummary" ADD CONSTRAINT "AnnualSummary_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualSummary" ADD CONSTRAINT "AnnualSummary_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
