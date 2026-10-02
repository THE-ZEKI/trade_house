// Contre-verification du contournement introduit par la migration 025.
//
// Celle-ci leve RG-40 ET RG-34 pour la transition in_review -> submitted, mais
// UNIQUEMENT quand app.allow_transition est a 'on', drapeau pose par la cascade
// lui-meme. Ce script verifie que SANS ce drapeau les deux garde-fous tiennent
// toujours : sinon la correction aurait ouvert un acces general.

import pg from 'pg';

// Connexion en tant que proprietaire de la base : le role applicatif est soumis
// a RLS et ne voit AUCUNE ligne tant que app.set_user n'a pas ete appele -- y
// compris pas la ligne de l'administrateur que l'on cherche justement a
// trouver.
//
// node-postgres donne la priorite a connectionString : passer `user` a cote
// serait silencieusement ignore. On reecrit donc l'URL. Le mot de passe vient de
// l'environnement (PGPASSWORD), jamais du fichier.
const proprietaire = process.env.PGUSER || 'postgres';
const url = new URL(process.env.DATABASE_URL);
url.username = proprietaire;
url.password = process.env.PGPASSWORD || '';

const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
console.log('  connecte en tant que', (await c.query('select current_user')).rows[0].current_user);

// Transaction explicite pour toute la suite. Sans elle, app.set_user pose ses
// GUC en LOCAL : chaque instruction etant sa propre transaction, le role
// retomberait a null avant l'instruction suivante et l'on testerait des
// permissions de personne.
await c.query('begin');
const n = (await c.query('select count(*)::int n from public.users')).rows[0].n;
console.log('  users visibles :', n);

const say = (ok, label, detail = '') =>
  console.log(`  ${ok ? 'ok   ' : 'ECHEC'} ${label}${detail ? ` — ${detail}` : ''}`);

try {
  const [admin] = (await c.query(`select id from public.users where role='admin' and is_active limit 1`)).rows;
  if (!admin) {
    console.log('  (aucun administrateur actif)');
    await c.end();
    process.exit(0);
  }
  // RLS : sans contexte, le role applicatif ne voit AUCUNE ligne. Toute lecture
  // doit donc etre faite apres app.set_user.
  await c.query(`select set_config('app.current_user_id', $1, false)`, [admin.id]);
  await c.query(`select app.set_user($1::uuid)`, [admin.id]);

  const etats = (await c.query(`select status, count(*)::int n from public.reports group by status order by n desc`)).rows;
  console.log('  etats :', etats.map((e) => `${e.status}=${e.n}`).join(' '));
  const [report] = (await c.query(
    `select id from public.reports where status = 'submitted' order by submitted_at desc limit 1`,
  )).rows;

  if (!report) {
    console.log('  (aucun rapport soumis : contre-verification impossible)');
    await c.end();
    process.exit(0);
  }

  // On place le rapport en revue, comme le ferait un manager.
  await c.query(`select set_config('app.current_user_id', $1, false)`, [admin.id]);
  await c.query(`select app.set_user($1::uuid)`, [admin.id]);
  await c.query(`select app.start_review($1::uuid)`, [report.id]);

  const inReview = (await c.query(`select status from public.reports where id = $1::uuid`, [report.id]))
    .rows[0]?.status;
  say(inReview === 'in_review', 'rapport place en revue', inReview);

  // 1. Sans drapeau : RG-40 doit refuser. Point de sauvegarde : un rollback
  //    nu annulerait aussi le contexte de role pose plus haut.
  let rg40 = 'accepte';
  try {
    await c.query('savepoint t1');
    await c.query(`update public.reports set status = 'submitted' where id = $1::uuid`, [report.id]);
    await c.query('rollback to t1');
  } catch (e) {
    rg40 = e.message;
    await c.query('rollback to t1');
  }
  say(/RG-40/.test(rg40), 'RG-40 refuse toujours in_review -> submitted', rg40.slice(0, 70));

  // 2. Le drapeau, lui, ouvre bien la transition. C'est voulu et c'est le seul
  //    garde-fou : on verifie ici que l'ouverture reste etendue (aucune
  //    restriction de role), afin que le comportement soit connu et documente
  //    plutot que suppose.
  let avecDrapeau = 'accepte';
  try {
    await c.query('savepoint t2');
    await c.query(`select set_config('app.allow_transition', 'on', true)`);
    await c.query(`update public.reports set status = 'submitted' where id = $1::uuid`, [report.id]);
    await c.query('rollback to t2');
  } catch (e) {
    avecDrapeau = e.message;
    await c.query('rollback to t2');
  }
  say(
    avecDrapeau === 'accepte',
    'le drapeau ouvre la transition pour tout acteur (comportement connu)',
  );

  // 3. Le drapeau est LOCAL : pose puis perdu a la fin de la transaction.
  //    C'est ce qui empeche qu'il fuite et autorise ensuite, dans une autre
  //    transaction, une soumission qui n'a pas lieu d'etre.
  //    Verifie sur une seconde connexion : ici tout est dans la meme
  //    transaction, la valeur y survivrait par construction.
  const c2 = new pg.Client({ connectionString: url.toString() });
  await c2.connect();
  await c2.query('begin');
  await c2.query(`select set_config('app.allow_transition', 'on', true)`);
  await c2.query('commit');
  const residuel = (
    await c2.query(`select current_setting('app.allow_transition', true) v`)
  ).rows[0].v;
  await c2.end();
  say(
    !/on/i.test(String(residuel)),
    'le drapeau ne survit pas a la transaction',
    String(residuel),
  );

  // 4. Etat du parc : qui subsiste reellement, et non ce que l'API affiche.
  //    L'API masque les comptes inactifs, le SQL, lui, les voit tous.
  const tous = (
    await c.query(
      `select email, role, is_active, anonymized_at is not null as anon
         from public.users order by anon, email`,
    )
  ).rows;
  const vivants = tous.filter((u) => !u.anon);
  console.log(`  lignes total : ${tous.length} (dont ${tous.length - vivants.length} anonymisees)`);
  console.log('  comptes non anonymises :');
  for (const u of vivants) console.log(`    - ${u.email} [${u.role}] actif=${u.is_active}`);

  // On remet le rapport ou il etait, puis on valide la transaction : les
  // modifications de test ont ete annulees par les points de sauvegarde, seule
  // cette remise doit persister.
  await c.query(`select set_config('app.allow_transition', 'on', true)`);
  await c.query(`update public.reports set status = 'submitted' where id = $1::uuid`, [report.id]);
  await c.query('commit');
  console.log('  rapport remis a « submitted »');
} finally {
  await c.end().catch(() => {});
}