#!/usr/bin/env node
/**
 * trade_house · scripts/verify-room.mjs
 *
 * Verifie l'acces a la salle (C4, C6, RG-25) et la presence (C8) sur la
 * vraie base, plus la signature des jetons cote application.
 *
 *   npm run verify:room
 */
import { Client } from 'pg';
import { signRoomToken, verifyRoomToken } from '../.tmp-room/room-token.js';

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  [ok] ${m}`); };
const ko = (m) => { fail += 1; console.log(`  [KO] ${m}`); };
const check = (c, m) => (c ? ok(m) : ko(m));

const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();

async function asUser(userId, fn) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('begin');
    await c.query('select app.set_user($1::uuid)', [userId]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

const login = (email) =>
  admin.query('select id from app.user_for_login($1::citext)', [email])
    .then((r) => r.rows[0]?.id);

const ADM = await login('admin@trade-house.local');
const MGR = await login('manager@trade-house.local');
const T1 = await login('trader1@trade-house.local');
const T2 = await login('trader2@trade-house.local');
const stamp = Date.now();
// le troisieme trader est cree par l'admin, comme le fait l'API /api/users
const T3 = await asUser(ADM, (c) =>
  c.query(
    `select (app.create_user($1::citext,$2::varchar,'trader'::user_role,$3::uuid)).id`,
    [`room.${stamp}@trade-house.local`, 'Trader invite', MGR],
  ).then((r) => r.rows[0].id));

console.log('== signature des jetons (sans base) ==');
process.env.APP_ENCRYPTION_KEY ||= 'x'.repeat(48);
const claims = {
  v: 1, m: '11111111-1111-1111-1111-111111111111', u: T1,
  r: 'participant', e: Math.floor(Date.now() / 1000) + 1800,
};
const token = signRoomToken(claims);
const back = verifyRoomToken(token);
check(back?.u === T1 && back?.r === 'participant', 'aller-retour du jeton');
check(verifyRoomToken(token.slice(0, -1) + 'X') === null, 'jeton falsifie refuse');
check(signRoomToken(claims) === token, 'signature deterministe pour un meme jeton');
check(
  verifyRoomToken(signRoomToken({ ...claims, e: Math.floor(Date.now() / 1000) - 10 })) === null,
  'jeton expire refuse',
);
check(verifyRoomToken('pas-un-jeton') === null, 'chaine arbitraire refusee');

console.log("== droits d'acces a la salle (C4, RG-25) ==");
const createMeeting = (title, participants, as = ADM) =>
  asUser(as, async (c) => {
    const id = (await c.query(
      `select (app.create_meeting($1::varchar,$2::text,'internal'::meeting_type,
         now() + interval '1 hour', 60, $3::uuid[], null, 'internal'::link_provider,
         null, null)).id`,
      [title, 'Description', participants],
    )).rows[0].id;
    const who = (await c.query('select created_by from public.meetings where id = $1::uuid', [id]))
      .rows[0]?.created_by;
    if (who !== as) throw new Error(`create_meeting : created_by ${who} au lieu de ${as}`);
    return id;
  });

const meetingId = await createMeeting('Reunion de test', [T1, T3]);
ok(`reunion creee (${meetingId.slice(0, 8)}...)`);

const claimsFor = (who) =>
  asUser(who, (c) =>
    c.query('select app.room_claims($1::uuid, null) c', [meetingId]).then((r) => r.rows[0].c));

const c1 = await claimsFor(T1);
check(c1.m === meetingId && c1.u === T1, 'invite : acces accorde');
check(c1.r === 'participant', `invite : role « $(c1.r) »`);
check(c1.e * 1000 > Date.now() + 25 * 60 * 1000, 'expiration a 30 min par defaut (C4)');

check((await claimsFor(ADM)).r === 'moderator', 'admin : role moderateur (RG-25)');

// un manager NON invite n'entre pas dans la reunion d'un autre : C4 prime sur
// le privilege, sinon un manager pourrait espionner les seances d'autrui.
const mgrOut = await asUser(MGR, (c) =>
  c.query('select app.room_claims($1::uuid, null) c', [meetingId])
    .then(() => 'AUTORISE')
    .catch((e) => e.message));
check(String(mgrOut).includes('C4'), `manager non invite refuse ($(String(mgrOut).slice(0, 35)))`);

// RG-25 : l'organisateur est moderateur meme sans privilege global.
// La reunion est donc creee par le MANAGER, pas par l'admin.
const own = await createMeeting('Reunion du manager', [T1], MGR);
const orgClaims = await asUser(MGR, (c) =>
  c.query('select app.room_claims($1::uuid, null) c', [own]).then((r) => r.rows[0].c));
check(orgClaims.r === 'moderator', 'organisateur : moderateur sans privilege global');

// La salle ne s'ouvre que 10 min avant le debut (RG-20). Elargir la fenetre
// via le reglage evite d'attendre, et verifie au passage que le seuil est
// bien pilotable en base (et non code en dur).
await asUser(ADM, (c) =>
  c.query('update public.app_settings set room_open_before_minutes = 180'));
const open = await asUser(ADM, (c) => c.query(
  `select is_room_open from public.v_meeting_room_window where id = $1::uuid`, [meetingId]));
check(open.rows[0]?.is_room_open === true, 'fenetre de salle elargie par le reglage');

console.log('== presence automatique (C8) ==');

const join1 = await asUser(T1, (c) =>
  c.query('select app.attendance_join($1::uuid, $2::uuid, $3::varchar) id', [meetingId, T1, 'client'])
    .then((r) => r.rows[0].id));
check(!!join1, 'entree en salle enregistree');

const seg = (await asUser(ADM, (c) => c.query(
  `select joined_at, left_at, source from public.meeting_attendance
    where meeting_id = $1::uuid and user_id = $2::uuid`, [meetingId, T1]))).rows[0];
check(seg && seg.joined_at && seg.left_at === null, 'segment ouvert, non cloture');
check(seg?.source === 'client', 'source de l evenement tracee');

await asUser(T1, (c) =>
  c.query('select app.attendance_leave($1::uuid, $2::uuid, $3::varchar)', [meetingId, T1, 'client']));
const closed = (await asUser(ADM, (c) => c.query(
  `select left_at from public.meeting_attendance
    where meeting_id = $1::uuid and user_id = $2::uuid`, [meetingId, T1]))).rows[0];
check(!!closed?.left_at, 'sortie : segment cloture');

const noPerm = await asUser(T2, (c) =>
  c.query('select app.attendance_join($1::uuid, $2::uuid, $3::varchar)', [meetingId, T2, 'client'])
    .then(() => 'AUTORISE')
    .catch((e) => String(e.message).slice(0, 45)));
check(String(noPerm) !== 'AUTORISE', `presence refusee a un non-invite (${noPerm})`);

const mat = await asUser(MGR, (c) =>
  c.query('select app.materialize_attendance($1::uuid) n', [meetingId]).then((r) => Number(r.rows[0].n)));
check(mat >= 1, `presence materialisee (${mat} participant(s))`);
const summary = (await asUser(ADM, (c) => c.query(
  `select total_seconds, status from public.meeting_attendance_result
    where meeting_id = $1::uuid and user_id = $2::uuid`, [meetingId, T1]))).rows[0];
check(!!summary, `resultat de presence fige (${summary?.status ?? 'absent'})`);

// le reglage doit revenir a sa valeur d'origine : un test qui laisse deriver
// les seuils fausse les tests suivants.
await asUser(ADM, (c) =>
  c.query('update public.app_settings set room_open_before_minutes = 10'));

await admin.end();
console.log(`\n${fail ? 'ECHEC' : 'SUCCES'} : ${pass} verifications, ${fail} echecs.`);
process.exit(fail ? 1 : 0);

check(c1.m === meetingId && c1.u === T1, 'invite : acces accorde');
check(c1.r === 'participant', `invite : role « ${c1.r} »`);
check(c1.e * 1000 > Date.now() + 25 * 60 * 1000, 'expiration a 30 min par defaut (C4)');

const refused = await asUser(T2, (c) =>
  c.query('select app.room_claims($1::uuid, null) c', [meetingId])
    .then(() => 'AUTORISE')
    .catch((e) => e.message));
check(String(refused).includes('C4'), `non-invite refuse (${String(refused).slice(0, 40)})`);
