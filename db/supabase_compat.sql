-- ============================================================================
-- trade_house - supabase_compat.sql
-- A appliquer UNIQUEMENT sur un projet Supabase, apres avoir copie les
-- migrations dans supabase/migrations/. Remplace l'identification de
-- developpement (app.user_id) par l'identite Supabase (auth.uid()).
-- ============================================================================

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select auth.uid()
$$;

create or replace function app.set_user(p_uuid uuid) returns uuid
language plpgsql as $$
begin
  raise exception 'app.set_user est reserve au developpement PostgreSQL local';
end $$;

-- Supabase gere deja l'authentification, les mots de passe et le MFA TOTP :
--   1. public.users.id doit REFERENCES auth.users(id) ON DELETE CASCADE
--   2. public.user_sessions et public.mfa_factors deviennent inutiles
--      (tables auth.sessions et auth.mfa_factors)
--   3. Remplacer app.create_user / app.issue_invitation par
--      supabase.auth.admin.createUser() et generateLink()
create or replace function app.supabase_notes() returns text
language sql as $$ select 'cf. docs/DECISIONS.md - D3' $$;
