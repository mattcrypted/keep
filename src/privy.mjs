// Keep — identity layer. Email-OTP login via Privy (headless, server-side), which
// gives each user a Privy embedded wallet (TEE-secured, portable across devices).
// That wallet ADDRESS is the Keep identity: memories are keyed off it and it owns
// the minted NFTs. Log in with the same email anywhere → same wallet → your
// memories rehydrate from 0G and you still own your tokens. Fixes the
// localStorage-isn't-portable problem.
import 'dotenv/config';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_ID = process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const BASE = 'https://api.privy.io/v1';

export function privyReady() {
  return !!(APP_ID && APP_SECRET);
}

// ── App-signing (Option B) ────────────────────────────────────────────────
// With PRIVY_AUTHORIZATION_KEY set (a P-256 PKCS8 private key, base64, no PEM), the
// app can sign transactions FROM a user's wallet — needed so a buyer's OWN wallet pays
// the seller. New wallets get this key (via a key quorum) as an ADDITIONAL SIGNER, so
// the USER still owns the wallet and the app is only a co-signer. Gated: with the key
// unset, everything below is inert and wallet creation behaves exactly as before.
const AUTH_KEY = process.env.PRIVY_AUTHORIZATION_KEY || '';
export function appSigningReady() {
  return !!(AUTH_KEY && privyReady());
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.KEEP_DATA_DIR || join(__dirname, '..', 'data');
const QUORUM_FILE = join(DATA_DIR, 'privy-quorum.json');

function authorizationContext() {
  return AUTH_KEY ? { authorization_private_keys: [AUTH_KEY] } : undefined;
}

// Derive the P-256 public key (base64 DER/SPKI) from the configured private key.
function appPublicKeyB64() {
  const priv = createPrivateKey({ key: Buffer.from(AUTH_KEY, 'base64'), format: 'der', type: 'pkcs8' });
  return createPublicKey(priv).export({ type: 'spki', format: 'der' }).toString('base64');
}

// The key quorum that holds the app's signing key. Created once and persisted (on the
// data volume) so we don't mint a new one each boot; reused while the public key matches.
let _quorumId = null;
export async function appQuorumId() {
  if (!AUTH_KEY) return null;
  if (_quorumId) return _quorumId;
  const pub = appPublicKeyB64();
  try {
    if (existsSync(QUORUM_FILE)) {
      const saved = JSON.parse(readFileSync(QUORUM_FILE, 'utf8'));
      if (saved.publicKey === pub && saved.quorumId) return (_quorumId = saved.quorumId);
    }
  } catch { /* recreate below */ }
  const kqRes = typeof client().keyQuorums === 'function' ? client().keyQuorums() : client().keyQuorums;
  const quorum = await kqRes.create({
    authorization_threshold: 1,
    display_name: 'keep-app-signer',
    public_keys: [pub],
  });
  _quorumId = quorum.id;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${QUORUM_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ publicKey: pub, quorumId: _quorumId }));
    renameSync(tmp, QUORUM_FILE); // atomic swap
  } catch (err) {
    console.error('[privy] could not persist quorum id (will recreate next boot):', err.message);
  }
  return _quorumId;
}

let _client;
function client() {
  if (!privyReady()) throw new Error('Privy not configured (PRIVY_APP_ID / PRIVY_APP_SECRET)');
  return (_client ??= new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET }));
}

function headers() {
  return {
    Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64'),
    'privy-app-id': APP_ID,
    'content-type': 'application/json',
  };
}

// 1. Send a one-time code to the email. The "send code" step lives on the auth
// host (auth.privy.io) and is a public, app-id-only call (no secret) — the
// secret-authed verify happens server-side in step 2.
const AUTH_BASE = 'https://auth.privy.io/api/v1';
export async function sendEmailCode(email) {
  const r = await fetch(`${AUTH_BASE}/passwordless/init`, {
    method: 'POST',
    headers: { 'privy-app-id': APP_ID, 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw new Error(`init ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return true;
}

// 2. Verify the code → resolve the Privy user → ensure they have an embedded
// wallet → return its address (the Keep identity).
export async function verifyEmailCode(email, code) {
  const r = await fetch(`${BASE}/passwordless/authenticate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, code }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`authenticate ${r.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text || '{}');

  const userId = data?.user?.id || data?.user_id || data?.id;
  if (!userId) throw new Error('no user id in authenticate response');

  // existing embedded wallet from the auth payload?
  let address = findEmbeddedWallet(data.user) || findEmbeddedWallet(data);
  if (!address) address = await getOrCreateWallet(userId);

  // Bind the identity to the email Privy actually authenticated, not the raw
  // client input (normalization/aliasing could differ); fall back to the input.
  const verifiedEmail = findEmail(data.user) || findEmail(data) || email;

  return { userId, address, email: verifiedEmail };
}

// Resolve a user's embedded wallet by ADDRESS and return a signer. Privy's TEE signs
// the transaction (the user's keys never leave it); we broadcast it on 0G ourselves —
// so it works regardless of whether Privy "supports" 0G (proven in scripts/privy-spike).
// This is how a buyer's OWN wallet funds a real purchase: the cookie-authenticated buyer
// authorizes; their embedded wallet (not the relayer) pays.
export async function walletSigner(address) {
  const c = client();
  const w = await c.wallets().getWalletByAddress({ address });
  if (!w?.id) throw new Error('no Privy embedded wallet for ' + address);
  const account = createViemAccount(c, {
    walletId: w.id,
    address: w.address,
    authorizationContext: authorizationContext(), // app's signing key (undefined if unset)
  });
  return { address: w.address, signTransaction: (txReq) => account.signTransaction(txReq) };
}

async function getOrCreateWallet(userId) {
  // Look for an existing embedded wallet on the user. Only create a new one when
  // the lookup DEFINITIVELY succeeds and shows none — a transient/non-OK lookup
  // must NOT fall through to create(), or a fresh wallet could be minted while one
  // already exists, splitting the identity (the address IS the whole identity).
  const r = await fetch(`${BASE}/users/${encodeURIComponent(userId)}`, { headers: headers() });
  if (!r.ok) throw new Error(`wallet lookup failed (${r.status})`);
  const existing = findEmbeddedWallet(await r.json());
  if (existing) return existing;
  // The USER owns the wallet; when app-signing is configured, also add the app's key
  // quorum as an additional signer so the app can later pay FROM this wallet on the
  // user's behalf (buyer-funded purchases). Without the key, this is a plain user wallet.
  const createParams = { chain_type: 'ethereum', owner: { user_id: userId } };
  if (appSigningReady()) {
    try {
      const qid = await appQuorumId();
      if (qid) createParams.additional_signers = [{ signer_id: qid }];
    } catch (err) {
      console.error('[privy] additional-signer setup failed; creating a plain wallet:', err.message);
    }
  }
  const wallet = await client().wallets().create(createParams);
  return wallet.address;
}

// The user's linked email address from a Privy payload, if present.
function findEmail(obj) {
  const accts = obj?.linked_accounts || obj?.linkedAccounts || [];
  const e = accts.find((a) => a.type === 'email');
  return e?.address || null;
}

function findEmbeddedWallet(obj) {
  const accts = obj?.linked_accounts || obj?.linkedAccounts || [];
  const w = accts.find(
    (a) =>
      (a.type === 'wallet' || a.type === 'ethereum_wallet') &&
      (a.wallet_client_type === 'privy' ||
        a.walletClientType === 'privy' ||
        a.connector_type === 'embedded' ||
        a.connectorType === 'embedded')
  );
  return w?.address || null;
}
