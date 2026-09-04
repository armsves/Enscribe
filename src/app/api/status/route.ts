import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { readInvoiceFromEns } from "@/lib/ens-payment";
import { checkInvoicePayment } from "@/lib/payment-status";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Check whether an invoice deposit has been funded.
 * Prefer ?ens=… (reads amount/chain from Sepolia ENS). Fallback: depositAddress.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ens = searchParams.get("ens")?.trim();
    let depositAddress = searchParams.get("depositAddress")?.trim() ?? "";
    let amount = searchParams.get("amount");
    let originChain = searchParams.get("originChain");
    let originSymbol = searchParams.get("originSymbol");
    let createdAt = searchParams.get("createdAt");

    if (ens) {
      const record = await readInvoiceFromEns(ens);
      if (!record.depositAddress) {
        return NextResponse.json(
          { error: `No deposit address on ${record.ens}` },
          { status: 404 },
        );
      }
      depositAddress = record.depositAddress;
      amount = amount ?? record.amount;
      originChain = originChain ?? record.originChain;
      originSymbol = originSymbol ?? record.originSymbol;
      createdAt = createdAt ?? record.createdAt;
    }

    if (!depositAddress) {
      return NextResponse.json(
        { error: "ens or depositAddress query param is required" },
        { status: 400 },
      );
    }
    if (!isAddress(depositAddress)) {
      return NextResponse.json(
        { error: "Invalid deposit address" },
        { status: 400 },
      );
    }

    const result = await checkInvoicePayment({
      depositAddress,
      amount,
      originChain,
      originSymbol,
      createdAt,
    });

    return NextResponse.json({
      ens: ens ?? null,
      depositAddress,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status check failed" },
      { status: 500 },
    );
  }
}
