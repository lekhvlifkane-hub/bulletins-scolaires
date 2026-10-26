-- File d'attente durable des e-mails (invitations, réinitialisations).
CREATE TYPE "EmailStatus" AS ENUM ('EN_ATTENTE', 'ENVOYE', 'ECHEC');

CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_schoolId_createdAt_idx" ON "EmailOutbox"("schoolId", "createdAt");

ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
