// Keep — reusable 0G Storage helpers (Round-1 backend).
// One record object, two jobs: it's the AI's memory AND its tamper-evident receipt.
// The rootHash returned by upload is content-addressed: change one byte and it changes.
import 'dotenv/config';
import { MemData, Indexer } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';
import { createHash } from 'node:crypto';

export const RPC = process.env.OG_RPC || 'https://evmrpc-testnet.0g.ai';
export const INDEXER_URL =
  process.env.OG_INDEXER || 'https://indexer-storage-testnet-turbo.0g.ai';

// Semantic binding of the record's claimed content + provenance: ties the prompt,
// response, claimed model, and time together so any later edit is detectable.
// (It attests the claimed model/time — not which model actually generated the text.)
export function recordHash({ prompt, response, model, ts }) {
  return createHash('sha256').update(`${prompt}${response}${model}${ts}`).digest('hex');
}

// Build a complete record (memory + receipt) from a turn.
export function buildRecord({ sessionId, prompt, response, model, ts = Date.now() }) {
  const base = { sessionId, prompt, response, model, ts };
  return { ...base, hash: recordHash(base) };
}

let _indexer;
export function indexer() {
  return (_indexer ??= new Indexer(INDEXER_URL));
}

// Wallet address + live balance, for the /api/health readiness check.
// Throws if OG_KEY is unset — callers should try/catch and report "not ready".
export async function walletStatus() {
  const s = signer();
  const bal = await s.provider.getBalance(s.address);
  return { address: s.address, balance: ethers.formatEther(bal) };
}

let _signer;
export function signer() {
  if (_signer) return _signer;
  const key = process.env.OG_KEY;
  if (!key) {
    throw new Error(
      'OG_KEY not set. Run `npm run wallet`, fund the printed address at faucet.0g.ai, then put the key in .env.'
    );
  }
  const provider = new ethers.JsonRpcProvider(RPC);
  _signer = new ethers.Wallet(key, provider);
  return _signer;
}

// WRITE: upload a record to 0G. Returns the receipt (rootHash + txHash).
export async function putRecord(record) {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const data = new MemData(bytes);

  // Local merkle root — what the content *should* address to.
  const [tree, treeErr] = await data.merkleTree();
  if (treeErr) throw treeErr;
  const localRoot = tree.rootHash();

  const [res, upErr] = await indexer().upload(data, RPC, signer());
  if (upErr) throw upErr;

  const rootHash = res.rootHash ?? localRoot;
  return { rootHash, txHash: res.txHash, localRoot };
}

// READ / VERIFY: fetch by rootHash with merkle proof. Works in browser or Node.
export async function getRecord(rootHash) {
  const [blob, dlErr] = await indexer().downloadToBlob(rootHash, { proof: true });
  if (dlErr) throw dlErr;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Enforce content-addressing on the READ path: the bytes the indexer returned MUST hash
  // back to the rootHash we asked for, or we refuse to trust them. Without this a malicious
  // or buggy indexer could swap a record's bytes and every caller would believe it (the
  // sealed path is saved by GCM, but gallery/rehydrate/verify read plaintext records).
  const derived = await rootHashOf(bytes);
  if (derived !== rootHash) throw new Error(`content at ${rootHash} does not match its address`);
  return { record: JSON.parse(new TextDecoder().decode(bytes)), bytes };
}

// Re-derive the rootHash from raw bytes (proves content-addressing held).
export async function rootHashOf(bytes) {
  const [tree, err] = await new MemData(bytes).merkleTree();
  if (err) throw err;
  return tree.rootHash();
}
