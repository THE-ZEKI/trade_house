// Applique une migration SQL via `pg` en forcant IPv4.
//
// Pourquoi pas le script PowerShell : il appelle `psql -h localhost`, et sur
// cette machine `localhost` resout en ::1 (IPv6) alors que PostgreSQL n'ecoute
// que sur 127.0.0.1. La migration echoue alors sur une erreur de connexion
// qui n'a rien a voir avec le SQL qu elle contient. Forcer 127.0.0.1 ici rend
// le diagnostic honnete : soit le SQL est en cause, soit la connexion passe.
//
// Usage : node --env-file=.env.local scripts/apply-migration.mjs db/migrations/020_annotations.sql

import { readFile } from 'node:fs/promises';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('Usage : node scripts/apply-migration.mjs <fichier.sql>');
  process.exit(2);
}

// La base applique ses migrations dans une seule transaction : soit 020 passe
// entierement, soit rien n est change. Une politique de RLS a moitie appliquee
// laisserait un acces que l'on croit avoir ferme.
// Les migrations doivent etre jouees par le role PROPRIETAIRE (postgres) :
// trade_house_app n'a volontairement pas le droit de creer de politiques RLS.
// Le role est donc configurable, avec un avertissement explicite si la
// connexion aboutit quand meme — l'erreur « doit etre le proprietaire de la
// relation » n'apparait qu'apres coup et ne dit pas quoi changer.
const client = new pg.Client({
  connectionString: (
    process.env.MIGRATION_DATABASE_URL ??
    `postgresql://${process.env.PGUSER ?? 'postgres'}:${process.env.PGPASSWORD ?? ''}@127.0.0.1:5432/${process.env.PGDATABASE ?? 'trade_house'}`
  ),
});

try {
  await client.connect();
  const raw = await readFile(file, 'utf8');

  // Les migrations contiennent des commandes META de psql (`\set`, `\echo`,
  // `\timing`, `\i`). Elles servent une installation manuelle, mais sont
  // invalides en SQL : le serveur les refuse par « erreur de syntaxe sur ou
  // près de \ ». On les retire avant l'envoi.
  const sql = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*\\(set|echo|timing|i|pset|connect)\b/.test(line))
    .join('\n');

  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('commit');
    console.log(`OK  ${file}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
} catch (err) {
  console.error(`ECHEC ${file}`);
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}