// Keep — 0G Chain layer (ownership). The app wallet (OG_KEY) is the contract
// owner / mint relayer: it pays gas and mints each memory TO the user's address,
// so the user owns the token without needing gas. One mint = owned NFT + the
// on-chain MemoryAnchored event (rootHash + owner + time). The memory CONTENT
// still lives on 0G storage; this just records ownership + a provenance anchor.
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { signer } from './og.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(__dirname, '..', 'data', 'deploy.json');

let _deploy = null;
try {
  if (existsSync(DEPLOY)) _deploy = JSON.parse(readFileSync(DEPLOY, 'utf8'));
} catch (err) {
  console.error('[chain] failed to load deploy.json:', err.message);
}

let _contract;
function contract() {
  if (!_deploy) throw new Error('KeepMemory not deployed — run `npm run deploy:contract`');
  return (_contract ??= new ethers.Contract(_deploy.address, _deploy.abi, signer()));
}

export function mintingReady() {
  return !!_deploy;
}
export function contractAddress() {
  return _deploy?.address || null;
}

// Read tokenId + the trustless on-chain anchor time (block.timestamp at mint) for
// an already-anchored root. Best-effort: returns nulls if the views revert.
async function tokenInfo(c, rootHash) {
  try {
    const tokenId = (await c.tokenIdOfRoot(rootHash)).toString();
    const anchoredAt = Number(await c.anchoredAt(tokenId));
    return { tokenId, anchoredAt };
  } catch {
    return { tokenId: null, anchoredAt: null };
  }
}

// Mint a memory to its owner + anchor its rootHash. Idempotent per rootHash.
export async function mintMemory({ owner, rootHash, model, ts }) {
  const c = contract();

  const existing = await c.ownerOfRoot(rootHash);
  if (existing && existing !== ethers.ZeroAddress) {
    return { alreadyMinted: true, owner: existing, ...(await tokenInfo(c, rootHash)) };
  }

  let rc;
  try {
    const tx = await c.mintMemory(owner, rootHash, model || '', ts || 0);
    rc = await tx.wait();
  } catch (err) {
    // TOCTOU: the off-chain ownerOfRoot read above can race a concurrent mint of
    // the same root (double-click / two tabs). The on-chain require('already
    // minted') is the real guard — so if the root is now anchored, treat it as the
    // idempotent success case instead of surfacing a scary 502.
    const after = await c.ownerOfRoot(rootHash).catch(() => ethers.ZeroAddress);
    if (after && after !== ethers.ZeroAddress) {
      return { alreadyMinted: true, owner: after, ...(await tokenInfo(c, rootHash)) };
    }
    throw err;
  }

  // anchoredAt comes from the SAME event we already parse for tokenId — zero extra
  // RPC. It is the block timestamp of the mint: a trustless "committed at" time.
  let tokenId = null;
  let anchoredAt = null;
  for (const log of rc.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed && parsed.name === 'MemoryAnchored') {
        tokenId = parsed.args.tokenId.toString();
        anchoredAt = Number(parsed.args.anchoredAt);
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { alreadyMinted: false, owner, tokenId, anchoredAt, txHash: rc.hash };
}

// Chain-sourced ownership for a memory: is this rootHash minted, and as which token
// to whom? Lets the UI surface ownership on ANY device — it reads the chain, not the
// browser's localStorage — so "owned ⬦ #N" follows the identity, not the device.
export async function mintStatusOf(rootHash) {
  const c = contract();
  const owner = await c.ownerOfRoot(rootHash);
  if (!owner || owner === ethers.ZeroAddress) return { minted: false };
  return { minted: true, owner, ...(await tokenInfo(c, rootHash)) };
}

// Deployment block, so the gallery event query starts from when the contract first
// existed instead of block 0 (a tighter range some RPCs require for getLogs).
let _deployBlock;
async function deployBlock(c) {
  if (_deployBlock !== undefined) return _deployBlock;
  try {
    const rc = _deploy?.txHash ? await c.runner.provider.getTransactionReceipt(_deploy.txHash) : null;
    _deployBlock = rc ? rc.blockNumber : 0;
  } catch {
    _deployBlock = 0;
  }
  return _deployBlock;
}

// ── Gallery: every memory an address has minted, sourced from the chain. The
// MemoryAnchored event's `owner` is INDEXED, so we enumerate an address's tokens
// by event filter — no ERC721Enumerable needed, and it's portable across devices
// (the chain is the source of truth, not the browser). Returns newest-first.
export async function galleryOf(owner) {
  const c = contract();
  const from = await deployBlock(c);
  const logs = await c.queryFilter(c.filters.MemoryAnchored(null, null, owner), from, 'latest');
  const seen = new Set();
  const items = [];
  for (const l of logs) {
    const tokenId = l.args.tokenId.toString();
    if (seen.has(tokenId)) continue; // defensive de-dupe
    seen.add(tokenId);
    items.push({
      tokenId,
      rootHash: l.args.rootHash,
      model: l.args.model,
      ts: Number(l.args.ts),
      anchoredAt: Number(l.args.anchoredAt),
      txHash: l.transactionHash,
    });
  }
  items.sort((a, b) => b.anchoredAt - a.anchoredAt);
  return items;
}
