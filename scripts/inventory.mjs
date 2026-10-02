// Inventaire avant nettoyage : ce qui a ete produit par les scripts de test.
//
// Aucune ecriture. Le but est de savoir ce qui va disparaitre et de verifier
// que l'on ne touche pas aux tables de structure.

import pg from 'pg';

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

  for (const t of tables) {
    const { rows } = await c.query(`select count(*)::int n from public."${t}"`);
    if (rows[0].n > 0) console.log(`  ${String(rows[0].n).padStart(6)}  ${t}`);
  }

  console.log('\n  --- comptes ---');
  const u = (
    await c.query(
      `select role, is_active, anonymized_at is not null as anon, count(*)::int n
         from public.users group by 1,2,3 order by 1`,
    )
  ).rows;
  for (const x of u) {
    console.log(`  ${String(x.n).padStart(6)}  role=${x.role} actif=${x.is_active} anonymise=${x.anon}`);
  }
} finally {
  await c.end().catch(() => {});
}