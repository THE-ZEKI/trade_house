/**
 * Verification de l'implementation TOTP contre les vecteurs de test officiels
 * de la RFC 6238 (annexe B) : SHA1, 6 chiffres, 30 s.
 *
 *   npm run verify:crypto
 *
 * Les bibliotheques sont d'abord compilees dans .tmp-totp (voir package.json).
 */
const { currentCode, generateSecret, verifyCode } = require('../.tmp-totp/totp.js');
const { base32Encode, encryptSecret, decryptSecret, safeEqual } = require('../.tmp-totp/crypto.js');

const ok = (label) => console.log(`  [ok] ${label}`);
const ko = (label) => {
  failures += 1;
  console.log(`  [KO] ${label}`);
};
let failures = 0;

console.log('== RFC 6238 : vecteurs de test officiels (SHA1) ==');
const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const vectors = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];
for (const [seconds, expected8] of vectors) {
  const expected = expected8.slice(-6);
  const got = currentCode(secret, seconds * 1000);
  if (got === expected) ok(`T=${seconds}  code ${expected}`);
  else ko(`T=${seconds}  attendu ${expected}, obtenu ${got}`);
}

console.log('== fenetre de tolerance ==');
const now = 1_700_000_000_000;
const tests = [
  ['code actuel accepte', verifyCode(secret, currentCode(secret, now), now), true],
  ['code decale de +1 pas accepte', verifyCode(secret, currentCode(secret, now + 30000), now), true],
  ['code decale de -1 pas accepte', verifyCode(secret, currentCode(secret, now - 30000), now), true],
  ['code decale de +2 pas refuse', verifyCode(secret, currentCode(secret, now + 60000), now), false],
  ['code arbitraire refuse', verifyCode(secret, '000000', now), false],
  ['texte refuse', verifyCode(secret, 'abcdef', now), false],
];
for (const [label, got, expected] of tests) {
  if (got === expected) ok(label);
  else ko(`${label} (resultat ${got})`);
}

console.log('== secret et chiffrement AES-256-GCM ==');
const generated = generateSecret();
let tamperedFails = false;
try {
  const payload = encryptSecret(Buffer.from('secret-totp'));
  payload[payload.length - 1] ^= 0xff;
  decryptSecret(payload);
} catch {
  tamperedFails = true;
}
const cryptoTests = [
  ['secret base32 de 32 caracteres', generated.length === 32, true],
  ['deux secrets differents', generateSecret() !== generated, true],
  [
    'aller-retour de chiffrement',
    decryptSecret(encryptSecret(Buffer.from('JBSWY3DPEHPK3PXP', 'ascii'))).toString('ascii') ===
      'JBSWY3DPEHPK3PXP',
    true,
  ],
  ['donnee alteree rejetee par le tag GCM', tamperedFails, true],
  ['comparaison egale', safeEqual('abc', 'abc'), true],
  ['comparaison differente', safeEqual('abc', 'abd'), false],
];
for (const [label, got, expected] of cryptoTests) {
  if (got === expected) ok(label);
  else ko(`${label} (resultat ${got})`);
}

console.log('');
if (failures > 0) {
  console.log(`ECHEC : ${failures} test(s)`);
  process.exit(1);
}
console.log('SUCCES : TOTP conforme a la RFC 6238 et chiffrement operationnel.');
