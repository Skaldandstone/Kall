import crypto from 'node:crypto';

/**
 * A minimal, dependency-free RFC 6238 TOTP generator (SHA1, 30s step, 6
 * digits) matching the backend's pyotp defaults (kall/api_security.py).
 * Lets a test act as a real authenticator app against a real secret,
 * instead of mocking the verify step -- this is the exact "does the
 * QR/manual-secret setup actually work end to end" regression this session
 * fixed (the QR code previously never rendered as a scannable image at all).
 */
function base32Decode(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = secret.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function currentTotpCode(secret: string, stepSeconds = 30, digits = 6): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}
