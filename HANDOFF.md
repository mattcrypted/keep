# Handoff — "Keep" · 0G Cup (The Zero Cup) build

> ## ⚠️ UPDATE — 2026-06-21 (read first; the body below is historical)
> This original handoff predates two decisions and is **stale where it says Chain or
> identity are "not built / deferred"** (e.g. the phasing table, and lines stating
> *"#3 on-chain ownership is deferred to a later round"*, *"per-user wallet … a
> later-round feature"*, *"NOT started … 0G Chain (QF+)"*). Current reality:
> - **Ownership (0G Chain) is LIVE.** `KeepMemory` ERC-721 (v2) is deployed at
>   `0x9ea49d676462e8BC3754574E4b7F9D116778F87F` (chain 16602); minting + on-chain
>   anchoring (incl. trustless `block.timestamp`) work end-to-end, and ownership is
>   read back from the chain so `owned` badges follow the identity to any device.
>   See `contracts/KeepMemory.sol`, `src/chain.mjs`. (v1 was `0xCD33…2c2B`.)
> - **Identity is LIVE.** Email-OTP login via Privy embedded wallets, with a
>   server-side session cookie (`src/session.mjs`, `src/privy.mjs`).
> - **0G Compute / "prove the model produced it" is DROPPED from scope** (too
>   expensive). Keep's honest boundary: it proves a record is unaltered + carries its
>   claimed model/time, and does **not** claim to prove which model generated the text.
> - The current judge-facing source of truth is **`README.md`** (rewritten 2026-06-21).
>   Session narratives: ownership+identity first cut → `/tmp/keep-handoff-2026-06-20.md`;
>   **security hardening + contract v2 + chain-sourced ownership → `/tmp/keep-handoff-2026-06-21.md`** (latest).

**Created:** 2026-06-19, by a Claude Code session working in `~/hermes`.
**Scope:** ONLY the 0G Cup submission ("Keep"). Ignore all other hermes work.
**Project home:** `~/keep` — a NEW, standalone folder, **not** inside `~/hermes` (hermes holds unrelated `.env` secrets; keep this project isolated, matching the `~/pharos-sentinel` convention). Name "Keep" is provisional (alts: *Witness*, *Recall*) — rename the folder if it changes.

## TL;DR — what you're building
A web app for **The Zero Cup**, 0G's vibe-coding tournament. **Keep** = a *self-sovereign AI*: a text chat agent whose every output is (1) **remembered** on 0G storage, (2) **tamper-evident / verifiable**, and (3) eventually **owned** on 0G chain. These are three *properties of one record*, NOT three separate features. Pitch: **"an AI that remembers you — and can prove it."**

## Deadline & format
- **Group-stage submission: 2026-06-23** (~4 days out). Knockout rounds run to Jul 19. Judges score group→R16; **community votes decide from the quarter-finals on** (so shareability matters later).
- **Eligibility gate:** 0G must do real work (storage / compute / chain). *"If it runs the same without 0G, it's a bolt-on and disqualified."*
- Submit at **0g.ai/arena**. Rules: https://0g.ai/arena/zero-cup/submission-criteria · https://0g.ai/arena/zero-cup/competition-rules
- **Web app only** — no native/mobile build (the user's 2015 Intel Mac can't build iOS; web sidesteps it entirely).

## Phasing (deliberate — maps to rounds AND 0G primitives)
| Round | Ship | 0G primitive |
|---|---|---|
| **R1 / group stage (Jun 23)** | memory + provenance receipt | **Storage** |
| ~~R32 / R16~~ | ~~trustless verifiable inference~~ — **DROPPED from scope (too expensive)** | ~~Compute~~ |
| ✅ **shipped (pulled forward)** | mint records as owned objects + portable email-login identity | **Chain** + Privy |

**Round-1 scope = 2 of the 3 solutions above: #1 memory + #2 provenance** (the storage-anchored receipt + Verify — NOT yet trustless 0G-Compute inference). **#3 on-chain ownership is deferred to a later round**, as is the deeper form of #2 (verifiable inference on Compute). Only Round 1 is due Jun 23 — don't build the Round-2 (Compute) or Round-3 (Chain) upgrades before the Round-1 memory loop works.

## Round-1 MVP (the only thing due Jun 23)
- **One screen: chat.** Each AI message carries a `✓ on 0G` badge → popover showing the rootHash (link to storagescan-galileo), model, timestamp, and a **Verify** button.
- A "remembering N things" indicator; reload the page → the AI still knows you (proves memory is real).
- **Record model (one object, two jobs):**
  ```
  { sessionId, prompt, response, model, ts, hash: sha256(prompt + response + model + ts) }
  ```
  Uploaded to 0G; its **rootHash is the receipt** (content-addressed = tamper-proof — change one byte and the rootHash changes).
- **Verify flow:** fetch by rootHash with merkle proof, recompute the hash, confirm it matches. Honest scope: this proves the record is unchanged + stamps the claimed model/time; it does NOT prove which model actually produced it (a deliberate boundary — 0G Compute is out of scope).

## Verified 0G stack (from docs.0g.ai, checked 2026-06-19)
- Testnet: **0G Galileo**, **Chain ID 16602** *(some 3rd-party listings/ThirdWeb say 16601 — confirm in MetaMask)*, native token `0G`.
- Dev RPC: `https://evmrpc-testnet.0g.ai` · Turbo indexer: `https://indexer-storage-testnet-turbo.0g.ai`
- Faucet: https://faucet.0g.ai (0.1 0G/day; ask in Discord for more) + Google Cloud faucet.
- Storage Flow contract: `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`
- Explorers: chainscan-galileo.0g.ai · storagescan-galileo.0g.ai
- **Storage SDK:** `@0gfoundation/0g-storage-ts-sdk` (+ `ethers` peer dep). **Clone the starter kit first:** https://github.com/0gfoundation/0g-storage-ts-starter-kit (has working scripts + a browser impl in `web/src/storage.ts` + a Vite polyfill config).
- **SDK calls (backend / Node):**
  ```js
  import { MemData, Indexer } from '@0gfoundation/0g-storage-ts-sdk';
  import { ethers } from 'ethers';
  const RPC = 'https://evmrpc-testnet.0g.ai';
  const provider = new ethers.JsonRpcProvider(RPC);
  const signer   = new ethers.Wallet(process.env.OG_KEY, provider); // throwaway faucet-funded wallet
  const indexer  = new Indexer('https://indexer-storage-testnet-turbo.0g.ai');

  // WRITE: returns the receipt id
  const data = new MemData(new TextEncoder().encode(JSON.stringify(record)));
  const [tree] = await data.merkleTree();
  const [tx, err] = await indexer.upload(data, RPC, signer);   // save tree.rootHash()

  // READ / VERIFY (works in browser or Node)
  const [blob, derr] = await indexer.downloadToBlob(rootHash, { proof: true });
  ```
- Gotchas: `indexer.download()` is Node-only (uses `fs`) — use `downloadToBlob`. The SDK imports `fs`/`crypto` at load, so browser bundlers need polyfills (see the starter kit's `web/vite.config.ts`).

## Architecture (backend-centric — chosen on purpose)
- Browser chat UI (no wallet for end users) → **Node/Express or Next API routes** backend.
- Backend holds the **LLM key (Claude)** + **one faucet-funded 0G testnet wallet**. On each turn it calls the LLM, builds the record, uploads to 0G, returns `{reply, rootHash}`. `/verify` re-fetches by rootHash.
- Why: avoids browser polyfill pain and gives judges/voters a **zero-friction demo** (no MetaMask/faucet to try it).
- The "true self-sovereignty" upgrade — per-user wallet + the SDK's built-in **client-side ECIES encrypt-to-self** (the network never sees plaintext; only the user's wallet can decrypt) — is a later-round feature, not Round 1.

## Progress so far (updated 2026-06-19, post-build) — ROUND 1 BUILT & WORKING LIVE
The Round-1 MVP is **complete and validated end to end**. Wallet funded (0.5 0G), spike green,
full app built, adversarial review done, all confirmed fixes applied and re-tested live.
- **Spike PASSED** (`npm run spike`): put→get→verify, 5 integrity assertions incl. tamper
  negative-control. The #1 risk (0G round-trip) is retired. 0G write latency ≈ 14s.
- **Wallet:** `0x7353E916DA4EBCe042A7078a97BCAC900E0e8cb4`, key in `.env` as `OG_KEY`,
  funded ~0.5 0G. Chain ID confirmed **16602**.
- **App built** (`npm start` → http://localhost:3000):
  - `src/og.mjs` — 0G helpers (+ `walletStatus` for health).
  - `src/llm.mjs` — Claude wrapper (`claude-opus-4-8`, adaptive thinking, effort medium).
  - `src/server.mjs` — Express backend: `/api/chat` (LLM reply now, 0G write async + retry,
    rate-limited), `/api/receipt`, `/api/verify`, `/api/rehydrate` (ts-sorted + verify-on-restore
    + `serverHadSession` flag), `/api/forget`, `/api/health`.
  - `public/` — zero-build chat UI: `✓ on 0G` badges, receipt popover + Verify, "remembering N"
    (optimistic), reload-rehydrates-from-0G, **"prove it ⟲"** wipe-RAM button.
  - `README.md` — judge-facing pitch + quick start + demo script.
- **ANTHROPIC_API_KEY** set in `.env` and validated with a live call. **Full loop proven live:**
  chat → Claude reply → 0G persist (~14s) → badge flips → Verify confirms unaltered → memory recalled.
- **Adversarial review** (31-agent workflow): 27 findings → 12 confirmed → all applied & re-tested.
  Notably fixed: rehydrate reordering (HIGH, now ts-sorted — proven via reversed-input test),
  open-endpoint wallet-drain (MEDIUM, now rate-limited — 429 on burst), verify-on-rehydrate,
  the "prove it" wipe-RAM affordance, README.
- **Durability fix (Jun 20):** added a durable server-side receipt index
  (`src/index-store.mjs` → `data/index.json`, gitignored) keyed by sessionId. It records
  each turn's 0G address when the *write completes server-side* (not browser-dependent) and
  survives server restarts; the client merges it on load (`GET /api/session/:id`). Fixes
  memory loss when a tab closed during the ~14s write window (root cause of "yesterday is
  forgotten"). Verified across a kill+restart. **Caveat:** turns orphaned *before* this fix
  can't be recovered (their addresses were never recorded). Returns only addresses — memory
  is still fetched + re-verified from 0G, so eligibility is intact.
- **NOT started (by design — later rounds):** 0G Compute (R32), 0G Chain (QF+).

## Immediate next steps (in order) — build is done; submission tasks remain
1. ~~Day-1 spike~~ ✅ ~~Scaffold app~~ ✅ ~~Chat loop~~ ✅ ~~Provenance UX~~ ✅ ~~Review + fixes~~ ✅ ~~README~~ ✅
2. **Browser smoke test** — open http://localhost:3000, run the README demo script (tell it your
   name → reload → "prove it ⟲" → click a badge → Verify). Confirm the UI visually.
3. **Record a short demo video** following the README demo script (this is vote-bait for later rounds too).
4. **(Optional) Deploy publicly** so judges can try it without running locally + two keys. If deploying,
   move secrets to the host's env, keep the rate-limiter, and top up the faucet wallet first.
5. **Submit on 0G Arena before Jun 23** (0g.ai/arena). Leave buffer.

## #1 bottleneck / risk
The 0G storage round-trip (new chain + SDK, never used before). Spike it Day 1. If it fights you, ask in 0G Discord: discord.com/invite/0glabs.

## Rejected — do NOT revisit
The original **"Shoulders"** concept and **any real-time-avatar + voice-clone "presence" flow**. Its wow was **D-ID Talks Streams** (D-ID sponsored the hackathon it won) + **ElevenLabs** voice cloning — costs real money (no sponsor here; D-ID bills per streaming-second × 2 streams) and **0G has no native role in it → bolt-on**. Reference only: github.com/billums123/shoulder-angels.

## Secrets & safety
- Create a **fresh `.env` in `~/keep`** for this project's keys (LLM key + the 0G wallet private key). **Never reuse or copy `~/hermes/.env`**, and never commit any `.env` or private key. Use a **throwaway testnet wallet** for the 0G signer.

## Suggested skills (invoke as available)
- **claude-api** — consult before wiring the LLM "brain" (current Claude model IDs / params).
- **tdd** — build the 0G `put → get → verify` round-trip test-first; the integrity check is a natural unit test.
- **diagnose** — for the likely-thorny 0G SDK / testnet integration bugs.
- **run** / **verify** — to launch the app and confirm memory persists + Verify works before submitting.

## Fuller context (optional)
The complete plan + rationale lives in the originating workspace's memory: `/Users/Matthew/.claude/projects/-Users-Matthew-hermes/memory/zerog-cup-self-sovereign-ai.md`. Note: that memory is keyed to the `~/hermes` workspace and may NOT auto-load when you work in `~/keep` — this handoff is written to stand alone.
