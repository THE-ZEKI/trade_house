// Verifie la connexion SMTP Gmail telle qu'elle sera faite sur Vercel.
// Usage : node scripts/test-smtp-gmail.mjs
// Lit EMAIL/SMTP_USER/SMTP_PASSWORD depuis le fichier .env du Bureau, ou de
// l'environnement. Ne journalise JAMAIS le mot de passe.
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const envFile = process.env.ENV_FILE ?? 'C:/Users/HP/Desktop/trade-house-vercel.env';
let file = '';
try { file = readFileSync(envFile, 'utf8'); } catch { console.log('(pas de fichier .env lu : variables d’environnement seules)'); }
const get = (k) => file.match(new RegExp('^' + k + '="?([^"\\r\\n]*)"?$', 'm'))?.[1]?.trim() || process.env[k];

const user = get('SMTP_USER');
const pass = get('SMTP_PASSWORD');
const host = get('SMTP_HOST') ?? 'smtp.gmail.com';
const port = Number(get('SMTP_PORT') ?? '465');
const to = process.argv[2] ?? 'ezechieltrade@gmail.com';

if (!user || !pass) {
  console.log('SMTP_USER / SMTP_PASSWORD absents. Renseigne-les dans', envFile);
  process.exit(1);
}
console.log('hote  :', host + ':' + port);
console.log('user  :', user);
console.log('mdp   :', pass.length + ' caracteres');
console.log('');

const transport = nodemailer.createTransport({
  host, port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
});

try {
  const ok = await transport.verify();
  console.log('Connexion SMTP : OK' + (ok ? '' : ' (verify() a repondu falsy)'));
  const info = await transport.sendMail({
    from: `"Trade House" <${user}>`,
    to,
    subject: 'Test SMTP Gmail',
    text: 'Envoi de test via Gmail SMTP.',
  });
  console.log('Envoi          : OK');
  console.log('id             :', info.messageId);
} catch (e) {
  console.log('ECHEC :', e?.code ?? '', '-', (e?.message ?? '').slice(0, 200));
  if (String(e?.code).includes('535')) {
    console.log('');
    console.log("Erreur 535 = identifiants refuses. Avec Gmail, il faut un");
    console.log('« mot de passe d application », PAS le mot de passe du compte :');
    console.log('  Google Account > Security > 2-Step Verification > App passwords.');
  }
} finally {
  transport.close();
}