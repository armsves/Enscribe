import { NextResponse } from "next/server";
import type { Hex } from "viem";
import type { FreelancerProfile, LocalInvoice } from "@/lib/invoice-store";
import {
  isUserStoreConfigured,
  loadUserRecord,
  saveUserRecord,
  verifyUserAuth,
} from "@/lib/swarm";

export const runtime = "nodejs";
export const maxDuration = 60;

type AuthBody = {
  address?: string;
  timestamp?: number;
  signature?: string;
};

function parseAuth(input: AuthBody) {
  if (!input.address || !input.timestamp || !input.signature) {
    throw new Error("address, timestamp, and signature are required");
  }
  return {
    address: input.address,
    timestamp: Number(input.timestamp),
    signature: input.signature as Hex,
  };
}

/** Load encrypted per-wallet profile + invoice ledger from Swarm (via feed). */
export async function GET(request: Request) {
  try {
    if (!isUserStoreConfigured()) {
      return NextResponse.json(
        { error: "Swarm user store is not configured on the server" },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const wallet = await verifyUserAuth(
      parseAuth({
        address: searchParams.get("address") ?? undefined,
        timestamp: Number(searchParams.get("timestamp") ?? NaN),
        signature: searchParams.get("signature") ?? undefined,
      }),
    );

    const record = await loadUserRecord(wallet);
    return NextResponse.json({
      ok: true,
      wallet,
      found: Boolean(record),
      updatedAt: record?.updatedAt ?? null,
      profile: record?.profile ?? null,
      invoices: record?.invoices ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load user store",
      },
      { status: 400 },
    );
  }
}

/** Encrypt + upload user record, update Swarm feed pointer for this wallet. */
export async function PUT(request: Request) {
  try {
    if (!isUserStoreConfigured()) {
      return NextResponse.json(
        { error: "Swarm user store is not configured on the server" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as AuthBody & {
      profile?: FreelancerProfile;
      invoices?: LocalInvoice[];
    };

    const wallet = await verifyUserAuth(parseAuth(body));
    if (!body.profile) {
      return NextResponse.json({ error: "profile is required" }, { status: 400 });
    }

    const saved = await saveUserRecord({
      wallet,
      profile: body.profile,
      invoices: Array.isArray(body.invoices) ? body.invoices : [],
    });

    return NextResponse.json({
      ok: true,
      wallet,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save user store",
      },
      { status: 400 },
    );
  }
}
