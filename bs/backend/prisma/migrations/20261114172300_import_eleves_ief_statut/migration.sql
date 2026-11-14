CREATE TYPE "EnrollmentEntryType" AS ENUM ('NEW', 'TRANSFERRED');

ALTER TABLE "School"
ADD COLUMN "iefName" TEXT NOT NULL DEFAULT 'IEF Thiès';

ALTER TABLE "Enrollment"
ADD COLUMN "entryType" "EnrollmentEntryType";
