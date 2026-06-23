// Durable receipt index: sessionId → [{ rootHash, ts, turnId }].
//
// The 0G RECORDS are the memory — content and verifiability live on-chain. This
// is only a list of their 0G addresses, so a client can find its records even if
// the browser never captured a rootHash (tab closed during the ~14s write) or
// localStorage was cleared. It's written the moment the server-side 0G write
// COMPLETES, independent of whether the browser is still open, and persisted to
// disk so it survives server restarts. Pointers, not memory — 0G stays load-bearing.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The mutable index lives here; defaults to <repo>/data for local dev. In
// production (e.g. Railway) point KEEP_DATA_DIR at a persistent volume so the
// index survives redeploys — and so the volume never shadows the image's
// read-only data/deploy.json (which chain.mjs still loads from <repo>/data).
const DATA_DIR = process.env.KEEP_DATA_DIR || join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'index.json');

let _index = {}; // { [sessionId]: [{ rootHash, ts, turnId }] }

try {
  if (existsSync(FILE)) _index = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (err) {
  // Move the corrupt file aside so the next persist() can't overwrite it with empty state.
  try { renameSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch { /* best effort */ }
  console.error('[index] load failed, moved corrupt file aside, starting empty:', err.message);
  _index = {};
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Atomic write: serialize to a temp file, then rename over the target. A crash or
    // disk-full mid-write can no longer truncate the live file (rename is atomic on one FS).
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(_index));
    renameSync(tmp, FILE);
  } catch (err) {
    console.error('[index] write failed:', err.message);
  }
}

// Record a turn's 0G address under its session (idempotent on rootHash).
export function addToIndex(sessionId, { rootHash, ts, turnId }) {
  const list = (_index[sessionId] ||= []);
  if (list.some((e) => e.rootHash === rootHash)) return;
  list.push({ rootHash, ts, turnId });
  persist();
}

// All known rootHashes for a session, chronological.
export function getIndex(sessionId) {
  return (_index[sessionId] || []).slice().sort((a, b) => a.ts - b.ts);
}
