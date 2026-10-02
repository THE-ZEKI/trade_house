// Etat reel des comptes : permet de repondre « quels comptes ont un mot de
// passe » sans le deviner. `app.create_user` ne definit PAS de mot de passe
// (le compte est cree, invitation envoyee) : les comptes crees par les scripts
// de verification existent donc en base mais ne sont PAS connectables.
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Chaque interrogation est isolee : le role applicatif n'a pas le droit de
// lire app.schema_migrations (c'est normal, seul le proprietaire migre), et
// une requete refusee ne doit pas empeicher l'affichage des autres.
const show = async (label, text) => {
  try {
    const r = await c.query(text);
    console.log(`\n${label}`);
    console.table(r.rows);
  } catch (err) {
    console.log(`\n${label}\n  (lecture refusee : ${err.message})`);
  }
};

// pg_catalog n'est pas soumis au RLS : c'est le seul endroit ou l'on peut
// lire qui possede quoi sans etre connecte en tant que cet utilisateur.
await show(
  'Proprietaires',
  `select c.relname as objet,
          pg_get_userbyid(c.relowner) as proprietaire
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('users','reports','report_files','file_annotations',
                        'report_corrections','user_sessions')
    order by c.relname`,
);

await show(
  'Schema app',
  `select nspname, pg_get_userbyid(nspowner) as proprietaire
     from pg_namespace
    where nspname in ('app','public')`,
);

await show(
  'Roles PostgreSQL',
  `select rolname,
          rolsuper as superutilisateur,
          rolcanlogin as connexion
     from pg_roles
    order by rolsuper desc, rolname`,
);

await show(
  'Migration 020 deja appliquee ?',
  `select version, applied_at
     from app.schema_migrations
    where version like '020%' or version like '%annotations%'`,
);

await show(
  'Dernieres migrations appliquees',
  `select * from app.schema_migrations order by 1 desc limit 6`,
);

// L'etat REEL des politiques est plus fiable que le journal : il dit ce que
// la base applique aujourd'hui, pas ce qu elle croit avoir applique.
await show(
  'Politiques actuelles sur file_annotations',
  `select policyname, cmd, qual, with_check
     from pg_policies
    where tablename = 'file_annotations'
    order by policyname`,
);

await c.end();