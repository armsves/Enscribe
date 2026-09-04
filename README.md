# Enscribe

**ENS-named invoices for freelancers.** Each invoice mints `inv-*.eth` with public payment metadata. Clients pay USDC on Arbitrum/Optimism; settlement routes privately to Solana via [Aurora confidential Intents](https://docs.intents.aurora.dev/). Accounting groups payments by month and exports CSV for taxes.

## Product

| Area | What it does |
| --- | --- |
| `/` | MetaMask login → dashboard (create invoice + workspace links) |
| `/invoices/new` | Create invoice → Intents quote → mint ENS → PDF + Swarm |
| `/invoices` | Workspace list + payment status refresh |
| `/pay/[ens]` | Client pay page (app resolves Sepolia ENS; MetaMask pays USDC) |
| `/profile` | Freelancer MetaMask + Phantom wallet registration |
| `/accounting` | Monthly ledger + CSV export |

Solana settlement addresses are **never** written to ENS.

## Env

Copy `.env.example` → `.env.local`:

| Var | Required | Notes |
| --- | --- | --- |
| `INTENTS_API_KEY` | yes | [studio.aurora.dev](https://studio.aurora.dev/) |
| `ENS_CONTROLLER_PRIVATE_KEY` | yes | Owner of parent ENS |
| `ENS_PARENT_NAME` | yes | default `commons3nse.eth` |
| `ENS_CHAIN` | yes | `sepolia` |
| `ENS_ONCHAIN_MINT` | no | default true |
| `BEE_URL` | for Swarm | Bee/gateway API (server-only uploads) |
| `BEE_BATCH_ID` | for Swarm | **Server secret** — postage batch, never public |
| `SWARM_DATA_SECRET` | for user store | AES key material for per-wallet records |
| `SWARM_ENCRYPT` | no | Bee encrypt for invoice PDFs (default true) |

## Run

```bash
npm install
npm run dev   # http://localhost:3001
```

## Privacy

| Public (ENS) | Private |
| --- | --- |
| Invoice ENS name | Solana settlement address |
| Client, description, amount | Confidential Intents route |
| Deposit address | Freelancer ledger (local browser) |
