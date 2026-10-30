# ArcPay

> Built with Arc Studio - money-powered apps in minutes

Project memory for future agents and humans.

## What This App Does

USDC payments by `@username` on Arc, from a web dashboard and a Telegram bot. Non-custodial: the bot only prepares a payment request, the user signs it in their own wallet.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, wagmi v2, viem, ConnectKit (stands in for RainbowKit in this sandbox)
- Backend: Bun (`server/`), Turso (libSQL) via `@libsql/client` (`server/db.ts`), Telegram Bot API over plain fetch (long polling)
- Contract: `contracts/ArcPay.sol` (Solidity 0.8.28, Foundry). Commit/reveal username registry plus `pay` and `payToUsername`. No owner, no fees, never holds funds.
- Chain: Arc Testnet (5042002) by default, Arc Mainnet (5042) via `VITE_CHAIN_ID`. USDC ERC-20 (6 decimals) from `@/onchain-facts`.

## Deployments

- Arc Testnet: `0x67aee7753ca0e8e1855aff3a7a10f6c45031c35d`, deployed at block 69716835 (also in `.env` as `VITE_ARCPAY_ADDRESS` and `ARCPAY_DEPLOY_BLOCK`).
- ArcPayDelegate (bot spending limits), Arc Testnet: `0xa46efe86c1f4de5ea77edb6fd3975b7c9cd23929` (`VITE_DELEGATE_ADDRESS`). Relayer wallet key lives in `.env` as `RELAYER_PRIVATE_KEY`; its address is shown by `bun run relayer:create`.
- Mainnet: not deployed by Arc Studio. The user runs `bun run deploy:mainnet -- --yes-mainnet` themselves.

## Key Files

- `src/App.tsx` composition root with the gate sequence (health, wallet, network, sign-in, username, dashboard)
- `src/components/` UI, `src/lib/` session, API client, hooks, env helpers, shared ABI (`arcpay-abi.ts`)
- `server/index.ts` HTTP API, `server/indexer.ts` event indexer, `server/bot.ts` Telegram bot, `server/services.ts` domain logic, `server/parse.ts` command parser
- `scripts/setup.ts` admin setup (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN), `scripts/deploy-arcpay.ts` deploy to testnet or mainnet
- Design: black canvas, sunset gradient (`--sunset` in `src/index.css`), outlined display font (Bowlby One), palm silhouettes in `Brand.tsx`

## Decisions

- Bot spending limits: the owner approves USDC to `ArcPayDelegate` and names the relayer with per-payment, daily and expiry limits. The bot's Confirm button calls `payFor` through the relayer (`server/relayer.ts`). Bot payments under `BOT_MANUAL_SIGN_FROM_USDC` (default 50) that fit the limit send after a Confirm tap that shows the recipient's name, its source and full wallet (`server/messages.ts`); at or above it, or over the limit, they use the signed-link flow. `sendDelegated` itself refuses amounts at or above the threshold. Slither's arbitrary-from-in-transferFrom note on `payFor` is by design: only the delegated relayer can call it, inside the owner's limits.
- Wallet sign-in is a free signed message; sessions are random tokens stored as SHA-256 hashes.
- Pairing codes are single use, expire in 10 minutes, and only their hash is stored.
- Telegram "send" creates a payment intent; the memo of the onchain payment is the intent id, which lets the indexer confirm it.
- Gas on Arc is USDC, so payment checks keep a small USDC reserve (0.05).
- The backend reaches the chain through the sandbox RPC proxy when available, else the public RPC from `@/onchain-facts`.

- Database: timestamps are ISO text, USDC amounts are base-unit integers stored as TEXT. Use `?` placeholders through the `Db` wrapper.

## To Run

```bash
bun install
bun run setup
bun run server
bun run dev
```
