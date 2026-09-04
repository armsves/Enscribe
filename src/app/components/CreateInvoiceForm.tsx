"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  downloadPdfBase64,
  loadProfile,
  markInvoiceSent,
  saveProfile,
  upsertInvoice,
  type LocalInvoice,
} from "@/lib/invoice-store";
import { pushUserStoreToSwarm } from "@/lib/swarm-client";
import {
  connectMetaMask,
  connectMetaMaskSolana,
  connectPhantom,
  shorten,
} from "@/lib/wallets";

type Token = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
};

type PublicConfig = {
  parentEns?: string;
  controllerConfigured?: boolean;
  onChainMint?: boolean;
  intentsConfigured?: boolean;
};

const CHAIN_LABEL: Record<string, string> = {
  arb: "Arbitrum",
  op: "Optimism",
  base: "Base",
  eth: "Ethereum",
};

export function CreateInvoiceForm() {
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [freelancerName, setFreelancerName] = useState("");
  const [solanaAddress, setSolanaAddress] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [amount, setAmount] = useState("500");
  const [originAsset, setOriginAsset] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [result, setResult] = useState<LocalInvoice | null>(null);
  const [absolutePayUrl, setAbsolutePayUrl] = useState<string | null>(null);
  const [swarmError, setSwarmError] = useState<string | null>(null);

  useEffect(() => {
    const profile = loadProfile();
    setFreelancerName(profile.displayName);
    setSolanaAddress(profile.solanaAddress);
    setRefundTo(profile.defaultRefundTo);

    void (async () => {
      const [cRes, tRes] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/tokens?scope=origin"),
      ]);
      setConfig((await cRes.json()) as PublicConfig);
      const tJson = (await tRes.json()) as { tokens?: Token[] };
      const list = tJson.tokens ?? [];
      setTokens(list);
      const preferred =
        list.find((t) => t.symbol === "USDC" && t.blockchain === "arb") ??
        list.find((t) => t.symbol === "USDC" && t.blockchain === "op") ??
        list[0];
      if (preferred) setOriginAsset(preferred.assetId);
    })();
  }, []);

  const selected = useMemo(
    () => tokens.find((t) => t.assetId === originAsset),
    [tokens, originAsset],
  );

  const amountBaseUnits = useMemo(() => {
    if (!selected) return "";
    const [whole, frac = ""] = amount.trim().split(".");
    const padded = (frac + "0".repeat(selected.decimals)).slice(
      0,
      selected.decimals,
    );
    const raw = `${whole.replace(/\D/g, "") || "0"}${padded}`.replace(
      /^0+(?=\d)/,
      "",
    );
    return raw || "0";
  }, [amount, selected]);

  const linkPhantom = async () => {
    setWalletMsg(null);
    setError(null);
    try {
      const address = await connectPhantom();
      setSolanaAddress(address);
      saveProfile({
        displayName: freelancerName.trim(),
        solanaAddress: address,
        defaultRefundTo: refundTo.trim(),
      });
      setWalletMsg(`Phantom Solana: ${shorten(address, 6)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Phantom connect failed");
    }
  };

  const linkMetaMaskSolana = async () => {
    setWalletMsg(null);
    setError(null);
    try {
      const address = await connectMetaMaskSolana();
      setSolanaAddress(address);
      saveProfile({
        displayName: freelancerName.trim(),
        solanaAddress: address,
        defaultRefundTo: refundTo.trim(),
      });
      setWalletMsg(`MetaMask Solana: ${shorten(address, 6)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MetaMask Solana connect failed");
    }
  };

  const linkMetaMask = async () => {
    setWalletMsg(null);
    setError(null);
    try {
      const address = await connectMetaMask();
      setRefundTo(address);
      saveProfile({
        displayName: freelancerName.trim(),
        solanaAddress: solanaAddress.trim(),
        defaultRefundTo: address,
      });
      setWalletMsg(`MetaMask: ${shorten(address)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MetaMask connect failed");
    }
  };

  const create = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSwarmError(null);
    setAbsolutePayUrl(null);
    try {
      if (!clientName.trim()) throw new Error("Client name is required");
      if (!solanaAddress.trim()) {
        throw new Error("Connect Phantom or enter a Solana settlement address");
      }
      if (!originAsset) throw new Error("Select a payment token");

      saveProfile({
        displayName: freelancerName.trim(),
        solanaAddress: solanaAddress.trim(),
        defaultRefundTo: refundTo.trim(),
      });

      const res = await fetch("/api/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountBaseUnits,
          originAsset,
          solanaAddress: solanaAddress.trim(),
          clientName: clientName.trim(),
          description: description.trim(),
          invoiceNumber: invoiceNumber.trim() || undefined,
          freelancerName: freelancerName.trim() || undefined,
          ...(refundTo.trim() ? { refundTo: refundTo.trim() } : {}),
        }),
      });
      const data = (await res.json()) as {
        id?: string;
        ens?: string;
        payUrl?: string;
        absolutePayUrl?: string;
        depositAddress?: string;
        amount?: string;
        amountFormatted?: string;
        originChain?: string;
        originSymbol?: string;
        clientName?: string;
        description?: string;
        invoiceNumber?: string;
        freelancerName?: string;
        createdAt?: string;
        pdfBase64?: string;
        swarmStored?: boolean;
        swarmError?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Invoice creation failed");

      const local: LocalInvoice = {
        id: data.id ?? crypto.randomUUID(),
        ens: data.ens ?? "",
        payUrl: data.payUrl ?? `/pay/${data.ens}`,
        depositAddress: data.depositAddress ?? "",
        amount: data.amount ?? amountBaseUnits,
        amountFormatted: data.amountFormatted ?? amount,
        originChain: data.originChain ?? selected?.blockchain ?? "",
        originSymbol: data.originSymbol ?? selected?.symbol ?? "",
        clientName: data.clientName ?? clientName,
        description: data.description ?? description,
        invoiceNumber: data.invoiceNumber ?? "",
        freelancerName: data.freelancerName ?? freelancerName,
        createdAt: data.createdAt ?? new Date().toISOString(),
        status: "pending",
        pdfBase64: data.pdfBase64 ?? null,
      };
      upsertInvoice(local);
      setResult(local);
      setAbsolutePayUrl(data.absolutePayUrl ?? null);
      if (data.swarmError) setSwarmError(data.swarmError);

      // Best-effort: sync encrypted ledger keyed by MetaMask wallet (server holds batch ID).
      if (refundTo.trim()) {
        try {
          await pushUserStoreToSwarm({
            profile: {
              displayName: freelancerName.trim(),
              solanaAddress: solanaAddress.trim(),
              defaultRefundTo: refundTo.trim(),
            },
            address: refundTo.trim(),
          });
        } catch (syncErr) {
          setSwarmError(
            syncErr instanceof Error
              ? `Invoice created; Swarm ledger sync: ${syncErr.message}`
              : "Invoice created; Swarm ledger sync failed",
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invoice creation failed");
    } finally {
      setLoading(false);
    }
  };

  const parentEns = config?.parentEns ?? "commons3nse.eth";
  const shareMailto =
    result && absolutePayUrl
      ? `mailto:?subject=${encodeURIComponent(`Invoice ${result.invoiceNumber}`)}&body=${encodeURIComponent(
          `Hi ${result.clientName},\n\nPlease pay invoice ${result.invoiceNumber} (${result.amountFormatted} ${result.originSymbol}) via Enscribe:\n${absolutePayUrl}\n\nENS: ${result.ens}\n\nConnect MetaMask on the pay page — Enscribe resolves the Sepolia ENS name for you.\n`,
        )}`
      : null;

  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-16 pt-6">
      <p className="mb-3 font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
        New invoice
      </p>
      <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl">
        Bill a client
      </h1>
      <p className="mt-4 text-[var(--fg-muted)]">
        Mints{" "}
        <span className="font-[family-name:var(--font-mono)] text-[var(--fg)]">
          inv-*.{parentEns}
        </span>
        , generates a PDF with the pay link, and stores an encrypted copy on
        Swarm. Solana stays private.{" "}
        <Link href="/profile" className="text-[var(--ledger)] underline">
          Register wallets
        </Link>
      </p>

      <div className="mt-8 space-y-4 border border-[var(--line)] bg-[var(--bg-panel)] p-6">
        <label className="block text-sm text-[var(--fg-muted)]">
          Your name (on invoice)
          <input
            value={freelancerName}
            onChange={(e) => setFreelancerName(e.target.value)}
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </label>
        <label className="block text-sm text-[var(--fg-muted)]">
          Client name
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Acme Studio"
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </label>
        <label className="block text-sm text-[var(--fg-muted)]">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brand site redesign — March"
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </label>
        <label className="block text-sm text-[var(--fg-muted)]">
          Invoice number (optional)
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="INV-2026-041"
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </label>

        <div className="space-y-2">
          <p className="text-sm text-[var(--fg-muted)]">
            Solana settlement — Phantom or MetaMask Solana (private)
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void linkPhantom()}
              className="border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--ledger)]"
            >
              Connect Phantom
            </button>
            <button
              type="button"
              onClick={() => void linkMetaMaskSolana()}
              className="border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--ledger)]"
            >
              Connect MetaMask Solana
            </button>
          </div>
          <input
            value={solanaAddress}
            onChange={(e) => setSolanaAddress(e.target.value)}
            className="w-full border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </div>

        <label className="block text-sm text-[var(--fg-muted)]">
          Pay with
          <select
            value={originAsset}
            onChange={(e) => setOriginAsset(e.target.value)}
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          >
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol} · {CHAIN_LABEL[t.blockchain] ?? t.blockchain}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-[var(--fg-muted)]">
          Amount ({selected?.symbol ?? "token"})
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </label>

        <div className="space-y-2">
          <p className="text-sm text-[var(--fg-muted)]">
            EVM refund / identity (MetaMask login)
          </p>
          <button
            type="button"
            onClick={() => void linkMetaMask()}
            className="border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--ledger)]"
          >
            {refundTo ? `MetaMask · ${shorten(refundTo)}` : "Connect MetaMask"}
          </button>
          <input
            value={refundTo}
            onChange={(e) => setRefundTo(e.target.value)}
            placeholder="0x…"
            className="w-full border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </div>

        {walletMsg && (
          <p className="text-sm text-[var(--ok)]">{walletMsg}</p>
        )}

        <button
          type="button"
          disabled={loading || !config?.intentsConfigured}
          onClick={() => void create()}
          className="w-full bg-[var(--ledger)] px-4 py-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
        >
          {loading ? "Minting ENS + PDF…" : "Create ENS invoice"}
        </button>

        {error && (
          <p className="border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        {result && (
          <div className="border border-[var(--ledger)]/40 bg-[var(--ledger-dim)] p-4">
            <p className="text-sm text-[var(--ok)]">
              {result.invoiceNumber} ready for {result.clientName}
            </p>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)]">
              {result.ens}
            </p>
            {absolutePayUrl && (
              <p className="mt-2 break-all font-[family-name:var(--font-mono)] text-xs text-[var(--fg-muted)]">
                {absolutePayUrl}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link href={result.payUrl} className="text-[var(--ledger)] underline">
                Open pay page →
              </Link>
              {result.pdfBase64 && (
                <button
                  type="button"
                  className="text-[var(--ledger)] underline"
                  onClick={() =>
                    downloadPdfBase64(
                      `${result.invoiceNumber || result.ens}.pdf`,
                      result.pdfBase64!,
                    )
                  }
                >
                  Download PDF
                </button>
              )}
              {shareMailto && (
                <a
                  href={shareMailto}
                  className="text-[var(--ledger)] underline"
                  onClick={() => {
                    const next = markInvoiceSent(result.ens);
                    const updated = next.find((i) => i.ens === result.ens);
                    if (updated) setResult(updated);
                    void pushUserStoreToSwarm({
                      address: refundTo.trim() || undefined,
                    }).catch(() => undefined);
                  }}
                >
                  Email to client (mark sent)
                </a>
              )}
              {result.status === "pending" && (
                <button
                  type="button"
                  className="text-[var(--ledger)] underline"
                  onClick={() => {
                    const next = markInvoiceSent(result.ens);
                    const updated = next.find((i) => i.ens === result.ens);
                    if (updated) setResult(updated);
                    void pushUserStoreToSwarm({
                      address: refundTo.trim() || undefined,
                    }).catch(() => undefined);
                  }}
                >
                  Mark as sent
                </button>
              )}
              <Link href="/invoices" className="text-[var(--fg-muted)] underline">
                All invoices
              </Link>
            </div>
            {swarmError && (
              <p className="mt-2 text-xs text-[var(--danger)]">{swarmError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
