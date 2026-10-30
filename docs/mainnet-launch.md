# Mainnet launch checklist

Mainnet moves real USDC and transactions cannot be undone. Arc Studio does not deploy to or operate on mainnet for you. You run every step below yourself, outside Arc Studio, after your own review.

## 1. Before you touch mainnet

- [ ] Get `contracts/ArcPay.sol` and `contracts/ArcPayDelegate.sol` independently audited by a professional firm. The automated reviews in this project are not a substitute.
- [ ] Run a full test on Arc Testnet: register a username, link Telegram, turn on a spending limit, send under 50 USDC with the Confirm button, send 50 USDC or more and sign in the web app, revoke the limit.
- [ ] Decide your limits: the fee `BOT_GAS_FEE_USDC` (default 0.01), the signature threshold `BOT_MANUAL_SIGN_FROM_USDC` (default 50). Check real Arc mainnet gas costs first.

## 2. Keys and wallets

- [ ] Create a fresh deployer wallet that holds only what it needs for gas. Export its key in your shell as `PRIVATE_KEY`; never put it in a file or chat.
- [ ] Create a separate bot payment wallet (relayer) with `bun run relayer:create`, or better, keep that key in a managed wallet or key service. It must hold only gas money.
- [ ] Fund the deployer and the relayer with mainnet USDC for gas. Arc gas is paid in USDC.

## 3. Deploy the contracts (from your machine)

```bash
bun install
bun run contracts:build
export PRIVATE_KEY=0x...
bun run deploy:mainnet -- --yes-mainnet                           # ArcPay
bun run deploy:mainnet -- --yes-mainnet --contract ArcPayDelegate # ArcPayDelegate
```

Each run asks you to type `DEPLOY TO MAINNET`, then prints the values for `.env`. Check both addresses on https://explorer.arc.io.

## 4. Production configuration

Set these on the backend host (not in source control): `VITE_CHAIN_ID=5042`, `VITE_ARCPAY_ADDRESS`, `VITE_DELEGATE_ADDRESS`, `ARCPAY_DEPLOY_BLOCK`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `RELAYER_PRIVATE_KEY`, `PUBLIC_APP_URL` (your https web address).

Use a new Turso database for mainnet so testnet data does not mix in.

## 5. Hosting

- Web app: deploy to Vercel (build output `dist`) with `VITE_CHAIN_ID=5042`, `VITE_ARCPAY_ADDRESS`. Add a rewrite so `/api/*` goes to your backend address.
on host (- Backend: an always-Railway, Render, Fly.io or a server) running `bun run server`. Run exactly one copy, because two copies would both poll Telegram.

## 6. Go-live checks

- [ ] `GET /health` shows the mainnet chain, the contract addresses, `bot.running: true`, and `relayer.low: false`.
- [ ] Test with small amounts (for example 0.1 USDC) between two of your own accounts before inviting anyone.
- [ ] Watch the backend log for `LOW GAS` warnings and top up the relayer.
- [ ] Revoke and replace the Telegram bot token if it was ever shared.

## 7. Risks to accept knowingly

- The relayer key can spend each user's remaining budget up to the limits they set. If it leaks, tell users to turn off their limit and replace the key.
- Usernames are permanent and first come, first served.
- Telegram chats are not end to end encrypted. Pairing codes are single use and expire in 10 minutes.
