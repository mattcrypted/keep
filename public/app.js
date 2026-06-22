// Keep — client. Identity is a Privy embedded wallet (email login): memories are
// keyed off the wallet address and it owns the minted NFTs, so signing in on any
// device brings your memories back (from 0G) and your tokens with them. Anonymous
// use still works (random id); signing in is what makes it portable + ownable.

// Motion (the vanilla build of the Framer Motion engine), loaded as progressive
// enhancement. Cards reveal on scroll with spring physics; if it fails to load, cards
// simply appear, so nothing breaks. Vendored at /vendor/motion.js (no CDN at runtime).
let MOTION = null;
import('/vendor/motion.js').then((m) => { MOTION = m; }).catch(() => { MOTION = null; });

function revealCards(root) {
  if (!MOTION || !MOTION.inView || !MOTION.animate) return; // no Motion: cards stay visible
  const show = (card) => {
    card.style.opacity = '1';
    card.style.transform = 'none';
  };
  for (const card of root.querySelectorAll('.listing-card, .nft-card')) {
    card.style.opacity = '0';
    // Failsafe: a card must never be left stuck hidden if Motion misbehaves.
    const failsafe = setTimeout(() => show(card), 1500);
    try {
      MOTION.inView(
        card,
        () => {
          clearTimeout(failsafe);
          try {
            MOTION.animate(card, { opacity: [0, 1], y: [16, 0] }, { type: 'spring', stiffness: 240, damping: 26 });
          } catch {
            show(card);
          }
        },
        { amount: 0.12 }
      );
    } catch {
      clearTimeout(failsafe);
      show(card);
    }
  }
}

// Entrance motion for the About section: fade + rise its blocks with a stagger.
// Progressive enhancement — if Motion is unavailable the blocks are simply visible.
function revealAbout() {
  const root = document.getElementById('about');
  if (!root) return;
  const els = root.querySelectorAll('.about-reveal');
  if (!MOTION || !MOTION.animate) {
    els.forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; });
    return;
  }
  els.forEach((el, i) => {
    el.style.opacity = '0';
    const failsafe = setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'none'; }, 1600);
    try {
      MOTION.animate(el, { opacity: [0, 1], y: [20, 0] }, { type: 'spring', stiffness: 220, damping: 26, delay: 0.06 * i });
    } catch {
      clearTimeout(failsafe);
      el.style.opacity = '1';
      el.style.transform = 'none';
    }
  });
}

const LS_ANON = 'keep.anonId';
const LS_IDENTITY = 'keep.identity'; // { email, address }
const rootsKey = (id) => 'keep.roots:' + id;
const mintedKey = (id) => 'keep.minted:' + id;

const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const memCount = document.getElementById('mem-count');
const memSaving = document.getElementById('mem-saving');
const proveBtn = document.getElementById('prove');
const identityBtn = document.getElementById('identity');
const signoutBtn = document.getElementById('signout');
const navChat = document.getElementById('nav-chat');
const navAbout = document.getElementById('nav-about');
const about = document.getElementById('about');
const aboutBack = document.getElementById('about-back');
const aboutCta = document.getElementById('about-cta');
const galleryBtn = document.getElementById('nav-gallery');
const gallery = document.getElementById('gallery');
const galleryGrid = document.getElementById('gallery-grid');
const gallerySub = document.getElementById('gallery-sub');
const galleryState = document.getElementById('gallery-state');
const galleryBack = document.getElementById('gallery-back');
const marketBtn = document.getElementById('nav-market');
const market = document.getElementById('market');
const marketGrid = document.getElementById('market-grid');
const marketState = document.getElementById('market-state');
const marketSub = document.getElementById('market-sub');
const marketBack = document.getElementById('market-back');
const sealOverlay = document.getElementById('seal-overlay');
const sealClose = document.getElementById('seal-close');
const sealTitle = document.getElementById('seal-title');
const sealTeaser = document.getElementById('seal-teaser');
const sealPrice = document.getElementById('seal-price');
const sealName = document.getElementById('seal-name');
const sealScope = document.getElementById('seal-scope');
const sealSubmit = document.getElementById('seal-submit');
const sealMsg = document.getElementById('seal-msg');
const LS_NAME = 'keep.sellerName';
const pillOg = document.getElementById('pill-og');
const restored = document.getElementById('restored');
const restoredText = document.getElementById('restored-text');

const popover = document.getElementById('popover');
const popStatus = document.getElementById('pop-status');
const popModel = document.getElementById('pop-model');
const popTime = document.getElementById('pop-time');
const popRoot = document.getElementById('pop-root');
const verifyResult = document.getElementById('verify-result');
const mintBtn = document.getElementById('mint-btn');
const mintResult = document.getElementById('mint-result');
// Trustless committed-at-block-time proof row (filled once a call is anchored).
const committedRow = document.getElementById('committed-row');
const committedVal = document.getElementById('committed-val');

// Login modal
const loginOverlay = document.getElementById('login-overlay');
const loginClose = document.getElementById('login-close');
const loginStepEmail = document.getElementById('login-step-email');
const loginStepCode = document.getElementById('login-step-code');
const loginEmail = document.getElementById('login-email');
const loginSend = document.getElementById('login-send');
const loginCode = document.getElementById('login-code');
const loginVerify = document.getElementById('login-verify');
const loginResend = document.getElementById('login-resend');
const loginBack = document.getElementById('login-back');
const loginCodeHint = document.getElementById('login-code-hint');
const loginMsg = document.getElementById('login-msg');

let loginReady = false;

// ── Identity + effective session id ─────────────────────
function anonId() {
  let v = localStorage.getItem(LS_ANON);
  if (!v) {
    v = crypto.randomUUID?.() || 'anon-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem(LS_ANON, v);
  }
  return v;
}
function loadIdentity() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_IDENTITY) || 'null');
    return v && v.address ? v : null;
  } catch {
    return null;
  }
}
let identity = loadIdentity(); // { email, address } | null
let sessionId = identity?.address || anonId(); // the id sent to the backend
let pollEpoch = 0; // bumped on every identity switch — stale receipt polls bail out

const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);

function renderIdentity() {
  if (identity) {
    identityBtn.textContent = shortAddr(identity.address);
    identityBtn.classList.add('ident');
    identityBtn.title = `Signed in as ${identity.email}\n${identity.address}\nClick to copy address`;
  } else {
    identityBtn.textContent = loginReady ? 'sign in' : 'login off';
    identityBtn.classList.remove('ident');
    identityBtn.title = loginReady
      ? 'Sign in to own your memories and keep them across devices'
      : 'Login not configured (no Privy keys)';
  }
  // The gallery is private: only a signed-in identity owns memories to show.
  if (galleryBtn) galleryBtn.hidden = !identity;
  // The sign-out control only makes sense while signed in.
  if (signoutBtn) signoutBtn.hidden = !identity;
}

// ── Per-identity receipt index ──────────────────────────
function loadRoots() {
  try {
    return JSON.parse(localStorage.getItem(rootsKey(sessionId)) || '[]');
  } catch {
    return [];
  }
}
function saveRoots(roots) {
  localStorage.setItem(rootsKey(sessionId), JSON.stringify(roots));
}
function sortedRootHashes() {
  return loadRoots()
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((r) => r.rootHash);
}
function rememberRoot(turnId, rootHash, txHash, ts) {
  rememberRootFor(sessionId, turnId, rootHash, txHash, ts);
}
// Write a root under a SPECIFIC identity's index (not necessarily the current one):
// a receipt poll started before an identity switch must persist under the identity
// that actually created the turn, never the one the user just switched to.
function rememberRootFor(id, turnId, rootHash, txHash, ts) {
  let roots;
  try {
    roots = JSON.parse(localStorage.getItem(rootsKey(id)) || '[]');
  } catch {
    roots = [];
  }
  if (roots.some((r) => r.turnId === turnId)) return;
  roots.push({ turnId, rootHash, txHash, ts });
  localStorage.setItem(rootsKey(id), JSON.stringify(roots));
  if (id === sessionId) updateMemCount();
}
function txFor(rootHash) {
  return loadRoots().find((r) => r.rootHash === rootHash)?.txHash;
}

// ── Per-identity mint state ─────────────────────────────
function loadMinted() {
  try {
    return JSON.parse(localStorage.getItem(mintedKey(sessionId)) || '{}');
  } catch {
    return {};
  }
}
function rememberMint(turnId, tokenId, txHash, anchoredAt) {
  const m = loadMinted();
  m[turnId] = { tokenId, txHash, anchoredAt };
  localStorage.setItem(mintedKey(sessionId), JSON.stringify(m));
}
function mintOf(turnId) {
  return loadMinted()[turnId];
}

// ── "Call your shot" labels (Track-2 sneak peek) ────────
// A "call" is just a memory the user flags as a prediction. The label is
// client-only — it never enters the 0G record, the recordHash, or the chain —
// so the store / verify / rehydrate / mint contract is byte-for-byte unchanged.
const callKey = (id) => 'keep.call:' + id;
function loadCalls() {
  try {
    return JSON.parse(localStorage.getItem(callKey(sessionId)) || '{}');
  } catch {
    return {};
  }
}
function isCall(turnId) {
  return !!loadCalls()[turnId];
}
function setCall(turnId, on) {
  const m = loadCalls();
  if (on) m[turnId] = { at: Date.now() };
  else delete m[turnId];
  localStorage.setItem(callKey(sessionId), JSON.stringify(m));
}

let toldCount = 0;
function updateMemCount() {
  const stored = loadRoots().length;
  const n = Math.max(toldCount, stored);
  memCount.textContent = String(n);
  const saving = Math.max(0, n - stored);
  memSaving.textContent = saving > 0 ? ` · ${saving} saving` : '';
  proveBtn.hidden = stored === 0;
}

// ── Rendering ───────────────────────────────────────────
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const fmtTime = (ts) => new Date(ts).toLocaleString();

function addUserMsg(text) {
  const msg = el('div', 'msg user');
  msg.appendChild(el('div', 'bubble', text));
  const meta = el('div', 'meta'); // "Seal & list" gets attached here once the turn is stored
  msg.appendChild(meta);
  thread.appendChild(msg);
  scroll();
  return { meta, text };
}

function addAiMsg(text, { turnId, model, ts, rootHash, status, verified, userHandle } = {}) {
  const msg = el('div', 'msg ai');
  msg.appendChild(el('div', 'bubble', text));
  const meta = el('div', 'meta');
  const badge = el('span', 'badge');
  badge.dataset.turnId = turnId || '';
  badge.appendChild(el('span', 'dot'));
  badge.appendChild(el('span', 'label'));
  meta.appendChild(badge);
  msg.appendChild(meta);
  thread.appendChild(msg);

  const handle = {
    badge,
    set(state, data = {}) {
      badge.className = 'badge ' + state;
      badge.querySelector('.label').textContent =
        state === 'stored' ? '✓ on 0G' : state === 'error' ? '✕ 0G failed' : 'saving to 0G ~15s';
      badge.dataset.status = state;
      if (data.verified != null) badge.dataset.verified = String(data.verified);
      if (data.rootHash) badge.dataset.rootHash = data.rootHash;
      badge.dataset.model = data.model || model || '';
      badge.dataset.ts = data.ts || ts || '';
      if (state === 'stored') {
        reflectOwned(badge);
        reflectCall(badge);
        renderReceiptActions(meta, badge.dataset.turnId);
        if (userHandle) attachUserSeal(userHandle, badge.dataset.turnId);
      }
    },
  };
  handle.set(status || 'pending', { rootHash, model, ts, verified });
  scroll();
  return handle;
}

// AI-side receipt action: "Share card" sits next to the "on 0G" badge once the
// memory is stored. (The badge itself opens the details popup and verifies.)
// "Seal & list" lives under YOUR message instead — see attachUserSeal.
function renderReceiptActions(meta, turnId) {
  if (!turnId || meta.querySelector('.meta-action')) return; // render once
  const share = el('button', 'meta-action', 'Share card ⬦');
  share.title = 'Download a proof-of-foresight card (anchors the call on 0G if needed)';
  share.addEventListener('click', () => shareInline(turnId, share));
  meta.appendChild(share);
}

// The most recent message you can seal — the target for the typed "seal and list".
let lastSealable = null; // { turnId, text }

// A short, public-safe headline suggestion from your message (NOT the teaser,
// which would leak the sealed body).
function sealTitleFrom(text) {
  return (text || '').trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 60);
}

// "Seal & list" on YOUR side of the chat: attached under your message once its
// turn is stored on 0G, pre-filling a title from what you wrote.
function attachUserSeal(userHandle, turnId) {
  if (!userHandle || !userHandle.meta || !turnId) return;
  lastSealable = { turnId, text: userHandle.text || '' };
  if (userHandle.meta.querySelector('.meta-action')) return; // render once
  const seal = el('button', 'meta-action', 'Seal & list ⬦');
  seal.title = 'Seal this message (encrypt + list on 0G), and mark it as a prediction';
  seal.addEventListener('click', () => openSeal(turnId, { title: sealTitleFrom(userHandle.text) }));
  userHandle.meta.appendChild(seal);
}

// Recognize a typed "seal and list" instruction (an exact-phrase whitelist, so a
// normal memory is never mistaken for a command).
function isSealCommand(text) {
  const s = text.trim().toLowerCase().replace(/[.!?\s]+$/g, '');
  return [
    'seal and list', 'seal & list', 'seal and list it', 'seal & list it',
    'seal and list this', 'seal & list this', 'seal it', 'seal this',
    'seal and sell', 'seal & sell', 'list it on the market', 'list this on the market',
    'put it up for sale', 'put this up for sale',
  ].includes(s);
}

// Handle the typed command: open the seal form pre-filled for your most recent
// message, instead of sending the command to Keep as a normal message.
function handleSealCommand() {
  input.value = '';
  if (!identity) {
    openLogin('Sign in to seal & list your knowledge.');
    return;
  }
  if (!lastSealable || !lastSealable.turnId) {
    addPlainAiMsg('Send the knowledge you want to list as a message first, then say “seal and list” and I’ll open the listing form for it.');
    return;
  }
  openSeal(lastSealable.turnId, { title: sealTitleFrom(lastSealable.text) });
}

// Decorate restored memories with CHAIN-SOURCED ownership, so "owned ⬦ #N" shows on
// any device — not just where the mint happened. Asks the server (which reads the
// contract) which of these roots this identity owns, then reflects + caches them.
async function decorateOwnership(roots) {
  const list = (roots || []).filter(Boolean);
  if (!list.length) return;
  try {
    const res = await fetch('/api/owned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, rootHashes: list }),
    });
    if (!res.ok) return;
    const { owned } = await res.json();
    for (const [rootHash, info] of Object.entries(owned || {})) {
      const badge = thread.querySelector(`.badge[data-root-hash="${CSS.escape(rootHash)}"]`);
      if (!badge) continue;
      const turnId = badge.dataset.turnId;
      // Cache (or backfill) the mint — including anchoredAt, which older cached
      // entries (minted before the "call" feature) won't have yet.
      const cached = turnId && mintOf(turnId);
      if (turnId && (!cached || cached.anchoredAt == null)) {
        rememberMint(turnId, info.tokenId, info.txHash, info.anchoredAt);
      }
      reflectOwned(badge);
    }
  } catch {
    /* ownership is best-effort decoration */
  }
}

// Reflect on-chain ownership on a badge (if this turn was minted).
function reflectOwned(badge) {
  const m = mintOf(badge.dataset.turnId);
  let own = badge.querySelector('.own');
  if (m) {
    badge.classList.add('owned');
    if (!own) {
      own = el('span', 'own', ` · owned ⬦ #${m.tokenId}`);
      badge.appendChild(own);
    }
  }
}

// Reflect the "call" label on a badge (Track-2). Visual only.
function reflectCall(badge) {
  if (!badge) return;
  badge.classList.toggle('call', isCall(badge.dataset.turnId));
}

function addPlainAiMsg(text) {
  const msg = el('div', 'msg ai');
  msg.appendChild(el('div', 'bubble', text));
  thread.appendChild(msg);
  scroll();
}
function addTyping() {
  const msg = el('div', 'msg ai typing');
  msg.appendChild(el('div', 'bubble', 'Keep is thinking…'));
  thread.appendChild(msg);
  scroll();
  return msg;
}
const scroll = () => (thread.scrollTop = thread.scrollHeight);

// ── Badge → popover ─────────────────────────────────────
thread.addEventListener('click', (e) => {
  const badge = e.target.closest('.badge');
  if (badge) openPopover(badge);
});

function openPopover(badge) {
  const status = badge.dataset.status;
  const rootHash = badge.dataset.rootHash || '';
  const verified = badge.dataset.verified === 'true';
  const turnId = badge.dataset.turnId;
  const minted = mintOf(turnId);

  popStatus.textContent =
    status === 'stored'
      ? verified
        ? 'stored & verified on 0G ✓'
        : 'stored & verifiable on 0G'
      : status === 'error'
        ? 'persist failed'
        : 'saving, 0G writes take about 10 to 15s';
  popModel.textContent = badge.dataset.model || 'n/a';
  popTime.textContent = badge.dataset.ts ? fmtTime(Number(badge.dataset.ts)) : 'n/a';
  popRoot.textContent = rootHash || 'n/a';
  const tx = txFor(rootHash);
  if (tx) popRoot.href = `https://storagescan-galileo.0g.ai/tx/${tx}`;
  else popRoot.removeAttribute('href');

  verifyResult.textContent = '';
  verifyResult.className = 'verify-result';

  mintResult.textContent = '';
  mintResult.className = 'mint-result';
  mintBtn.dataset.turnId = turnId;
  if (minted) {
    mintBtn.textContent = 'Owned ⬦';
    mintBtn.disabled = true;
    mintResult.textContent = `#${minted.tokenId}, yours on 0G`;
    mintResult.className = 'mint-result ok';
    if (minted.txHash) {
      const a = document.createElement('a');
      a.href = `https://chainscan-galileo.0g.ai/tx/${minted.txHash}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = ' ↗';
      a.className = 'mono';
      mintResult.appendChild(a);
    }
  } else {
    mintBtn.textContent = 'Mint as NFT ⬦';
    mintBtn.disabled = status !== 'stored';
  }

  // Trustless committed-at-block-time proof (shown once the call is anchored via mint).
  if (committedRow) {
    if (minted && minted.anchoredAt) {
      committedRow.hidden = false;
      committedVal.textContent = 'committed at block-time ' + fmtTime(minted.anchoredAt * 1000);
    } else {
      committedRow.hidden = true;
    }
  }

  const r = badge.getBoundingClientRect();
  popover.hidden = false;
  const top = Math.min(r.bottom + 8, window.innerHeight - popover.offsetHeight - 12);
  const left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 12);
  popover.style.top = `${Math.max(12, top)}px`;
  popover.style.left = `${Math.max(12, left)}px`;

  // Clicking the "on 0G" badge IS "verify on 0G": show the details, then verify.
  if (status === 'stored' && rootHash) runVerify(rootHash);
}

document.addEventListener('click', (e) => {
  if (!popover.hidden && !popover.contains(e.target) && !e.target.closest('.badge')) {
    popover.hidden = true;
  }
});

// Re-fetch the record from 0G and re-hash it to prove it is unaltered. Runs
// automatically when the receipt popup opens (the badge is the verify trigger).
async function runVerify(rootHash) {
  if (!rootHash) return;
  verifyResult.textContent = 'verifying on 0G…';
  verifyResult.className = 'verify-result';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootHash }),
    });
    const data = await res.json();
    if (data.ok) {
      verifyResult.textContent = '✓ unaltered, re-fetched from 0G and re-hashed';
      verifyResult.className = 'verify-result ok';
    } else {
      verifyResult.textContent = `✕ ${res.ok ? 'mismatch, record altered' : data.error || 'verify failed'}`;
      verifyResult.className = 'verify-result bad';
    }
  } catch (err) {
    verifyResult.textContent = `✕ ${err.message}`;
    verifyResult.className = 'verify-result bad';
  }
}

mintBtn.addEventListener('click', async () => {
  const turnId = mintBtn.dataset.turnId;
  if (!turnId) return;
  if (!identity) {
    popover.hidden = true;
    openLogin('Sign in to mint this memory as an NFT you own.');
    return;
  }
  mintBtn.disabled = true;
  mintResult.textContent = 'minting on 0G…';
  mintResult.className = 'mint-result';
  try {
    const res = await fetch('/api/mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, turnId, owner: identity.address }),
    });
    const data = await res.json();
    if (!res.ok) {
      mintResult.textContent = `✕ ${data.error || 'mint failed'}`;
      mintResult.className = 'mint-result bad';
      mintBtn.disabled = false;
      return;
    }
    const tokenId = data.tokenId || (data.alreadyMinted ? 'n/a' : '?');
    rememberMint(turnId, tokenId, data.txHash, data.anchoredAt);
    mintResult.textContent = data.alreadyMinted ? 'already owned ⬦' : `minted ⬦ #${tokenId}, yours on 0G`;
    mintResult.className = 'mint-result ok';
    mintBtn.textContent = 'Owned ⬦';
    // reflect on the badge
    const badge = thread.querySelector(`.badge[data-turn-id="${CSS.escape(turnId)}"]`);
    if (badge) reflectOwned(badge);
  } catch (err) {
    mintResult.textContent = `✕ ${err.message}`;
    mintResult.className = 'mint-result bad';
    mintBtn.disabled = false;
  }
});

// ── Shareable proof-of-foresight card ───────────────────
// "Share card" anchors the call on 0G if it isn't already (a gas-free mint, which
// stamps a trustless block-time), then downloads the proof card. Sealing already
// marks a memory as a prediction, so there is no separate "mark as call" control.
async function shareInline(turnId, btn) {
  if (!identity) {
    openLogin('Sign in to create a shareable proof card.');
    return;
  }
  let m = mintOf(turnId);
  if (!m || m.anchoredAt == null) {
    if (btn) { btn.disabled = true; btn.textContent = 'anchoring on 0G…'; }
    try {
      const res = await fetch('/api/mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, turnId, owner: identity.address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'could not anchor on 0G');
      rememberMint(turnId, data.tokenId || 'n/a', data.txHash, data.anchoredAt);
      const badge = thread.querySelector(`.badge[data-turn-id="${CSS.escape(turnId)}"]`);
      if (badge) reflectOwned(badge);
      m = mintOf(turnId);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Share card ⬦'; }
      alert('Could not anchor this memory on 0G: ' + e.message);
      return;
    }
  }
  if (btn) btn.disabled = false;
  if (!m || m.anchoredAt == null) {
    if (btn) btn.textContent = 'Share card ⬦';
    return;
  }
  buildShareCard(turnId);
  if (btn) {
    btn.textContent = 'card saved ✓';
    setTimeout(() => { btn.textContent = 'Share card ⬦'; }, 1800);
  }
}

// An honest proof-of-foresight card: it proves WHEN the call was committed on a
// trustless block time — never that it was right, nor which model wrote it.
function buildShareCard(turnId) {
  const minted = mintOf(turnId);
  if (!minted || !minted.anchoredAt) return;
  const when = fmtTime(minted.anchoredAt * 1000);
  const W = 720;
  const H = 360;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#0a0807';
  x.fillRect(0, 0, W, H);
  x.strokeStyle = '#ff4d00';
  x.lineWidth = 2;
  x.strokeRect(14, 14, W - 28, H - 28);
  x.fillStyle = '#ff6a26';
  x.font = 'bold 30px system-ui, sans-serif';
  x.fillText('◆ Keep: Call committed', 40, 72);
  x.fillStyle = '#9c938d';
  x.font = '15px system-ui, sans-serif';
  x.fillText('Committed at block-time (0G Chain · trustless):', 40, 130);
  x.fillStyle = '#f6f3f1';
  x.font = 'bold 22px system-ui, sans-serif';
  x.fillText(when, 40, 166);
  x.fillStyle = '#9c938d';
  x.font = '14px ui-monospace, monospace';
  x.fillText('Token #' + (minted.tokenId ?? 'n/a'), 40, 214);
  if (minted.txHash) x.fillText('tx ' + minted.txHash.slice(0, 34) + '…', 40, 238);
  x.fillStyle = '#9c938d';
  x.font = '13px system-ui, sans-serif';
  x.fillText('Proof of WHEN this call was committed on-chain', 40, 300);
  x.fillText('not that it is correct, and not which model wrote it.', 40, 322);
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keep-call-' + (minted.tokenId || 'card') + '.png';
    a.click();
    URL.revokeObjectURL(url);
  });
  navigator.clipboard
    ?.writeText(
      `Keep, call committed at block-time ${when} (0G Chain, trustless). ` +
        `Token #${minted.tokenId ?? 'n/a'}. Proof of WHEN it was committed: ` +
        `not that it's correct, nor which model wrote it.`
    )
    .catch(() => {});
}

// ── Receipt polling ─────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollReceipt(turnId, handle) {
  const epoch = pollEpoch; // capture: if the user switches identity, this poll aborts
  const pollSession = sessionId; // persist under the identity that created the turn
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    if (epoch !== pollEpoch) return; // identity switched — abandon this stale poll
    try {
      const res = await fetch(`/api/receipt/${encodeURIComponent(pollSession)}/${encodeURIComponent(turnId)}`);
      if (!res.ok) continue;
      const r = await res.json();
      if (r.status === 'stored') {
        if (epoch === pollEpoch) handle.set('stored', { rootHash: r.rootHash, model: r.model, ts: r.ts });
        rememberRootFor(pollSession, turnId, r.rootHash, r.txHash, r.ts);
        return;
      }
      if (r.status === 'error') {
        if (epoch === pollEpoch) handle.set('error', { model: r.model, ts: r.ts });
        return;
      }
    } catch {
      /* keep polling */
    }
  }
}

// ── Send ────────────────────────────────────────────────
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  // A typed "seal and list" is an instruction, not a memory: open the seal form
  // for your most recent message instead of sending it to Keep.
  if (isSealCommand(text)) {
    handleSealCommand();
    return;
  }
  input.value = '';
  sendBtn.disabled = true;
  const userHandle = addUserMsg(text);
  const typing = addTyping();
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) {
      addPlainAiMsg(`⚠ ${data.error || 'something went wrong'}`);
      return;
    }
    const handle = addAiMsg(data.reply, { turnId: data.turnId, model: data.model, ts: data.ts, userHandle });
    lastSealable = { turnId: data.turnId, text }; // command can target it even before it's stored
    toldCount++;
    updateMemCount();
    pollReceipt(data.turnId, handle);
  } catch (err) {
    typing.remove();
    addPlainAiMsg(`⚠ ${err.message}`);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});

// ── Login flow ──────────────────────────────────────────
async function copyIdentityAddress() {
  const prev = shortAddr(identity.address);
  try {
    await navigator.clipboard.writeText(identity.address);
    identityBtn.textContent = 'copied ✓';
  } catch {
    // clipboard blocked (non-secure context / permissions) — let the user copy manually
    window.prompt('Your wallet address:', identity.address);
    return;
  }
  setTimeout(() => {
    if (identity) identityBtn.textContent = prev;
  }, 1200);
}

// Sign out: clear the session cookie + local identity, fall back to the anon id,
// and rebuild the view. Memories stay on 0G and return on the next sign-in.
function signOut() {
  if (!identity) return;
  if (!confirm(`Sign out of ${identity.email}? (your memories stay safe on 0G and come back when you sign in again)`)) return;
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); // clear the httpOnly cookie
  localStorage.removeItem(LS_IDENTITY);
  identity = null;
  sessionId = anonId();
  renderIdentity();
  switchIdentity();
}

identityBtn.addEventListener('click', (e) => {
  if (!loginReady) return;
  if (!identity) {
    openLogin();
    return;
  }
  // Shift-click signs out (a shortcut); a plain click copies the full address (it's
  // truncated in the pill, so copy is the only way to get the whole thing to fund / receive).
  if (e.shiftKey) {
    signOut();
    return;
  }
  copyIdentityAddress();
});

// Explicit sign-out control, shown only when signed in.
if (signoutBtn) signoutBtn.addEventListener('click', signOut);

function openLogin(hint) {
  loginStepEmail.hidden = false;
  loginStepCode.hidden = true;
  loginMsg.textContent = hint || '';
  loginMsg.className = 'modal-msg' + (hint ? ' info' : '');
  loginSend.disabled = false;
  loginOverlay.hidden = false;
  loginEmail.focus();
}
function closeLogin() {
  loginOverlay.hidden = true;
}
loginClose.addEventListener('click', closeLogin);
loginOverlay.addEventListener('click', (e) => {
  if (e.target === loginOverlay) closeLogin();
});
loginBack.addEventListener('click', () => {
  loginStepEmail.hidden = false;
  loginStepCode.hidden = true;
  loginMsg.textContent = '';
});

loginSend.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    loginMsg.textContent = 'Enter a valid email.';
    loginMsg.className = 'modal-msg bad';
    return;
  }
  loginSend.disabled = true;
  loginMsg.textContent = 'sending code…';
  loginMsg.className = 'modal-msg info';
  try {
    const res = await fetch('/api/auth/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'could not send code');
    loginStepEmail.hidden = true;
    loginStepCode.hidden = false;
    loginCodeHint.textContent = `Enter the code we emailed to ${email}.`;
    loginMsg.textContent = '';
    loginCode.value = '';
    loginCode.focus();
  } catch (err) {
    loginMsg.textContent = err.message;
    loginMsg.className = 'modal-msg bad';
    loginSend.disabled = false;
  }
});

loginVerify.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const code = loginCode.value.trim();
  if (!code) return;
  loginVerify.disabled = true;
  loginMsg.textContent = 'verifying…';
  loginMsg.className = 'modal-msg info';
  try {
    const res = await fetch('/api/auth/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'verification failed');
    identity = { email: data.email, address: data.address };
    localStorage.setItem(LS_IDENTITY, JSON.stringify(identity));
    sessionId = identity.address;
    loginMsg.textContent = '✓ signed in';
    loginMsg.className = 'modal-msg ok';
    renderIdentity();
    closeLogin();
    switchIdentity();
  } catch (err) {
    loginMsg.textContent = /invalid|422|credential|expired/i.test(err.message)
      ? "That code didn't match, it may be expired or already used. Tap “resend a fresh code” and enter the newest one."
      : err.message;
    loginMsg.className = 'modal-msg bad';
  } finally {
    loginVerify.disabled = false;
  }
});

loginResend.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  if (!email) return;
  loginResend.disabled = true;
  loginMsg.textContent = 'sending a fresh code…';
  loginMsg.className = 'modal-msg info';
  try {
    const res = await fetch('/api/auth/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'could not resend');
    loginCode.value = '';
    loginCode.focus();
    loginMsg.textContent = `Fresh code sent to ${email}, enter the newest one.`;
    loginMsg.className = 'modal-msg info';
  } catch (err) {
    loginMsg.textContent = err.message;
    loginMsg.className = 'modal-msg bad';
  } finally {
    loginResend.disabled = false;
  }
});

// Re-render the thread for the current identity (after login/logout).
async function switchIdentity() {
  showChatView(); // leave the gallery if it was open
  thread.replaceChildren();
  restored.hidden = true;
  toldCount = 0;
  popover.hidden = true;
  await boot();
}

// ── Status pills (fired independently; never blocks chat) ──
async function updatePills() {
  try {
    const h = await (await fetch('/api/health')).json();
    loginReady = !!h.loginReady;
    renderIdentity();
    if (h.ogReady && h.wallet?.balance != null) {
      pillOg.textContent = `0G ✓ ${Number(h.wallet.balance).toFixed(2)}`;
      pillOg.className = 'pill';
    } else if (h.wallet?.error) {
      pillOg.textContent = '0G: RPC slow';
      pillOg.className = 'pill muted';
    } else {
      pillOg.textContent = '0G unfunded';
      pillOg.className = 'pill bad';
    }
  } catch {
    pillOg.textContent = '0G: checking';
    pillOg.className = 'pill muted';
  }
}

// ── Prove it ────────────────────────────────────────────
proveBtn.addEventListener('click', async () => {
  proveBtn.disabled = true;
  try {
    await fetch('/api/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    /* reload regardless */
  }
  location.reload();
});

// ── Gallery: your private collection of owned memory NFTs ────────────────
// Signed-in only. Chain-sourced (the server reads MemoryAnchored for your
// address), content re-fetched from 0G. Its own full-section view, not a popover.
// Reflect which of the three sections (chat / market / gallery) is active on the
// centered nav, so only one tab is lit at a time.
function setActiveSection(section) {
  navChat.classList.toggle('active', section === 'chat');
  marketBtn.classList.toggle('active', section === 'market');
  galleryBtn.classList.toggle('active', section === 'gallery');
  navAbout.classList.toggle('active', section === 'about');
}

function showChatView() {
  gallery.hidden = true;
  market.hidden = true;
  if (about) about.hidden = true;
  thread.hidden = false;
  composer.hidden = false;
  setActiveSection('chat');
  updateMemCount(); // restore "prove it" visibility (it belongs to the chat section)
}

// About: a static, signed-out-friendly explainer of what Keep is. Its own section.
function showAbout() {
  popover.hidden = true;
  thread.hidden = true;
  composer.hidden = true;
  restored.hidden = true;
  gallery.hidden = true;
  market.hidden = true;
  about.hidden = false;
  setActiveSection('about');
  proveBtn.hidden = true;
  revealAbout();
}

function renderNftCard(it) {
  const card = el('div', 'nft-card');
  card.appendChild(el('div', 'nft-id', `Memory #${it.tokenId} ⬦`));
  if (it.prompt) card.appendChild(el('div', 'nft-prompt', `“${it.prompt}”`));
  card.appendChild(el('div', 'nft-response', it.response || '(content lives on 0G)'));

  const meta = el('div', 'nft-meta');
  if (it.anchoredAt) {
    meta.appendChild(el('div', 'nft-committed', `committed at block-time ${fmtTime(it.anchoredAt * 1000)}`));
  }
  meta.appendChild(el('div', null, `model · ${it.model || 'n/a'}`));
  if (it.rootHash) {
    meta.appendChild(el('div', 'nft-root', `${it.rootHash.slice(0, 10)}…${it.rootHash.slice(-6)}`));
  }
  if (it.txHash) {
    const a = document.createElement('a');
    a.href = `https://chainscan-galileo.0g.ai/tx/${it.txHash}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'view mint on-chain ↗';
    meta.appendChild(a);
  }
  card.appendChild(meta);
  return card;
}

async function openGallery() {
  if (!identity) return;
  popover.hidden = true;
  thread.hidden = true;
  composer.hidden = true;
  restored.hidden = true;
  market.hidden = true;
  if (about) about.hidden = true;
  gallery.hidden = false;
  setActiveSection('gallery');
  proveBtn.hidden = true; // "prove it" belongs to the chat section
  galleryGrid.replaceChildren();
  galleryState.hidden = false;
  galleryState.textContent = 'loading your collection from 0G…';
  gallerySub.textContent = 'everything you own, anchored on-chain';
  try {
    const res = await fetch(`/api/gallery/${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'could not load your gallery');
    const items = data.items || [];
    if (!items.length) {
      galleryState.hidden = false;
      galleryState.textContent = 'No memories owned yet. Mint one from the chat and it’ll appear here as yours.';
      gallerySub.textContent = '0 owned';
      return;
    }
    galleryState.hidden = true;
    gallerySub.textContent = `${items.length} memor${items.length === 1 ? 'y' : 'ies'} you own`;
    for (const it of items) galleryGrid.appendChild(renderNftCard(it));
    revealCards(galleryGrid);
  } catch (err) {
    galleryState.hidden = false;
    galleryState.textContent = `✕ ${err.message}`;
    gallerySub.textContent = '';
  }
}

navChat.addEventListener('click', showChatView);
navAbout.addEventListener('click', showAbout);
if (aboutBack) aboutBack.addEventListener('click', showChatView);
if (aboutCta) aboutCta.addEventListener('click', showChatView);
galleryBtn.addEventListener('click', openGallery);
galleryBack.addEventListener('click', showChatView);

// ── Sealed Market: browse encrypted listings; buy to decrypt ─────────────
// Public browse (anyone, even anonymous). Buy/unlock require a signed-in wallet.
// The decryption key NEVER reaches the client — /api/market/unlock returns the
// already-decrypted plaintext only to the seller or a recorded purchaser.
let purchasedSet = new Set();
let marketChain = { address: null, base: 'https://chainscan-galileo.0g.ai' };

async function openMarket() {
  popover.hidden = true;
  thread.hidden = true;
  composer.hidden = true;
  restored.hidden = true;
  gallery.hidden = true;
  if (about) about.hidden = true;
  market.hidden = false;
  setActiveSection('market');
  proveBtn.hidden = true; // "prove it" belongs to the chat section
  marketGrid.replaceChildren();
  marketState.hidden = false;
  marketState.textContent = 'loading sealed listings from 0G…';
  marketSub.textContent = 'encrypted memories, sealed on 0G, buy to decrypt';
  purchasedSet = new Set();
  try {
    if (identity) {
      try {
        const mineRes = await fetch('/api/market/mine');
        if (mineRes.ok) {
          const mine = await mineRes.json();
          purchasedSet = new Set(mine.purchased || []);
        }
      } catch {
        /* best-effort */
      }
    }
    const res = await fetch('/api/market/listings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'could not load the market');
    marketChain = { address: data.market || null, base: data.chainBase || marketChain.base };
    const items = data.listings || [];
    if (!items.length) {
      marketState.hidden = false;
      marketState.textContent = 'No sealed listings yet. Seal one of your memories from its receipt to list it here.';
      marketSub.textContent = '0 listings · the bazaar is open';
      return;
    }
    marketState.hidden = true;
    marketSub.textContent = `${items.length} sealed listing${items.length === 1 ? '' : 's'} · buy to decrypt`;
    for (const it of items) marketGrid.appendChild(renderListingCard(it));
    revealCards(marketGrid);
  } catch (err) {
    marketState.hidden = false;
    marketState.textContent = `✕ ${err.message}`;
    marketSub.textContent = '';
  }
}

function renderListingCard(it) {
  const me = identity?.address ? identity.address.toLowerCase() : null;
  const mine = me && it.seller === me;
  const bought = purchasedSet.has(it.listingId);

  const card = el('div', 'listing-card');

  // Framer-style preview: the listing header sits in a white card on a blue panel.
  const thumb = el('div', 'listing-thumb');
  if (it.priceLabel) thumb.appendChild(el('span', 'price-chip', it.priceLabel));
  const preview = el('div', 'listing-preview');
  preview.appendChild(el('div', 'listing-title', it.title || 'Untitled'));
  if (it.teaser) preview.appendChild(el('div', 'listing-teaser', `“${it.teaser}”`));
  preview.appendChild(el('div', 'listing-locked', '🔒 sealed on 0G · buy to decrypt'));
  thumb.appendChild(preview);
  card.appendChild(thumb);

  card.appendChild(el('div', 'listing-by', `by ${it.sellerName || it.sellerShort}${mine ? ' · you' : ''}`));

  // The decrypted memory drops in here after purchase (hidden until then).
  const body = el('div', 'sealed-body');
  body.hidden = true;
  card.appendChild(body);

  const actions = el('div', 'listing-actions');
  const btn = el('button', 'listing-btn');
  const note = el('div', 'listing-note');

  const reveal = async () => {
    btn.disabled = true;
    btn.textContent = 'unlocking…';
    try {
      const r = await fetch('/api/market/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listingId: it.listingId }),
      });
      if (r.status === 401) {
        openLogin('Sign in to unlock sealed memories.');
        btn.disabled = false;
        btn.textContent = 'Reveal';
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'unlock failed');
      body.hidden = false;
      if (d.scope === 'user') {
        // user-knowledge listing: the seller's own message is the content
        body.textContent = d.prompt || '(empty)';
      } else {
        if (d.prompt) body.before(el('div', 'listing-prompt', `“${d.prompt}”`));
        body.textContent = d.response || '(empty)';
      }
      body.classList.add('revealed');
      actions.replaceChildren(el('div', 'listing-unlocked', '✓ unlocked, decrypted from 0G'));
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Reveal';
      note.textContent = `✕ ${e.message}`;
      note.className = 'listing-note bad';
    }
  };

  // Priced listings settle REAL OG via the buyer-funded rail; free listings use the
  // gas-free relayer access record. The copy is honest per rail — "paid" only when value moved.
  const priced = !!(it.priceLabel && it.priceLabel !== 'Free');
  const buyLabel = priced ? `Pay ${it.priceLabel}` : 'Get access';

  const onPurchased = (d) => {
    purchasedSet.add(it.listingId);
    btn.disabled = false;
    btn.textContent = 'Reveal';
    btn.onclick = reveal;
    note.className = 'listing-note ok';
    const label = d.rail === 'funded'
      ? `✓ paid ${it.priceLabel} on 0G · `        // real OG moved buyer → seller
      : '✓ access recorded on 0G (gas-free) · ';   // relayer record, no value moved
    if (d.onChain && d.explorerUrl) {
      note.replaceChildren(document.createTextNode(label));
      const a = el('a', 'listing-root', 'view tx ↗');
      a.href = d.explorerUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      note.appendChild(a);
    } else {
      note.textContent = '✓ access recorded (locally, on-chain record pending)';
    }
  };

  const doBuy = async () => {
    if (!identity) {
      openLogin('Sign in to buy and unlock sealed memories.');
      return;
    }
    btn.disabled = true;
    btn.textContent = priced ? `paying ${it.priceLabel}…` : 'recording…';
    try {
      const r = await fetch(priced ? '/api/market/buy-funded' : '/api/market/buy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listingId: it.listingId }),
      });
      if (r.status === 401) {
        openLogin('Sign in to buy sealed memories.');
        btn.disabled = false;
        btn.textContent = buyLabel;
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (r.status === 402) throw new Error(`not enough OG, fund your wallet to pay ${it.priceLabel}`);
      if (!r.ok) throw new Error(d.error || 'purchase failed');
      onPurchased(d);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = buyLabel;
      note.textContent = `✕ ${e.message}`;
      note.className = 'listing-note bad';
    }
  };

  if (mine || bought) {
    btn.textContent = mine ? 'Reveal (yours)' : 'Reveal';
    btn.onclick = reveal;
  } else {
    btn.textContent = buyLabel;
    btn.onclick = doBuy;
    note.textContent = priced
      ? 'pay in OG, settles buyer → seller on 0G, unlocks the sealed memory'
      : 'gas-free access record on 0G, unlocks real sealed content';
  }
  actions.appendChild(btn);
  if (note.textContent) actions.appendChild(note);
  card.appendChild(actions);

  // Verify the ciphertext is intact on 0G (sealed records verify via contentAddressOk).
  const ver = el('div', 'listing-verify');
  ver.appendChild(el('span', null, 'ciphertext'));
  const vlink = el('a', 'listing-root', `${it.cipherRootHash.slice(0, 10)}…${it.cipherRootHash.slice(-6)}`);
  vlink.href = '#';
  vlink.title = 'Verify the sealed ciphertext is intact on 0G';
  const vres = el('span', 'listing-vres', '');
  vlink.addEventListener('click', async (e) => {
    e.preventDefault();
    vres.textContent = ' checking…';
    vres.className = 'listing-vres';
    try {
      const r = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rootHash: it.cipherRootHash }),
      });
      const d = await r.json();
      if (d.contentAddressOk) {
        vres.textContent = ' ✓ sealed ciphertext intact on 0G';
        vres.className = 'listing-vres ok';
      } else {
        vres.textContent = ' ✕ could not verify';
        vres.className = 'listing-vres bad';
      }
    } catch (e2) {
      vres.textContent = ` ✕ ${e2.message}`;
      vres.className = 'listing-vres bad';
    }
  });
  ver.appendChild(vlink);
  ver.appendChild(vres);
  card.appendChild(ver);

  // On-chain settlement provenance: the listing + its purchases settle on 0G via the
  // KeepMarket contract — the unlock gate reads that chain state, not a server flag.
  if (marketChain.address) {
    const settle = el('div', 'listing-verify');
    settle.appendChild(el('span', null, 'registered on 0G'));
    const onTx = !!it.listTxHash;
    const slink = el('a', 'listing-root', onTx
      ? `${it.listTxHash.slice(0, 10)}…${it.listTxHash.slice(-6)}`
      : `${marketChain.address.slice(0, 10)}…${marketChain.address.slice(-6)}`);
    slink.href = `${marketChain.base}/${onTx ? 'tx/' + it.listTxHash : 'address/' + marketChain.address}`;
    slink.target = '_blank';
    slink.rel = 'noopener';
    slink.title = onTx ? 'Listing registered on 0G chain' : 'KeepMarket contract on 0G';
    settle.appendChild(slink);
    card.appendChild(settle);
  }

  return card;
}

marketBtn.addEventListener('click', openMarket);
marketBack.addEventListener('click', showChatView);

// ── Seal & list ──────────────────────────────────────────────────────────
let sealTurnId = null;
let sealScopeVal = 'user'; // 'user' = just my message | 'full' = the whole exchange

// Segmented "what to list" control.
if (sealScope) {
  sealScope.addEventListener('click', (e) => {
    const opt = e.target.closest('.scope-opt');
    if (!opt) return;
    sealScopeVal = opt.dataset.scope === 'full' ? 'full' : 'user';
    for (const b of sealScope.querySelectorAll('.scope-opt')) {
      b.classList.toggle('active', b === opt);
    }
  });
}
function setSealScope(scope) {
  sealScopeVal = scope === 'full' ? 'full' : 'user';
  if (sealScope) {
    for (const b of sealScope.querySelectorAll('.scope-opt')) {
      b.classList.toggle('active', b.dataset.scope === sealScopeVal);
    }
  }
}

function openSeal(turnId, prefill = {}) {
  if (!identity) {
    popover.hidden = true;
    openLogin('Sign in to seal & list this memory.');
    return;
  }
  sealTurnId = turnId;
  popover.hidden = true;
  sealTitle.value = prefill.title || '';
  sealTeaser.value = prefill.teaser || '';
  sealPrice.value = '';
  if (sealName) sealName.value = localStorage.getItem(LS_NAME) || '';
  setSealScope('user'); // default to "just my message" (your knowledge)
  sealMsg.textContent = '';
  sealMsg.className = 'modal-msg';
  sealSubmit.disabled = false;
  sealOverlay.hidden = false;
  sealTitle.focus();
}
function closeSeal() {
  sealOverlay.hidden = true;
}
sealClose.addEventListener('click', closeSeal);
sealOverlay.addEventListener('click', (e) => {
  if (e.target === sealOverlay) closeSeal();
});
sealSubmit.addEventListener('click', async () => {
  const title = sealTitle.value.trim();
  if (!title) {
    sealMsg.textContent = 'A title is required.';
    sealMsg.className = 'modal-msg bad';
    return;
  }
  const sellerName = sealName ? sealName.value.trim() : '';
  if (sellerName) localStorage.setItem(LS_NAME, sellerName); // remember it for next time
  sealSubmit.disabled = true;
  sealMsg.textContent = 'sealing & uploading ciphertext to 0G… (~15s)';
  sealMsg.className = 'modal-msg info';
  try {
    const r = await fetch('/api/market/seal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        turnId: sealTurnId,
        title,
        teaser: sealTeaser.value.trim(),
        priceOg: sealPrice.value.trim(),
        scope: sealScopeVal,
        sellerName,
      }),
    });
    if (r.status === 401) {
      closeSeal();
      openLogin('Sign in to seal & list this memory.');
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'could not seal');
    // Sealing marks the memory as a prediction (no separate "mark as call" control).
    if (sealTurnId) {
      setCall(sealTurnId, true);
      reflectCall(thread.querySelector(`.badge[data-turn-id="${CSS.escape(sealTurnId)}"]`));
    }
    sealMsg.textContent = '✓ sealed & listed, marked as a prediction';
    sealMsg.className = 'modal-msg ok';
    setTimeout(closeSeal, 950);
  } catch (e) {
    sealMsg.textContent = `✕ ${e.message}`;
    sealMsg.className = 'modal-msg bad';
    sealSubmit.disabled = false;
  }
});

// Recover rootHashes the browser never captured by merging the server index.
async function mergeServerRoots() {
  try {
    const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const { roots: serverRoots } = await res.json();
    if (!Array.isArray(serverRoots) || serverRoots.length === 0) return;
    const local = loadRoots();
    const have = new Set(local.map((r) => r.rootHash));
    let added = 0;
    for (const r of serverRoots) {
      if (r.rootHash && !have.has(r.rootHash)) {
        local.push({ turnId: r.turnId, rootHash: r.rootHash, txHash: undefined, ts: r.ts });
        have.add(r.rootHash);
        added++;
      }
    }
    if (added) {
      saveRoots(local);
      updateMemCount();
    }
  } catch {
    /* localStorage only */
  }
}

// ── Boot ────────────────────────────────────────────────
async function boot() {
  updateMemCount();
  await mergeServerRoots();

  const roots = sortedRootHashes();
  if (roots.length === 0) {
    addPlainAiMsg(
      identity
        ? "You're signed in, anything you tell me is yours, remembered on 0G, and you can mint any memory you want to own. What's on your mind?"
        : "Hi, I'm Keep. Anything you tell me gets written to 0G as a tamper-evident record you can verify, and I'll still remember it if you reload. Sign in (top right) to make your memories portable and ownable."
    );
    return;
  }

  restoredText.textContent = `rebuilding ${roots.length} memor${roots.length === 1 ? 'y' : 'ies'} from 0G…`;
  restored.hidden = false;
  try {
    const res = await fetch('/api/rehydrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, rootHashes: roots }),
    });
    if (!res.ok) {
      restoredText.textContent =
        res.status === 401
          ? 'Sign in again to rebuild your owned memories from 0G.'
          : "couldn't restore from 0G, please reload.";
      return;
    }
    const data = await res.json();
    let lastHandle = null;
    for (const t of data.turns) {
      const uh = addUserMsg(t.prompt);
      lastHandle = addAiMsg(t.response, {
        turnId: t.turnId,
        model: t.model,
        ts: t.ts,
        rootHash: t.rootHash,
        verified: t.verified,
        status: 'stored',
        userHandle: uh,
      });
    }
    toldCount = data.recovered;
    updateMemCount();
    decorateOwnership(data.turns.map((t) => t.rootHash)); // chain-sourced owned badges
    const verifiedNote = data.allVerified ? ', all verified ✓' : '';
    restoredText.textContent = data.serverHadSession
      ? `restored ${data.recovered} of ${data.requested} memories from 0G (re-fetched from the chain)${verifiedNote}`
      : `rebuilt this conversation from 0G, the server held nothing. ${data.recovered} of ${data.requested} memories restored${verifiedNote}.`;
    if (lastHandle) {
      lastHandle.badge.classList.add('attention');
      lastHandle.badge.addEventListener('animationend', () => lastHandle.badge.classList.remove('attention'), {
        once: true,
      });
    }
  } catch (err) {
    restoredText.textContent = `couldn't restore from 0G: ${err.message}`;
  }
}

renderIdentity();
updatePills();
boot();
