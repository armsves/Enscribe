"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  downloadPdfBase64,
  loadInvoices,
  loadProfile,
  markInvoiceSent,
  updateInvoiceStatus,
  type LocalInvoice,
} from "@/lib/invoice-store";
import { PAY_CHAINS } from "@/lib/pay-chains";
import { pushUserStoreToSwarm } from "@/lib/swarm-client";

function StatusPill({ status }: { status: LocalInvoice["status"] }) {
  const styles: Record<LocalInvoice["status"], string> = {
    paid: "bg-[var(--ledger-dim)] text-[var(--ledger)]",
    sent: "bg-sky-500/15 text-sky-300",
    pending: "bg-[var(--amber-dim)] text-[var(--amber)]",
    failed: "bg-[var(--danger)]/15 text-[var(--danger)]",
    unknown: "bg-white/5 text-[var(--fg-muted)]",
  };
  return (
    <span
      className={`px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] tracking-wide uppercase ${styles[status]}`}
    >
      {status}
    </span>
  );
}

async function syncSwarmQuietly() {
  const profile = loadProfile();
  if (!profile.defaultRefundTo) return;
  try {
    await pushUserStoreToSwarm({ address: profile.defaultRefundTo });
  } catch {
    // local status still updated
  }
}

export function InvoiceList() {
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setInvoices(loadInvoices());
  }, []);

  const refreshStatus = useCallback(async (inv: LocalInvoice) => {
    setChecking(inv.ens);
    setMessage(null);
    try {
      const qs = new URLSearchParams({
        ens: inv.ens,
        depositAddress: inv.depositAddress,
        amount: inv.amount,
        originChain: inv.originChain,
        originSymbol: inv.originSymbol,
        createdAt: inv.createdAt,
      });
      const res = await fetch(`/api/status?${qs}`);
      const data = (await res.json()) as {
        status?: string;
        paymentTxHash?: string | null;
        source?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Status check failed");

      const remote = (data.status ?? "unknown") as LocalInvoice["status"];
      let nextStatus = inv.status;
      if (remote === "paid") nextStatus = "paid";
      else if (remote === "failed") nextStatus = "failed";
      // Keep "sent" if still unpaid — don't drop back to pending.
      else if (inv.status === "pending" && remote === "pending") {
        nextStatus = "pending";
      }

      const next = updateInvoiceStatus(inv.ens, nextStatus, {
        paidAt: nextStatus === "paid" ? new Date().toISOString() : inv.paidAt,
        paymentTxHash: data.paymentTxHash ?? inv.paymentTxHash,
      });
      setInvoices(next);

      if (nextStatus === "paid") {
        setMessage(
          `Paid${data.paymentTxHash ? ` · tx ${data.paymentTxHash.slice(0, 10)}…` : ""} (${data.source ?? "check"})`,
        );
        await syncSwarmQuietly();
      } else if (nextStatus === "failed") {
        setMessage("Payment failed / refunded (Intents)");
        await syncSwarmQuietly();
      } else {
        setMessage(`Still ${nextStatus} — no matching deposit tx yet`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Status check failed");
    } finally {
      setChecking(null);
    }
  }, []);

  const markSent = async (inv: LocalInvoice) => {
    const next = markInvoiceSent(inv.ens);
    setInvoices(next);
    setMessage(`Marked ${inv.invoiceNumber || inv.ens} as sent`);
    await syncSwarmQuietly();
  };

  const refreshAll = async () => {
    const list = loadInvoices();
    for (const inv of list.filter((i) => i.status !== "paid")) {
      await refreshStatus(inv);
    }
    setInvoices(loadInvoices());
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
            Workspace
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl">
            Invoices
          </h1>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            pending → sent → paid. Check payment looks for USDC transfers to the
            ENS deposit address and Intents settlement.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--ledger)]"
          >
            Refresh statuses
          </button>
          <Link
            href="/invoices/new"
            className="bg-[var(--ledger)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            New invoice
          </Link>
        </div>
      </div>

      {message && (
        <p className="mb-4 text-sm text-[var(--ok)]">{message}</p>
      )}

      {invoices.length === 0 ? (
        <p className="text-[var(--fg-muted)]">
          No invoices yet.{" "}
          <Link href="/invoices/new" className="text-[var(--ledger)] underline">
            Create your first ENS invoice
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] border border-[var(--line)]">
          {invoices.map((inv) => {
            const explorer = PAY_CHAINS[inv.originChain]?.explorerTx;
            return (
              <li
                key={inv.ens}
                className="flex flex-col gap-3 bg-[var(--bg-panel)] px-4 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-[family-name:var(--font-display)] text-lg">
                      {inv.clientName}
                    </span>
                    <StatusPill status={inv.status} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--fg-muted)]">
                    {inv.invoiceNumber} · {inv.amountFormatted}{" "}
                    {inv.originSymbol}
                    {inv.description ? ` · ${inv.description}` : ""}
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--fg-muted)]">
                    {inv.ens}
                  </p>
                  {inv.paymentTxHash && (
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--ledger)]">
                      {explorer ? (
                        <a
                          href={explorer(inv.paymentTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          tx {inv.paymentTxHash.slice(0, 10)}…
                        </a>
                      ) : (
                        <>tx {inv.paymentTxHash.slice(0, 10)}…</>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link
                    href={inv.payUrl}
                    className="border border-[var(--line)] px-3 py-1.5 hover:border-[var(--ledger)]"
                  >
                    Pay page
                  </Link>
                  {inv.pdfBase64 && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadPdfBase64(
                          `${inv.invoiceNumber || inv.ens}.pdf`,
                          inv.pdfBase64!,
                        )
                      }
                      className="border border-[var(--line)] px-3 py-1.5 hover:border-[var(--ledger)]"
                    >
                      PDF
                    </button>
                  )}
                  {inv.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => void markSent(inv)}
                      className="border border-[var(--line)] px-3 py-1.5 hover:border-[var(--ledger)]"
                    >
                      Mark sent
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={checking === inv.ens || inv.status === "paid"}
                    onClick={() => void refreshStatus(inv)}
                    className="border border-[var(--line)] px-3 py-1.5 disabled:opacity-50"
                  >
                    {checking === inv.ens
                      ? "Checking…"
                      : inv.status === "paid"
                        ? "Paid"
                        : "Check payment"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
