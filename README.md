# ArcPay

Send and receive USDC on Arc by `@username`, from a web dashboard or a Telegram bot. Wallets stay non-custodial: every payment is signed in your own wallet.

Built with [Arc Studio](https://studio.arc.io)

## What it does

- Connect a wallet and claim a permanent onchain username.
- Pair your Telegram account with a one-time code, then send, tip and receive USDC in chat.
- Pay by `@username` (ArcPay name or linked Telegram handle) or by wallet address.
- Optional bot spending limit: pre-approve a small budget so the Telegram bot can send with one tap and no wallet signature.
- Dashboard with live payment history, a guided send flow, and session controls to disconnect wallets or revoke the Telegram bot.

## Tech stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit
- Backend: Bun, Turso (libSQL), Telegram Bot API
- Contract: Solidity (Foundry) on Arc

## Development

Prerequisites: [Bun](https://bun.sh), [Foundry](https://getfoundry.sh), a [Turso](https://turso.tech) database, and (optional) a Telegram bot token from @BotFather.

```bash
bun install
bun run setup          # asks for your Turso URL and token and an optional bot token, creates the tables
bun run server         # backend API, payment indexer and Telegram bot on :3001
bun run dev            # web app on :5173 (proxies /api to the backend)
```

Other commands:

```bash
bun run contracts:build   # compile the contract
bun run contracts:test    # contract tests
bun run test:server       # backend tests
bun run check             # lint and typecheck
bun run deploy:testnet    # deploy to Arc Testnet from your wallet
```

### Environment variables

Set these in `.env` (never commit it). `bun run setup` writes most of them.

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso database URL (`libsql://...`). Required. The API stays in setup mode until it is set. A `file:` path also works for local testing. |
| `TURSO_AUTH_TOKEN` | Turso auth token. Required for a remote Turso database. |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Optional, the bot is off without it. |
| `PUBLIC_APP_URL` | Public https address of the web app, used for payment links sent by the bot. |
| `VITE_CHAIN_ID` | `5042002` for Arc Testnet (default) or `5042` for Arc Mainnet. |
| `VITE_ARCPAY_ADDRESS` | Address of the deployed ArcPay contract. |
| `VITE_DELEGATE_ADDRESS` | Address of the deployed ArcPayDelegate contract (bot spending limits). Optional. |
| `BOT_MANUAL_SIGN_FROM_USDC` | Bot payments at or above this amount always need a wallet signature in the web app. Default `50`. |
| `BOT_GAS_FEE_USDC` | Gas reimbursement the bot takes per payment from the user's limit, default `0.01`. Each user caps it. |
| `RELAYER_PRIVATE_KEY` | Key of the bot's payment wallet. Created by `bun run relayer:create`. Keep it secret, fund it with a little USDC for gas only. |
| `ARCPAY_DEPLOY_BLOCK` | Block the contract was deployed at, where payment indexing starts. |
| `PORT` | Backend port, default `3001`. |
| `ARC_RPC_URL` | Optional RPC override for the backend. |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Provisioned by Arc Studio. Optional elsewhere. |
| `PRIVATE_KEY` | Deployer key for `deploy:testnet` and `deploy:mainnet`. Export it in your shell only. |
| `ARC_TESTNET_RPC_URL`, `ARC_MAINNET_RPC_URL` | Optional RPC overrides for the deploy script. |

## Deploying to Arc Mainnet

Mainnet moves real USDC and transactions cannot be undone. Get the contract independently reviewed and audited first, and test on testnet.

```bash
bun run contracts:build
export PRIVATE_KEY=0x...        # your own funded deployer wallet
bun run deploy:mainnet -- --yes-mainnet
```

The script asks you to type a confirmation phrase, deploys, checks the result, and prints the three values to put in `.env`. A Foundry alternative is `contracts/script/DeployArcPay.s.sol`. Then set `VITE_CHAIN_ID=5042`, restart the backend and the web app.

## Bot spending limit (optional)

Turn this on so the bot can send without a wallet signature each time. Each person sets a per-payment limit, a daily limit and an expiry, and can turn it off at any time. Bot payments under 50 USDC (change with `BOT_MANUAL_SIGN_FROM_USDC`) that fit the limit send after one Confirm tap in Telegram (the confirmation shows the username and full wallet address). Payments of 50 USDC or more, or above the limit, always ask for a wallet signature in the web app.

```bash
bun run deploy:testnet -- --contract ArcPayDelegate   # or deploy:mainnet -- --contract ArcPayDelegate --yes-mainnet
bun run relayer:create                                  # creates the bot's payment wallet, prints its address
```

The admin, not the users, keeps the relayer funded. Users only repay the small network fee from their own limit. `GET /health` reports the relayer's gas balance and a `low` flag, and the backend logs a warning when it drops below 0.5 USDC, so watch that and top it up. If it runs dry, bot payments fall back to the signed web link instead of failing.

Set `VITE_DELEGATE_ADDRESS` in `.env`, fund the printed relayer address with a little USDC for its first payments (after that each payment repays its own gas through the network fee), and restart the backend. The relayer key can move users' USDC up to the limits they chose, so keep it out of source control and use a separate wallet with only gas funds. For mainnet, consider keeping that key in a managed wallet or key service.

## Telegram bot

Create a bot with @BotFather, put the token in `TELEGRAM_BOT_TOKEN`, restart the backend, then generate a pairing code on the dashboard and send it to the bot.
