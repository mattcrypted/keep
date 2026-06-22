// Compile KeepMarket.sol (with OpenZeppelin imports) and deploy it to 0G Galileo
// from the app wallet (OG_KEY) — which becomes the contract owner / settlement relayer.
// Saves { address, abi } to data/market-deploy.json (gitignored) for the server to load,
// then self-tests BOTH rails (relayer recordPurchase + buyer-funded buy) before wiring.
import 'dotenv/config';
import solc from 'solc';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RPC = process.env.OG_RPC || 'https://evmrpc-testnet.0g.ai';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);

if (!process.env.OG_KEY) {
  console.error('OG_KEY not set in .env');
  process.exit(1);
}

console.log('\nDeploy KeepMarket → 0G Galileo\n');

// 1. Compile (resolve @openzeppelin/* from node_modules).
const source = readFileSync(join(ROOT, 'contracts', 'KeepMarket.sol'), 'utf8');
function findImports(path) {
  try {
    return { contents: readFileSync(require.resolve(path), 'utf8') };
  } catch (e) {
    return { error: `not found: ${path} (${e.message})` };
  }
}
const input = {
  language: 'Solidity',
  sources: { 'KeepMarket.sol': { content: source } },
  settings: {
    viaIR: true,
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
if (errors.length) {
  console.error('Solidity errors:\n' + errors.map((e) => e.formattedMessage).join('\n'));
  process.exit(1);
}
info(`compiled with solc ${solc.version()}`);
const artifact = out.contracts['KeepMarket.sol']['KeepMarket'];
const abi = artifact.abi;
const bytecode = '0x' + artifact.evm.bytecode.object;

// 2. Deploy from the app wallet.
const provider = new ethers.JsonRpcProvider(RPC);
const signer = new ethers.Wallet(process.env.OG_KEY, provider);
info(`deployer (owner / settlement relayer): ${signer.address}`);
const bal = await provider.getBalance(signer.address);
info(`balance ${ethers.formatEther(bal)} 0G`);

console.log('\n  deploying…');
const factory = new ethers.ContractFactory(abi, bytecode, signer);
const contract = await factory.deploy(signer.address);
await contract.waitForDeployment();
const address = await contract.getAddress();
const deployTx = contract.deploymentTransaction();
ok(`deployed KeepMarket at ${address}`);
info(`tx https://chainscan-galileo.0g.ai/tx/${deployTx.hash}`);

// 3. Persist for the server.
const DATA_DIR = join(ROOT, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(
  join(DATA_DIR, 'market-deploy.json'),
  JSON.stringify({ address, abi, deployer: signer.address, chainId: 16602, txHash: deployTx.hash }, null, 2)
);
ok('wrote data/market-deploy.json');

// 4. Self-test BOTH rails against a throwaway seller (tiny value, so the relayer barely spends).
console.log('\n  self-test…');
const id = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const seller = ethers.Wallet.createRandom().address;
const recordBuyer = ethers.Wallet.createRandom().address;
const listingId = id('selftest-' + deployTx.hash.slice(2, 12));
const price = ethers.parseEther('0.0002');

await (await contract.list(listingId, seller, price)).wait();
ok('list() registered a listing');

// Relayer rail: record a purchase with no value, assert the on-chain access fact.
await (await contract.recordPurchase(listingId, recordBuyer)).wait();
const recordedOk = await contract.hasPurchased(listingId, recordBuyer);
recordedOk ? ok('recordPurchase() → hasPurchased == true') : bad('recordPurchase did not record');

// Buyer-funded rail: deployer buys with value, assert access + seller proceeds credited.
await (await contract.buy(listingId, { value: price })).wait();
const boughtOk = await contract.hasPurchased(listingId, signer.address);
const owed = await contract.pendingWithdrawals(seller);
boughtOk ? ok('buy() → hasPurchased == true') : bad('buy did not record');
owed === price ? ok(`pendingWithdrawals[seller] == ${ethers.formatEther(owed)} 0G (pull-payment credited)`)
               : bad(`seller proceeds wrong: ${ethers.formatEther(owed)} 0G`);

if (!(recordedOk && boughtOk && owed === price)) {
  console.log('');
  bad('self-test FAILED');
  process.exit(1);
}

console.log('\n  \x1b[32mKeepMarket deployed and settling on 0G.\x1b[0m\n');
