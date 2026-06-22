// Generate a THROWAWAY 0G Galileo testnet wallet for signing storage uploads.
// Testnet only, no real value. Funds it yourself at https://faucet.0g.ai
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const w = ethers.Wallet.createRandom();

console.log('\n  Throwaway 0G testnet wallet (Galileo, chain 16602)\n');
console.log('  address    :', w.address);
console.log('  privateKey :', w.privateKey);
console.log('  mnemonic   :', w.mnemonic?.phrase);

// Persist into .env (OG_KEY) without clobbering other values.
const ENV = new URL('../.env', import.meta.url).pathname;
let env = existsSync(ENV)
  ? readFileSync(ENV, 'utf8')
  : (existsSync(new URL('../.env.example', import.meta.url).pathname)
      ? readFileSync(new URL('../.env.example', import.meta.url).pathname, 'utf8')
      : 'OG_KEY=\n');

if (/^OG_KEY=.*/m.test(env)) {
  env = env.replace(/^OG_KEY=.*/m, `OG_KEY=${w.privateKey}`);
} else {
  env += `\nOG_KEY=${w.privateKey}\n`;
}
writeFileSync(ENV, env);

console.log('\n  Saved OG_KEY -> .env');
console.log('\n  NEXT: fund this address with testnet 0G:');
console.log('    https://faucet.0g.ai   (0.1 0G/day; ask in 0G Discord for more)');
console.log('  Then run:  npm run spike\n');
