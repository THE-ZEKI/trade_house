// Genere un hash bcrypt du MÊME algorithme que src/lib/auth.ts (bcryptjs),
// car c'est bcrypt.compare qui verifie a la connexion. Un crypt() pgcrypto
// ne serait PAS comparable : bcrypt reconnait son prefixe "$2a$/$2b$" et
// ignorerait un hash md5/sha256 sans erreur visible.
//
// Usage : node scripts/hash-password.mjs "MonMotDePasse1!"
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.error('usage : node scripts/hash-password.mjs "MotDePasse1!"');
  process.exit(1);
}
if (password.length < 8 || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  console.error('REFUSE (RG-65) : 8 caracteres minimum, un chiffre, un caractere special.');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 10);
console.log(hash);
console.log('');
console.log('-- Verification aller-retour :', await bcrypt.compare(password, hash));
