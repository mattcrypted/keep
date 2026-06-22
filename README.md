# Keep

**An AI that remembers you — and can prove it. And you own those memories.**

Keep is a chat agent whose every exchange is written to [0G](https://0g.ai) as a
**tamper-evident, content-addressed record** — then made **ownable** as an NFT on
0G Chain. It doesn't remember you in a private server log that can be quietly
edited. It remembers you in records anyone can independently verify, that no one
(not even its operator) can alter after the fact, and that **you** hold on-chain.

> 0G Cup / The Zero Cup submission. Three solutions, all live end-to-end:
> **memory + provenance** on 0G Storage, **ownership** on 0G Chain, with a portable
> **identity** (email login → embedded wallet) tying them to you.

---

## Why 0G is load-bearing (not a bolt-on)

The whole point of Keep is that **your memory lives on 0G, not in the server.**

- Each chat turn produces a record `{ sessionId, prompt, response, model, ts, hash }`.
  Its **0G rootHash is the receipt** — content-addressed, so changing a single byte
  changes the rootHash. That's what makes it tamper-evident.
- The browser keeps only the list of rootHashes (pointers). On reload it calls
  **`/api/rehydrate`, which rebuilds the entire conversation by fetching the records
  back from 0G** — re-deriving each rootHash and re-checking each provenance hash as
  it restores.
- There's a **"prove it ⟲"** button: it wipes the server's in-memory copy, then
  reloads. Memory can then *only* come back from the chain — and the banner confirms
  *"rebuilt this conversation from 0G — the server held nothing."*
- The durable server-side index holds **pointers only** (rootHash + ts + turnId), never
  prompt/response text — so nothing but 0G can reconstruct the memory.

Delete the server's RAM, restart the backend — your conversation comes back from 0G.
Remove 0G and there is no memory, nothing to verify, and nothing to own.

---

## The three solutions

### 1. Memory — 0G Storage
Every turn is uploaded to 0G decentralized storage. Reload, restart, or switch
devices: the conversation is rebuilt by fetching the records back from the chain.

### 2. Provenance — content-addressed receipts
A rootHash is content-addressed, so it *is* a tamper-evident receipt. **Verify on
0G** re-fetches the bytes with a merkle proof, re-derives the rootHash, and re-checks
the inner `sha256(prompt+response+model+ts)` — proving the record is unaltered and
carries the model and time it claims.

### 3. Ownership — 0G Chain
`KeepMemory` is an ERC-721 deployed on 0G Galileo. Clicking **Mint** turns a stored
memory into a token you own; the same transaction emits an on-chain
`MemoryAnchored(tokenId, rootHash, owner, model, ts)` event and records
`rootHashOf` / `ownerOfRoot`. **One mint = an owned NFT + an on-chain provenance
anchor.**

- Contract: **`0x9ea49d676462e8BC3754574E4b7F9D116778F87F`** ([on chainscan](https://chainscan-galileo.0g.ai/address/0x9ea49d676462e8BC3754574E4b7F9D116778F87F)) · chain ID **16602**
- The app's funded wallet is the `onlyOwner` relayer: it pays gas and mints **to your
  address**, so you own the token without needing gas or a wallet install.
- **Ownership is read from the chain** (`/api/owned` → the contract's `tokenIdOfRoot`),
  so your `owned ⬦` badges follow your identity to **any device** — not just where you minted.

### Identity — portable, no wallet to install
Sign in with **email (one-time code) via [Privy](https://privy.io)**, which provisions
a TEE-secured **embedded wallet**. That wallet address is your Keep identity: memories
are keyed off it and it owns your tokens. Sign in with the same email on any device →
your memories rehydrate from 0G and your tokens come with you. On verify, the server
issues a signed, httpOnly session cookie, so every identity-scoped request is proven
server-side (you can only read/mint/inject under your own address). Anonymous use still
works (a random local id); signing in is what makes memories portable and ownable.

---

## Quick start

You need **four config values** in `.env` (git-ignored — never commit it):

| Key | What | Where |
|---|---|---|
| `OG_KEY` | funded 0G testnet wallet (signs storage writes + relays mints) | `npm run wallet`, then fund at [faucet.0g.ai](https://faucet.0g.ai) |
| `ANTHROPIC_API_KEY` | the chat brain | [console.anthropic.com](https://console.anthropic.com) |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | email login → embedded wallet | [dashboard.privy.io](https://dashboard.privy.io) |

```bash
npm install

# (optional) prove the 0G round-trip works end to end
npm run spike            # put → get → verify, with a tamper negative-control

# (optional) prove a Privy embedded wallet can sign + broadcast on 0G
npm run privy-spike

# The KeepMemory contract is already deployed (data/deploy.json). To redeploy:
npm run deploy:contract  # compiles + deploys + self-tests with a real mint

npm start                # → http://localhost:3000
```

Optional env overrides: `KEEP_RL_BURST`, `KEEP_RL_DAY_GLOBAL`, `KEEP_RL_DAY_IP`
(rate-limit caps), `PORT`.

---

## Demo script (the 2-minute version)

1. **Sign in** (top-right) with your email → enter the one-time code. A secure wallet
   is created for you; the pill shows your address.
2. **Tell it about yourself** — "My name is Matthew and I love teal." The receipt badge
   goes `saving to 0G ~15s` → **`✓ on 0G`**.
3. **Click the badge** → popover shows the rootHash, model, and timestamp. Hit **Verify
   on 0G** → it re-fetches from the chain and confirms it's unaltered.
4. **Mint as NFT ⬦** → the memory becomes a token you own; the badge shows `owned ⬦ #N`
   with a chainscan link.
5. **Hit "prove it ⟲"** → it wipes server RAM and reloads. The banner reads *"rebuilt
   this conversation from 0G — the server held nothing,"* and the memory is still there.
6. **Portability** → sign out, then sign in again (even in a fresh browser). Your
   memories rebuild from 0G under your identity and your tokens are still yours.

---

## Architecture

```
Browser (chat UI)            Node/Express backend            0G Galileo testnet
 • email login (Privy)   ─►   • holds the LLM key        ─►   • Storage (records)
 • holds rootHashes           • ONE funded 0G wallet          • Chain (KeepMemory NFT)
 • rebuilds memory from 0G    • signs writes, relays mints
 • httpOnly session cookie    • LLM reply now, 0G write async (~14s)
```

Backend-centric on purpose: end users need no MetaMask/faucet, so judges and voters get
a **zero-friction demo**. The backend signs 0G writes and relays mints with one
faucet-funded testnet wallet.

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | LLM reply now; persist the record to 0G in the background (rate-limited) |
| `GET /api/receipt/:sessionId/:turnId` | Poll a turn's 0G receipt (`pending` → `stored`) |
| `POST /api/verify` | Re-fetch by rootHash, re-hash, confirm unaltered |
| `POST /api/rehydrate` | Rebuild a session's memory from 0G (ts-sorted, verified on restore, capped) |
| `POST /api/forget` | Wipe the in-memory copy (the "prove it" affordance) |
| `GET /api/session/:sessionId` | The 0G addresses stored for a session (pointers only) |
| `POST /api/mint` | Mint a stored memory as an NFT to the **authenticated** owner + anchor it |
| `POST /api/auth/email/send` · `/verify` · `/api/auth/logout` | Email-OTP identity → session cookie |
| `GET /api/health` | Wallet balance + readiness for the status pills |

Identity-scoped routes (`mint`, `session`, `rehydrate`, `forget`, `chat` for a
wallet id) require the session cookie's address to match — so a public address can't be
used to read, inject, or mint another user's memories.

### Verified 0G stack (Galileo testnet)

- Chain ID **16602**, native token `0G` · RPC `https://evmrpc-testnet.0g.ai`
- Turbo indexer `https://indexer-storage-testnet-turbo.0g.ai`
- Explorers: `chainscan-galileo.0g.ai` · `storagescan-galileo.0g.ai`
- SDKs: `@0gfoundation/0g-storage-ts-sdk` · `ethers` · `@privy-io/node`

---

## Honest scope & threat model

Keep is a **testnet hackathon build**. What it proves — and deliberately does not — is
stated plainly so nothing here overclaims:

- **What verification proves:** a record is **unaltered** and carries the **model and
  time it claims**. It does **not** cryptographically prove *which* model generated the
  text — that's an explicit boundary, not a hidden gap. (If asked, Keep says so.)
- **Ownership is relayer-attested.** The app wallet is the `onlyOwner` minter, so on-chain
  ownership is only as trustless as that relayer is honest. Making users self-mint (or
  sign a message binding their address to a rootHash) would move that trust to the chain
  itself — a deliberate next step, out of scope here.
- **Memories are public.** Records live on public 0G testnet storage with no encryption
  yet, so anyone with a rootHash can read them — don't put secrets in. (Client-side
  encrypt-to-self is a natural extension, not built.)
- **Single funded hot wallet** signs all writes and pays all gas (fine for a testnet
  demo; a production deploy would split the minter role and harden key management).
- **Both times are recorded on-chain:** the record's *claimed* time (relayer-supplied,
  only as trustworthy as the relayer) and the trustless **mint block time** (`anchoredAt`).

---

## Project layout

```
src/og.mjs          0G storage helpers (buildRecord, putRecord, getRecord, verify, walletStatus)
src/llm.mjs         Claude wrapper (the chat brain)
src/chain.mjs       0G Chain layer — mints + anchors memories via KeepMemory
src/privy.mjs       Identity — email-OTP login → Privy embedded wallet
src/session.mjs     Server-side session: signed httpOnly cookie proving identity per request
src/index-store.mjs Durable receipt index (pointers only) → data/index.json
src/server.mjs      Express backend + all API routes
contracts/KeepMemory.sol   ERC-721 + on-chain provenance anchor
public/             zero-build chat UI (index.html, app.js, styles.css)
scripts/            gen-wallet · spike · privy-spike · deploy-contract
data/deploy.json    deployed contract address + ABI (git-ignored)
```
