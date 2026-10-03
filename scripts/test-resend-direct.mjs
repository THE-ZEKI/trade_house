// Test isole : appelle l'API Resend sans passer par l'app ni par Vercel.
// Usage : node scripts/test-resend-direct.mjs "destinataire@exemple.fr"
import { readFileSync } from 'node:fs';

const env = readFileSync(process.env.ENV_FILE ?? 'C:/Users/HP/Desktop/trade-house-vercel.env', 'utf8');
const get = (k) => env.match(new RegExp('^' + k + '="?([^"\\r\\n]*)"?$', 'm'))?.[1]?.trim();

const key = get('RESEND_API_KEY');
const from = get('EMAIL_FROM') ?? 'Trade House <onboarding@resend.dev>';
const to = process.argv[2] ?? get('EMAIL_FROM')?.match(/<(.+)>/)?.[1];

console.log('cle   :', key ? `${key.slice(0, 8)}... (${key.length} car.)` : 'ABSENTE');
console.log('guillemets autour de la cle :', key?.startsWith('"') || key?.endsWith('"') ? 'OUI (BUG)' : 'non');
console.log('from  :', from);
console.log('to    :', to);
console.log('');

if (!key) { console.log('RESULTAT : KO - cle absente du fichier'); process.exit(1); }

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ from, to, subject: 'Test Trade House', text: 'Message de test.' }),
});
const body = await res.text();
console.log('HTTP   :', res.status, res.statusText);
console.log('Reponse:', body);
console.log('');
console.log('RESULTAT :', res.ok ? 'OK - Resend accepte le message' : `KO - ${res.status}`);
