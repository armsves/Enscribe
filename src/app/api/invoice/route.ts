import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import {
  getControllerAddress,
  getParentEnsName,
  mintPaymentRequestSubdomain,
} from "@/lib/ens-subdomain";
import {
  isValidSolanaAddress,
  invoiceLabelFromNonce,
} from "@/lib/ens-records";
import { readInvoiceFromEns } from "@/lib/ens-payment";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import {
  listTokens,
  redactRecipient,
  requestConfidentialQuote,
} from "@/lib/intents";
import { PAY_CHAINS } from "@/lib/pay-chains";
import { isSwarmConfigured, uploadEncryptedFile } from "@/lib/swarm";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  amount: string;
  originAsset: string;
  solanaAddress: string;
  refundTo?: string;
  clientName: string;
  description?: string;
  invoiceNumber?: string;
  freelancerName?: string;
};

function appOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3001";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ens = searchParams.get("ens");
    if (!ens) {
      return NextResponse.json({ error: "ens query param is required" }, { status: 400 });
    }

    const record = await readInvoiceFromEns(ens);
    if (!record.depositAddress) {
      return NextResponse.json(
        { error: `No invoice found for ${record.ens}` },
        { status: 404 },
      );
    }

    const chainKey = (record.originChain ?? "").toLowerCase();
    const payChain = PAY_CHAINS[chainKey] ?? null;
    let payToken = null;

    if (payChain && record.originSymbol) {
      const tokens = await listTokens();
      const match = tokens.find(
        (t) =>
          t.blockchain === chainKey &&
          t.symbol.toUpperCase() === record.originSymbol!.toUpperCase() &&
          Boolean(t.contractAddress),
      );
      const contract =
        match?.contractAddress && isAddress(match.contractAddress)
          ? (match.contractAddress as Address)
          : null;
      payToken = {
        symbol: match?.symbol ?? record.originSymbol,
        decimals: match?.decimals ?? 6,
        blockchain: chainKey,
        contractAddress: contract,
        chainId: payChain.chainId,
      };
    }

    return NextResponse.json({
      ...record,
      payToken,
      chainLabel: payChain?.label ?? record.originChain,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read invoice from ENS",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;

    if (!body.amount || !body.originAsset || !body.solanaAddress || !body.clientName?.trim()) {
      return NextResponse.json(
        {
          error:
            "amount, originAsset, solanaAddress, and clientName are required",
        },
        { status: 400 },
      );
    }

    if (!/^\d+$/.test(body.amount)) {
      return NextResponse.json(
        { error: "amount must be base units integer string" },
        { status: 400 },
      );
    }

    if (!isValidSolanaAddress(body.solanaAddress)) {
      return NextResponse.json(
        { error: "Invalid Solana address" },
        { status: 400 },
      );
    }

    const refundRaw = body.refundTo?.trim();
    const refundTo = (
      refundRaw && isAddress(refundRaw)
        ? refundRaw
        : getControllerAddress()
    ) as Address | null;

    if (!refundTo) {
      return NextResponse.json(
        {
          error:
            "refundTo must be a valid EVM address, or set ENS_CONTROLLER_PRIVATE_KEY on the server",
        },
        { status: 400 },
      );
    }

    const solanaAddress = body.solanaAddress.trim();
    const requestId = crypto.randomUUID();
    const label = invoiceLabelFromNonce(requestId);
    const parentEns = getParentEnsName();
    const ens = `${label}.${parentEns}`;
    const createdAt = new Date().toISOString();
    const invoiceNumber =
      body.invoiceNumber?.trim() ||
      `INV-${createdAt.slice(0, 10).replaceAll("-", "")}-${label.slice(-4).toUpperCase()}`;

    const quote = await requestConfidentialQuote({
      amount: body.amount,
      originAsset: body.originAsset,
      solanaRecipient: solanaAddress,
      refundTo,
      dry: false,
    });

    const depositAddress = quote.quote.depositAddress;
    if (!depositAddress) {
      throw new Error("Intents quote did not return a deposit address");
    }

    const tokens = await listTokens();
    const originToken = tokens.find((t) => t.assetId === body.originAsset);

    const mint = await mintPaymentRequestSubdomain({
      label,
      metadata: {
        depositAddress: depositAddress as Address,
        amount: body.amount,
        amountFormatted: quote.quote.amountInFormatted,
        originChain: originToken?.blockchain ?? "evm",
        originSymbol: originToken?.symbol ?? "TOKEN",
        refundTo,
        createdAt,
        clientName: body.clientName.trim().slice(0, 80),
        description: (body.description ?? "").trim().slice(0, 200),
        invoiceNumber,
        freelancerName: (body.freelancerName ?? "").trim().slice(0, 80),
      },
    });

    if (mint.status === "failed") {
      return NextResponse.json(
        {
          error: mint.error ?? "Failed to mint invoice subdomain on ENS",
          ens,
        },
        { status: 500 },
      );
    }

    if (mint.status === "skipped") {
      return NextResponse.json(
        {
          error:
            mint.error ??
            "ENS mint skipped — set ENS_CONTROLLER_PRIVATE_KEY and ENS_ONCHAIN_MINT=true",
        },
        { status: 503 },
      );
    }

    const safeQuote = redactRecipient(
      quote as unknown as Record<string, unknown>,
      solanaAddress,
    );

    const relativePayUrl = `/pay/${encodeURIComponent(ens)}`;
    const absolutePayUrl = `${appOrigin(request)}${relativePayUrl}`;
    const amountFormatted =
      quote.quote.amountInFormatted ?? body.amount;
    const originChain = originToken?.blockchain ?? "evm";
    const originSymbol = originToken?.symbol ?? "TOKEN";

    const pdfBytes = await buildInvoicePdf({
      ens,
      payUrl: absolutePayUrl,
      invoiceNumber,
      clientName: body.clientName.trim(),
      freelancerName: (body.freelancerName ?? "").trim(),
      description: (body.description ?? "").trim(),
      amountFormatted,
      originSymbol,
      originChain,
      depositAddress,
      createdAt,
    });
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    let swarm: {
      reference: string;
      gatewayUrl: string;
      encrypted: boolean;
    } | null = null;
    let swarmError: string | null = null;
    if (isSwarmConfigured()) {
      try {
        swarm = await uploadEncryptedFile({
          data: pdfBytes,
          filename: `${invoiceNumber || ens}.pdf`,
          contentType: "application/pdf",
        });
      } catch (err) {
        swarmError =
          err instanceof Error ? err.message : "Swarm PDF upload failed";
      }
    }

    return NextResponse.json({
      ok: true,
      id: requestId,
      ens,
      invoiceNumber,
      payUrl: relativePayUrl,
      absolutePayUrl,
      depositAddress,
      amount: body.amount,
      amountFormatted,
      amountOutFormatted: quote.quote.amountOutFormatted,
      originChain,
      originSymbol,
      clientName: body.clientName.trim(),
      description: (body.description ?? "").trim(),
      freelancerName: (body.freelancerName ?? "").trim(),
      createdAt,
      mint,
      quote: safeQuote,
      pdfBase64,
      swarmStored: Boolean(swarm),
      swarmError,
      note: "Solana settlement is confidential — only invoice metadata and deposit address are on ENS. Postage batch + Swarm refs stay server-side.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invoice creation failed",
      },
      { status: 400 },
    );
  }
}
