"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.safeEqual = safeEqual;
exports.randomToken = randomToken;
exports.base32Encode = base32Encode;
exports.base32Decode = base32Decode;
exports.hmacSha1 = hmacSha1;
const node_crypto_1 = require("node:crypto");
/**
 * Chiffrement des secrets (2FA) — AES-256-GCM.
 *
 * Le secret TOTP est la piece la plus sensible du systeme : possedant le
 * secret ET l'empreinte stockee en base, on genere des codes a vie. Il est donc
 * chiffre par l'application avant d'atteindre PostgreSQL (colonne bytea), avec
 * une cle dediee (APP_ENCRYPTION_KEY) qui ne vit que dans l'environnement.
 *
 * Format stocke : [ iv (12 o) | tag (16 o) | donnees ]
 */
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
function key() {
    const raw = process.env.APP_ENCRYPTION_KEY;
    if (!raw || raw.length < 32) {
        throw new Error('APP_ENCRYPTION_KEY doit contenir au moins 32 caracteres');
    }
    return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
}
function encryptSecret(plaintext) {
    const iv = (0, node_crypto_1.randomBytes)(IV_LENGTH);
    const cipher = (0, node_crypto_1.createCipheriv)(ALGO, key(), iv);
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
function decryptSecret(payload) {
    const iv = payload.subarray(0, IV_LENGTH);
    const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = payload.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = (0, node_crypto_1.createDecipheriv)(ALGO, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}
/** Comparaison a temps constant (evite les attaques temporelles). */
function safeEqual(a, b) {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(bufA, bufB);
}
/** Jeton aleatoire en base32 (pour les codes de secours et les URL d'invitation). */
function randomToken(bytes = 20) {
    return base32Encode((0, node_crypto_1.randomBytes)(bytes));
}
// --- Base32 (RFC 4648, sans padding) : alphabet utilise par les authentificateurs
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += B32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        output += B32[(value << (5 - bits)) & 31];
    return output;
}
function base32Decode(input) {
    const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const char of clean) {
        const index = B32.indexOf(char);
        if (index === -1)
            throw new Error('Caractere base32 invalide');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}
/** HMAC-SHA1 : c'est l'algorithme impose par la RFC 6238 pour TOTP. */
function hmacSha1(key, message) {
    return (0, node_crypto_1.createHmac)('sha1', key).update(message).digest();
}
