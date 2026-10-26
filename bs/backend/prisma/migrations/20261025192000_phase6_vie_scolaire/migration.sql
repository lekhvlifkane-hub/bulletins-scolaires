CREATE TYPE "AttendanceKind" AS ENUM ('ABSENCE', 'RETARD');
CREATE TYPE "CouncilDecisionStatus" AS ENUM ('BROUILLON', 'VALIDEE');

CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "kind" "AttendanceKind" NOT NULL,
    "date" DATE NOT NULL,
    "justified" BOOLEAN NOT NULL DEFAULT false,
    "durationMinutes" INTEGER,
    "reason" TEXT,
    "recordedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Appreciation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Appreciation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouncilDecision" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CouncilDecisionStatus" NOT NULL DEFAULT 'BROUILLON',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT NOT NULL,
    "previousDecisionId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CouncilDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Appreciation_enrollmentId_semesterId_subjectId_key"
ON "Appreciation"("enrollmentId", "semesterId", "subjectId");
CREATE INDEX "AttendanceRecord_schoolId_enrollmentId_semesterId_deletedAt_idx"
ON "AttendanceRecord"("schoolId", "enrollmentId", "semesterId", "deletedAt");
CREATE INDEX "AttendanceRecord_schoolId_semesterId_date_idx"
ON "AttendanceRecord"("schoolId", "semesterId", "date");
CREATE INDEX "Appreciation_schoolId_enrollmentId_semesterId_deletedAt_idx"
ON "Appreciation"("schoolId", "enrollmentId", "semesterId", "deletedAt");
CREATE UNIQUE INDEX "CouncilDecision_enrollmentId_academicYearId_version_key"
ON "CouncilDecision"("enrollmentId", "academicYearId", "version");
CREATE INDEX "CouncilDecision_schoolId_academicYearId_status_isCurrent_idx"
ON "CouncilDecision"("schoolId", "academicYearId", "status", "isCurrent");

ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_enrollmentId_fkey"
FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_semesterId_fkey"
FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_recordedById_fkey"
FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appreciation" ADD CONSTRAINT "Appreciation_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appreciation" ADD CONSTRAINT "Appreciation_enrollmentId_fkey"
FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appreciation" ADD CONSTRAINT "Appreciation_semesterId_fkey"
FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appreciation" ADD CONSTRAINT "Appreciation_subjectId_fkey"
FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appreciation" ADD CONSTRAINT "Appreciation_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Appreciation" ADD CONSTRAINT "Appreciation_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_enrollmentId_fkey"
FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_academicYearId_fkey"
FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_previousDecisionId_fkey"
FOREIGN KEY ("previousDecisionId") REFERENCES "CouncilDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CouncilDecision" ADD CONSTRAINT "CouncilDecision_validatedById_fkey"
FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
