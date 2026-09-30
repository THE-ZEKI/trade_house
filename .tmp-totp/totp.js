"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSecret = generateSecret;
exports.currentCode = currentCode;
exports.verifyCode = verifyCode;
exports.otpauthUrl = otpauthUrl;
const node_crypto_1 = require("node:crypto");
const crypto_1 = require("./crypto");
/**
 * TOTP — RFC 6238 (sur HMAC-SHA1, comme、Google Authenticator, Authy, 1Password).
 *
 * Parametres : 30 secondes, 6 chiffres, SHA1, decalage 0.
 * On accepte une fenetre de +/- 1 pas (90 s) pour tolerer une horloge legerement
 * desynchronisee, tout en refusant au-dela.
 */
const PERIOD = 30;
const DIGITS = 6;
function generateSecret(bytes = 20) {
    return (0, crypto_1.base32Encode)((0, node_crypto_1.randomBytes)(bytes));
}
function counter(timeStep) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(timeStep));
    return buf;
}
function codeFor(secretBase32, timeStep) {
    const key = (0, crypto_1.base32Decode)(secretBase32);
    const digest = (0, crypto_1.hmacSha1)(key, counter(timeStep));
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);
    return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}
/** Code attendu pour l'instant present. */
function currentCode(secret, at = Date.now()) {
    return codeFor(secret, Math.floor(at / 1000 / PERIOD));
}
/** Verifie un code en tolerant une fenetre de +/- `window` periodes. */
function verifyCode(secret, code, at = Date.now(), window = 1) {
    const candidate = code.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(candidate))
        return false;
    const step = Math.floor(at / 1000 / PERIOD);
    for (let drift = -window; drift <= window; drift += 1) {
        if ((0, crypto_1.safeEqual)(codeFor(secret, step + drift), candidate))
            return true;
    }
    return false;
}
/** URL otpauth:// pour le QR code (a afficher / encoder en phase 1). */
function otpauthUrl(params) {
    const label = encodeURIComponent(`${params.issuer}:${params.account}`);
    const query = new URLSearchParams({
        secret: params.secret,
        issuer: params.issuer,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(PERIOD),
    });
    return `otpauth://totp/${label}?${query.toString()}`;
}
