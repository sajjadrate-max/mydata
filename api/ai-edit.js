// Lumio AI photo edit: the photo + an instruction go to Grok (xAI image edits) and the
// edited photo comes back. Runs on Vercel so the xAI key never reaches the phone.
//
// Vercel -> Project -> Settings -> Environment Variables:
//   XAI_API_KEY        (required) key from console.x.ai
//   FIREBASE_API_KEY   (required for sign-in check) the apiKey from social-config.js
//   AI_DAILY_LIMIT     (optional) edits per person per day, default 20
//   XAI_IMAGE_MODEL    (optional) default "grok-imagine-image"
//   AI_OPEN=1          (optional, testing only) allow use without signing in
//
// POST /api/ai-edit  { image: "data:image/jpeg;base64,...", prompt: "...", idToken: "<Firebase ID token>" }
//   -> { image: "data:image/...;base64,..." }  or  { error: "setup" | "auth" | "limit" | "bad" | "ai", detail? }

const XAI = 'https://api.x.ai/v1/images/edits';
const used = new Map();   // uid -> { day, n }  (per server instance; a soft limit)

async function whoIs(idToken) {
  const key = process.env.FIREBASE_API_KEY;
  if (!key) return process.env.AI_OPEN === '1' ? 'open' : null;
  if (!idToken) return null;
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.users && j.users[0] && j.users[0].localId || null;
}

function allowed(uid) {
  const max = parseInt(process.env.AI_DAILY_LIMIT || '20', 10), day = new Date().toISOString().slice(0, 10);
  const u = used.get(uid);
  if (!u || u.day !== day) { used.set(uid, { day, n: 1 }); return true; }
  if (u.n >= max) return false;
  u.n++; return true;
}

async function toDataUrl(item) {
  if (item.b64_json) return 'data:image/jpeg;base64,' + item.b64_json;
  if (item.url && item.url.startsWith('data:')) return item.url;
  if (item.url) {   // fetch here so the phone doesn't hit a cross-site image
    const r = await fetch(item.url); if (!r.ok) throw new Error('fetch result ' + r.status);
    const type = r.headers.get('content-type') || 'image/jpeg';
    return 'data:' + type + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  throw new Error('no image in answer');
}

async function editWithGrok(image, prompt) {
  const model = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image';
  // xAI takes JSON; the image is sent as a data URL. Two accepted spellings are tried in turn.
  const bodies = [
    { model, prompt, image: { url: image }, n: 1, response_format: 'b64_json' },
    { model, prompt, image, n: 1, response_format: 'b64_json' },
    { model, prompt, image: { url: image }, n: 1 }
  ];
  let last = '';
  for (const b of bodies) {
    const r = await fetch(XAI, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.XAI_API_KEY }, body: JSON.stringify(b) });
    const text = await r.text();
    if (r.ok) {
      const j = JSON.parse(text), item = j.data && j.data[0];
      if (!item) throw new Error('empty answer');
      return toDataUrl(item);
    }
    last = r.status + ' ' + text.slice(0, 300);
    if (r.status !== 400 && r.status !== 422) break;   // only a malformed request is worth another spelling
  }
  throw new Error(last);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!process.env.XAI_API_KEY) { res.status(503).json({ error: 'setup' }); return; }
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const image = String(body.image || ''), prompt = String(body.prompt || '').trim().slice(0, 1000);
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 4e6 || !prompt) { res.status(400).json({ error: 'bad' }); return; }
  try {
    const uid = await whoIs(body.idToken);
    if (!uid) { res.status(401).json({ error: 'auth' }); return; }
    if (!allowed(uid)) { res.status(429).json({ error: 'limit' }); return; }
    res.status(200).json({ image: await editWithGrok(image, prompt) });
  } catch (e) {
    console.error('ai-edit', e);
    res.status(502).json({ error: 'ai', detail: String(e && e.message || e).slice(0, 200) });
  }
};
