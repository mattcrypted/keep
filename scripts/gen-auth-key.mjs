// Generate a P-256 (prime256v1) authorization key for Privy server-side signing.
// RUN THIS IN YOUR OWN TERMINAL — the printed PRIVATE key is a SECRET that can sign
// transactions for app-controlled wallets. Put it in .env (local) and Railway as
// PRIVY_AUTHORIZATION_KEY. Never commit it, never paste it into chat.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8B64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

console.log('\n  Privy authorization key (P-256) generated.\n');
console.log('  Add this to BOTH .env (local) and the Railway service env — keep it SECRET:\n');
console.log('  PRIVY_AUTHORIZATION_KEY=' + pkcs8B64 + '\n');
console.log('  (The server derives the matching public key from this at runtime — you only set the private key.)\n');
