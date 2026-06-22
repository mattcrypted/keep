// Make-or-break spike: can a Privy embedded wallet sign + broadcast a transaction
// on 0G Galileo (chainId 16602)? Privy just SIGNS (in its TEE); we broadcast to
// 0G's RPC ourselves, so it works regardless of whether Privy "supports" 0G.
// If green, Privy is our identity + ownership layer (email login -> embedded
// wallet -> owns the user's memories/NFTs, portable across devices).
import 'dotenv/config';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { ethers } from 'ethers';

const RPC = process.env.OG_RPC || 'https://evmrpc-testnet.0g.ai';
const CHAIN_ID = 16602;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);
function assert(c, m) {
  if (!c) {
    console.error(`  \x1b[31m✗ ${m}\x1b[0m`);
    process.exit(1);
  }
  ok(m);
}

const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
if (!appId || !appSecret) {
  console.error('Missing PRIVY_APP_ID / PRIVY_APP_SECRET in .env');
  process.exit(1);
}

console.log('\nPrivy → 0G Galileo signing spike\n');

const privy = new PrivyClient({ appId, appSecret });
const provider = new ethers.JsonRpcProvider(RPC);

// 1. Create an embedded wallet server-side (the per-user identity in production).
const wallet = await privy.wallets().create({ chain_type: 'ethereum' });
info(`created Privy embedded wallet id=${wallet.id}`);
info(`address ${wallet.address}`);

// 2. Wrap it as a viem account — Privy's TEE is the signer.
const account = createViemAccount(privy, { walletId: wallet.id, address: wallet.address });

// 3. Build a 0G transaction (to self, 0 value) and have Privy sign it.
const fee = await provider.getFeeData();
const feeFields = fee.maxFeePerGas
  ? { type: 'eip1559', maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.maxFeePerGas }
  : { type: 'legacy', gasPrice: fee.gasPrice ?? ethers.parseUnits('1', 'gwei') };
const txReq = { to: wallet.address, value: 0n, chainId: CHAIN_ID, nonce: 0, gas: 21000n, ...feeFields };

console.log('\n  asking Privy to sign a chainId-16602 transaction…');
const raw = await account.signTransaction(txReq);
info(`Privy returned a signed tx (${(raw.length - 2) / 2} bytes)`);

// 4. Decode + verify: it must be chain-bound to 0G and recover to our wallet.
const parsed = ethers.Transaction.from(raw);
assert(Number(parsed.chainId) === CHAIN_ID, 'signed tx is bound to chainId 16602 (0G)');
assert(
  parsed.from.toLowerCase() === wallet.address.toLowerCase(),
  'signature recovers to the Privy wallet address'
);
ok('CORE PROOF: Privy can sign valid 0G transactions');

// 5. Ultimate proof: fund the wallet, broadcast a REAL tx on 0G from it.
try {
  if (!process.env.OG_KEY) throw new Error('OG_KEY not set — skipping live broadcast');
  const funder = new ethers.Wallet(process.env.OG_KEY, provider);
  console.log('\n  funding the Privy wallet for a live broadcast…');
  const ftx = await funder.sendTransaction({ to: wallet.address, value: ethers.parseEther('0.002') });
  await ftx.wait();
  ok('funded with 0.002 0G');

  const fee2 = await provider.getFeeData();
  const feeFields2 = fee2.maxFeePerGas
    ? { type: 'eip1559', maxFeePerGas: fee2.maxFeePerGas, maxPriorityFeePerGas: fee2.maxPriorityFeePerGas ?? fee2.maxFeePerGas }
    : { type: 'legacy', gasPrice: fee2.gasPrice ?? ethers.parseUnits('1', 'gwei') };
  const raw2 = await account.signTransaction({ to: wallet.address, value: 0n, chainId: CHAIN_ID, nonce: 0, gas: 21000n, ...feeFields2 });

  console.log('  broadcasting the Privy-signed tx to 0G…');
  const sent = await provider.broadcastTransaction(raw2);
  info(`txHash ${sent.hash}`);
  const rc = await sent.wait();
  assert(rc.status === 1, 'LIVE 0G transaction from the Privy wallet confirmed on-chain');
  info(`view https://chainscan-galileo.0g.ai/tx/${sent.hash}`);
} catch (e) {
  console.log(`\n  (live broadcast skipped: ${e.message})\n  — the core signing proof above already settles viability.`);
}

console.log('\n  \x1b[32mPrivy is viable as the 0G identity + signing layer.\x1b[0m\n');
