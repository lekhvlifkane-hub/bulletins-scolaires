-- CreateEnum
CREATE TYPE "EvaluationCategory" AS ENUM ('DEVOIR', 'COMPOSITION', 'AUTRE');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('BOUILLON', 'SAISIE_EN_COURS', 'A_VERIFIER', 'VALIDEE', 'PUBLIEE');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('SAISIE', 'ABSENT', 'ANNULEE', 'NON_SAISIE');

-- DropForeignKey
ALTER TABLE "AcademicYear" DROP CONSTRAINT "AcademicYear_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Classroom" DROP CONSTRAINT "Classroom_academicYearId_fkey";

-- DropForeignKey
ALTER TABLE "Classroom" DROP CONSTRAINT "Classroom_levelId_fkey";

-- DropForeignKey
ALTER TABLE "Classroom" DROP CONSTRAINT "Classroom_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Classroom" DROP CONSTRAINT "Classroom_seriesId_fkey";

-- DropForeignKey
ALTER TABLE "ClassroomSubject" DROP CONSTRAINT "ClassroomSubject_classroomId_fkey";

-- DropForeignKey
ALTER TABLE "ClassroomSubject" DROP CONSTRAINT "ClassroomSubject_subjectId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_classroomId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Level" DROP CONSTRAINT "Level_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Semester" DROP CONSTRAINT "Semester_academicYearId_fkey";

-- DropForeignKey
ALTER TABLE "Series" DROP CONSTRAINT "Series_levelId_fkey";

-- DropForeignKey
ALTER TABLE "Series" DROP CONSTRAINT "Series_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Subject" DROP CONSTRAINT "Subject_schoolId_fkey";

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "absencesComptentZero" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "annuelSiSemestreManquant" TEXT NOT NULL DEFAULT 'NULL',
ADD COLUMN     "arrondiDecimales" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "arrondiMode" TEXT NOT NULL DEFAULT 'HALF_UP',
ADD COLUMN     "baremeParDefaut" DECIMAL(5,2) NOT NULL DEFAULT 20,
ADD COLUMN     "classerResultatsIncomplets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coefficientInvalide" TEXT NOT NULL DEFAULT 'EXCLURE',
ADD COLUMN     "groupeSansNote" TEXT NOT NULL DEFAULT 'EXCLURE',
ADD COLUMN     "poidsAutres" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "poidsCompositions" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "poidsDevoirs" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "poidsSemestre1" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "poidsSemestre2" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "rangMode" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "regleCalculMatiere" TEXT NOT NULL DEFAULT 'POIDS_GROUPES';

-- CreateTable
CREATE TABLE "AssessmentType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "EvaluationCategory" NOT NULL,
    "defaultOutOf" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomSubjectId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "outOf" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'BOUILLON',
    "date" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "score" DECIMAL(5,2),
    "status" "GradeStatus" NOT NULL DEFAULT 'NON_SAISIE',
    "observation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentType_schoolId_category_idx" ON "AssessmentType"("schoolId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentType_schoolId_code_key" ON "AssessmentType"("schoolId", "code");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_semesterId_idx" ON "Assessment"("schoolId", "semesterId");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_status_idx" ON "Assessment"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_schoolId_classroomSubjectId_semesterId_typeId_po_key" ON "Assessment"("schoolId", "classroomSubjectId", "semesterId", "typeId", "position");

-- CreateIndex
CREATE INDEX "Grade_schoolId_enrollmentId_idx" ON "Grade"("schoolId", "enrollmentId");

-- CreateIndex
CREATE INDEX "Grade_schoolId_assessmentId_idx" ON "Grade"("schoolId", "assessmentId");

-- CreateIndex
CREATE INDEX "Grade_schoolId_deletedAt_idx" ON "Grade"("schoolId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_assessmentId_enrollmentId_key" ON "Grade"("assessmentId", "enrollmentId");

-- CreateIndex
CREATE INDEX "AcademicYear_schoolId_status_idx" ON "AcademicYear"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Classroom_schoolId_academicYearId_idx" ON "Classroom"("schoolId", "academicYearId");

-- CreateIndex
CREATE INDEX "ClassroomSubject_schoolId_classroomId_idx" ON "ClassroomSubject"("schoolId", "classroomId");

-- CreateIndex
CREATE INDEX "ClassroomSubject_schoolId_subjectId_idx" ON "ClassroomSubject"("schoolId", "subjectId");

-- CreateIndex
CREATE INDEX "Enrollment_schoolId_studentId_idx" ON "Enrollment"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "Enrollment_schoolId_classroomId_status_idx" ON "Enrollment"("schoolId", "classroomId", "status");

-- CreateIndex
CREATE INDEX "Student_schoolId_lastName_firstNames_idx" ON "Student"("schoolId", "lastName", "firstNames");

-- AddForeignKey
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Semester" ADD CONSTRAINT "Semester_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Series" ADD CONSTRAINT "Series_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Series" ADD CONSTRAINT "Series_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomSubject" ADD CONSTRAINT "ClassroomSubject_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassroomSubject" ADD CONSTRAINT "ClassroomSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_classroomSubjectId_fkey" FOREIGN KEY ("classroomSubjectId") REFERENCES "ClassroomSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AssessmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
