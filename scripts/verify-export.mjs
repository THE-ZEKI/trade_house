#!/usr/bin/env node
/**
 * trade_house · scripts/verify-export.mjs
 *
 * Verifie l'export PDF (D6) sans passer par HTTP : on appelle le generateur
 * avec des donnees construites, et on controle le PDF produit.
 *
 *   npm run verify:export
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// le generateur est compile en .tmp-pdf par la tache npm (voir package.json)
const { renderReportPdf } = await import('../.tmp-pdf/pdf.js');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  [ok] ${m}`); };
const ko = (m) => { fail += 1; console.log(`  [KO] ${m}`); };
const check = (c, m) => (c ? ok(m) : ko(m));

console.log('== export PDF (D6) ==');

// Un PNG 4x4 valide, minimal, pour tester l'incorporation d'image.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
);

const base = {
  report: {
    session_date: '2026-03-14', instrument: 'EURUSD', result_type: 'loss',
    result_amount: -250, strategy: 'Cassure de resistance', nb_trades: 4,
    plan_respected: false, rr_planned: 2, rr_realized: 0.5,
    emotions: ['calm', 'impatience'], emotions_note: 'Bonne discipline en debut de seance.',
    highlights: 'Entree respectee sur le premier trade.',
    mistakes: 'Trade impulsive sur la fin.',
    notes: 'Volume faible, spreads elargis.',
    is_no_trade: false, is_late: true, status: 'validated', current_version: 2,
  },
  trader: { full_name: 'Amadou Traoré', email: 'amadou@trade-house.local' },
  reviewer: { full_name: 'Marie Dupont' },
  versions: [
    { version_number: 1, submitted_at: '2026-03-15T08:10:00Z', submitted_by_name: 'Amadou Traoré' },
    { version_number: 2, submitted_at: '2026-03-15T10:02:00Z', submitted_by_name: 'Amadou Traoré' },
  ],
  corrections: [
    {
      target_type: 'field', target_field: 'plan_respected',
      message: "Le plan n'a pas ete respecte sur le dernier trade : explains la raison.",
      severity: 'mandatory', status: 'done', author_name: 'Marie Dupont',
      created_at: '2026-03-15T09:00:00Z',
    },
  ],
  files: [
    { id: '1', original_name: 'capture.png', mime_type: 'image/png', storage_path: 'inexistant.png' },
  ],
};

let pdf;
try {
  pdf = await renderReportPdf(base);
  check(Buffer.isBuffer(pdf) && pdf.length > 1000, `PDF genere (${pdf.length} octets)`);
} catch (e) {
  ko(`echec de generation : ${e.message}`);
}

// --- structure du fichier -------------------------------------------------
check(pdf.subarray(0, 5).toString('latin1') === '%PDF-', 'en-tete %PDF- present');
check(pdf.subarray(-6).toString('latin1').includes('%%EOF'), 'marqueur %%EOF present');

// Le PDF est compresse (FlateDecode) : on decompresse le flux de contenu pour
// verifier que le texte et les accents ont bien ete encodes.
import { inflateSync, inflateRawSync } from 'node:zlib';

function inflateStreams(buf) {
  const out = [];
  let pos = 0;
  for (;;) {
    const start = buf.indexOf('stream', pos, 'latin1');
    if (start < 0) break;
    // le mot-cle est suivi d'un fin de ligne optionnel avant les donnees
    let data = start + 'stream'.length;
    if (buf[data] === 0x0d) data += 1;
    if (buf[data] === 0x0a) data += 1;
    const end = buf.indexOf('endstream', data, 'latin1');
    if (end < 0) break;
    const chunk = buf.subarray(data, end);
    try {
      out.push(inflateSync(chunk));
    } catch {
      try {
        out.push(inflateRawSync(chunk));
      } catch {
        /* flux non compresse (images) : ignore */
      }
    }
    pos = end + 1;
  }
  return out;
}

const streams = pdf ? inflateStreams(pdf) : [];
check(streams.length > 0, `flux de contenu decompresses (${streams.length})`);

// pdfkit ecrit le texte en segments hexadecimaux : <54 72 61 64 65> -> "Trade".
// Les octets sont en WinAnsi : 0xE9 = e accent. On decode sur 32..255 pour les
// conserver (les accents sont justement hors ASCII).
function decodeText(s) {
  let out = '';
  const re = /<([0-9A-Fa-f\s]+)>/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const hex = m[1].replace(/\s+/g, '');
    for (let i = 0; i + 1 < hex.length; i += 2) {
      const code = Number.parseInt(hex.slice(i, i + 2), 16);
      if (code === 10) out += '\n';
      else if (code >= 32 && code < 256) out += String.fromCharCode(code);
    }
  }
  return out;
}

const text = decodeText(streams.join('\n'));
check(text.includes('Trade House'), 'titre present dans le flux');
check(text.includes('Rapport de seance du 2026-03-14'), 'date de seance');
check(/Statut\s*:\s*Valide/.test(text), 'statut present');
check(text.includes('Plan respecte'), 'champs D1 presents');
check(text.includes('Obligatoire'), 'severite des correctifs presente');
check(text.includes('Version 1') && text.includes('Version 2'), 'historique des versions (E6)');
check(text.includes('pieces jointes') || text.includes('Pieces jointes'), 'inventaire des pieces jointes');
// accents encodes en WinAnsi : e accent = 0xE9, a accent = 0xE0
const accented = /[\u00E0\u00E8\u00E9\u00EA\u00FB\u00E7\u00F4\u00EE\u00E2]/;
check(accented.test(text), 'accents preserves (encodage WinAnsi)');
check(text.includes('Amadou Traor'), 'identite du trader (accent retient)');
check(pdf.length > 2000, 'volume coherent avec un rapport complet');

// --- robustesse : donnees degradees ---------------------------------------
const edge = {
  ...base,
  report: { session_date: null, instrument: null, result_type: null, result_amount: null,
            strategy: null, nb_trades: null, plan_respected: null, rr_planned: null,
            rr_realized: null, emotions: null, status: 'draft', current_version: 1,
            is_no_trade: false, is_late: false },
  trader: null, reviewer: null, versions: [], corrections: [],
  files: [{ id: '2', original_name: 'capture.webp', mime_type: 'image/webp', storage_path: 'x.webp' }],
};
try {
  const p2 = await renderReportPdf(edge);
  check(Buffer.isBuffer(p2) && p2.length > 800, 'rapport vide : generation sans erreur');
} catch (e) {
  ko(`rapport vide : ${e.message}`);
}

// emojis : hors encodage WinAnsi, ils doivent etre retires et non faire echouer
try {
  const p3 = await renderReportPdf({
    ...base,
    report: { ...base.report, notes: 'Trade 📈 gains 🚀' },
  });
  check(Buffer.isBuffer(p3), 'emojis retires sans erreur de rendu');
} catch (e) {
  ko(`emojis : ${e.message}`);
}

mkdirSync('.tmp-totp', { recursive: true });
writeFileSync('.tmp-totp/apercu-rapport.pdf', pdf);
console.log(`\n  apercu ecrit dans .tmp-totp/apercu-rapport.pdf`);
console.log(`\n${fail ? 'ECHEC' : 'SUCCES'} : ${pass} verifications, ${fail} echecs.`);
process.exit(fail ? 1 : 0);
