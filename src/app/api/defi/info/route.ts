import { NextResponse } from "next/server";
import { DEFI_NOTES, KAMINO, buildKaminoUsdcDepositSteps } from "@/lib/kamino";

export const runtime = "nodejs";

/**
 * Investigation / scaffold endpoint for Solana DeFi deposits via Intents Connect.
 * Does not execute on-chain — returns the documented Kamino bridge-in step template.
 */
export async function GET() {
  const template = buildKaminoUsdcDepositSteps({
    intermediaryUsdcAta: "<intermediary USDC ATA>",
    intermediaryCollateralAta: "<intermediary cUSDC ATA>",
    liquidityAmount: "{MIN_AMOUNT_OUT}",
  });

  return NextResponse.json({
    ...DEFI_NOTES,
    kaminoMainMarketUsdc: KAMINO,
    connectBaseUrl:
      process.env.INTENTS_CONNECT_API_URL ??
      "https://intents-connect-api.aurora.dev",
    bridgeInEndpoint: "POST /api/v1/executions/{originWallet}",
    requiredHeader: "x-api-key",
    executionMode: "quote_with_steps",
    stepsTemplate: template,
    relationToSolPay:
      "SolPay's default path is a confidential Swap API settlement to a hidden Solana wallet. DeFi deposit is a separate Connect flow that lands in an intermediary, then supplies to Kamino.",
  });
}
