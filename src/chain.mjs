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
import { walletSigner } from './privy.mjs';

// Fail fast instead of hanging a request when the 0G RPC is slow or a tx never mines.
// Every market chain call wraps in this so the route's try/catch fallback fires quickly.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
    t.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(__dirname, '..', 'data', 'deploy.json');
const MARKET_DEPLOY = join(__dirname, '..', 'data', 'market-deploy.json');

let _deploy = null;
try {
  if (existsSync(DEPLOY)) _deploy = JSON.parse(readFileSync(DEPLOY, 'utf8'));
} catch (err) {
  console.error('[chain] failed to load deploy.json:', err.message);
}

let _marketDeploy = null;
try {
  if (existsSync(MARKET_DEPLOY)) _marketDeploy = JSON.parse(readFileSync(MARKET_DEPLOY, 'utf8'));
} catch (err) {
  console.error('[chain] failed to load market-deploy.json:', err.message);
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

// ── KeepMarket: on-chain settlement + access for the Sealed Market. Same relayer
// (OG_KEY) is the contract owner; it lists on the seller's behalf and records relayed
// purchases gaslessly (mirroring mint). The buyer-funded buy() path is permissionless
// and lives in the contract for when a buyer wallet holds OG. The unlock gate reads
// hasPurchased() so "who may decrypt" is a verifiable on-chain fact, not a server flag.
let _market;
function marketContract() {
  if (!_marketDeploy) throw new Error('KeepMarket not deployed — run `npm run deploy:market`');
  return (_market ??= new ethers.Contract(_marketDeploy.address, _marketDeploy.abi, signer()));
}

export function marketReady() {
  return !!_marketDeploy;
}
export function marketAddress() {
  return _marketDeploy?.address || null;
}

// Listing ids are UUIDs off-chain; on-chain they key by keccak256 of the UUID bytes.
export function listingKey(listingId) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(listingId)));
}

// Register a listing on-chain (relayer pays gas; seller is fixed once set). priceWei is
// a bigint/string in wei of native OG (0 = display-only price). Returns the tx hash.
export async function listOnChain(listingId, seller, priceWei = 0n) {
  const c = marketContract();
  const rc = await withTimeout(
    (async () => (await c.list(listingKey(listingId), seller, priceWei)).wait())(),
    20000,
    'list'
  );
  return { txHash: rc.hash };
}

// Record a relayer-settled purchase for `buyer` (gas-abstracted, no value moves).
// Idempotent on-chain. Returns the tx hash.
export async function recordPurchaseOnChain(listingId, buyer) {
  const c = marketContract();
  const rc = await withTimeout(
    (async () => (await c.recordPurchase(listingKey(listingId), buyer)).wait())(),
    20000,
    'recordPurchase'
  );
  return { txHash: rc.hash };
}

// The on-chain access fact the unlock gate reads. Short timeout: a slow read must not
// stall unlock — the route falls back to the local grant.
export async function hasPurchasedOnChain(listingId, buyer) {
  const c = marketContract();
  return withTimeout(c.hasPurchased(listingKey(listingId), buyer), 8000, 'hasPurchased');
}

// The exact on-chain listing the buy() rail enforces — read straight from the contract
// (defense-in-depth vs the off-chain priceLabel; the chain price is the source of truth).
export async function listingOnChain(listingId) {
  const c = marketContract();
  const l = await withTimeout(c.listings(listingKey(listingId)), 8000, 'listings');
  return { seller: l.seller, price: l.price, exists: l.exists };
}

// Native OG balance of an address (decide funded-vs-relayed; surface relayer health).
export async function balanceOf(address) {
  return withTimeout(signer().provider.getBalance(address), 8000, 'balanceOf');
}

// BUYER-FUNDED purchase: the buyer's OWN embedded wallet pays the on-chain price in
// native OG via buy(). Privy signs (TEE); we broadcast on 0G. Returns { txHash, pricePaid }
// on a mined, successful tx. Throws on insufficient funds / revert (the caller decides
// whether to surface "fund your wallet" — it never silently falls back to a free record).
export async function buyFundedOnChain(listingId, buyerAddress) {
  const c = marketContract();
  const key = listingKey(listingId);
  const l = await c.listings(key);
  if (!l.exists) throw new Error('listing not on-chain');
  const price = l.price; // EXACT value the contract requires (buy() enforces ==)
  const data = c.interface.encodeFunctionData('buy', [key]);
  const provider = signer().provider;
  const to = _marketDeploy.address;

  const { signTransaction } = await walletSigner(buyerAddress);
  const nonce = await provider.getTransactionCount(buyerAddress, 'pending');
  const fee = await provider.getFeeData();
  const feeFields = fee.maxFeePerGas
    ? { type: 'eip1559', maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.maxFeePerGas }
    : { type: 'legacy', gasPrice: fee.gasPrice ?? ethers.parseUnits('4', 'gwei') };

  let gas;
  try {
    gas = ((await provider.estimateGas({ from: buyerAddress, to, data, value: price })) * 12n) / 10n;
  } catch {
    gas = 150000n; // estimate reverts when the buyer is underfunded — broadcast will surface it
  }

  const raw = await signTransaction({
    to, value: price, data, chainId: _marketDeploy.chainId || 16602, nonce, gas, ...feeFields,
  });
  const sent = await withTimeout(provider.broadcastTransaction(raw), 20000, 'buy-broadcast');
  const rc = await withTimeout(sent.wait(), 30000, 'buy-confirm');
  if (!rc || rc.status !== 1) throw new Error('buy transaction failed on-chain');
  return { txHash: sent.hash, pricePaid: price.toString() };
}
