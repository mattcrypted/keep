// PROOF-OF-MECHANISM for Option B: can the app sign a transaction for a wallet whose
// signer set includes an app-held P-256 authorization key? If this goes green, B is
// viable and we wire it; if not, we stop and the live app is untouched.
//
// Flow: generate an ephemeral P-256 key -> register it as a Privy key quorum -> create
// a wallet owned by that quorum -> fund it from the relayer -> have the app sign a tx
// via authorizationContext -> broadcast on 0G. The ephemeral key is NOT printed.
import 'dotenv/config';
import { ethers } from 'ethers';
import { generateKeyPairSync } from 'node:crypto';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { signer } from '../src/og.mjs';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);

if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET || !process.env.OG_KEY) {
  console.error('Need PRIVY_APP_ID + PRIVY_APP_SECRET + OG_KEY in .env');
  process.exit(1);
}

console.log('\nOption B proof-of-mechanism: app-signed wallet pays on 0G\n');

const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
const kqRes = typeof privy.keyQuorums === 'function' ? privy.keyQuorums() : privy.keyQuorums;

// 1. Ephemeral P-256 authorization key (private kept in-memory, never printed).
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8B64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const authorizationContext = { authorization_private_keys: [pkcs8B64] };
info('generated ephemeral P-256 authorization key');

try {
  // 2. Register the public key as a key quorum (threshold 1).
  const quorum = await kqRes.create({
    authorization_threshold: 1,
    display_name: 'keep-appsign-test',
    public_keys: [spkiB64],
  });
  ok(`created key quorum ${quorum.id}`);

  // 3. Create a wallet owned by that quorum — i.e. signable by our app key.
  const wallet = await privy.wallets().create({ chain_type: 'ethereum', owner_id: quorum.id });
  ok(`created wallet ${wallet.address} (owned by the quorum)`);

  // 4. Fund it from the relayer so it can broadcast.
  const relayer = signer();
  const p = relayer.provider;
  await (await relayer.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.004') })).wait();
  ok('funded wallet with 0.004 OG');

  // 5. App signs a 0G tx via authorizationContext; we broadcast ourselves.
  const account = createViemAccount(privy, { walletId: wallet.id, address: wallet.address, authorizationContext });
  const fee = await p.getFeeData();
  const feeFields = fee.maxFeePerGas
    ? { type: 'eip1559', maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.maxFeePerGas }
    : { type: 'legacy', gasPrice: fee.gasPrice ?? ethers.parseUnits('4', 'gwei') };
  const nonce = await p.getTransactionCount(wallet.address, 'pending');
  info('asking the app (via authorizationContext) to sign a 0G tx…');
  const raw = await account.signTransaction({ to: wallet.address, value: 0n, chainId: 16602, nonce, gas: 21000n, ...feeFields });
  ok(`app SIGNED the tx (${(raw.length - 2) / 2} bytes) — no user signing key needed`);

  const sent = await p.broadcastTransaction(raw);
  const rc = await sent.wait();
  if (rc.status === 1) {
    ok('APP-SIGNED 0G TRANSACTION CONFIRMED');
    info(`view https://chainscan-galileo.0g.ai/tx/${sent.hash}`);
    console.log('\n  \x1b[32mOption B is VIABLE — the app can sign for quorum-owned wallets.\x1b[0m\n');
  } else {
    bad('tx reverted'); process.exit(1);
  }
} catch (e) {
  console.log('');
  bad('FAILED: ' + e.message);
  console.log('--- detail ---');
  console.log(e.stack || e);
  if (e.body) console.log('body:', JSON.stringify(e.body).slice(0, 600));
  process.exit(1);
}
