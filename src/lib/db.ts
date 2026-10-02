import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/**
 * Couche d'accès à la base.
 *
 * Deux responsabilités seulement :
 *   1. gérer le pool de connexions ;
 *   2. ouvrir une transaction et y poser l'identifiant de l'appelant
 *      (app.set_user), car c'est ce que les politiques RLS et toutes les
 *      fonctions app.* lisent pour savoir « qui » appelle.
 *
 * Aucune règle métier ici : elle vit dans la base (schéma app). Voir
 * docs/PLAN_BACKEND.md.
 */

const globalForPg = globalThis as unknown as { tradeHousePool?: Pool };

export const pool: Pool =
  globalForPg.tradeHousePool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // les erreurs ne doivent pas faire tomber le process en dev
    application_name: 'trade_house',
  });

// évite de créer un pool à chaque rechargement à chaud de Next.js
if (process.env.NODE_ENV !== 'production') globalForPg.tradeHousePool = pool;

export type Sql = PoolClient;

/** Requête simple, hors contexte utilisateur (health check, cron technique). */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as unknown[]);
  return res.rows;
}

/** Requête simple qui doit renvoyer au plus une ligne. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Variantes LIÉES à une transaction.
 *
 * Indispensable : query()/queryOne() utilisent le pool, donc une AUTRE
 * connexion, sur laquelle app.set_user() n'a pas été posé. Le RLS filtrerait
 * alors toutes les lignes et l'on croirait, à tort, qu'un enregistrement
 * n'existe pas. Dans un callback asUser()/withTransaction(), utilisez
 * systématiquement queryWith() / queryOneWith().
 */
export async function queryWith<T extends QueryResultRow = QueryResultRow>(
  sql: Sql,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await sql.query<T>(text, params as unknown[]);
  return res.rows;
}

export async function queryOneWith<T extends QueryResultRow = QueryResultRow>(
  sql: Sql,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await queryWith<T>(sql, text, params);
  return rows[0] ?? null;
}

/**
 * Exécute un traitement dans une transaction.
 * En cas d'erreur : ROLLBACK, donc aucune écriture partielle.
 */
export async function withTransaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* la connexion est perdue : rien à faire de plus */
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Exécute un traitement « en tant qu'utilisateur ».
 *
 * app.set_user() utilise set_config(..., true) : la valeur est valable pour la
 * transaction courante uniquement. C'est pourquoi cette fonction ouvre TOUJOURS
 * une transaction — sans cela l'identité fuiterait d'un appel à l'autre.
 *
 * @param userId identifiant de public.users, ou null pour un appel anonyme
 *               (connexion, acceptation d'invitation) : le RLS alors ne laisse
 *               passer que les lignes autorisées par les politiques.
 */
export async function asUser<T>(
  userId: string | null,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  return withTransaction(async (sql) => {
    await sql.query('select app.set_user($1::uuid)', [userId]);
    return fn(sql);
  });
}

/**
 * Appel d'une fonction métier du schéma app.
 * Le nom de la fonction est validé : aucune injection possible depuis l'API.
 */
const APP_FUNCTIONS = new Set([
  // comptes
  'app.set_password',
  'app.update_profile',
  'app.deactivate_user',
  'app.reactivate_user',
  'app.create_user',
  'app.issue_invitation',
  // 027 : le manager invite un trader qui tombe sous sa couverture. La
  // fonction impose le role et le manager ; cette liste n'autorise que l'appel.
  'app.invite_trader',
  'app.accept_invitation',
  'app.revoke_all_sessions',
  // 018 : administration des comptes. La fonction elle-meme exige un
  // administrateur ; cette liste n'autorise que l'appel.
  'app.update_settings',
  'app.update_user_account',
  'app.anonymize_user',
  // formation (module G)
  'app.create_training_course',
  'app.update_training_course',
  'app.add_training_exercise',
  'app.assign_training',
  'app.submit_training_exercise',
  'app.review_training',
  'app.complete_training',
  'app.resubmit_training_exercise',
  'app.unassign_training',
  'app.attach_training_file',
  // 026 : supports du cours (images, PDF). La fonction refuse un cours qui
  // n'est pas de l'auteur ; cette liste n'autorise que l'appel.
  'app.attach_course_file',
  'app.remove_course_file',
  // reunions
  'app.create_meeting',
  'app.cancel_meeting',
  'app.reschedule_meeting',
  'app.update_meeting_link',
  'app.rsvp',
  'app.send_manual_reminder',
  // rapports
  'app.submit_report',
  'app.resubmit_report',
  'app.declare_no_trade',
  'app.cancel_no_trade',
  'app.start_review',
  'app.request_corrections',
  'app.validate_report',
  'app.dismiss_report',
  'app.reopen_report',
  'app.add_correction',
  'app.respond_correction',
  'app.arbitrate_correction',
  'app.cancel_no_trade',
  // salle video (C4, C8)
  'app.room_claims',
  'app.attendance_join',
  'app.attendance_leave',
  'app.materialize_attendance',
  'app.close_meeting',
  'app.start_review',
  'app.add_correction',
  'app.request_corrections',
  'app.respond_correction',
  'app.arbitrate_correction',
  'app.validate_report',
  'app.dismiss_report',
  'app.reopen_report',
  // salle et presence
  'app.attendance_join',
  'app.attendance_leave',
  'app.close_meeting',
  'app.materialize_attendance',
  // double authentification (A5)
  'app.set_mfa_enforced',
  'app.store_mfa_secret',
  'app.confirm_mfa',
  'app.disable_mfa',
  'app.store_backup_codes',
  'app.consume_backup_code',
  'app.consume_totp_step',
  // rappels (appelees par le cron)
  'app.claim_due_reminders',
  'app.prepare_reminder',
  'app.complete_reminder',
  'app.reclaim_stuck_reminders',
  'app.pending_reminder_targets',
  'app.meeting_occurrences',
  'app.generate_occurrences',
  'app.mark_notification_sent',
  'app.mark_notification_failed',
]);

/**
 * Normalise un nom de fonction metier.
 *
 * Le nom peut etre ecrit 'validate_report' ou 'app.validate_report'. Les deux
 * formes coexistaient dans les routes : vingt-quatre appels ecrivaient sans le
 * prefixe, alors que la liste blanche ne contient que la forme complete.
 * Resultat : « Fonction non autorisee » sur toute la revue et toute
 * l'administration des comptes — avec une fonction qui existe en base et un
 * TypeScript parfaitement vert.
 *
 * Normaliser ici supprime la classe de bug : ajouter chaque nom a la liste
 * blanche ne ferait que repousser le meme probleme sur la fonction suivante.
 */
function normalizeFn(fnName: string): string {
  return fnName.includes('.') ? fnName : `app.${fnName}`;
}

export async function callApp<T = QueryResultRow>(
  sql: Sql,
  fnName: string,
  args: readonly unknown[] = [],
): Promise<T | null> {
  fnName = normalizeFn(fnName);
  if (!APP_FUNCTIONS.has(fnName)) {
    throw new Error(`Fonction non autorisee : ${fnName}`);
  }
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  // to_jsonb est indispensable : sans lui, node-postgres renvoie les types
  // composites (par exemple public.users) sous forme de texte
  // « (uuid,email,…) » au lieu d'un objet exploitable.
  const sqlText = `select to_jsonb(${fnName}(${placeholders})) as result`;
  const res = await sql.query(sqlText, args as unknown[]);
  const row = res.rows[0] as { result: T } | undefined;
  return row ? row.result : null;
}

/**
 * Variante pour les fonctions qui renvoient PLUSIEURS lignes
 * (app.claim_due_reminders ...).
 *
 * Attention : une fonction renvoyant un ensemble, appelée dans la liste SELECT,
 * produit une ligne par élément — to_jsonb n'en convertirait qu'un seul. Il faut
 * donc expliciter l'agrégation.
 */
export async function callAppSet<T = QueryResultRow>(
  sql: Sql,
  fnName: string,
  args: readonly unknown[] = [],
): Promise<T[]> {
  fnName = normalizeFn(fnName);
  if (!APP_FUNCTIONS.has(fnName)) {
    throw new Error(`Fonction non autorisee : ${fnName}`);
  }
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const sqlText = `select coalesce(to_jsonb(array_agg(t)), '[]'::jsonb) as result
                     from ${fnName}(${placeholders}) as t`;
  const res = await sql.query(sqlText, args as unknown[]);
  const row = res.rows[0] as { result: T[] } | undefined;
  return row?.result ?? [];
}
