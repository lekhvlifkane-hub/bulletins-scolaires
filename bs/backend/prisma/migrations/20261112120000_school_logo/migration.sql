-- Logo de l'établissement, stocké comme data URL (PNG/JPEG) pour rester
-- disponible après redéploiement, sans dépendre d'un volume persistant.
-- La migration est idempotente pour les bases déjà mises à jour hors historique.
ALTER TABLE "School"
    ADD COLUMN IF NOT EXISTS "logoDataUrl" TEXT;
