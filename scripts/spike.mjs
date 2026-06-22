// Day-1 spike: prove the 0G storage round-trip works end to end.
// put a record -> get it back by rootHash -> integrity checks must all pass.
// This retires the #1 project risk (new chain + SDK) before any UI is built.
import { ethers } from 'ethers';
import {
  buildRecord,
  recordHash,
  putRecord,
  getRecord,
  rootHashOf,
  signer,
  RPC,
} from '../src/og.mjs';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);
function assert(cond, msg) {
  if (!cond) {
    console.error(`  \x1b[31m✗ ${msg}\x1b[0m`);
    process.exit(1);
  }
  ok(msg);
}

console.log('\n0G storage round-trip spike\n');

// 0. Wallet is funded?
const s = signer();
const provider = new ethers.JsonRpcProvider(RPC);
const bal = await provider.getBalance(s.address);
info(`wallet ${s.address}`);
info(`balance ${ethers.formatEther(bal)} 0G`);
if (bal === 0n) {
  console.error(
    '\n  \x1b[31mWallet has 0 0G.\x1b[0m Fund it at https://faucet.0g.ai then re-run.\n'
  );
  process.exit(1);
}

// 1. Build a record (the AI's memory + its receipt, one object).
const record = buildRecord({
  sessionId: 'spike-' + Date.now(),
  prompt: 'Remember that my favourite colour is teal.',
  response: 'Got it — your favourite colour is teal. I will keep that.',
  model: 'claude-opus-4-8',
});
info(`record sessionId=${record.sessionId} hash=${record.hash.slice(0, 16)}…`);

// 2. PUT.
console.log('\n  uploading to 0G…');
const t0 = Date.now();
const { rootHash, txHash, localRoot } = await putRecord(record);
ok(`uploaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
info(`rootHash ${rootHash}`);
info(`txHash   ${txHash}`);
info(`view     https://storagescan-galileo.0g.ai/tx/${txHash || ''}`);
assert(rootHash === localRoot, 'network rootHash matches locally-computed root');

// 3. GET (with merkle proof).
console.log('\n  downloading by rootHash…');
const { record: fetched, bytes } = await getRecord(rootHash);

// 4. Integrity checks.
const rederived = await rootHashOf(bytes);
assert(rederived === rootHash, 'fetched bytes re-hash to the same rootHash (content-addressed)');
assert(
  JSON.stringify(fetched) === JSON.stringify(record),
  'fetched record is byte-identical to what we stored (memory persists)'
);
assert(
  recordHash(fetched) === fetched.hash,
  'inner provenance hash matches prompt+response+model+ts (tamper-evident)'
);

// 5. Negative control: a tampered byte must break the rootHash.
const tampered = new Uint8Array(bytes);
tampered[tampered.length - 2] ^= 0xff;
const tamperedRoot = await rootHashOf(tampered);
assert(tamperedRoot !== rootHash, 'tampering with one byte changes the rootHash');

console.log('\n  \x1b[32mRound-trip verified.\x1b[0m The #1 risk is retired.\n');
