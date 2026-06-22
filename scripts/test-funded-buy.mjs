// Make-or-break integration test for the BUYER-FUNDED rail (the real "buyer pays the
// seller" path). Exercises the EXACT production code in src/chain.mjs + src/privy.mjs:
//   create a Privy buyer wallet -> fund it from the relayer -> list() a priced listing ->
//   buyFundedOnChain() (Privy signs, we broadcast on 0G) -> assert access + seller proceeds.
// Proves the funded flow works before any live login. Spends a little testnet OG.
import 'dotenv/config';
import { ethers } from 'ethers';
import { PrivyClient } from '@privy-io/node';
import { signer } from '../src/og.mjs';
import {
  listOnChain, hasPurchasedOnChain, buyFundedOnChain, listingOnChain, marketAddress,
} from '../src/chain.mjs';

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  • ${m}`);

if (!process.env.OG_KEY || !process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
  console.error('Need OG_KEY + PRIVY_APP_ID + PRIVY_APP_SECRET in .env');
  process.exit(1);
}

console.log('\nBuyer-funded rail integration test → 0G Galileo\n');
info(`KeepMarket ${marketAddress()}`);

// 1. Create a fresh Privy embedded wallet to act as the buyer.
const privy = new PrivyClient({ appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
const buyer = await privy.wallets().create({ chain_type: 'ethereum' });
info(`buyer (Privy embedded) ${buyer.address}`);

// 2. Fund the buyer from the relayer: price + a little gas.
const relayer = signer();
const price = ethers.parseEther('0.001');
const fund = price + ethers.parseEther('0.004');
await (await relayer.sendTransaction({ to: buyer.address, value: fund })).wait();
ok(`funded buyer with ${ethers.formatEther(fund)} OG`);

// 3. Relayer lists a priced listing for a throwaway seller (gasless for the seller).
const seller = ethers.Wallet.createRandom().address;
const listingId = 'funded-test-' + Date.now();
await listOnChain(listingId, seller, price);
ok(`listed "${listingId}" @ ${ethers.formatEther(price)} OG (seller ${seller.slice(0, 10)}…)`);

// 4. Buyer-funded purchase via the PRODUCTION path (Privy signs, we broadcast on 0G).
const before = await hasPurchasedOnChain(listingId, buyer.address);
const { txHash, pricePaid } = await buyFundedOnChain(listingId, buyer.address);
ok(`buy() paid ${ethers.formatEther(pricePaid)} OG — tx ${txHash}`);
info(`view https://chainscan-galileo.0g.ai/tx/${txHash}`);
const after = await hasPurchasedOnChain(listingId, buyer.address);

// 5. Assert: access granted on-chain + the seller is actually owed the OG.
const provider = relayer.provider;
const marketAbi = ['function pendingWithdrawals(address) view returns (uint256)'];
const market = new ethers.Contract(marketAddress(), marketAbi, provider);
const owed = await market.pendingWithdrawals(seller);

console.log('');
before === false ? ok('buyer had no access before') : bad('buyer already had access?!');
after === true ? ok('buyer HAS access after paying (hasPurchased == true)') : bad('access not granted');
owed === price ? ok(`seller is owed ${ethers.formatEther(owed)} OG (real value moved buyer → seller)`)
               : bad(`seller proceeds wrong: ${ethers.formatEther(owed)} OG`);

const pass = before === false && after === true && owed === price;
console.log('');
pass ? console.log('  \x1b[32mFUNDED RAIL WORKS: real OG moved buyer → seller on 0G.\x1b[0m\n')
     : (bad('FUNDED RAIL FAILED'), process.exit(1));
