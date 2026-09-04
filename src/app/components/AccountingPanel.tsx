"use client";

import { useEffect, useMemo, useState } from "react";
import {
  downloadCsv,
  invoicesByMonth,
  invoicesToCsv,
  loadInvoices,
  type LocalInvoice,
} from "@/lib/invoice-store";

export function AccountingPanel() {
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "paid" | "pending" | "sent"
  >("paid");

  useEffect(() => {
    setInvoices(loadInvoices());
  }, []);

  const months = useMemo(() => invoicesByMonth(invoices), [invoices]);
  const monthKeys = months.map((m) => m.month);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (monthFilter === "all") return true;
      const d = new Date(inv.paidAt || inv.createdAt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      return key === monthFilter;
    });
  }, [invoices, monthFilter, statusFilter]);

  const totals = useMemo(() => {
    const bySymbol = new Map<string, number>();
    for (const inv of filtered) {
      const n = Number(inv.amountFormatted || 0);
      if (Number.isNaN(n)) continue;
      bySymbol.set(
        inv.originSymbol,
        (bySymbol.get(inv.originSymbol) ?? 0) + n,
      );
    }
    return [...bySymbol.entries()];
  }, [filtered]);

  const exportCsv = () => {
    const csv = invoicesToCsv(filtered);
    const stamp =
      monthFilter === "all" ? "all" : monthFilter.replace("-", "");
    downloadCsv(`enscribe-${statusFilter}-${stamp}.csv`, csv);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
      <p className="mb-2 font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
        Books
      </p>
      <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl">
        Accounting
      </h1>
      <p className="mt-4 max-w-2xl text-[var(--fg-muted)]">
        Monthly invoice ledger for tax export. Status comes from your workspace
        (refresh on the invoices page). Paid rows are ideal for CSV filings.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="border border-[var(--line)] bg-[#071018] px-3 py-2 text-sm"
        >
          <option value="all">All months</option>
          {monthKeys.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value as "all" | "paid" | "pending" | "sent",
            )
          }
          className="border border-[var(--line)] bg-[#071018] px-3 py-2 text-sm"
        >
          <option value="paid">Paid only</option>
          <option value="sent">Sent only</option>
          <option value="pending">Pending only</option>
          <option value="all">All statuses</option>
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="bg-[var(--ledger)] px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-sm text-[var(--fg-muted)]">
        <span>{filtered.length} invoices</span>
        {totals.map(([symbol, sum]) => (
          <span key={symbol} className="text-[var(--fg)]">
            {sum.toFixed(2)} {symbol}
          </span>
        ))}
      </div>

      <div className="mt-8 overflow-x-auto border border-[var(--line)]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[var(--bg-elevated)] font-[family-name:var(--font-mono)] text-xs tracking-wide text-[var(--fg-muted)] uppercase">
            <tr>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Invoice</th>
              <th className="px-3 py-3">Client</th>
              <th className="px-3 py-3">Amount</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">ENS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-[var(--fg-muted)]"
                >
                  No rows for this filter. Create invoices and mark them paid
                  after settlement.
                </td>
              </tr>
            ) : (
              filtered.map((inv) => (
                <tr key={inv.ens} className="border-t border-[var(--line)]">
                  <td className="px-3 py-3 font-[family-name:var(--font-mono)] text-xs">
                    {(inv.paidAt || inv.createdAt).slice(0, 10)}
                  </td>
                  <td className="px-3 py-3">{inv.invoiceNumber}</td>
                  <td className="px-3 py-3">{inv.clientName}</td>
                  <td className="px-3 py-3">
                    {inv.amountFormatted} {inv.originSymbol}
                  </td>
                  <td className="px-3 py-3 uppercase text-[var(--fg-muted)]">
                    {inv.status}
                  </td>
                  <td className="px-3 py-3 font-[family-name:var(--font-mono)] text-xs text-[var(--fg-muted)]">
                    {inv.ens}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-10 space-y-4">
        <h2 className="font-[family-name:var(--font-display)] text-2xl">
          By month
        </h2>
        {months.length === 0 ? (
          <p className="text-[var(--fg-muted)]">No months yet.</p>
        ) : (
          months.map(({ month, items }) => {
            const paid = items.filter((i) => i.status === "paid");
            const sum = paid.reduce(
              (acc, i) => acc + Number(i.amountFormatted || 0),
              0,
            );
            return (
              <div
                key={month}
                className="flex flex-wrap items-center justify-between gap-3 border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3"
              >
                <div>
                  <p className="font-[family-name:var(--font-display)] text-lg">
                    {month}
                  </p>
                  <p className="text-sm text-[var(--fg-muted)]">
                    {paid.length} paid / {items.length} total
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-[family-name:var(--font-mono)] text-sm">
                    {sum.toFixed(2)} USDC-eq
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      downloadCsv(
                        `enscribe-${month}.csv`,
                        invoicesToCsv(items.filter((i) => i.status === "paid")),
                      );
                    }}
                    className="border border-[var(--line)] px-3 py-1.5 text-sm hover:border-[var(--ledger)]"
                  >
                    CSV
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
