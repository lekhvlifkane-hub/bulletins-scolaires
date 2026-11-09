-- Suppression du sous-système e-mail.
-- L'application n'envoie plus de messages : invitations et notifications
-- d'inscription sont transmises dans l'interface, la récupération de mot de
-- passe passe par l'administrateur. La file d'attente et les jetons de
-- réinitialisation disparaissent, ainsi que leur type d'énumération.

DROP TABLE IF EXISTS "EmailOutbox";
DROP TABLE IF EXISTS "PasswordResetToken";
DROP TYPE IF EXISTS "EmailStatus";
