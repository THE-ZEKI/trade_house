-- ============================================================================
-- trade_house - install.sql
-- INSTALLE L'ENSEMBLE DU SCHEMA DANS LA BASE COURANTE.
--
--     psql -U postgres -d trade_house -f db/install.sql
-- (db/setup.ps1 fait le travail complet : creation de la base + install)
--
--   *** FICHIER GENERE PAR db/tools/generate-install-sql.ps1 ***
--   Ne pas le modifier a la main : ajouter une migration ne l installerait pas.
--   Relancez l outil apres tout ajout dans db/migrations/.
-- ============================================================================
\set ON_ERROR_STOP on
\timing on

\echo
\echo === trade_house - installation des migrations ===
\i migrations/001_core.sql
\i migrations/002_identity.sql
\i migrations/003_meetings.sql
\i migrations/004_reports.sql
\i migrations/005_notifications.sql
\i migrations/006_functions.sql
\i migrations/007_views.sql
\i migrations/008_rls.sql
\i migrations/009_seed.sql
\i migrations/010_auth.sql
\i migrations/011_mfa.sql
\i migrations/012_security.sql
\i migrations/013_reminders.sql
\i migrations/014_recurrence.sql
\i migrations/015_bootstrap.sql
\i migrations/016_users_guards.sql
\i migrations/017_video.sql
\i migrations/018_user_admin.sql
\i migrations/019_settings.sql
\i migrations/020_annotations.sql
\i migrations/021_training.sql
\i migrations/022_training_extras.sql
\i migrations/023_training_submission_conflict.sql
\i migrations/024_training_files_write.sql
\i migrations/025_cascade_transition.sql
\i migrations/026_course_files.sql
\i migrations/027_manager_invites_trader.sql
\i migrations/028_assign_trader_manager.sql
\i migrations/029_meeting_creator_visible.sql
\i migrations/030_notifications_formation.sql
\i migrations/031_notifications_email.sql
\i migrations/032_notifications_accounts.sql
\i migrations/033_messaging.sql
\i migrations/034_notifications_messagerie.sql

\echo === Installation terminee ===
\echo Verification :
\echo   \d public.reports
\echo   select * from app.settings();
\echo   select version from app.schema_migrations order by version;
