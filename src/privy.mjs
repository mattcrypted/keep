// Keep — identity layer. Email-OTP login via Privy (headless, server-side), which
// gives each user a Privy embedded wallet (TEE-secured, portable across devices).
// That wallet ADDRESS is the Keep identity: memories are keyed off it and it owns
// the minted NFTs. Log in with the same email anywhere → same wallet → your
// memories rehydrate from 0G and you still own your tokens. Fixes the
// localStorage-isn't-portable problem.
import 'dotenv/config';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';

const APP_ID = process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const BASE = 'https://api.privy.io/v1';

export function privyReady() {
  return !!(APP_ID && APP_SECRET);
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
  const account = createViemAccount(c, { walletId: w.id, address: w.address });
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
  const wallet = await client().wallets().create({ chain_type: 'ethereum', owner: { user_id: userId } });
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
