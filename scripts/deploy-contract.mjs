// Compile KeepMemory.sol (with OpenZeppelin imports) and deploy it to 0G Galileo
// from the app wallet (OG_KEY) — which becomes the contract owner / mint relayer.
// Saves { address, abi } to data/deploy.json (gitignored) for the server to load,
// then self-tests with a real mint so we know it works before wiring the backend.
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
const info = (m) => console.log(`  • ${m}`);

if (!process.env.OG_KEY) {
  console.error('OG_KEY not set in .env');
  process.exit(1);
}

console.log('\nDeploy KeepMemory → 0G Galileo\n');

// 1. Compile (resolve @openzeppelin/* from node_modules).
const source = readFileSync(join(ROOT, 'contracts', 'KeepMemory.sol'), 'utf8');
function findImports(path) {
  try {
    return { contents: readFileSync(require.resolve(path), 'utf8') };
  } catch (e) {
    return { error: `not found: ${path} (${e.message})` };
  }
}
const input = {
  language: 'Solidity',
  sources: { 'KeepMemory.sol': { content: source } },
  settings: {
    viaIR: true, // tokenURI's multi-attribute encodePacked overflows the legacy stack
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
const artifact = out.contracts['KeepMemory.sol']['KeepMemory'];
const abi = artifact.abi;
const bytecode = '0x' + artifact.evm.bytecode.object;

// 2. Deploy from the app wallet.
const provider = new ethers.JsonRpcProvider(RPC);
const signer = new ethers.Wallet(process.env.OG_KEY, provider);
info(`deployer (contract owner / mint relayer): ${signer.address}`);
const bal = await provider.getBalance(signer.address);
info(`balance ${ethers.formatEther(bal)} 0G`);

console.log('\n  deploying…');
const factory = new ethers.ContractFactory(abi, bytecode, signer);
const contract = await factory.deploy(signer.address);
await contract.waitForDeployment();
const address = await contract.getAddress();
const deployTx = contract.deploymentTransaction();
ok(`deployed KeepMemory at ${address}`);
info(`tx https://chainscan-galileo.0g.ai/tx/${deployTx.hash}`);

// 3. Persist for the server.
const DATA_DIR = join(ROOT, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(
  join(DATA_DIR, 'deploy.json'),
  JSON.stringify({ address, abi, deployer: signer.address, chainId: 16602, txHash: deployTx.hash }, null, 2)
);
ok('wrote data/deploy.json');

// 4. Self-test: mint a memory to a throwaway address, read it back.
console.log('\n  self-test mint…');
const testOwner = ethers.Wallet.createRandom().address;
const rootHash = ethers.hexlify(ethers.randomBytes(32));
const ts = Date.now();
const mintTx = await contract.mintMemory(testOwner, rootHash, 'claude-opus-4-8', ts);
const rc = await mintTx.wait();
ok(`minted (tx ${rc.hash})`);
const onChainOwner = await contract.ownerOfRoot(rootHash);
const tokenId = await contract.nextId();
const owns = onChainOwner.toLowerCase() === testOwner.toLowerCase();
console.log(`  ${owns ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ownerOfRoot(rootHash) == minted-to address`);
info(`tokenURI(1) = ${(await contract.tokenURI(1)).slice(0, 64)}…`);
if (!owns) process.exit(1);

console.log('\n  \x1b[32mKeepMemory deployed and minting on 0G.\x1b[0m\n');
