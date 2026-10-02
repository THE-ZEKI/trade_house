// Mesure du temps passe en base, pour distinguer "la base est lente" de
// "l'application fait beaucoup d'allers-retours".
//
// Chronometre trois choses separement :
//   1. l'ouverture d'une connexion (le pool est-il chaud ?) ;
//   2. un aller-retour simple ;
//   3. le patron asUser(), c'est-a-dire ce que fait chaque route : poser le
//      contexte RLS puis executer la requete.

import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
url.username = process.env.PGUSER || 'postgres';
url.password = process.env.PGPASSWORD || '';

const chrono = (label, ms) => console.log(`  ${label.padEnd(38)} ${ms.toFixed(1)} ms`);

const c = new pg.Client({ connectionString: url.toString() });

let t = performance.now();
await c.connect();
chrono('ouverture de connexion', performance.now() - t);

t = performance.now();
for (let i = 0; i < 20; i++) await c.query('select 1');
chrono('select 1 (moyenne sur 20)', (performance.now() - t) / 20);

t = performance.now();
const [admin] = (
  await c.query(`select id from public.users where role = 'admin' and is_active limit 1`)
).rows;
chrono('recherche admin (1 aller-retour)', performance.now() - t);

await c.query('begin');
t = performance.now();
await c.query(`select set_config('app.current_user_id', $1, false)`, [admin.id]);
await c.query(`select app.set_user($1::uuid)`, [admin.id]);
await c.query(`select count(*)::int n from public.reports`);
chrono('asUser() complet (3 requetes)', performance.now() - t);
await c.query('commit');

// Le cout du hachage explique a lui seul une bonne part du temps de connexion.
t = performance.now();
await c.query(`select crypt('Zeki82203@', gen_salt('bf', 12)) = crypt('Zeki82203@', password_hash) ok
                 from public.users where email = 'ezechieltrade@gmail.com'`);
chrono('verification bcrypt (cost 12)', performance.now() - t);

await c.end();
