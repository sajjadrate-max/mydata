// Lamha social: Gmail login, profile, search, friends, notifications, chat with snaps, stories.
// Firebase (Auth + Firestore). Built into lib/social.js:
//   npx esbuild src/social.src.js --bundle --format=esm --minify --outfile=lib/social.js
// Config: social-config.js (window.LAMHA_FIREBASE). Add ?emu to the address to use local emulators.
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, connectAuthEmulator, signInWithCredential, deleteUser } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, runTransaction, getDocs, documentId, Timestamp
} from 'firebase/firestore';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const H = window.LamhaHost;                    // toast, busy, showCamera, cameraFor(name)
const EMU = new URLSearchParams(location.search).has('emu');
const cfg = EMU ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-lamha', appId: 'demo' } : (window.LAMHA_FIREBASE || {});
const configured = !!cfg.apiKey;
const pairId = (a, b) => a < b ? a + '_' + b : b + '_' + a;
const DAY = 24 * 3600 * 1000;
const AVATARS = ['assets/avatars/a1.jpg', 'assets/avatars/a2.jpg'];   // cartoon avatars to choose from

let app, auth, db, me = null, prof = null;
let friendships = new Map();   // otherUid -> friendship doc
let chats = new Map();         // pairId -> chat doc
let people = new Map();        // uid -> profile
let stories = new Map();       // uid -> [story]
const unsubs = [];

if (configured) {
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = EMU ? initializeFirestore(app, {}) : initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (EMU) { connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true }); connectFirestoreEmulator(db, 'localhost', 8080); }
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, onUser);
}

// ---------------- styles + root ----------------
const css = `
#soc{position:fixed;inset:0;z-index:40;background:#0d0d12;color:#fff;display:flex;flex-direction:column;font-family:var(--body)}
#soc[hidden]{display:none!important}
.sh{display:flex;align-items:center;gap:10px;padding:calc(12px + var(--safe-t)) 14px 10px;border-bottom:1px solid #22222c}
.sh h2{margin:0;font-size:1.15rem;flex:1}
.sb{flex:1;overflow:auto;padding:12px 14px calc(20px + var(--safe-b))}
.sbtn{width:40px;height:40px;border-radius:50%;background:#1d1d27;display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex:none}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#06B6D4);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;overflow:hidden;flex:none;position:relative}
.av img{width:100%;height:100%;object-fit:cover}
.av.ring{box-shadow:0 0 0 2px #0d0d12,0 0 0 4px #A78BFA}
.av.avbig{width:96px;height:96px;font-size:2.4rem}
.li{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid #1b1b24;min-width:0}
.li .tx{flex:1;display:flex;flex-direction:column;min-width:0;text-align:right}
.li .tx b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.li .tx small{color:#9aa0b4;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb{height:38px;border-radius:999px;padding:0 16px;font-weight:700;background:#272734;font-size:.88rem;white-space:nowrap;flex:none}
.pb.go{background:linear-gradient(90deg,#7C3AED,#06B6D4)}
.pb.red{background:#7f1d1d}
.inp{width:100%;height:46px;border-radius:14px;border:1px solid #2a2a36;background:#16161e;color:#fff;padding:0 14px;font:inherit;outline:0}
.inp:focus{border-color:#7C3AED}
.sec2{color:#9aa0b4;font-size:.82rem;font-weight:700;margin:16px 2px 4px}
.empty2{color:#9aa0b4;text-align:center;padding:40px 10px;line-height:2}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:6px;vertical-align:middle}
.msgs{flex:1;overflow:auto;padding:12px 12px 8px;display:flex;flex-direction:column;gap:6px}
.m{max-width:78%;padding:8px 12px;border-radius:16px;line-height:1.6;word-wrap:break-word;white-space:pre-wrap}
.m.me{align-self:flex-start;background:#4c1d95;border-bottom-left-radius:4px}
.m.them{align-self:flex-end;background:#1f2937;border-bottom-right-radius:4px}
.m small{display:block;font-size:.65rem;opacity:.6;margin-top:2px}
.snap{display:flex;align-items:center;gap:8px;font-weight:700}
.compose{display:flex;gap:8px;padding:8px 10px calc(10px + var(--safe-b));border-top:1px solid #22222c;align-items:center}
.compose .inp{border-radius:999px}
.srow{display:flex;gap:14px;overflow-x:auto;padding:6px 2px 10px;scrollbar-width:none}
.srow::-webkit-scrollbar{display:none}
.sitem{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.75rem;width:70px;flex:none}
.sitem .av{width:62px;height:62px}
.sv{position:fixed;inset:0;z-index:60;background:#000;display:flex;align-items:center;justify-content:center}
.sv img{max-width:100%;max-height:100%;object-fit:contain}
.sv .bars{position:absolute;top:calc(8px + var(--safe-t));left:8px;right:8px;display:flex;gap:4px;direction:ltr}
.sv .bars i{flex:1;height:3px;background:rgba(255,255,255,.35);border-radius:2px;overflow:hidden}
.sv .bars i b{display:block;height:100%;background:#fff;width:0}
.sv .who{position:absolute;top:calc(20px + var(--safe-t));right:12px;display:flex;align-items:center;gap:8px;font-weight:700;text-shadow:0 1px 4px #000}
.sv .who .av{width:36px;height:36px;font-size:.9rem}
.sv .x{position:absolute;top:calc(18px + var(--safe-t));left:12px}
.badge{position:absolute;top:-4px;left:-4px;min-width:18px;height:18px;border-radius:9px;background:#EF4444;color:#fff;font-size:.68rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px}
.chk{width:24px;height:24px;border-radius:50%;border:2px solid #555;flex:none;display:flex;align-items:center;justify-content:center;font-size:.8rem}
.chk.on{background:#7C3AED;border-color:#7C3AED}
.sendbar{padding:10px 14px calc(14px + var(--safe-b));border-top:1px solid #22222c;display:flex;gap:10px;align-items:center}
`;
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
const root = document.createElement('div'); root.id = 'soc'; root.hidden = true; document.body.appendChild(root);

// ---------------- helpers ----------------
const initials = p => esc(((p && (p.name || p.username)) || '؟').trim().slice(0, 1).toUpperCase());
const avatar = (p, cls = '') => '<span class="av ' + cls + '">' + (p && p.photo ? '<img src="' + esc(p.photo) + '" alt="" referrerpolicy="no-referrer">' : initials(p)) + '</span>';
const ms = t => t && t.toMillis ? t.toMillis() : (t || 0);
function ago(t) {
  const d = (Date.now() - ms(t)) / 1000;
  if (!ms(t)) return '';
  if (d < 60) return 'ابھی'; if (d < 3600) return Math.floor(d / 60) + ' منٹ پہلے';
  if (d < 86400) return Math.floor(d / 3600) + ' گھنٹے پہلے'; return Math.floor(d / 86400) + ' دن پہلے';
}
async function person(uid) {
  if (people.has(uid)) return people.get(uid);
  const s = await getDoc(doc(db, 'users', uid)).catch(() => null);
  const p = s && s.exists() ? { uid, ...s.data() } : { uid, name: '؟', username: '' };
  people.set(uid, p); return p;
}
function friendIds() { return [...friendships.values()].filter(f => f.status === 'accepted').map(f => f.other); }
function errMsg(e) { console.warn(e); return (e && e.code === 'permission-denied') ? 'اجازت نہیں ملی' : 'کچھ غلط ہو گیا، دوبارہ کوشش کریں'; }

// ---------------- screens / back button ----------------
let screen = null, screenArg = null, subScreen = null;
function open(name, arg, replace) {
  screen = name; screenArg = arg; root.hidden = false; document.body.classList.add('soc-open');
  if (!replace) history.pushState({ soc: name }, '');
  render();
}
function close() { screen = null; root.hidden = true; root.innerHTML = ''; stopChat(); document.body.classList.remove('soc-open'); H.showCamera(); }
const leave = () => history.back();            // closing goes through the back button history
let alsoPage = false;
// called by the page's back-button handler first; true = handled
function onBack() {
  if ($('sview')) { $('sview').remove(); clearTimeout(svT); return true; }
  if (!screen) return false;
  if (alsoPage) { alsoPage = false; close(); return false; }   // after sending: the page closes its editor too
  const back = { chat: 'chats', person: null }[screen];
  if (back) { stopChat(); open(back, null, true); return true; }
  close(); return true;
}

// ---------------- auth ----------------
async function login() {
  if (!configured) { open('setup'); return; }
  const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, prov); }
  catch (e) {
    if (e && /popup-blocked|operation-not-supported|popup-closed/.test(e.code || '')) { if (e.code !== 'auth/popup-closed-by-user') await signInWithRedirect(auth, prov); }
    else H.toast(errMsg(e));
  }
}
if (EMU) window.__emuLogin = (sub, email, name) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name })));

async function onUser(u) {
  unsubs.splice(0).forEach(f => f());
  storySubs.forEach(off => off()); storySubs.clear();
  friendships.clear(); chats.clear(); stories.clear();
  me = u; prof = null;
  if (u) {
    const s = await getDoc(doc(db, 'users', u.uid)).catch(() => null);
    if (s && s.exists()) prof = { uid: u.uid, ...s.data() };
    if (!prof) { open('username', null, !!screen); }
    else { people.set(u.uid, prof); subscribe(); if (screen === 'login') open(pendingScreen || 'chats', null, true); }
  }
  updateBadges();
  if (screen && screen !== 'username') render();
}
let pendingScreen = null;
function need(name, arg) {                       // open a screen that needs login
  if (!configured) { open('setup'); return; }
  if (!me) { pendingScreen = name; open('login'); return; }
  if (!prof) { open('username'); return; }
  open(name, arg);
}

// ---------------- live data ----------------
function subscribe() {
  unsubs.push(onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', me.uid)), snap => {
    friendships.clear();
    snap.forEach(d => { const f = d.data(), other = f.members.find(x => x !== me.uid); friendships.set(other, { id: d.id, other, ...f }); });
    Promise.all([...friendships.keys()].map(person)).then(() => { updateBadges(); refresh(); loadStories(); });
  }, e => console.warn(e)));
  unsubs.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me.uid)), snap => {
    chats.clear(); snap.forEach(d => chats.set(d.id, { id: d.id, ...d.data() }));
    updateBadges(); refresh();
  }, e => console.warn(e)));
  cleanOldStories();
}
function refresh() { if (screen && ['chats', 'friends', 'notifs', 'stories', 'search', 'profile', 'send'].includes(screen)) render(); }
// One live listener per person (me + each friend), so new stories show up right away.
const storySubs = new Map();
function loadStories() {
  const ids = new Set([me.uid, ...friendIds()]);
  for (const [uid, off] of storySubs) if (!ids.has(uid)) { off(); storySubs.delete(uid); stories.delete(uid); }
  for (const uid of ids) {
    if (storySubs.has(uid)) continue;
    storySubs.set(uid, onSnapshot(query(collection(db, 'stories'), where('uid', '==', uid)), snap => {
      const now = Date.now(), list = [];
      snap.forEach(d => { const s = { id: d.id, ...d.data() }; if (ms(s.expiresAt) > now) list.push(s); });
      list.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
      if (list.length) stories.set(uid, list); else stories.delete(uid);
      updateBadges(); refresh();
    }, () => { storySubs.delete(uid); setTimeout(() => { if (me) loadStories(); }, 3000); }));   // e.g. friendship not saved yet: try again
  }
}
async function cleanOldStories() {   // stories older than 24 h are removed by their owner
  const r = await getDocs(query(collection(db, 'stories'), where('uid', '==', me.uid))).catch(() => null);
  if (r) r.forEach(d => { if (ms(d.data().expiresAt) < Date.now()) deleteDoc(d.ref).catch(() => {}); });
}
const unreadChats = () => [...chats.values()].filter(c => c.lastFrom && c.lastFrom !== me.uid && ms(c.lastAt) > ms(c.read && c.read[me.uid]));
const pendingIn = () => [...friendships.values()].filter(f => f.status === 'pending' && f.to === me.uid);
const seenStories = () => JSON.parse(localStorage.getItem('lamha.seenStories') || '{}');
function updateBadges() {
  const set = (id, n) => { const b = $(id); if (b) { b.textContent = n > 9 ? '9+' : n; b.hidden = !n; } };
  if (!me || !prof) { set('bReq', 0); set('bChat', 0); set('bBell', 0); set('bStory', 0); }
  else {
    const seen = seenStories(), newStories = [...stories.entries()].filter(([u, l]) => u !== me.uid && ms(l[l.length - 1].createdAt) > (seen[u] || 0)).length;
    set('bReq', pendingIn().length); set('bChat', unreadChats().length); set('bBell', pendingIn().length + unreadChats().length); set('bStory', newStories);
  }
  const a = $('meAvatar'); if (a) a.innerHTML = prof && prof.photo ? '<img src="' + esc(prof.photo) + '" alt="" referrerpolicy="no-referrer">' : (prof ? initials(prof) : '👤');
}

// ---------------- actions ----------------
async function claimUsername(name, display) {
  const u = name.toLowerCase().trim();
  if (!/^[a-z0-9_.]{3,20}$/.test(u)) throw new Error('یوزرنیم 3 سے 20 حروف: انگریزی چھوٹے حروف، نمبر، _ یا . ');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'usernames', u), s = await tx.get(ref);
    if (s.exists() && s.data().uid !== me.uid) throw new Error('یہ یوزرنیم کسی اور کا ہے، کوئی اور چنیں');
    tx.set(ref, { uid: me.uid });
    tx.set(doc(db, 'users', me.uid), { name: display.trim().slice(0, 40) || u, username: u, photo: me.photoURL || '', createdAt: serverTimestamp() });
  });
  prof = { uid: me.uid, name: display.trim().slice(0, 40) || u, username: u, photo: me.photoURL || '' };
  people.set(me.uid, prof); subscribe(); updateBadges();
}
async function addFriend(uid) {
  const f = friendships.get(uid);
  if (f && f.status === 'pending' && f.to === me.uid) return acceptFriend(uid);
  if (f) return;
  await setDoc(doc(db, 'friendships', pairId(me.uid, uid)), { members: [me.uid, uid].sort(), from: me.uid, to: uid, status: 'pending', createdAt: serverTimestamp() });
  H.toast('✓ دوستی کی درخواست بھیج دی');
}
async function acceptFriend(uid) { await updateDoc(doc(db, 'friendships', pairId(me.uid, uid)), { status: 'accepted', since: serverTimestamp() }); H.toast('✓ اب آپ دوست ہیں'); }
async function removeFriend(uid) { await deleteDoc(doc(db, 'friendships', pairId(me.uid, uid))); }
async function blockUser(uid) { await setDoc(doc(db, 'friendships', pairId(me.uid, uid)), { members: [me.uid, uid].sort(), from: me.uid, to: uid, status: 'blocked', blockedBy: me.uid }); }
async function report(uid, why) { await addDoc(collection(db, 'reports'), { by: me.uid, user: uid, why: String(why || '').slice(0, 300), at: serverTimestamp() }); H.toast('✓ رپورٹ بھیج دی گئی'); }

async function ensureChat(uid) {
  const id = pairId(me.uid, uid), members = [me.uid, uid].sort();
  if (!chats.has(id)) await setDoc(doc(db, 'chats', id), { members, lastAt: serverTimestamp(), lastFrom: '', lastType: '', read: {} }, { merge: true });
  return id;
}
async function sendText(uid, text) {
  const id = await ensureChat(uid);
  await addDoc(collection(db, 'chats', id, 'messages'), { from: me.uid, type: 'text', text: text.slice(0, 2000), createdAt: serverTimestamp(), opened: false });
  await updateDoc(doc(db, 'chats', id), { members: [me.uid, uid].sort(), lastAt: serverTimestamp(), lastFrom: me.uid, lastType: 'text' });
}
async function sendSnap(uid, img) {
  const id = await ensureChat(uid);
  await addDoc(collection(db, 'chats', id, 'messages'), { from: me.uid, type: 'snap', img, createdAt: serverTimestamp(), opened: false });
  await updateDoc(doc(db, 'chats', id), { members: [me.uid, uid].sort(), lastAt: serverTimestamp(), lastFrom: me.uid, lastType: 'snap' });
}
async function markRead(id) { const c = chats.get(id); if (!c) return; await updateDoc(doc(db, 'chats', id), { members: c.members, ['read.' + me.uid]: serverTimestamp() }).catch(() => {}); }
async function postStory(img) {
  await addDoc(collection(db, 'stories'), { uid: me.uid, img, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
  loadStories();
}
// photo -> small JPEG data URL (Firestore documents hold up to 1 MB)
async function toDataUrl(blob) {
  const bmp = await createImageBitmap(blob);
  let k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)), q = .78, url = '';
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL('image/jpeg', q);
    if (url.length < 900000) break;
    q -= .12; k *= .85;
  }
  return url;
}

// ---------------- rendering ----------------
function header(title, extra = '') { return '<div class="sh"><button class="sbtn" data-act="back" aria-label="واپس">→</button><h2>' + title + '</h2>' + extra + '</div>'; }
function friendButton(uid) {
  const f = friendships.get(uid);
  if (uid === me.uid) return '<span class="pb">آپ</span>';
  if (!f) return '<button class="pb go" data-add="' + esc(uid) + '">➕ دوست بنائیں</button>';
  if (f.status === 'accepted') return '<button class="pb" data-chat="' + esc(uid) + '">💬 چیٹ</button>';
  if (f.status === 'pending' && f.to === me.uid) return '<button class="pb go" data-accept="' + esc(uid) + '">✓ قبول</button>';
  if (f.status === 'pending') return '<span class="pb">⏳ بھیجی گئی</span>';
  return '<span class="pb">🚫</span>';
}
function render() {
  if (!screen) return;
  const R = {
    setup: () => header('سیٹ اپ باقی ہے') + '<div class="sb"><div class="empty2">لاگ ان، چیٹ، دوست اور اسٹوریز کے لیے Firebase کا سیٹ اپ ابھی باقی ہے۔<br>یہ ایک بار کا کام ہے۔</div></div>',
    login: () => header('لاگ ان') + '<div class="sb" style="display:flex;flex-direction:column;align-items:center;gap:18px;padding-top:50px;text-align:center"><img src="icon-192.png" style="width:90px;height:90px;border-radius:24px" alt=""><h2 style="margin:0">لمحہ میں خوش آمدید</h2><p style="color:#9aa0b4;margin:0;line-height:1.9">دوست بنائیں، تصویریں بھیجیں، چیٹ کریں اور اپنی اسٹوری لگائیں۔</p><button class="pb go" data-act="login" style="height:50px;padding:0 28px;font-size:1rem">G&nbsp;&nbsp;Gmail سے لاگ ان کریں</button><small style="color:#6b7080;line-height:1.8">لاگ ان کر کے آپ <a href="privacy.html" style="color:#A78BFA">پرائیویسی پالیسی</a> سے متفق ہیں۔</small></div>',
    username: () => header('اپنا یوزرنیم چنیں') + '<div class="sb" style="display:flex;flex-direction:column;gap:12px"><p style="color:#9aa0b4;margin:0">دوست آپ کو اسی یوزرنیم سے تلاش کریں گے۔</p><label>نام<input class="inp" id="uName" maxlength="40" value="' + esc(me && me.displayName || '') + '"></label><label>یوزرنیم<input class="inp" id="uUser" dir="ltr" maxlength="20" autocapitalize="off" value="' + esc(suggestUser()) + '"></label><div id="uErr" style="color:#f87171"></div><button class="pb go" data-act="claim" style="height:48px">آگے</button></div>',
    profile: renderProfile, search: renderSearch, friends: renderFriends, notifs: renderNotifs, chats: renderChats, chat: renderChat, stories: renderStories, send: renderSend, person: renderPerson
  };
  root.innerHTML = (R[screen] || R.setup)();
  if (screen === 'chat') startChat(screenArg);
  if (screen === 'search') { const i = $('sq'); i.focus(); i.value = lastQ; i.oninput = () => doSearch(i.value); if (lastQ) doSearch(lastQ); }
}
function suggestUser() { const b = ((me && (me.email || '').split('@')[0]) || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 16); return b.length >= 3 ? b : b + '123'; }
function renderProfile() {
  const n = friendIds().length, mine = stories.get(me.uid) || [];
  return header('پروفائل') + '<div class="sb" style="text-align:center"><div style="display:flex;justify-content:center;margin:10px 0">' + avatar(prof, 'avbig' + (mine.length ? ' ring' : '')) + '</div>' +
    '<h2 style="margin:4px 0">' + esc(prof.name) + '</h2><div style="color:#9aa0b4" dir="ltr">@' + esc(prof.username) + '</div>' +
    '<div style="margin:16px 0;display:flex;gap:8px;justify-content:center"><button class="pb" data-go="friends">👥 ' + n + ' دوست</button><button class="pb" data-share-me>🔗 اپنا لنک بھیجیں</button></div>' +
    (mine.length ? '<button class="pb go" data-story="' + esc(me.uid) + '">⭕ میری اسٹوری دیکھیں (' + mine.length + ')</button>' : '<div style="color:#9aa0b4;font-size:.85rem">کیمرے سے تصویر بنا کر «بھیجیں» میں «میری اسٹوری» چنیں</div>') +
    '<div class="sec2" style="text-align:right">اکاؤنٹ</div><div style="display:flex;flex-direction:column;gap:8px">' +
    '<button class="pb" data-act="avatar">🖼️ اوتار بدلیں</button><button class="pb" data-act="rename">✏️ نام بدلیں</button><a class="pb" href="privacy.html" style="display:flex;align-items:center;justify-content:center;color:#fff;text-decoration:none">🔒 پرائیویسی پالیسی</a>' +
    '<button class="pb" data-act="logout">🚪 لاگ آؤٹ</button><button class="pb red" data-act="delete">🗑️ اکاؤنٹ ختم کریں</button></div></div>';
}
let lastQ = '', searchT = 0;
function renderSearch() { return header('تلاش', '') + '<div class="sb"><input class="inp" id="sq" dir="ltr" placeholder="یوزرنیم لکھیں…" autocapitalize="off" autocomplete="off"><div id="sres"></div></div>'; }
function doSearch(q) {
  lastQ = q; clearTimeout(searchT);
  q = q.toLowerCase().trim().replace(/^@/, '');
  if (q.length < 2) { $('sres').innerHTML = '<div class="empty2">کم از کم 2 حروف لکھیں</div>'; return; }
  searchT = setTimeout(async () => {
    const r = await getDocs(query(collection(db, 'usernames'), where(documentId(), '>=', q), where(documentId(), '<=', q + ''), limit(20))).catch(e => { H.toast(errMsg(e)); return null; });
    if (!r || lastQ.toLowerCase().trim().replace(/^@/, '') !== q || screen !== 'search') return;
    const list = await Promise.all(r.docs.map(d => person(d.data().uid)));
    $('sres').innerHTML = list.length ? list.map(p => '<div class="li">' + avatar(p) + '<button class="tx" data-person="' + esc(p.uid) + '"><b>' + esc(p.name) + '</b><small dir="ltr">@' + esc(p.username) + '</small></button>' + friendButton(p.uid) + '</div>').join('') : '<div class="empty2">کوئی نہیں ملا</div>';
  }, 250);
}
function renderPerson() {
  const p = people.get(screenArg) || { uid: screenArg, name: '…' }, f = friendships.get(p.uid);
  return header('') + '<div class="sb" style="text-align:center"><div style="display:flex;justify-content:center;margin:10px 0">' + avatar(p, 'avbig') + '</div><h2 style="margin:4px 0">' + esc(p.name) + '</h2><div style="color:#9aa0b4" dir="ltr">@' + esc(p.username) + '</div><div style="margin:18px 0">' + friendButton(p.uid) + '</div>' +
    (p.uid !== me.uid ? '<div style="display:flex;flex-direction:column;gap:8px;margin-top:30px">' + (f && f.status === 'accepted' ? '<button class="pb" data-unfriend="' + esc(p.uid) + '">دوستی ختم کریں</button>' : '') + '<button class="pb" data-block="' + esc(p.uid) + '">🚫 بلاک کریں</button><button class="pb red" data-report="' + esc(p.uid) + '">⚠️ رپورٹ کریں</button></div>' : '') + '</div>';
}
function renderFriends() {
  const inc = pendingIn(), out = [...friendships.values()].filter(f => f.status === 'pending' && f.from === me.uid), acc = friendIds();
  const row = (uid, btns) => { const p = people.get(uid) || { uid }; return '<div class="li">' + avatar(p) + '<button class="tx" data-person="' + esc(uid) + '"><b>' + esc(p.name) + '</b><small dir="ltr">@' + esc(p.username) + '</small></button>' + btns + '</div>'; };
  return header('دوست', '<button class="sbtn" data-go="search" aria-label="تلاش">🔍</button>') + '<div class="sb">' +
    '<button class="pb go" data-share-me style="width:100%;height:46px">🔗 اپنا لنک بھیج کر دوست بلائیں</button>' +
    (inc.length ? '<div class="sec2">درخواستیں (' + inc.length + ')</div>' + inc.map(f => row(f.other, '<button class="pb go" data-accept="' + esc(f.other) + '">✓ قبول</button><button class="pb" data-unfriend="' + esc(f.other) + '">✕</button>')).join('') : '') +
    '<div class="sec2">میرے دوست (' + acc.length + ')</div>' + (acc.length ? acc.map(uid => row(uid, '<button class="pb" data-chat="' + esc(uid) + '">💬</button>')).join('') : '<div class="empty2">ابھی کوئی دوست نہیں۔ 🔍 سے یوزرنیم تلاش کریں یا اپنا لنک بھیجیں۔</div>') +
    (out.length ? '<div class="sec2">بھیجی گئی درخواستیں</div>' + out.map(f => row(f.other, '<button class="pb" data-unfriend="' + esc(f.other) + '">منسوخ</button>')).join('') : '') + '</div>';
}
function renderNotifs() {
  const items = [];
  pendingIn().forEach(f => items.push({ t: ms(f.createdAt), h: '<div class="li">' + avatar(people.get(f.other)) + '<button class="tx" data-person="' + esc(f.other) + '"><b>' + esc((people.get(f.other) || {}).name) + '</b><small>دوستی کی درخواست · ' + ago(f.createdAt) + '</small></button><button class="pb go" data-accept="' + esc(f.other) + '">✓ قبول</button></div>' }));
  unreadChats().forEach(c => { const o = c.members.find(x => x !== me.uid); items.push({ t: ms(c.lastAt), h: '<div class="li">' + avatar(people.get(o)) + '<button class="tx" data-chat="' + esc(o) + '"><b>' + esc((people.get(o) || {}).name) + '</b><small>' + (c.lastType === 'snap' ? '<span class="dot" style="background:#EF4444"></span>نئی تصویر' : '<span class="dot" style="background:#3B82F6"></span>نیا پیغام') + ' · ' + ago(c.lastAt) + '</small></button></div>' }); });
  const seen = seenStories();
  stories.forEach((l, uid) => { if (uid !== me.uid && ms(l[l.length - 1].createdAt) > (seen[uid] || 0)) items.push({ t: ms(l[l.length - 1].createdAt), h: '<div class="li">' + avatar(people.get(uid), 'ring') + '<button class="tx" data-story="' + esc(uid) + '"><b>' + esc((people.get(uid) || {}).name) + '</b><small>نئی اسٹوری · ' + ago(l[l.length - 1].createdAt) + '</small></button></div>' }); });
  items.sort((a, b) => b.t - a.t);
  return header('اطلاعات') + '<div class="sb">' + (items.length ? items.map(i => i.h).join('') : '<div class="empty2">🔔 ابھی کوئی نئی اطلاع نہیں</div>') + '</div>';
}
function renderChats() {
  const list = friendIds().map(uid => ({ uid, c: chats.get(pairId(me.uid, uid)) })).sort((a, b) => ms(b.c && b.c.lastAt) - ms(a.c && a.c.lastAt));
  const status = c => {
    if (!c || !c.lastFrom) return '<small>چیٹ شروع کریں</small>';
    const mine = c.lastFrom === me.uid, snap = c.lastType === 'snap', unread = !mine && ms(c.lastAt) > ms(c.read && c.read[me.uid]);
    const color = snap ? '#EF4444' : '#3B82F6';
    const label = mine ? (ms(c.read && c.read[c.members.find(x => x !== me.uid)]) >= ms(c.lastAt) ? 'دیکھ لیا' : 'بھیج دیا') : (unread ? (snap ? 'نئی تصویر' : 'نیا پیغام') : (snap ? 'تصویر دیکھی' : 'پیغام پڑھا'));
    return '<small style="' + (unread ? 'color:#fff;font-weight:700' : '') + '"><span class="dot" style="background:' + (unread ? color : 'transparent') + ';border:2px solid ' + color + '"></span>' + label + ' · ' + ago(c.lastAt) + '</small>';
  };
  return header('چیٹ', '<button class="sbtn" data-go="friends" aria-label="دوست">👥</button>') + '<div class="sb">' +
    (list.length ? list.map(({ uid, c }) => { const p = people.get(uid) || { uid }; return '<div class="li">' + avatar(p, stories.has(uid) ? 'ring' : '') + '<button class="tx" data-chat="' + esc(uid) + '"><b>' + esc(p.name) + '</b>' + status(c) + '</button><button class="sbtn" data-snapto="' + esc(uid) + '" aria-label="تصویر بھیجیں">📷</button></div>'; }).join('')
      : '<div class="empty2">💬 ابھی کوئی دوست نہیں۔<br><button class="pb go" data-go="search" style="margin-top:12px">🔍 دوست تلاش کریں</button></div>') + '</div>';
}
function renderStories() {
  const mine = stories.get(me.uid), list = [...stories.keys()].filter(u => u !== me.uid).sort((a, b) => ms(stories.get(b).slice(-1)[0].createdAt) - ms(stories.get(a).slice(-1)[0].createdAt));
  const seen = seenStories();
  return header('اسٹوریز') + '<div class="sb"><div class="srow">' +
    '<button class="sitem" data-' + (mine ? 'story="' + esc(me.uid) + '"' : 'act="camera"') + '>' + avatar(prof, mine ? 'ring' : '') + '<span>' + (mine ? 'میری اسٹوری' : '➕ اسٹوری') + '</span></button>' +
    list.map(uid => { const p = people.get(uid) || {}, fresh = ms(stories.get(uid).slice(-1)[0].createdAt) > (seen[uid] || 0); return '<button class="sitem" data-story="' + esc(uid) + '">' + avatar(p, fresh ? 'ring' : '') + '<span>' + esc(p.name) + '</span></button>'; }).join('') + '</div>' +
    (list.length ? '' : '<div class="empty2">دوستوں کی اسٹوریز یہاں آئیں گی (24 گھنٹے کے لیے)۔</div>') + '</div>';
}
// ---- send a photo: pick friends and/or my story ----
let sendBlob = null, sendSel = new Set(), sendStory = false;
function renderSend() {
  const acc = friendIds();
  return header('کسے بھیجیں؟') + '<div class="sb">' +
    '<button class="li" data-mystory style="width:100%">' + avatar(prof) + '<span class="tx"><b>⭕ میری اسٹوری</b><small>سب دوست 24 گھنٹے دیکھ سکیں گے</small></span><span class="chk' + (sendStory ? ' on' : '') + '">' + (sendStory ? '✓' : '') + '</span></button>' +
    '<div class="sec2">دوست</div>' + (acc.length ? acc.map(uid => { const p = people.get(uid) || {}, on = sendSel.has(uid); return '<button class="li" data-pick="' + esc(uid) + '" style="width:100%">' + avatar(p) + '<span class="tx"><b>' + esc(p.name) + '</b><small dir="ltr">@' + esc(p.username) + '</small></span><span class="chk' + (on ? ' on' : '') + '">' + (on ? '✓' : '') + '</span></button>'; }).join('') : '<div class="empty2">ابھی کوئی دوست نہیں</div>') +
    '</div><div class="sendbar"><button class="pb" data-act="sharekit">↗ دوسری ایپ</button><button class="pb go" data-act="dosend" style="flex:1;height:46px" ' + (sendSel.size || sendStory ? '' : 'disabled') + '>بھیجیں ➤ ' + (sendSel.size + (sendStory ? 1 : 0) || '') + '</button></div>';
}
async function doSend() {
  H.busy(true, 'بھیجا جا رہا ہے…');
  try {
    const img = await toDataUrl(sendBlob);
    const jobs = [...sendSel].map(uid => sendSnap(uid, img));
    if (sendStory) jobs.push(postStory(img));
    await Promise.all(jobs);
    H.busy(false); H.toast('✓ بھیج دیا'); sendSel.clear(); sendStory = false; H.target = null; H.afterSend && H.afterSend(); alsoPage = true; history.back();
  } catch (e) { H.busy(false); H.toast(errMsg(e)); }
}

// ---- one chat ----
let chatUnsub = null, chatMsgs = [], chatLive = false;
function renderChat() {
  const p = people.get(screenArg) || { uid: screenArg };
  return header('<span style="display:flex;align-items:center;gap:8px">' + avatar(p) + esc(p.name) + '</span>', '<button class="sbtn" data-person="' + esc(p.uid) + '" aria-label="مزید">⋯</button>') +
    '<div class="msgs" id="msgs"><div class="empty2">…</div></div>' +
    '<div class="compose"><button class="sbtn" data-snapto="' + esc(p.uid) + '" aria-label="تصویر">📷</button><input class="inp" id="mtext" placeholder="پیغام لکھیں…" maxlength="2000" dir="auto"><button class="pb go" data-act="sendtext">➤</button></div>';
}
function startChat(uid) {
  stopChat();
  const id = pairId(me.uid, uid);
  chatLive = true;
  chatUnsub = onSnapshot(query(collection(db, 'chats', id, 'messages'), orderBy('createdAt', 'desc'), limit(80)), snap => {
    chatMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse(); drawMsgs(uid); markRead(id);
  }, () => { chatLive = false; const m = $('msgs'); if (m) m.innerHTML = '<div class="empty2">💬 پہلا پیغام بھیجیں</div>'; });   // new chat: no messages yet
  $('mtext').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-act="sendtext"]').click(); } };
}
function stopChat() { if (chatUnsub) { chatUnsub(); chatUnsub = null; } }
function drawMsgs(uid) {
  const m = $('msgs'); if (!m) return;
  if (!chatMsgs.length) { m.innerHTML = '<div class="empty2">💬 پہلا پیغام بھیجیں</div>'; return; }
  m.innerHTML = chatMsgs.map(x => {
    const mine = x.from === me.uid, time = ago(x.createdAt);
    if (x.type === 'snap') {
      const can = !mine && !x.opened && x.img;
      return '<div class="m ' + (mine ? 'me' : 'them') + '"><button class="snap" ' + (can ? 'data-opensnap="' + esc(x.id) + '"' : 'disabled') + '><span class="dot" style="background:' + (x.opened ? 'transparent' : '#EF4444') + ';border:2px solid #EF4444"></span>' +
        (mine ? (x.opened ? 'تصویر دیکھ لی گئی' : 'تصویر بھیجی') : (x.opened ? 'تصویر دیکھ لی' : 'تصویر دیکھنے کے لیے دبائیں')) + '</button><small>' + time + '</small></div>';
    }
    return '<div class="m ' + (mine ? 'me' : 'them') + '" dir="auto">' + esc(x.text) + '<small>' + time + '</small></div>';
  }).join('');
  m.scrollTop = m.scrollHeight;
}
async function openSnap(mid) {
  const x = chatMsgs.find(y => y.id === mid); if (!x || !x.img) return;
  const v = document.createElement('div'); v.className = 'sv'; v.id = 'sview';
  v.innerHTML = '<img src="' + esc(x.img) + '" alt=""><div class="bars"><i><b id="svb" style="transition:width 10s linear"></b></i></div><button class="sbtn x" aria-label="بند">✕</button>';
  document.body.appendChild(v); history.pushState({ soc: 'snap' }, '');
  requestAnimationFrame(() => { const b = $('svb'); if (b) b.style.width = '100%'; });
  const done = () => { if ($('sview')) history.back(); };
  v.onclick = done; svT = setTimeout(done, 10000);
  updateDoc(doc(db, 'chats', pairId(me.uid, screenArg), 'messages', mid), { opened: true, img: '' }).catch(() => {});
}
// ---- story viewer ----
let svT = 0;
function openStory(uid) {
  const list = stories.get(uid); if (!list || !list.length) return;
  const p = people.get(uid) || {};
  let i = 0;
  const v = document.createElement('div'); v.className = 'sv'; v.id = 'sview'; document.body.appendChild(v); history.pushState({ soc: 'story' }, '');
  const show = () => {
    clearTimeout(svT);
    if (i >= list.length) { if ($('sview')) history.back(); return; }
    v.innerHTML = '<img src="' + esc(list[i].img) + '" alt=""><div class="bars">' + list.map((_, k) => '<i><b style="width:' + (k < i ? 100 : 0) + '%' + (k === i ? ';transition:width 5s linear' : '') + '"' + (k === i ? ' id="svb"' : '') + '></b></i>').join('') + '</div>' +
      '<div class="who">' + avatar(p) + esc(p.name) + ' · ' + ago(list[i].createdAt) + '</div><button class="sbtn x" data-x aria-label="بند">✕</button>' + (uid === me.uid ? '<button class="pb red" data-delstory style="position:absolute;bottom:calc(20px + var(--safe-b));left:50%;transform:translateX(-50%)">🗑️ حذف</button>' : '');
    requestAnimationFrame(() => requestAnimationFrame(() => { const b = $('svb'); if (b) b.style.width = '100%'; }));
    svT = setTimeout(() => { i++; show(); }, 5000);
  };
  v.onclick = async e => {
    if (e.target.closest('[data-x]')) { history.back(); return; }
    if (e.target.closest('[data-delstory]')) { clearTimeout(svT); await deleteDoc(doc(db, 'stories', list[i].id)).catch(() => {}); history.back(); loadStories(); return; }
    i += e.clientX > innerWidth / 2 ? -1 : 1; if (i < 0) i = 0; show();   // right half = back (RTL)
  };
  const seen = seenStories(); seen[uid] = Date.now(); localStorage.setItem('lamha.seenStories', JSON.stringify(seen)); updateBadges();
  show();
}

// ---------------- clicks ----------------
root.addEventListener('click', async e => {
  const t = e.target.closest('button,[data-share-me]'); if (!t) return;
  const d = t.dataset;
  try {
    if (d.act === 'back') { history.back(); return; }
    if (d.act === 'login') return login();
    if (d.act === 'claim') {
      try { t.disabled = true; await claimUsername($('uUser').value, $('uName').value); open(pendingScreen || 'chats', null, true); pendingScreen = null; }
      catch (x) { $('uErr').textContent = x.message && !x.code ? x.message : errMsg(x); t.disabled = false; }
      return;
    }
    if (d.act === 'avatar') {   // choose a cartoon avatar or the Gmail photo
      const opts = [...AVATARS, me.photoURL].filter(Boolean);
      const v = document.createElement('div'); v.className = 'sv'; v.id = 'sview'; v.style.flexDirection = 'column'; v.style.gap = '14px';
      v.innerHTML = '<b>اوتار چنیں</b><div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;padding:0 20px">' +
        opts.map(o => '<button data-pickav="' + esc(o) + '" class="av avbig' + (prof.photo === o ? ' ring' : '') + '"><img src="' + esc(o) + '" alt="" referrerpolicy="no-referrer"></button>').join('') +
        '</div><button class="pb" data-pickav="">کوئی تصویر نہیں</button>';
      document.body.appendChild(v); history.pushState({ soc: 'avatar' }, '');
      v.onclick = async ev => {
        const b = ev.target.closest('[data-pickav]'); if (!b) return;
        const photo = b.dataset.pickav;
        await setDoc(doc(db, 'users', me.uid), { ...stripUid(prof), photo }).catch(x => H.toast(errMsg(x)));
        prof.photo = photo; people.set(me.uid, prof); updateBadges(); history.back(); render();
      };
      return;
    }
    if (d.act === 'logout') { await signOut(auth); leave(); H.toast('لاگ آؤٹ ہو گئے'); return; }
    if (d.act === 'rename') { const n = prompt('نیا نام', prof.name); if (n && n.trim()) { await setDoc(doc(db, 'users', me.uid), { ...stripUid(prof), name: n.trim().slice(0, 40) }); prof.name = n.trim().slice(0, 40); render(); } return; }
    if (d.act === 'delete') {
      if (!confirm('کیا آپ واقعی اپنا اکاؤنٹ ختم کرنا چاہتے ہیں؟ آپ کا پروفائل، یوزرنیم، دوستیاں اور اسٹوریز مٹ جائیں گی۔')) return;
      H.busy(true, 'اکاؤنٹ ختم ہو رہا ہے…');
      for (const f of friendships.values()) await deleteDoc(doc(db, 'friendships', f.id)).catch(() => {});
      for (const s of (stories.get(me.uid) || [])) await deleteDoc(doc(db, 'stories', s.id)).catch(() => {});
      await deleteDoc(doc(db, 'usernames', prof.username)).catch(() => {});
      await deleteDoc(doc(db, 'users', me.uid)).catch(() => {});
      await deleteUser(me).catch(async () => { await signOut(auth); });
      H.busy(false); leave(); H.toast('اکاؤنٹ ختم کر دیا گیا'); return;
    }
    if (d.act === 'sendtext') { const i = $('mtext'), v = i.value.trim(); if (!v) return; i.value = ''; await sendText(screenArg, v); if (!chatLive && screen === 'chat') startChat(screenArg); return; }
    if (d.act === 'camera') { leave(); return; }
    if (d.act === 'dosend') return doSend();
    if (d.act === 'sharekit') { const b = sendBlob; leave(); H.shareOut(b); return; }
    if (d.go) { open(d.go); return; }
    if (d.add !== undefined) { await addFriend(d.add); return; }
    if (d.accept !== undefined) { await acceptFriend(d.accept); return; }
    if (d.unfriend !== undefined) { if (confirm('ختم کر دیں؟')) await removeFriend(d.unfriend); return; }
    if (d.block !== undefined) { if (confirm('اس شخص کو بلاک کر دیں؟ وہ آپ کو پیغام نہیں بھیج سکے گا۔')) { await blockUser(d.block); H.toast('بلاک کر دیا'); } return; }
    if (d.report !== undefined) { const w = prompt('کیا مسئلہ ہے؟ (مختصر لکھیں)'); if (w !== null) await report(d.report, w); return; }
    if (d.person !== undefined) { await person(d.person); open('person', d.person); return; }
    if (d.chat !== undefined) { open('chat', d.chat); return; }
    if (d.snapto !== undefined) { const p = people.get(d.snapto) || {}; leave(); H.cameraFor(p.name, d.snapto); return; }
    if (d.opensnap !== undefined) { openSnap(d.opensnap); return; }
    if (d.story !== undefined) { openStory(d.story); return; }
    if (d.pick !== undefined) { sendSel.has(d.pick) ? sendSel.delete(d.pick) : sendSel.add(d.pick); render(); return; }
    if (d.mystory !== undefined) { sendStory = !sendStory; render(); return; }
    if (d.shareMe !== undefined) {
      const url = location.origin + location.pathname + '?add=' + encodeURIComponent(prof.username);
      if (navigator.share) navigator.share({ title: 'لمحہ', text: 'لمحہ پر مجھے دوست بنائیں: @' + prof.username, url }).catch(() => {});
      else { await navigator.clipboard.writeText(url).catch(() => {}); H.toast('🔗 لنک کاپی ہو گیا'); }
    }
  } catch (x) { H.toast(errMsg(x)); }
});
const stripUid = p => { const { uid, ...rest } = p; return rest; };

// ?add=username links open that person's profile
async function handleAddLink() {
  const u = new URLSearchParams(location.search).get('add');
  if (!u || !me || !prof) return;
  const s = await getDoc(doc(db, 'usernames', u.toLowerCase())).catch(() => null);
  if (s && s.exists()) { await person(s.data().uid); open('person', s.data().uid); }
  history.replaceState(null, '', location.pathname + (EMU ? '?emu' : ''));
}
if (configured) onAuthStateChanged(auth, u => { if (u) setTimeout(handleAddLink, 1500); });

// ---------------- public API for the camera page ----------------
window.LamhaSocial = {
  configured,
  onBack,
  open: name => need(name),
  // the editor's "Send" button: choose friends / story
  send(blob, kind) {
    if (kind === 'video') { H.shareOut(blob); return; }   // videos: share to other apps for now
    sendBlob = blob;
    if (H.target && H.target.uid) sendSel = new Set([H.target.uid]);
    need('send');
  },
  get loggedIn() { return !!(me && prof); }
};
updateBadges();
document.dispatchEvent(new Event('lamha-social'));
