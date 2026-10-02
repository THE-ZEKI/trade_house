// Depose des comptes que l'interface ne permet plus d'atteindre.
//
// L'API /api/users filtre sur is_active : un compte desactive puis laisse en
// place n'apparait ni dans la liste ni dans la recherche par nom. Il n'existe
// donc aucun chemin depuis l'interface pour l'anonymiser, alors que c'est
// justement le moment ou il faut le faire. Ce script rattrape ces comptes.
//
// L anonymisation elle-meme n'est pas reimplementee ici : on appelle
// app.anonymize_user, qui porte les regles (administrateur requis, interdiction
// de s auto-anonymiser, revocation des sessions). Seule la recherche du compte
// est faite en SQL.
//
// Mot de passe via PGPASSWORD dans l'environnement, jamais dans le fichier.

import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
url.username = process.env.PGUSER || 'postgres';
url.password = process.env.PGPASSWORD || '';

const c = new pg.Client({ connectionString: url.toString() });
await c.connect();

try {
  await c.query('begin');

  const [admin] = (await c.query(
    `select id from public.users where role = 'admin' and is_active and anonymized_at is null limit 1`,
  )).rows;
  if (!admin) {
    console.log('  (aucun administrateur actif)');
    process.exit(0);
  }
  await c.query(`select set_config('app.current_user_id', $1, false)`, [admin.id]);
  await c.query(`select app.set_user($1::uuid)`, [admin.id]);

  const cibles = (
    await c.query(
      `select id, email, role, is_active from public.users
        where anonymized_at is null and email <> 'admin@trade-house.local'
        order by email`,
    )
  ).rows;

  if (!cibles.length) {
    console.log('  aucun compte a deposer.');
    await c.query('rollback');
    process.exit(0);
  }

  for (const u of cibles) {
    try {
      await c.query(`select app.anonymize_user($1::uuid)`, [u.id]);
      console.log(`  depose  ${u.email} [${u.role}] actif=${u.is_active}`);
    } catch (e) {
      console.log(`  ECHEC   ${u.email} : ${e.message}`);
    }
  }

  await c.query('commit');
} finally {
  await c.end().catch(() => {});
}