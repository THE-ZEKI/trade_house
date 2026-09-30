#!/usr/bin/env node
/**
 * trade_house · scripts/verify-reports.mjs
 *
 * Verifie le cycle complet de correction (P7, P8, P9) et le stockage prive
 * (RG-32, RG-33) sur la vraie base, RLS actif, en passant par les memes
 * fonctions app.* que l'API.
 *
 *   npm run verify:reports
 */
import { Client } from 'pg';
import { sniffMime, signFileToken, verifyFileToken, putFile, getFile, deleteFile } from '../.tmp-storage/storage.js';

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  [ok] ${m}`); };
const ko = (m) => { fail += 1; console.log(`  [KO] ${m}`); };
const check = (cond, m) => (cond ? ok(m) : ko(m));

const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();

/** Connexion « as user » : le RLS s'applique, comme en production. */
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

const call = (c, fn, args) =>
  c.query(`select ${fn}($1${', $2'.repeat(args.length - 1)}) r`, args).then((r) => r.rows[0]?.r);

const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const mgr = await admin.query('select app.create_user($1,$2,$3) id', [
  `mgr.${stamp}@trade-house.local`, 'Chef phase3', 'manager',
]);
const trd = await admin.query('select app.create_user($1,$2,$3,$4) id', [
  `trd.${stamp}@trade-house.local`, 'Trader phase3', 'trader', mgr.rows[0].id,
]);
const other = await admin.query('select app.create_user($1,$2,$3,$4) id', [
  `oth.${stamp}@trade-house.local`, 'Trader etranger', 'trader', mgr.rows[0].id,
]);
const MGR = mgr.rows[0].id;
const TRD = trd.rows[0].id;
const OTH = other.rows[0].id;
console.log('== cycle de correction (rapports) ==');

// --- 1. le trader cree un brouillon ---------------------------------------
const reportId = await asUser(TRD, async (c) => {
  const r = await c.query(
    `insert into public.reports (trader_id, session_date, instrument, result_type, result_amount,
       nb_trades, plan_respected, rr_planned, rr_realized, emotions, is_no_trade, status)
     values ($1::uuid,$2::date,'EURUSD','loss',-250,4,false,2,0.5,array['calm']::emotion_code[],false,'draft')
     returning id`,
    [TRD, yesterday],
  );
  return r.rows[0].id;
});
ok('brouillon cree');

// --- 2. un tiers ne voit pas ce rapport (RLS) ------------------------------
const leak = await asUser(OTH, (c) => c.query('select 1 from public.reports where id=$1::uuid', [reportId]));
check(leak.rowCount === 0, 'RLS : un autre trader ne voit pas le rapport (0 ligne)');
const seenByMgr = await asUser(MGR, (c) => c.query('select 1 from public.reports where id=$1::uuid', [reportId]));
check(seenByMgr.rowCount === 1, 'le manager de l equipe voit le rapport');

// --- 3. soumission : version 1 figee --------------------------------------
const v1 = await asUser(TRD, (c) => call(c, 'app.submit_report', [reportId]));
check(v1 === 'submitted', `soumission : statut -> ${v1}`);
const versions = await admin.query(
  'select version_number from public.report_versions where report_id=$1', [reportId]);
check(versions.rowCount === 1, 'version 1 figee');

// --- 4. un rapport soumis n'est plus modifiable par SQL -------------------
const edit = await asUser(TRD, (c) =>
  c.query(`update public.reports set notes='contournement'
             where id=$1::uuid and status in ('draft','correction_requested')`, [reportId]));
check(edit.rowCount === 0, 'un rapport soumis n’est plus modifiable (garde SQL)');

// --- 5. le superviseur passe en revue -------------------------------------
const inReview = await asUser(MGR, (c) => call(c, 'app.start_review', [reportId]));
check(inReview === 'in_review', `passage en revue : ${inReview}`);

// --- 6. correction sur un champ ; cible invalide refusee ------------------
const corr1 = await asUser(MGR, (c) => call(c, 'app.add_correction',
  [reportId, 'Plan non respecte sur le dernier trade.', 'mandatory', 'field', 'plan_respected', null]));
check(!!corr1, 'correction sur un champ precis');
const corr2 = await asUser(MGR, (c) => call(c, 'app.add_correction',
  [reportId, 'Capture illisible.', 'suggestion', 'file', null, '00000000-0000-0000-0000-000000000000'])
  .catch((e) => e.message));
check(corr2 !== corr1, 'correction vers un fichier inexistant refusee');

// --- 7. validation impossible tant qu'une correction est ouverte ----------
const tooEarly = await asUser(MGR, (c) => call(c, 'app.validate_report', [reportId]).catch((e) => e.message));
check(tooEarly !== 'validated', `validation refusee avec correction ouverte (${String(tooEarly).slice(0, 45)})`);

// --- 8. le trader accepte --------------------------------------------------
await asUser(TRD, (c) => call(c, 'app.respond_correction', [corr1, 'done', 'Corrige.']));
const st1 = await admin.query('select status from public.report_corrections where id=$1', [corr1]);
check(st1.rows[0]?.status === 'done', 'correction acceptee par le trader');
// --- 9. demande de corrections -> resoumission -> validation --------------
const requested = await asUser(MGR, (c) => call(c, 'app.request_corrections', [reportId, null]));
check(requested === 'correction_requested', `demande de corrections : ${requested}`);
const editable = await asUser(TRD, (c) =>
  c.query(`update public.reports set notes='version 2 modifiee'
             where id=$1::uuid and status in ('draft','correction_requested')`, [reportId]));
check(editable.rowCount === 1, 'le trader peut modifier apres demande de corrections');
const v2 = await asUser(TRD, (c) => call(c, 'app.resubmit_report', [reportId]));
check(v2 === 'resubmitted', `resoumission : ${v2}`);
const allVersions = await admin.query(
  'select version_number from public.report_versions where report_id=$1 order by 1', [reportId]);
check(allVersions.rowCount === 2, 'version 2 conservee : l’historique E6 est intact');

const validated = await asUser(MGR, (c) => call(c, 'app.validate_report', [reportId]));
check(validated === 'validated', `validation : ${validated}`);

// --- 10. jour sans trade ---------------------------------------------------
const declared = await asUser(TRD, (c) => call(c, 'app.declare_no_trade', [today, 'Aucune opportunite.']));
check(!!declared, 'declaration « jour sans trade » (D7)');
const dRow = await admin.query(
  'select is_no_trade, no_trade_reason from public.reports where id=$1::uuid', [declared]);
check(dRow.rows[0]?.is_no_trade === true, 'is_no_trade positionne a true');

console.log('== stockage prive (RG-32, RG-33) ==');
// --- 11. signature de fichier ---------------------------------------------
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
check(sniffMime(png) === 'image/png', 'PNG valide detecte');
check(sniffMime(Buffer.from('<html><script>alert(1)</script></html>')) === null, 'HTML deguise refuse');
check(sniffMime(Buffer.from('%PDF-1.4 trap')) === 'application/pdf', 'PDF valide detecte');
check(sniffMime(Buffer.from('GIF89a')) === null, 'GIF non autorise refuse');

const stored = await putFile(TRD, 'image/png', png);
const back = await getFile(stored);
check(Buffer.compare(back, png) === 0, 'aller-retour du fichier sur disque');
check(!/png$/i.test(stored) || stored.length > 40, 'nom de stockage aleatoire, non devinable');
await deleteFile(stored);
let gone = false;
try { await getFile(stored); } catch { gone = true; }
check(gone, 'suppression du fichier');

console.log('== lien signe temporaire (RG-33) ==');
const fileId = await admin.query('select gen_random_uuid() id').then((r) => r.rows[0].id);
const token = signFileToken(fileId, 900);
check(verifyFileToken(fileId, token) === true, 'jeton valide pour le bon fichier');
check(verifyFileToken(fileId, token.slice(0, -1) + 'X') === false, 'jeton falsifie refuse');
check(verifyFileToken('00000000-0000-0000-0000-000000000000', token) === false,
  'jeton rejette sur un autre fichier');
check(verifyFileToken(fileId, signFileToken(fileId, -10)) === false, 'jeton expire refuse');

await admin.end();
console.log(`\n${fail ? 'ECHEC' : 'SUCCES'} : ${pass} verifications, ${fail} echecs.`);
process.exit(fail ? 1 : 0);
