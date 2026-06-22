// Verify the LEAST-invasive Option B shape: a wallet keeps its normal owner but adds
// the app's key quorum as an ADDITIONAL SIGNER. If the app can sign such a wallet, we
// can keep `owner: { user_id }` (user still owns it; identity lookup unchanged) and just
// append additional_signers — the gentlest custody change.
import 'dotenv/config';
import { ethers } from 'ethers';
import { generateKeyPairSync } from 'node:crypto';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { signer } from '../src/og.mjs';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);

const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
const kqRes = typeof privy.keyQuorums === 'function' ? privy.keyQuorums() : privy.keyQuorums;

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8B64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const authorizationContext = { authorization_private_keys: [pkcs8B64] };

console.log('\nOption B (gentle): additional_signers grants app signing?\n');

try {
  const quorum = await kqRes.create({ authorization_threshold: 1, display_name: 'keep-addsigner-test', public_keys: [spkiB64] });
  ok(`key quorum ${quorum.id}`);

  // Mirror production shape as closely as possible WITHOUT a real user: add the quorum
  // as an additional signer. (In prod we also pass owner: { user_id }.)
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    additional_signers: [{ signer_id: quorum.id }],
  });
  ok(`wallet ${wallet.address} (additional signer = our quorum)`);

  const relayer = signer();
  const p = relayer.provider;
  await (await relayer.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.004') })).wait();
  ok('funded 0.004 OG');

  const account = createViemAccount(privy, { walletId: wallet.id, address: wallet.address, authorizationContext });
  const fee = await p.getFeeData();
  const feeFields = fee.maxFeePerGas
    ? { type: 'eip1559', maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.maxFeePerGas }
    : { type: 'legacy', gasPrice: fee.gasPrice ?? ethers.parseUnits('4', 'gwei') };
  const nonce = await p.getTransactionCount(wallet.address, 'pending');
  const raw = await account.signTransaction({ to: wallet.address, value: 0n, chainId: 16602, nonce, gas: 21000n, ...feeFields });
  const sent = await p.broadcastTransaction(raw);
  const rc = await sent.wait();
  if (rc.status === 1) {
    ok('app signed an ADDITIONAL-SIGNER wallet → confirmed on 0G');
    info(`view https://chainscan-galileo.0g.ai/tx/${sent.hash}`);
    console.log('\n  \x1b[32mUse owner:{user_id} + additional_signers — user keeps ownership, app co-signs.\x1b[0m\n');
  } else { bad('reverted'); process.exit(1); }
} catch (e) {
  console.log('');
  bad('FAILED: ' + e.message);
  console.log(e.stack || e);
  if (e.body) console.log('body:', JSON.stringify(e.body).slice(0, 600));
  console.log('\n  → fall back to owner_id:{quorum} (app-owned) + external_id lookup.\n');
  process.exit(1);
}
