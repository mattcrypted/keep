// Keep — server-side session / identity proof.
//
// Before this, the server trusted whatever address the client claimed (sessionId
// in the body, `owner` on /api/mint), so anyone could read, inject, or MINT under
// another user's wallet address — addresses are public/on-chain, so this broke the
// whole "you own your memories" claim. Now: on email-OTP verify we issue a signed,
// HMAC-bound token in an httpOnly cookie; any route keyed by a WALLET ADDRESS
// requires that the cookie's address matches. Anonymous (random-UUID) sessions need
// no token — an unguessable UUID is itself the capability.
import 'dotenv/config';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'keep_session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Stable per-deployment HMAC key derived from a secret already in the env (no new
// env var to set, survives restarts so a live demo stays signed in). Falls back to
// a constant only when nothing is configured (login is disabled in that case).
const KEY = createHash('sha256')
  .update('keep-session/v1|' + (process.env.PRIVY_APP_SECRET || process.env.OG_KEY || 'keep-dev-secret'))
  .digest();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => b64u(createHmac('sha256', KEY).update(data).digest());

export function issueToken(address, now = Date.now()) {
  const payload = b64u(JSON.stringify({ a: String(address).toLowerCase(), e: now + TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const expected = sign(payload);
  if (!mac || mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null; // constant-time
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.a !== 'string' || typeof data.e !== 'number') return null;
  if (now > data.e) return null; // expired
  return { address: data.a };
}

// `Secure` is added under HTTPS (Railway / production) and omitted on localhost
// http, where browsers would otherwise drop the cookie and break login. The app is
// single-origin (static UI + API on one host), so SameSite=Lax is correct — only
// switch to SameSite=None (with Secure) if the frontend ever moves cross-origin.
const SECURE = process.env.KEEP_HTTPS === '1' || process.env.NODE_ENV === 'production';
const COOKIE_ATTRS = `HttpOnly; SameSite=Lax; Path=/${SECURE ? '; Secure' : ''}`;

export function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; ${COOKIE_ATTRS}; Max-Age=${Math.floor(TTL_MS / 1000)}`
  );
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`);
}

// The authenticated wallet address for this request (lowercased), or null.
export function sessionAddress(req) {
  const raw = req.headers.cookie || '';
  const part = raw
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + '='));
  if (!part) return null;
  const v = verifyToken(part.slice(COOKIE.length + 1));
  return v ? v.address : null;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
export function isWalletId(sessionId) {
  return typeof sessionId === 'string' && ADDR_RE.test(sessionId);
}

// Guard: a wallet-address-keyed session may only be used by the matching
// authenticated address. Anonymous (non-address) ids pass through untouched.
// Returns true if allowed; otherwise writes a 401 and returns false.
export function gateSession(req, res, sessionId) {
  if (!isWalletId(sessionId)) return true; // anon UUID — the id itself is the secret
  const addr = sessionAddress(req);
  if (addr && addr === sessionId.toLowerCase()) return true;
  res.status(401).json({ error: 'sign in to use this identity' });
  return false;
}
