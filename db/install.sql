-- ============================================================================
-- trade_house - install.sql
-- Installe l'ensemble du schema dans la base courante.
--   psql -U postgres -d trade_house -f db/install.sql
-- (db/setup.ps1 fait le travail complet : creation de la base + install)
-- ============================================================================
\set ON_ERROR_STOP on
\timing on

\echo ''
\echo '=== trade_house - installation des migrations ==='

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

\echo ''
\echo '=== Installation terminee ==='
\echo ''
\echo 'Verification :'
\echo '  \d public.reports'
\echo '  select * from app.settings();'
\echo '  select email, role, is_active from public.users order by role;'
\echo ''
\echo 'Premier test (le role courant est admin, aucun set_user n''est requis) :'
\echo '  select app.create_user(''test@trade-house.local'', ''Test Trader'', ''trader'');'
