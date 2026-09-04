import { NextResponse } from "next/server";
import {
  isEvmToken,
  isSolanaToken,
  listTokens,
} from "@/lib/intents";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") ?? "payment";
    const tokens = await listTokens();

    if (scope === "origin") {
      return NextResponse.json({
        tokens: tokens.filter(isEvmToken),
      });
    }

    if (scope === "destination") {
      // Expose Solana asset metadata (assetId/symbol) but never recipient
      return NextResponse.json({
        tokens: tokens.filter(isSolanaToken),
      });
    }

    return NextResponse.json({
      origin: tokens.filter(isEvmToken),
      destination: tokens.filter(isSolanaToken),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list tokens" },
      { status: 500 },
    );
  }
}
