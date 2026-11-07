// "میرا ڈیٹا" — personal cloud storage backend for this site (index.html).
//
// Files live in Vercel Blob storage (not on the phone). Everything is guarded by one
// password. The owner creates it on the page the first time; only a salted scrypt hash is
// kept (in Blob, under mera-data-config/). Setting DRIVE_PASSWORD in Vercel overrides it.
//
// Setup (once, in the Vercel dashboard of this project):
//   Storage -> Create -> Blob -> connect it to this project (adds BLOB_READ_WRITE_TOKEN),
//   then Redeploy. Open the page and create the password.
//
// Forgot the password? Delete the mera-data-config/ folder in the Blob store's file
// browser on Vercel; the page then asks for a new one. Files are not touched.
//
// Sign in with Google (optional): once logged in, the owner pastes a Google OAuth Client ID
// on the page and signs in with Google once; that Gmail address becomes the only Google
// account allowed in. The password keeps working as a backup.
//
// After any login the server hands out a session token (valid 30 days, signed with HMAC);
// the page keeps that instead of the password. Changing the password ends all sessions.
//
// All requests send the password in the "x-drive-key" header, except the upload-token
// request made by @vercel/blob/client, which carries it in clientPayload.
//
// GET  /api/drive?path=a/b/            -> { folders:[{name,path}], files:[{name,path,url,size,uploadedAt}] }
// POST /api/drive {action:"mkdir", path:"a/b/"}         -> creates a folder
// POST /api/drive {action:"delete", path:"a/x.pdf"}     -> deletes a file
// POST /api/drive {action:"delete", path:"a/b/"}        -> deletes a folder with everything inside
// POST /api/drive {action:"check"}                      -> verifies the password
// POST /api/drive {action:"setpass", password}          -> first-time password (only while none exists)
// POST /api/drive {action:"changepass", password}       -> new password (needs the current one)
// POST /api/drive {action:"google", credential}         -> Google sign-in, returns a session
// POST /api/drive {action:"linkgoogle", clientId, credential} / {action:"unlinkgoogle"}
// Unauthenticated answers say {error:"auth", google:"<client id>"} so the page can show the button.
// POST /api/drive {type:"blob.generate-client-token"..} -> handled by handleUpload (browser uploads
//                                                          straight to Blob, so any size works)

import { timingSafeEqual, scryptSync, randomBytes, createHmac, createHash } from 'node:crypto';
import { list, del, put, createFolder } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';

export const config = { maxDuration: 60 };

const ROOT = 'mera-data/';
const CONFIG = 'mera-data-config/auth';

function sameText(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ---- password ----
let authCache = null;                                   // survives while the function stays warm
async function getAuth() {
  if (process.env.DRIVE_PASSWORD) return { plain: process.env.DRIVE_PASSWORD };
  if (authCache) return authCache;
  const r = await list({ prefix: CONFIG, limit: 100 });
  const newest = r.blobs.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0];
  if (!newest) return null;
  const res = await fetch(newest.url + '?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('config');
  authCache = await res.json();
  return authCache;
}
function verify(pw, auth) {
  if (!auth || !pw) return false;
  if (auth.plain) return sameText(pw, auth.plain);
  const hash = scryptSync(String(pw), Buffer.from(auth.salt, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(auth.hash, 'hex'));
}
async function saveConfig(auth) {
  const old = (await list({ prefix: CONFIG, limit: 100 })).blobs.map(b => b.url);
  await put(CONFIG + '.json', JSON.stringify(auth), { access: 'public', addRandomSuffix: true, contentType: 'application/json', cacheControlMaxAge: 60 });
  if (old.length) await del(old);
  authCache = auth;
}
async function savePassword(pw, current) {
  if (String(pw || '').length < 4) throw new Error('short');
  const salt = randomBytes(16);
  await saveConfig({ ...(current || {}), salt: salt.toString('hex'), hash: scryptSync(String(pw), salt, 32).toString('hex') });
}

// ---- sessions: "s1.<expiry ms>.<hmac>" ----
const SESSION_MS = 30 * 24 * 3600 * 1000;
const secret = auth => createHash('sha256').update(process.env.BLOB_READ_WRITE_TOKEN + ':' + (auth.hash || auth.plain)).digest();
const sign = (auth, exp) => createHmac('sha256', secret(auth)).update('s1.' + exp).digest('hex');
function newSession(auth) { const exp = Date.now() + SESSION_MS; return 's1.' + exp + '.' + sign(auth, exp); }
function checkSession(tok, auth) {
  const m = /^s1\.(\d{10,16})\.([0-9a-f]{64})$/.exec(String(tok || ''));
  return !!m && Number(m[1]) > Date.now() && sameText(m[2], sign(auth, m[1]));
}
const allowed = (key, auth) => checkSession(key, auth) || verify(key, auth);

// ---- Google sign-in: verify the ID token with Google ----
async function googleEmail(credential, clientId) {
  if (!credential || !clientId) throw new Error('google');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.aud !== clientId || !/^(https:\/\/)?accounts\.google\.com$/.test(t.iss || '') ||
      !(t.email_verified === true || t.email_verified === 'true') || !t.email) throw new Error('google');
  return String(t.email).toLowerCase();
}

// Turns a user path into a safe relative path ("" for the root). Folders end with "/".
function clean(p, folder) {
  const parts = String(p || '').split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..');
  if (parts.some(s => s.length > 120 || /[\\\u0000-\u001f]/.test(s))) throw new Error('bad.path');
  const out = parts.join('/');
  return folder && out ? out + '/' : out;
}

async function listFolder(rel) {
  const prefix = ROOT + rel;
  const folders = [], files = [];
  let cursor;
  do {
    const r = await list({ prefix, mode: 'folded', cursor, limit: 1000 });
    for (const f of r.folders || []) {
      const path = f.slice(ROOT.length);
      folders.push({ name: path.slice(rel.length).replace(/\/$/, ''), path });
    }
    for (const b of r.blobs) {
      if (b.pathname.endsWith('/')) continue;          // the folder marker itself
      const path = b.pathname.slice(ROOT.length);
      files.push({ name: path.slice(rel.length), path, url: b.url, size: b.size, uploadedAt: b.uploadedAt });
    }
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  return { path: rel, folders, files };
}

async function remove(rel) {
  if (!rel) throw new Error('bad.path');                // never wipe the whole drive at once
  if (!rel.endsWith('/')) {
    const r = await list({ prefix: ROOT + rel, limit: 10 });
    const hit = r.blobs.filter(b => b.pathname === ROOT + rel).map(b => b.url);
    if (hit.length) await del(hit);
    return;
  }
  let cursor;
  do {
    const r = await list({ prefix: ROOT + rel, cursor, limit: 1000 });
    const urls = r.blobs.map(b => b.url);
    if (urls.length) await del(urls);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-drive-key');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!process.env.BLOB_READ_WRITE_TOKEN) { res.status(503).json({ error: 'setup', missing: ['BLOB_READ_WRITE_TOKEN'] }); return; }
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  try {
    const auth = await getAuth();
    if (!auth) {                                         // first visit: the owner picks a password
      if (req.method === 'POST' && body.action === 'setpass') {
        await savePassword(body.password);
        res.status(200).json({ ok: true, session: newSession(authCache) });
      } else res.status(409).json({ error: 'newpass' });
      return;
    }

    // Upload token for the browser (and Vercel's upload-completed callback).
    if (req.method === 'POST' && typeof body.type === 'string' && body.type.startsWith('blob.')) {
      const out = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          if (!allowed(clientPayload, auth)) throw new Error('auth');
          if (!pathname.startsWith(ROOT) || clean(pathname.slice(ROOT.length)) !== pathname.slice(ROOT.length)) throw new Error('bad.path');
          return { addRandomSuffix: true, maximumSizeInBytes: 5 * 1024 * 1024 * 1024 };
        }
      });
      res.status(200).json(out);
      return;
    }

    if (req.method === 'POST' && body.action === 'google') {
      const g = auth.google;
      if (!g) { res.status(409).json({ error: 'nogoogle' }); return; }
      if (await googleEmail(body.credential, g.clientId) !== g.email) { res.status(403).json({ error: 'google.other' }); return; }
      res.status(200).json({ ok: true, session: newSession(auth) });
      return;
    }

    if (!allowed(req.headers['x-drive-key'], auth)) {
      res.status(401).json({ error: 'auth', google: auth.google ? auth.google.clientId : undefined });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json(await listFolder(clean(req.query && req.query.path, true)));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

    if (body.action === 'check' || body.action === 'setpass') {
      res.status(200).json({ ok: true, session: newSession(auth), google: auth.google ? auth.google.email : null });
      return;
    }
    if (body.action === 'changepass') {
      if (auth.plain) { res.status(409).json({ error: 'envpass' }); return; }
      await savePassword(body.password, auth);
      res.status(200).json({ ok: true, session: newSession(authCache) });
      return;
    }
    if (body.action === 'linkgoogle') {
      if (auth.plain) { res.status(409).json({ error: 'envpass' }); return; }
      const clientId = String(body.clientId || '').trim();
      if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('google');
      const email = await googleEmail(body.credential, clientId);
      await saveConfig({ ...auth, google: { clientId, email } });
      res.status(200).json({ ok: true, email });
      return;
    }
    if (body.action === 'unlinkgoogle') {
      if (auth.plain) { res.status(409).json({ error: 'envpass' }); return; }
      const { google, ...rest } = auth;
      await saveConfig(rest);
      res.status(200).json({ ok: true });
      return;
    }
    if (body.action === 'mkdir') {
      const rel = clean(body.path, true);
      if (!rel) throw new Error('bad.path');
      await createFolder(ROOT + rel, { access: 'public' });
      res.status(200).json({ ok: true, path: rel });
      return;
    }
    if (body.action === 'delete') {
      const raw = String(body.path || '');
      await remove(clean(raw, raw.endsWith('/')));
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: 'action' });
  } catch (e) {
    const code = String(e && e.message || e);
    if (code === 'auth') { res.status(401).json({ error: 'auth' }); return; }
    if (code === 'google') { res.status(400).json({ error: 'google' }); return; }
    if (code === 'short') { res.status(400).json({ error: 'short' }); return; }
    if (code === 'bad.path') { res.status(400).json({ error: 'bad.path' }); return; }
    console.error('drive error', e);
    res.status(502).json({ error: 'server', detail: code.slice(0, 120) });
  }
}
