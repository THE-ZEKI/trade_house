// Remise a zero des donnees de demonstration.
//
// Supprime tout ce que les scripts de test ont produit : rapports, reunions,
// formations, annotations, sessions, traces d'audit, invitations. Ne touche ni
// a la structure, ni a app_settings.
//
// Les comptes anonymises sont supprimes (lignes et non seulement l'identite) :
// une fois les donnees de demonstration parties, ils ne referent plus rien. Les
// comptes reels sont conserves -- on ne supprime que ce qui porte
// anonymized_at, c'est-a-dire ce qui a etre declare definitivement perdu.
//
// Le dossier .storage/ est vide de la meme facon : des fichiers sans ligne
// rattachee sont invisibles pour l'API mais occupent de l'espace disque.
//
// Usage : node --env-file=.env.local scripts/reset-demo-data.mjs [--dry-run]

import pg from 'pg';
import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');

const CONSERVES = new Set(['users', 'app_settings']);

const url = new URL(process.env.DATABASE_URL);
url.username = process.env.PGUSER || 'postgres';
url.password = process.env.PGPASSWORD || '';

const c = new pg.Client({ connectionString: url.toString() });
await c.connect();

try {
  const tables = (
    await c.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    )
  ).rows.map((r) => r.table_name);

  const cibles = tables.filter((t) => !CONSERVES.has(t));
  console.log(`  tables purgees : ${cibles.length} / ${tables.length}`);

  if (!dryRun) {
    // CASCADE resout l'ordre a notre place : les enfants (versions,
    // correctifs, participants...) tombent avec leur parent.
    await c.query(`truncate ${cibles.map((t) => `public."${t}"`).join(', ')} cascade`);

    const { rows } = await c.query(
      `delete from public.users where anonymized_at is not null returning email`,
    );
    console.log(`  comptes anonymises supprimes : ${rows.length}`);
    for (const r of rows.slice(0, 3)) console.log(`    - ${r.email}`);
    if (rows.length > 3) console.log(`    ... et ${rows.length - 3} autres`);
  } else {
    console.log('  (simulation : aucune ecriture)');
  }

  // Fichiers sur disque.
  const racine = path.join(process.cwd(), '.storage');
  if (await readdir(racine).then(() => true).catch(() => false)) {
    if (!dryRun) await rm(racine, { recursive: true, force: true });
    console.log(`  dossier .storage/ ${dryRun ? 'aurait ete' : 'a ete'} vide`);
  }

  // Etat final.
  const restants = (
    await c.query(
      `select email, role, is_active from public.users
        order by email`,
    )
  ).rows;
  console.log(`\n  comptes restants : ${restants.length}`);
  for (const u of restants) console.log(`    - ${u.email} [${u.role}] actif=${u.is_active}`);
} finally {
  await c.end().catch(() => {});
}