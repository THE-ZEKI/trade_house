import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Verifie que l'application est correctement branchée sur la base — et surtout
 * que la PRÉMISSE DU RLS est vraie : on ne doit pas être connecté avec un rôle
 * propriétaire ou bypassrls, sinon toute la séparation des rôles (RG-04, RG-06)
 * serait silencieusement désactivée.
 */
export async function GET() {
  const started = Date.now();

  try {
    const info = await queryOne<{
      db: string;
      version: string;
      current_user: string;
      bypass_rls: boolean;
      is_owner: boolean;
    }>(`
      select current_database()                       as db,
             current_setting('server_version')         as version,
             current_user                              as current_user,
             coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass_rls,
             (select pg_has_role(current_user, t.tableowner, 'member')
                from pg_tables t
               where t.schemaname = 'public' and t.tablename = 'reports'
               limit 1)                               as is_owner
    `);

    const counts = await queryOne<{ tables: number; views: number; app_functions: number }>(`
      select
        (select count(*)::int from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE') as tables,
        (select count(*)::int from information_schema.views
          where table_schema = 'public')                              as views,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app')                                     as app_functions
    `);

    // si ces deux drapeaux sont vrais, le RLS est inopérant : on le signale
    const rlsEffective = !info?.bypass_rls && !info?.is_owner;

    return NextResponse.json({
      status: rlsEffective ? 'ok' : 'degraded',
      database: info?.db,
      version: info?.version,
      role: info?.current_user,
      rls: {
        effective: rlsEffective,
        bypass_rls: info?.bypass_rls,
        is_owner: info?.is_owner,
      },
      schema: counts,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Connexion impossible',
        hint: 'Verifier DATABASE_URL dans .env.local et que le role trade_house_app existe.',
        latencyMs: Date.now() - started,
      },
      { status: 503 },
    );
  }
}
