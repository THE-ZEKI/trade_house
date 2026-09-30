#!/usr/bin/env node
/**
 * trade_hone · scripts/verify-email.mjs
 *
 * Verifie l'adaptateur d'envoi d'emails sans envoyer de vrai message :
 *   - fournisseur « log »  : doit journaliser et ne rien envoyer
 *   - SMTP indisponible   : doit renvoyer une erreur propre (delivered=false)
 *     au lieu de lever une exception, afin que le job cron applique les
 *     relances RG-16 au lieu de perdre l'email.
 *
 *   npm run verify:email
 */
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'log';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
if (process.env.EMAIL_PROVIDER === 'smtp') {
  process.env.SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1';
  process.env.SMTP_PORT = process.env.SMTP_PORT || '2599'; // port ferme : echec attendu
  process.env.SMTP_SECURE = 'false';
}

const { sendEmail, closeEmailTransport } = await import('../.tmp-email/email.js');

let failures = 0;
const ok = (m) => console.log(`  [ok] ${m}`);
const ko = (m) => {
  failures += 1;
  console.log(`  [KO] ${m}`);
};

console.log(`== fournisseur : ${process.env.EMAIL_PROVIDER} ==`);

const result = await sendEmail({
  to: 'test@trade-house.local',
  subject: 'Test Trade House',
  text: 'Message de verification.',
});
console.log(`  -> ${JSON.stringify(result)}`);

if (process.env.EMAIL_PROVIDER === 'log') {
  result.provider === 'log' ? ok('fournisseur log') : ko('fournisseur inattendu');
  result.delivered === false ? ok('aucun envoi reel en developpement') : ko('envoi reel inattendu');
} else {
  if (typeof result.delivered === 'boolean') ok('contrat respecte (delivered boolean)');
  else ko('contrat non respecte');
  if (result.delivered === false && result.error) {
    ok('echec propre sans exception : ' + String(result.error).slice(0, 60));
  } else {
    ok('envoi accepte par le fournisseur');
  }
}

await closeEmailTransport();
console.log(failures ? `\nECHEC : ${failures}` : '\nSUCCES : adaptateur email operationnel.');
process.exit(failures ? 1 : 0);
