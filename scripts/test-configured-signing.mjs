// Final green-light for Option B using the REAL configured key. Run this AFTER you've
// set PRIVY_AUTHORIZATION_KEY in .env. It exercises the exact production machinery:
// derive the app key quorum from the env key -> create a wallet with that quorum as an
// additional signer -> fund it -> sign via walletSigner() (which uses the env key) ->
// broadcast on 0G. Green here = safe to deploy. Nothing touches the live app.
import 'dotenv/config';
import { ethers } from 'ethers';
import { PrivyClient } from '@privy-io/node';
import { appSigningReady, appQuorumId, walletSigner } from '../src/privy.mjs';
import { signer } from '../src/og.mjs';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);

console.log('\nOption B final check — using the configured PRIVY_AUTHORIZATION_KEY\n');

if (!appSigningReady()) {
  bad('appSigningReady() is false — set PRIVY_AUTHORIZATION_KEY in .env first (run scripts/gen-auth-key.mjs).');
  process.exit(1);
}
ok('app-signing is configured');

try {
  const qid = await appQuorumId();
  ok(`app key quorum resolved: ${qid}`);

  const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
  const wallet = await privy.wallets().create({ chain_type: 'ethereum', additional_signers: [{ signer_id: qid }] });
  ok(`created a test wallet ${wallet.address} (app as additional signer, via the env key)`);

  const relayer = signer();
  const p = relayer.provider;
  await (await relayer.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.004') })).wait();
  ok('funded 0.004 OG');

  const { signTransaction } = await walletSigner(wallet.address); // uses authorizationContext from env
  const fee = await p.getFeeData();
  const feeFields = fee.maxFeePerGas
    ? { type: 'eip1559', maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.maxFeePerGas }
    : { type: 'legacy', gasPrice: fee.gasPrice ?? ethers.parseUnits('4', 'gwei') };
  const nonce = await p.getTransactionCount(wallet.address, 'pending');
  const raw = await signTransaction({ to: wallet.address, value: 0n, chainId: 16602, nonce, gas: 21000n, ...feeFields });
  const sent = await p.broadcastTransaction(raw);
  const rc = await sent.wait();
  if (rc.status === 1) {
    ok('configured key SIGNED + confirmed on 0G');
    info(`view https://chainscan-galileo.0g.ai/tx/${sent.hash}`);
    console.log('\n  \x1b[32mGREEN — safe to deploy Option B.\x1b[0m\n');
  } else { bad('reverted'); process.exit(1); }
} catch (e) {
  console.log('');
  bad('FAILED: ' + e.message);
  console.log(e.stack || e);
  process.exit(1);
}
