// Keep — Sealed Market store: listings + (structurally separate) keys + grants.
//
// Mirrors index-store.mjs: one JSON file on KEEP_DATA_DIR (the Railway volume,
// gitignored via data/*), loaded on boot, persisted on every write. The three
// maps are kept STRUCTURALLY SEPARATE — a public read path (listPublic) only ever
// touches `listings`, so a symmetric key or a purchase grant can never be
// serialized into a browse response, even if the listing shape changes. toPublic()
// whitelists fields one-by-one (it NEVER spreads a listing) for the same reason.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.KEEP_DATA_DIR || join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'market.json');

let _state = { listings: {}, keys: {}, grants: {} };
try {
  if (existsSync(FILE)) {
    const loaded = JSON.parse(readFileSync(FILE, 'utf8'));
    _state = {
      listings: loaded.listings || {},
      keys: loaded.keys || {},
      grants: loaded.grants || {},
    };
  }
} catch (err) {
  console.error('[market] load failed, starting empty:', err.message);
  _state = { listings: {}, keys: {}, grants: {} };
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(_state));
  } catch (err) {
    console.error('[market] write failed:', err.message);
  }
}

const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');

// PUBLIC projection: a field-by-field whitelist. It NEVER spreads the listing and
// NEVER reads keys/grants — so iv/tag/ct/key/grant data cannot leak into a browse
// or buy response. This is the only shape any unauthenticated caller ever sees.
export function toPublic(l) {
  return {
    listingId: l.listingId,
    seller: l.seller,
    sellerShort: shortAddr(l.seller),
    title: l.title,
    teaser: l.teaser,
    priceLabel: l.priceLabel,
    model: l.model,
    sealedAt: l.sealedAt,
    createdAt: l.createdAt,
    cipherRootHash: l.cipherRootHash,
    sourceRootHash: l.sourceRootHash,
    listTxHash: l.listTxHash || null, // on-chain provenance of the listing (public)
  };
}

export function addListing(listing) {
  _state.listings[listing.listingId] = listing;
  persist();
}
// Record the on-chain listing tx hash once list() lands (provenance + UI link).
export function setListTx(id, txHash) {
  const l = _state.listings[id];
  if (l) {
    l.listTxHash = txHash;
    persist();
  }
}
export function getListing(id) {
  return _state.listings[id];
}
export function listPublic() {
  return Object.values(_state.listings)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublic);
}

// Secret store — kept in its own map, only ever read inside the unlock gate.
export function setKey(id, keyB64) {
  _state.keys[id] = keyB64;
  persist();
}
export function getKey(id) {
  return _state.keys[id];
}

// Purchase grants — idempotent (re-buy is a no-op, so buy is replay-safe).
export function grantBuyer(id, addrLower) {
  const g = (_state.grants[id] ||= {});
  if (!g[addrLower]) {
    g[addrLower] = { at: Date.now() };
    persist();
  }
}
export function hasGrant(id, addrLower) {
  return !!(_state.grants[id] && _state.grants[id][addrLower]);
}

// Dedupe: an existing listing by this seller for this exact source memory. Re-sealing
// the same memory returns it instead of paying for another upload + another list() tx.
export function findBySource(sellerLower, sourceRootHash) {
  return Object.values(_state.listings).find(
    (l) => l.seller === sellerLower && l.sourceRootHash === sourceRootHash
  );
}

// For the UI's owner/unlocked states.
export function listingsBySeller(addrLower) {
  return Object.values(_state.listings)
    .filter((l) => l.seller === addrLower)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublic);
}
export function grantsOfBuyer(addrLower) {
  return Object.keys(_state.grants).filter((id) => _state.grants[id] && _state.grants[id][addrLower]);
}
