// Keep — Round-1 backend.
// Browser chat UI → this server. The server holds the LLM key + the one
// faucet-funded 0G wallet, so end users need no wallet/MetaMask (zero-friction
// demo). Each turn: call the LLM, return the reply instantly, then persist the
// record to 0G in the background (the write takes ~14s). The browser keeps the
// ordered rootHashes; on reload it asks /api/rehydrate to rebuild memory FROM 0G
// — which is what makes 0G load-bearing, not a bolt-on.
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildRecord, recordHash, putRecord, getRecord, rootHashOf, walletStatus } from './og.mjs';
import { chat, llmReady, MODEL } from './llm.mjs';
import { addToIndex, getIndex } from './index-store.mjs';
import { mintMemory, mintingReady, contractAddress, mintStatusOf, galleryOf } from './chain.mjs';
import { sendEmailCode, verifyEmailCode, privyReady } from './privy.mjs';
import {
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  sessionAddress,
  gateSession,
} from './session.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const app = express();
// Behind exactly one reverse proxy in a typical deploy (Render/Fly/ngrok), so
// req.ip is the real client IP, not the proxy's; harmless on localhost. Do NOT
// raise this to trust an unbounded X-Forwarded-For chain — that lets clients spoof.
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.static(PUBLIC_DIR));

// ── In-memory session store (the LIVE working copy). 0G is the durable copy.
// sessions: Map<sessionId, { turns: Turn[] }>
// Turn = { turnId, prompt, response, model, ts, hash, receipt }
// receipt = { status: 'pending'|'stored'|'error', rootHash?, txHash?, error? }
const sessions = new Map();
const MAX_SESSIONS = 2000; // bound RAM — 0G + the durable index are the real store

function getSession(id) {
  let s = sessions.get(id);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      // FIFO-evict the oldest working copy; its memory still lives on 0G.
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    s = { turns: [] };
    sessions.set(id, s);
  }
  return s;
}

// Rebuild the LLM-shaped history from stored turns.
function historyOf(session) {
  return session.turns.flatMap((t) => [
    { role: 'user', content: t.prompt },
    { role: 'assistant', content: t.response },
  ]);
}

// ── Abuse guard. Every /api/chat turn spends LLM budget AND real testnet 0G
// gas from one shared wallet, so an open endpoint is a drain / cost-DoS vector.
// In-memory limits are enough for a demo: per-IP burst + per-IP AND global daily
// ceilings (so one IP can't lock out every other user by exhausting a single
// global counter). Counting is deferred to countSpend(), called only AFTER a real
// spend succeeds — so failed LLM calls / no-op mints don't burn the budget.
const LIMITS = {
  windowMs: 20_000,
  perWindow: Number(process.env.KEEP_RL_BURST) || 5,
  perDayGlobal: Number(process.env.KEEP_RL_DAY_GLOBAL) || 300,
  perDayIp: Number(process.env.KEEP_RL_DAY_IP) || 60,
};
const DAY_MS = 86_400_000;
const _ipHits = new Map(); // ip -> [timestamps] within the burst window
let _day = { start: Date.now(), count: 0 }; // global daily spend (backstop)
const _ipDay = new Map(); // ip -> { start, count } daily spend per IP

const clientIp = (req) => req.ip || 'unknown';
function rollDay(now) {
  if (now - _day.start > DAY_MS) _day = { start: now, count: 0 };
}

function rateLimit(req, res, next) {
  const now = Date.now();
  rollDay(now);
  if (_day.count >= LIMITS.perDayGlobal) {
    return res.status(429).json({ error: 'Daily demo limit reached — please try again later.' });
  }
  const ip = clientIp(req);
  const d = _ipDay.get(ip);
  if (d && now - d.start <= DAY_MS && d.count >= LIMITS.perDayIp) {
    return res.status(429).json({ error: 'Daily limit reached for your address — try again later.' });
  }
  const hits = (_ipHits.get(ip) || []).filter((t) => now - t < LIMITS.windowMs);
  if (hits.length >= LIMITS.perWindow) {
    return res.status(429).json({ error: 'One moment — too many messages too fast.' });
  }
  hits.push(now);
  _ipHits.set(ip, hits);
  if (_ipHits.size > 5000) pruneIpHits(now); // bound memory: drop stale IP buckets
  next();
}

function pruneIpHits(now) {
  for (const [ip, arr] of _ipHits) {
    const live = arr.filter((t) => now - t < LIMITS.windowMs);
    if (live.length) _ipHits.set(ip, live);
    else _ipHits.delete(ip);
  }
}

// Count one real spend (a completed LLM turn or a broadcast mint) against both the
// global and per-IP daily ceilings. Call this AFTER the spend succeeds.
function countSpend(req) {
  const now = Date.now();
  rollDay(now);
  _day.count++;
  const ip = clientIp(req);
  const d = _ipDay.get(ip);
  if (d && now - d.start <= DAY_MS) d.count++;
  else _ipDay.set(ip, { start: now, count: 1 });
}

// ── Per-email throttles for the auth flow (independent of IP): a send cooldown
// (anti email-bomb) and a failed-verify cap (anti OTP brute force).
const _emailSendAt = new Map(); // email -> last send ts
const _verifyFails = new Map(); // email -> { count, start }
const EMAIL_COOLDOWN_MS = 60_000;
const VERIFY_MAX = 6;
const VERIFY_WINDOW_MS = 10 * 60_000;

// Persist to 0G with a couple of retries — cuts the "silently forgot that turn"
// rate when a single upload hits a transient node/network hiccup.
async function persistWithRetry(record, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await putRecord(record);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── Chat: LLM reply now, 0G write in the background.
app.post('/api/chat', rateLimit, async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }
  if (!llmReady()) {
    return res.status(503).json({
      error: 'LLM not configured. Add ANTHROPIC_API_KEY to .env and restart.',
    });
  }
  // A wallet-keyed session may only be driven by its authenticated owner — else an
  // attacker could read or inject turns into another user's memory by address.
  if (!gateSession(req, res, sessionId)) return;

  const session = getSession(sessionId);

  let reply;
  try {
    const messages = [...historyOf(session), { role: 'user', content: message }];
    const out = await chat(messages);
    reply = out.text;
  } catch (err) {
    console.error('[llm] chat failed:', err.message);
    return res.status(502).json({ error: 'the chat model is unavailable right now — try again.' });
  }
  countSpend(req); // a real LLM turn just completed — now it counts against the ceiling

  const ts = Date.now();
  const record = buildRecord({ sessionId, prompt: message, response: reply, model: MODEL, ts });
  const turnId = record.hash; // content-addressed → unique per turn

  const turn = {
    turnId,
    prompt: message,
    response: reply,
    model: MODEL,
    ts,
    hash: record.hash,
    receipt: { status: 'pending' },
  };
  session.turns.push(turn);

  // Background persist to 0G. The client polls /api/receipt for the rootHash.
  // On success we ALSO write the address to the durable index — independent of
  // whether the browser is still open — so the turn is recoverable even if the
  // tab closed during this ~14s write.
  persistWithRetry(record)
    .then(({ rootHash, txHash }) => {
      turn.receipt = { status: 'stored', rootHash, txHash };
      addToIndex(sessionId, { rootHash, ts, turnId });
    })
    .catch((err) => {
      turn.receipt = { status: 'error', error: err.message };
      console.error(`[0G] persist failed for turn ${turnId.slice(0, 12)}:`, err.message);
    });

  res.json({ reply, turnId, model: MODEL, ts, count: session.turns.length });
});

// ── Receipt status for one turn (client polls until 'stored' or 'error').
app.get('/api/receipt/:sessionId/:turnId', (req, res) => {
  if (!gateSession(req, res, req.params.sessionId)) return;
  const session = sessions.get(req.params.sessionId);
  const turn = session?.turns.find((t) => t.turnId === req.params.turnId);
  if (!turn) return res.status(404).json({ error: 'turn not found' });
  res.json({ ...turn.receipt, model: turn.model, ts: turn.ts, hash: turn.hash });
});

// ── Verify: fetch by rootHash, recompute, confirm nothing was altered.
app.post('/api/verify', async (req, res) => {
  const { rootHash } = req.body || {};
  if (typeof rootHash !== 'string' || !rootHash.startsWith('0x')) {
    return res.status(400).json({ error: 'rootHash required' });
  }
  try {
    const { record, bytes } = await getRecord(rootHash);
    const rederivedRoot = await rootHashOf(bytes);
    const contentAddressOk = rederivedRoot === rootHash;
    const innerHashOk = recordHash(record) === record.hash;
    res.json({
      ok: contentAddressOk && innerHashOk,
      contentAddressOk, // bytes still hash to this rootHash (unaltered on 0G)
      innerHashOk, // prompt+response+model+ts still matches the stamped hash
      record,
      rootHash,
      rederivedRoot,
    });
  } catch (err) {
    res.status(502).json({ error: `verify failed: ${err.message}` });
  }
});

// ── Rehydrate: rebuild a session's memory purely from 0G rootHashes.
// This is the proof that memory is real and 0G is load-bearing: wipe the
// server, and the conversation comes back from the chain alone.
app.post('/api/rehydrate', rateLimit, async (req, res) => {
  const { sessionId, rootHashes } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  if (!Array.isArray(rootHashes)) {
    return res.status(400).json({ error: 'rootHashes array required' });
  }
  if (!gateSession(req, res, sessionId)) return;

  // Cap + de-dupe the request: one POST otherwise forces an unbounded number of
  // sequential 0G downloads (request-amplification DoS). 200 turns is ample.
  const MAX_REHYDRATE = 200;
  const cleaned = [...new Set(rootHashes.filter((h) => typeof h === 'string' && h.startsWith('0x')))];
  if (cleaned.length > MAX_REHYDRATE) {
    console.warn(`[rehydrate] capping ${cleaned.length} → ${MAX_REHYDRATE} roots for ${sessionId.slice(0, 10)}`);
  }
  const wanted = cleaned.slice(0, MAX_REHYDRATE);

  // Did the server still have this conversation in RAM? If not, the ONLY source
  // for the rebuilt memory below is 0G itself — that's the eligibility proof.
  const prior = sessions.get(sessionId);
  const serverHadSession = !!(prior && prior.turns.length);

  const turns = [];
  for (const rootHash of wanted) {
    try {
      const { record, bytes } = await getRecord(rootHash);
      // Verify as we restore: rehydration IS the tamper-check, not a later click.
      // Re-derive the rootHash from fetched bytes + re-check the provenance hash.
      const rederived = await rootHashOf(bytes);
      const verified = rederived === rootHash && recordHash(record) === record.hash;
      turns.push({
        turnId: record.hash,
        prompt: record.prompt,
        response: record.response,
        model: record.model,
        ts: record.ts,
        hash: record.hash,
        verified,
        rootHash,
      });
    } catch (err) {
      console.error(`[0G] rehydrate failed for ${rootHash.slice(0, 12)}:`, err.message);
      // Skip unfetchable records; report how many we recovered.
    }
  }

  // Restore chronological order from the records' own timestamps. Receipts can
  // land out of send-order (independent ~14s writes), so never trust array order.
  turns.sort((a, b) => a.ts - b.ts);

  sessions.set(sessionId, {
    turns: turns.map((t) => ({
      turnId: t.turnId,
      prompt: t.prompt,
      response: t.response,
      model: t.model,
      ts: t.ts,
      hash: t.hash,
      receipt: { status: 'stored', rootHash: t.rootHash },
    })),
  });

  res.json({
    turns: turns.map(({ prompt, response, model, ts, turnId, rootHash, verified }) => ({
      prompt,
      response,
      model,
      ts,
      turnId,
      rootHash,
      verified,
    })),
    recovered: turns.length,
    requested: wanted.length,
    serverHadSession,
    allVerified: turns.length > 0 && turns.every((t) => t.verified),
  });
});

// ── Forget: wipe the in-memory copy so the next reload MUST rebuild from 0G.
// The "prove it" affordance — after this, server RAM holds nothing, so memory
// can only come back from the chain.
app.post('/api/forget', (req, res) => {
  const { sessionId } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  if (!gateSession(req, res, sessionId)) return;
  const existed = sessions.delete(sessionId);
  res.json({ forgotten: existed });
});

// ── Durable index: the 0G addresses this server has ever stored for a session.
// The client merges these on load, so a turn whose ~14s write completed is
// recoverable even if the browser never captured its rootHash. Note this does
// NOT bypass 0G — it returns only addresses; the memory itself is still fetched
// and re-verified from the chain by /api/rehydrate.
app.get('/api/session/:sessionId', (req, res) => {
  if (!gateSession(req, res, req.params.sessionId)) return;
  res.json({ roots: getIndex(req.params.sessionId) });
});

// ── Mint: turn a stored memory into an owned NFT on 0G Chain + anchor its
// rootHash on-chain. Opt-in (user clicks). The app wallet relays the mint and
// mints TO the user's address, so the user owns it without needing gas.
app.post('/api/mint', rateLimit, async (req, res) => {
  const { sessionId, turnId } = req.body || {};
  if (!mintingReady()) {
    return res.status(503).json({ error: 'Minting not configured — deploy the contract first.' });
  }
  // The owner is the SERVER-VERIFIED identity (from the email-OTP session cookie),
  // never a client-supplied address — otherwise anyone could mint another user's
  // memory to their own wallet and permanently capture its on-chain ownership.
  const owner = sessionAddress(req);
  if (!owner) {
    return res.status(401).json({ error: 'sign in to mint this memory' });
  }
  if (typeof sessionId !== 'string' || typeof turnId !== 'string') {
    return res.status(400).json({ error: 'sessionId and turnId required' });
  }
  // ...and you can only mint memories under your own identity.
  if (!gateSession(req, res, sessionId)) return;

  // Resolve the memory's rootHash + ts (live session first, durable index fallback).
  let rootHash, ts;
  const turn = sessions.get(sessionId)?.turns.find(
    (t) => t.turnId === turnId && t.receipt?.status === 'stored'
  );
  if (turn) {
    rootHash = turn.receipt.rootHash;
    ts = turn.ts;
  } else {
    const entry = getIndex(sessionId).find((e) => e.turnId === turnId);
    if (entry) {
      rootHash = entry.rootHash;
      ts = entry.ts;
    }
  }
  if (!rootHash) {
    return res.status(404).json({ error: 'memory not found or not yet stored on 0G' });
  }

  try {
    const result = await mintMemory({ owner, rootHash, model: MODEL, ts });
    if (result.txHash && !result.alreadyMinted) countSpend(req); // count only a real broadcast
    res.json({
      ...result,
      rootHash,
      contract: contractAddress(),
      explorer: result.txHash ? `https://chainscan-galileo.0g.ai/tx/${result.txHash}` : null,
    });
  } catch (err) {
    console.error('[mint] failed:', err.message);
    res.status(502).json({ error: 'mint failed — please try again.' });
  }
});

// ── Owned: chain-sourced ownership for a session's memories. For each rootHash
// that's minted, returns its tokenId + owner — so the UI can show "owned ⬦ #N" on
// any device (ownership lives on-chain, not in the browser's localStorage).
app.post('/api/owned', rateLimit, async (req, res) => {
  const { sessionId, rootHashes } = req.body || {};
  if (!mintingReady()) return res.json({ owned: {} });
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  if (!Array.isArray(rootHashes)) {
    return res.status(400).json({ error: 'rootHashes array required' });
  }
  if (!gateSession(req, res, sessionId)) return;
  const roots = [...new Set(rootHashes.filter((h) => typeof h === 'string' && h.startsWith('0x')))].slice(0, 200);
  const owned = {};
  await Promise.all(
    roots.map(async (rh) => {
      try {
        const s = await mintStatusOf(rh);
        if (s.minted) owned[rh] = { tokenId: s.tokenId, owner: s.owner, anchoredAt: s.anchoredAt };
      } catch {
        /* skip unreadable root */
      }
    })
  );
  res.json({ owned });
});

// ── Gallery: a signed-in user's PRIVATE collection — every memory they've minted,
// enumerated from the chain (MemoryAnchored events for their address), with the
// content re-fetched from 0G. Read-only and gated to the owning identity: the
// `owner` is the cookie-verified wallet, never client-supplied.
app.get('/api/gallery/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!mintingReady()) return res.json({ items: [] });
  if (!gateSession(req, res, sessionId)) return;
  const owner = sessionAddress(req);
  if (!owner) return res.json({ items: [] }); // anonymous sessions own nothing

  try {
    const tokens = await galleryOf(owner);
    // Pull each memory's content from 0G in parallel; content is best-effort so a
    // single slow/unavailable record never blanks the whole gallery.
    const items = await Promise.all(
      tokens.map(async (t) => {
        let prompt = null;
        let response = null;
        try {
          const { record } = await getRecord(t.rootHash);
          prompt = record.prompt;
          response = record.response;
        } catch {
          /* leave content null — card still shows tokenId + on-chain proof */
        }
        return { ...t, prompt, response };
      })
    );
    res.json({ owner, items });
  } catch (err) {
    console.error('[gallery] failed:', err.message);
    res.status(502).json({ error: 'could not load your gallery — please try again.' });
  }
});

// ── Identity: email-OTP login via Privy → embedded wallet address = identity.
app.post('/api/auth/email/send', rateLimit, async (req, res) => {
  const { email } = req.body || {};
  if (!privyReady()) return res.status(503).json({ error: 'Login not configured (no Privy keys).' });
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }
  // Per-email cooldown (independent of IP) so a chosen inbox can't be code-bombed.
  const key = email.trim().toLowerCase();
  if (Date.now() - (_emailSendAt.get(key) || 0) < EMAIL_COOLDOWN_MS) {
    return res.status(429).json({ error: 'A code was just sent — check your inbox or wait a moment.' });
  }
  _emailSendAt.set(key, Date.now());
  try {
    await sendEmailCode(email.trim());
    res.json({ sent: true });
  } catch (err) {
    console.error('[auth] send failed:', err.message);
    res.status(502).json({ error: "couldn't send a code right now — please try again." });
  }
});

app.post('/api/auth/email/verify', rateLimit, async (req, res) => {
  const { email, code } = req.body || {};
  if (!privyReady()) return res.status(503).json({ error: 'Login not configured (no Privy keys).' });
  if (typeof email !== 'string' || typeof code !== 'string' || !email.trim() || !code.trim()) {
    return res.status(400).json({ error: 'email and code required' });
  }
  // Cap failed attempts per email to blunt OTP brute force (defense-in-depth atop
  // Privy's own limits + the per-IP rateLimit above).
  const key = email.trim().toLowerCase();
  const f = _verifyFails.get(key);
  if (f && Date.now() - f.start < VERIFY_WINDOW_MS && f.count >= VERIFY_MAX) {
    return res.status(429).json({ error: 'Too many attempts — request a fresh code and wait a few minutes.' });
  }
  try {
    const { address, userId, email: verifiedEmail } = await verifyEmailCode(email.trim(), code.trim());
    _verifyFails.delete(key);
    // Identity is now proven server-side — issue a signed, httpOnly session cookie.
    // Every identity-scoped route derives the address from THIS, not from the client.
    setSessionCookie(res, issueToken(address));
    res.json({ address, userId, email: verifiedEmail });
  } catch (err) {
    const ff = f && Date.now() - f.start < VERIFY_WINDOW_MS ? f : { count: 0, start: Date.now() };
    ff.count++;
    _verifyFails.set(key, ff);
    console.error('[auth] verify failed:', err.message);
    res.status(401).json({ error: 'verification failed — check the newest code or resend.' });
  }
});

// ── Logout: clear the server session cookie (httpOnly, so JS can't clear it).
app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── Health / readiness (drives the status pills in the header).
let _walletCache = { at: 0, value: null };
app.get('/api/health', async (_req, res) => {
  let wallet = null;
  let ogReady = false;
  try {
    const fresh = Date.now() - _walletCache.at < 10_000;
    const w = fresh && _walletCache.value ? _walletCache.value : await walletStatus();
    _walletCache = { at: Date.now(), value: w };
    wallet = w;
    ogReady = Number(w.balance) > 0;
  } catch (err) {
    wallet = { error: err.message };
  }
  res.json({
    wallet,
    ogReady,
    llmReady: llmReady(),
    model: MODEL,
    mintingReady: mintingReady(),
    contract: contractAddress(),
    loginReady: privyReady(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Keep — running at http://localhost:${PORT}`);
  console.log(`  LLM: ${llmReady() ? MODEL : 'NOT configured (set ANTHROPIC_API_KEY)'}`);
  console.log(`  0G:  persisting records to Galileo testnet\n`);
});
