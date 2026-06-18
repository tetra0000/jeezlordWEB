// Password hashing using Node's built-in scrypt (no bcrypt dependency).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = scryptSync(password, salt, KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(derived, stored);
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}
