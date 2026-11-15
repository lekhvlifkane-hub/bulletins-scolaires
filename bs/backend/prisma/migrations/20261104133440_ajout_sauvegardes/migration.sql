-- Table singleton de configuration des sauvegardes.
-- Migration reconstituée pour aligner l'historique local (table déjà présente et vide).
CREATE TABLE "BackupSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "actif" BOOLEAN NOT NULL DEFAULT false,
    "heure" INTEGER NOT NULL DEFAULT 2,
    "retentionJours" INTEGER NOT NULL DEFAULT 30,
    "derniereTentativeAt" TIMESTAMP(3),
    "derniereReussiteAt" TIMESTAMP(3),
    "dernierStatut" TEXT,
    "dernierMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSetting_pkey" PRIMARY KEY ("id")
);
