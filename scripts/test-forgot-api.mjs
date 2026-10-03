// Appelle le endpoint « mot de passe oublie » du deploiement et affiche la
// reponse brute : un 200 { status: "sent" } masque volontairement toute erreur,
// c'est pourquoi le navigateur n'apprend rien de l'echec.
const BASE = process.argv[2] ?? 'https://trade-house-vmfj.vercel.app';
const EMAIL = process.argv[3] ?? 'ezechieltrade@gmail.com';

const res = await fetch(`${BASE}/api/auth/password/forgot`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL }),
});
console.log('URL     :', `${BASE}/api/auth/password/forgot`);
console.log('email   :', EMAIL);
console.log('HTTP    :', res.status, res.statusText);
console.log('Reponse :', await res.text());
console.log('');
console.log(
  'Lecture :',
  res.ok
    ? '200 = la route a repondu. Pour "sent", soit le compte est inconnu/inactif, soit l envoi a echoue en silence. Verifier Resend Logs et la table users.'
    : 'Erreur = la route a leve : base injoignable ou configuration invalide. Le message indique la cause.',
);
