/**
 * Test a confidential Intents payment:
 *   10 USDC on Arbitrum or Optimism → USDC on Solana
 *
 * Both L2s are supported by Aurora Intents. Default chain: Arbitrum.
 *
 * Usage:
 *   npx tsx scripts/test-payment.ts --refund 0xYourEvmWallet
 *   npx tsx scripts/test-payment.ts --chain op --refund 0xYourEvmWallet
 *   npx tsx scripts/test-payment.ts --dry --refund 0xYourEvmWallet
 *   npx tsx scripts/test-payment.ts --recipient <solanaPubkey> --refund 0x...
 *
 * Env (from .env.local):
 *   INTENTS_API_KEY   required
 *   SOLANA_RECIPIENT  optional fallback if --recipient omitted
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type Token = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  contractAddress?: string | null;
};

type QuoteResponse = {
  quote?: {
    depositAddress?: string;
    depositMemo?: string;
    amountInFormatted?: string;
    amountOutFormatted?: string;
    amountInUsd?: string;
    amountOutUsd?: string;
    timeEstimate?: number;
    deadline?: string;
    minAmountOut?: string;
  };
  correlationId?: string | null;
  message?: string;
  error?: string;
};

const API_BASE = "https://intents-api.aurora.dev";
const AMOUNT_USDC = "10";
const DEFAULT_CHAIN = "arb" as const;

const CHAIN_LABEL: Record<string, string> = {
  arb: "Arbitrum",
  op: "Optimism",
};

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return `${whole.replace(/\D/g, "") || "0"}${padded}`.replace(/^0+(?=\d)/, "") || "0";
}

async function main() {
  loadEnvLocal();

  const apiKey = process.env.INTENTS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("INTENTS_API_KEY missing — set it in .env.local");
  }

  const chain = (arg("chain") ?? DEFAULT_CHAIN).toLowerCase();
  if (chain !== "arb" && chain !== "op") {
    throw new Error(`--chain must be arb or op (got ${chain}). Both are supported.`);
  }

  const dry = hasFlag("dry");
  const refundTo = arg("refund");
  if (!refundTo || !/^0x[a-fA-F0-9]{40}$/.test(refundTo)) {
    throw new Error("Pass a valid EVM refund wallet: --refund 0x...");
  }

  const recipient =
    arg("recipient")?.trim() ||
    process.env.SOLANA_RECIPIENT?.trim() ||
    "ivemZpkY6sHxMmJdRD1kjfRFQkVgxDbVQGq9vysna5f";

  console.log("\nSolPay payment test");
  console.log("-------------------");
  console.log(`Origin:      10 USDC on ${CHAIN_LABEL[chain]} (${chain})`);
  console.log(`Destination: USDC on Solana`);
  console.log(`Recipient:   ${recipient.slice(0, 4)}…${recipient.slice(-4)} (redacted in full logs below)`);
  console.log(`Refund to:   ${refundTo}`);
  console.log(`Mode:        ${dry ? "dry (quote only)" : "live quote + deposit address"}`);
  console.log(`Note:        Ethereum mainnet is NOT used for this payment path.\n`);

  const tokensRes = await fetch(`${API_BASE}/api/tokens/${apiKey}`);
  const tokensJson = (await tokensRes.json()) as
    | Token[]
    | { tokens?: Token[]; message?: string };
  if (!tokensRes.ok) {
    throw new Error(
      `tokens failed: ${typeof tokensJson === "object" && tokensJson && "message" in tokensJson ? tokensJson.message : tokensRes.status}`,
    );
  }
  const tokens = Array.isArray(tokensJson)
    ? tokensJson
    : (tokensJson.tokens ?? []);

  const origin = tokens.find(
    (t) =>
      t.symbol.toUpperCase() === "USDC" &&
      t.blockchain === chain,
  );
  const destination = tokens.find(
    (t) => t.symbol.toUpperCase() === "USDC" && t.blockchain === "sol",
  );

  if (!origin) {
    throw new Error(`USDC not found on ${chain} in Intents token list`);
  }
  if (!destination) {
    throw new Error("USDC not found on Solana in Intents token list");
  }

  console.log("Origin asset:");
  console.log(`  ${origin.assetId}`);
  console.log(`  contract ${origin.contractAddress}`);
  console.log("Destination asset:");
  console.log(`  ${destination.assetId}`);
  console.log(`  mint ${destination.contractAddress}\n`);

  const amount = toBaseUnits(AMOUNT_USDC, origin.decimals);
  const deadline = new Date(Date.now() + 15 * 60_000).toISOString();
  const slippage = Number(process.env.DEFAULT_SLIPPAGE_BPS ?? "100");

  const body = {
    dry,
    confidentiality: "advanced",
    swapType: "EXACT_INPUT",
    amount,
    originAsset: origin.assetId,
    destinationAsset: destination.assetId,
    depositType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo,
    refundType: "ORIGIN_CHAIN",
    slippageTolerance: slippage,
    deadline,
  };

  console.log(`Requesting confidential quote for ${amount} base units…`);
  const quoteRes = await fetch(`${API_BASE}/api/quote/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const quoteJson = (await quoteRes.json()) as QuoteResponse;
  if (!quoteRes.ok) {
    console.error(JSON.stringify(quoteJson, null, 2));
    throw new Error(
      `quote failed (${quoteRes.status}): ${quoteJson.message ?? quoteJson.error ?? "unknown"}`,
    );
  }

  const q = quoteJson.quote;
  if (!q) {
    console.error(JSON.stringify(quoteJson, null, 2));
    throw new Error("quote response missing quote object");
  }

  console.log("\nQuote OK");
  console.log(`  send:     ${q.amountInFormatted} USDC (~$${q.amountInUsd})`);
  console.log(`  receive:  ${q.amountOutFormatted} USDC (~$${q.amountOutUsd})`);
  console.log(`  min out:  ${q.minAmountOut}`);
  console.log(`  ETA:      ~${q.timeEstimate ?? "?"}s`);
  if (q.deadline) console.log(`  deadline: ${q.deadline}`);

  if (dry) {
    console.log("\nDry run complete — re-run without --dry to get a deposit address.");
    return;
  }

  if (!q.depositAddress) {
    throw new Error("Live quote did not return depositAddress");
  }

  console.log("\nDeposit address (send exactly 10 USDC on", CHAIN_LABEL[chain] + "):");
  console.log(`  ${q.depositAddress}`);
  if (q.depositMemo) console.log(`  memo: ${q.depositMemo}`);

  console.log("\nNext steps:");
  console.log(`  1. On ${CHAIN_LABEL[chain]}, transfer 10 USDC to the deposit address above.`);
  console.log(
    `     USDC contract: ${origin.contractAddress}`,
  );
  console.log(
    `  2. Poll status:\n     curl -sS "${API_BASE}/api/status/${apiKey}?depositAddress=${q.depositAddress}"`,
  );
  console.log(
    "  3. Funds settle as USDC on Solana to the registered recipient (confidential route).",
  );
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
