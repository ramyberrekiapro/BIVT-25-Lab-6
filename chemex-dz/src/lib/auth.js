// Admin authentication: one shared admin password (Cloudflare secret ADMIN_PASSWORD)
// and a stateless HMAC-signed session cookie (secret SESSION_SECRET).
// Changing either secret invalidates every existing session.

import { HttpError } from './http.js';

const COOKIE = 'cdz_admin';
const SESSION_TTL = 60 * 60 * 12; // 12 hours
const MAX_FAILS = 8;
const FAIL_WINDOW = 15 * 60; // seconds

const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function secrets(env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    throw new HttpError(500, 'Admin is not configured: set ADMIN_PASSWORD and SESSION_SECRET');
  }
  return env;
}

async function hmac(keyMaterial, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(keyMaterial), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

function timingSafeEqual(a, b) {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function sign(env, payload) {
  const { SESSION_SECRET, ADMIN_PASSWORD } = secrets(env);
  return b64url(await hmac(`${SESSION_SECRET}\0${ADMIN_PASSWORD}`, payload));
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function cookieHeader(value, maxAge, secure) {
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export async function isAuthenticated(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await sign(env, `session:${exp}`);
  return timingSafeEqual(enc.encode(sig), enc.encode(expected));
}

export async function login(request, env, password) {
  const { ADMIN_PASSWORD, SESSION_SECRET } = secrets(env);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const now = Math.floor(Date.now() / 1000);
  const db = env.DB;

  await db.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(now - FAIL_WINDOW).run();
  const { n } = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts >= ?')
    .bind(ip, now - FAIL_WINDOW).first();
  if (n >= MAX_FAILS) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');

  // Compare HMAC digests so the comparison time does not depend on the password.
  const [a, b] = await Promise.all([
    hmac(SESSION_SECRET, `pw:${password}`),
    hmac(SESSION_SECRET, `pw:${ADMIN_PASSWORD}`),
  ]);
  if (!timingSafeEqual(a, b)) {
    await db.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, now).run();
    throw new HttpError(401, 'Incorrect password');
  }

  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  const exp = now + SESSION_TTL;
  const token = `${exp}.${await sign(env, `session:${exp}`)}`;
  return cookieHeader(token, SESSION_TTL, new URL(request.url).protocol === 'https:');
}

export function logoutCookie(request) {
  return cookieHeader('', 0, new URL(request.url).protocol === 'https:');
}
