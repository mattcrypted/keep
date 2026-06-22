// Keep — client. Identity is a Privy embedded wallet (email login): memories are
// keyed off the wallet address and it owns the minted NFTs, so signing in on any
// device brings your memories back (from 0G) and your tokens with them. Anonymous
// use still works (random id); signing in is what makes it portable + ownable.

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
const pillOg = document.getElementById('pill-og');
const pillLlm = document.getElementById('pill-llm');
const restored = document.getElementById('restored');
const restoredText = document.getElementById('restored-text');

const popover = document.getElementById('popover');
const popStatus = document.getElementById('pop-status');
const popModel = document.getElementById('pop-model');
const popTime = document.getElementById('pop-time');
const popRoot = document.getElementById('pop-root');
const verifyBtn = document.getElementById('verify-btn');
const verifyResult = document.getElementById('verify-result');
const mintBtn = document.getElementById('mint-btn');
const mintResult = document.getElementById('mint-result');
// Track-2 sneak peek: "Call your shot" controls
const callToggle = document.getElementById('call-toggle');
const committedRow = document.getElementById('committed-row');
const committedVal = document.getElementById('committed-val');
const shareBtn = document.getElementById('share-btn');

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
    identityBtn.title = `Signed in as ${identity.email}\n${identity.address}\n(click to sign out)`;
  } else {
    identityBtn.textContent = loginReady ? 'sign in' : 'login off';
    identityBtn.classList.remove('ident');
    identityBtn.title = loginReady
      ? 'Sign in to own your memories and keep them across devices'
      : 'Login not configured (no Privy keys)';
  }
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
  thread.appendChild(msg);
  scroll();
}

function addAiMsg(text, { turnId, model, ts, rootHash, status, verified } = {}) {
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
      }
    },
  };
  handle.set(status || 'pending', { rootHash, model, ts, verified });
  scroll();
  return handle;
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
      if (turnId && !mintOf(turnId)) rememberMint(turnId, info.tokenId, info.txHash, info.anchoredAt);
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
        : 'saving — 0G writes take ~10–15s';
  popModel.textContent = badge.dataset.model || '—';
  popTime.textContent = badge.dataset.ts ? fmtTime(Number(badge.dataset.ts)) : '—';
  popRoot.textContent = rootHash || '—';
  const tx = txFor(rootHash);
  if (tx) popRoot.href = `https://storagescan-galileo.0g.ai/tx/${tx}`;
  else popRoot.removeAttribute('href');

  verifyResult.textContent = '';
  verifyResult.className = 'verify-result';
  verifyBtn.disabled = status !== 'stored';
  verifyBtn.dataset.rootHash = rootHash;

  mintResult.textContent = '';
  mintResult.className = 'mint-result';
  mintBtn.dataset.turnId = turnId;
  if (minted) {
    mintBtn.textContent = 'Owned ⬦';
    mintBtn.disabled = true;
    mintResult.textContent = `#${minted.tokenId} — yours on 0G`;
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

  // Track-2 "Call your shot": label toggle + trustless committed-at-block-time proof.
  if (callToggle) {
    callToggle.checked = isCall(turnId);
    callToggle.dataset.turnId = turnId || '';
  }
  if (committedRow) {
    if (minted && minted.anchoredAt) {
      committedRow.hidden = false;
      committedVal.textContent = 'committed at block-time ' + fmtTime(minted.anchoredAt * 1000);
    } else {
      committedRow.hidden = true;
    }
  }
  if (shareBtn) {
    shareBtn.hidden = !(minted && minted.anchoredAt);
    shareBtn.dataset.turnId = turnId || '';
  }

  const r = badge.getBoundingClientRect();
  popover.hidden = false;
  const top = Math.min(r.bottom + 8, window.innerHeight - popover.offsetHeight - 12);
  const left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 12);
  popover.style.top = `${Math.max(12, top)}px`;
  popover.style.left = `${Math.max(12, left)}px`;
}

document.addEventListener('click', (e) => {
  if (!popover.hidden && !popover.contains(e.target) && !e.target.closest('.badge')) {
    popover.hidden = true;
  }
});

verifyBtn.addEventListener('click', async () => {
  const rootHash = verifyBtn.dataset.rootHash;
  if (!rootHash) return;
  verifyBtn.disabled = true;
  verifyResult.textContent = 'checking 0G…';
  verifyResult.className = 'verify-result';
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootHash }),
    });
    const data = await res.json();
    if (data.ok) {
      verifyResult.textContent = '✓ unaltered — re-fetched from 0G & re-hashed';
      verifyResult.className = 'verify-result ok';
    } else {
      verifyResult.textContent = `✕ ${res.ok ? 'mismatch — record altered' : data.error || 'verify failed'}`;
      verifyResult.className = 'verify-result bad';
    }
  } catch (err) {
    verifyResult.textContent = `✕ ${err.message}`;
    verifyResult.className = 'verify-result bad';
  } finally {
    verifyBtn.disabled = false;
  }
});

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
    const tokenId = data.tokenId || (data.alreadyMinted ? '—' : '?');
    rememberMint(turnId, tokenId, data.txHash, data.anchoredAt);
    mintResult.textContent = data.alreadyMinted ? 'already owned ⬦' : `minted ⬦ #${tokenId} — yours on 0G`;
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

// ── "Call your shot" toggle + shareable proof card (Track-2) ─────
if (callToggle) {
  callToggle.addEventListener('change', () => {
    const tid = callToggle.dataset.turnId;
    if (!tid) return;
    setCall(tid, callToggle.checked);
    reflectCall(thread.querySelector(`.badge[data-turn-id="${CSS.escape(tid)}"]`));
  });
}
if (shareBtn) {
  shareBtn.addEventListener('click', () => buildShareCard(shareBtn.dataset.turnId));
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
  x.fillStyle = '#0e1116';
  x.fillRect(0, 0, W, H);
  x.strokeStyle = '#1c7a63';
  x.lineWidth = 2;
  x.strokeRect(14, 14, W - 28, H - 28);
  x.fillStyle = '#2dd4a7';
  x.font = 'bold 30px system-ui, sans-serif';
  x.fillText('◆ Keep — Call committed', 40, 72);
  x.fillStyle = '#9aa7b4';
  x.font = '15px system-ui, sans-serif';
  x.fillText('Committed at block-time (0G Chain · trustless):', 40, 130);
  x.fillStyle = '#e8edf2';
  x.font = 'bold 22px system-ui, sans-serif';
  x.fillText(when, 40, 166);
  x.fillStyle = '#9aa7b4';
  x.font = '14px ui-monospace, monospace';
  x.fillText('Token #' + (minted.tokenId ?? '—'), 40, 214);
  if (minted.txHash) x.fillText('tx ' + minted.txHash.slice(0, 34) + '…', 40, 238);
  x.fillStyle = '#9aa7b4';
  x.font = '13px system-ui, sans-serif';
  x.fillText('Proof of WHEN this call was committed on-chain —', 40, 300);
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
      `Keep — call committed at block-time ${when} (0G Chain, trustless). ` +
        `Token #${minted.tokenId ?? '—'}. Proof of WHEN it was committed — ` +
        `not that it's correct, nor which model wrote it.`
    )
    .catch(() => {});
  shareBtn.textContent = 'card saved ✓';
  setTimeout(() => {
    if (shareBtn) shareBtn.textContent = 'Share card ⬦';
  }, 1800);
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
  input.value = '';
  sendBtn.disabled = true;
  addUserMsg(text);
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
    const handle = addAiMsg(data.reply, { turnId: data.turnId, model: data.model, ts: data.ts });
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
identityBtn.addEventListener('click', () => {
  if (!loginReady) return;
  if (identity) {
    if (confirm(`Sign out of ${identity.email}? (your memories stay safe on 0G and come back when you sign in again)`)) {
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); // clear the httpOnly cookie
      localStorage.removeItem(LS_IDENTITY);
      identity = null;
      sessionId = anonId();
      renderIdentity();
      switchIdentity();
    }
  } else {
    openLogin();
  }
});

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
      ? "That code didn't match — it may be expired or already used. Tap “resend a fresh code” and enter the newest one."
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
    loginMsg.textContent = `Fresh code sent to ${email} — enter the newest one.`;
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
    pillLlm.textContent = h.llmReady ? h.model : 'no LLM key';
    pillLlm.className = 'pill ' + (h.llmReady ? '' : 'bad');
    if (h.ogReady && h.wallet?.balance != null) {
      pillOg.textContent = `0G ✓ ${Number(h.wallet.balance).toFixed(2)}`;
      pillOg.className = 'pill';
    } else if (h.wallet?.error) {
      pillOg.textContent = '0G — RPC slow';
      pillOg.className = 'pill muted';
    } else {
      pillOg.textContent = '0G unfunded';
      pillOg.className = 'pill bad';
    }
  } catch {
    pillOg.textContent = '0G — checking';
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
        ? "You're signed in — anything you tell me is yours, remembered on 0G, and you can mint any memory you want to own. What's on your mind?"
        : "Hi — I'm Keep. Anything you tell me gets written to 0G as a tamper-evident record you can verify, and I'll still remember it if you reload. Sign in (top right) to make your memories portable and ownable."
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
          : "couldn't restore from 0G — please reload.";
      return;
    }
    const data = await res.json();
    let lastHandle = null;
    for (const t of data.turns) {
      addUserMsg(t.prompt);
      lastHandle = addAiMsg(t.response, {
        turnId: t.turnId,
        model: t.model,
        ts: t.ts,
        rootHash: t.rootHash,
        verified: t.verified,
        status: 'stored',
      });
    }
    toldCount = data.recovered;
    updateMemCount();
    decorateOwnership(data.turns.map((t) => t.rootHash)); // chain-sourced owned badges
    const verifiedNote = data.allVerified ? ' — all verified ✓' : '';
    restoredText.textContent = data.serverHadSession
      ? `restored ${data.recovered} of ${data.requested} memories from 0G (re-fetched from the chain)${verifiedNote}`
      : `rebuilt this conversation from 0G — the server held nothing. ${data.recovered} of ${data.requested} memories restored${verifiedNote}.`;
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
