/** Client-side freelancer invoice ledger (browser localStorage). */

export type InvoiceStatus =
  | "pending"
  | "sent"
  | "paid"
  | "failed"
  | "unknown";

export type LocalInvoice = {
  id: string;
  ens: string;
  payUrl: string;
  depositAddress: string;
  amount: string;
  amountFormatted: string;
  originChain: string;
  originSymbol: string;
  clientName: string;
  description: string;
  invoiceNumber: string;
  freelancerName: string;
  createdAt: string;
  status: InvoiceStatus;
  sentAt?: string | null;
  paidAt?: string | null;
  lastCheckedAt?: string | null;
  /** Origin-chain payment tx into the deposit address */
  paymentTxHash?: string | null;
  /** Encrypted Swarm reference (legacy; prefer server-side only) */
  swarmReference?: string | null;
  swarmGatewayUrl?: string | null;
  pdfBase64?: string | null;
};

const STORAGE_KEY = "enscribe.invoices.v1";
const PROFILE_KEY = "enscribe.profile.v1";

export type FreelancerProfile = {
  displayName: string;
  solanaAddress: string;
  defaultRefundTo: string;
};

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadInvoices(): LocalInvoice[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalInvoice[];
    return Array.isArray(parsed) ? parsed.map(normalizeInvoice) : [];
  } catch {
    return [];
  }
}

function normalizeInvoice(inv: LocalInvoice): LocalInvoice {
  const status = inv.status === ("pending" as string) && inv.sentAt
    ? "sent"
    : inv.status;
  return { ...inv, status };
}

export function saveInvoices(invoices: LocalInvoice[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
}

export function upsertInvoice(invoice: LocalInvoice) {
  const list = loadInvoices();
  const idx = list.findIndex((i) => i.ens === invoice.ens || i.id === invoice.id);
  if (idx >= 0) list[idx] = invoice;
  else list.unshift(invoice);
  saveInvoices(list);
  return list;
}

const STATUS_RANK: Record<InvoiceStatus, number> = {
  unknown: 0,
  pending: 1,
  sent: 2,
  paid: 3,
  failed: 2,
};

export function updateInvoiceStatus(
  ens: string,
  status: InvoiceStatus,
  opts?: {
    paidAt?: string | null;
    sentAt?: string | null;
    paymentTxHash?: string | null;
    allowDowngrade?: boolean;
  },
) {
  const list = loadInvoices();
  const next = list.map((inv) => {
    if (inv.ens !== ens) return inv;
    const nextStatus =
      !opts?.allowDowngrade && STATUS_RANK[status] < STATUS_RANK[inv.status]
        ? inv.status
        : status;
    return {
      ...inv,
      status: nextStatus,
      sentAt:
        nextStatus === "sent" || nextStatus === "paid"
          ? opts?.sentAt ?? inv.sentAt ?? new Date().toISOString()
          : inv.sentAt,
      paidAt:
        nextStatus === "paid"
          ? opts?.paidAt ?? inv.paidAt ?? new Date().toISOString()
          : inv.paidAt,
      paymentTxHash: opts?.paymentTxHash ?? inv.paymentTxHash ?? null,
      lastCheckedAt: new Date().toISOString(),
    };
  });
  saveInvoices(next);
  return next;
}

export function markInvoiceSent(ens: string) {
  return updateInvoiceStatus(ens, "sent", {
    sentAt: new Date().toISOString(),
  });
}

export function loadProfile(): FreelancerProfile {
  if (!canUseStorage()) {
    return { displayName: "", solanaAddress: "", defaultRefundTo: "" };
  }
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return { displayName: "", solanaAddress: "", defaultRefundTo: "" };
    return JSON.parse(raw) as FreelancerProfile;
  } catch {
    return { displayName: "", solanaAddress: "", defaultRefundTo: "" };
  }
}

export function saveProfile(profile: FreelancerProfile) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function invoicesByMonth(invoices: LocalInvoice[]) {
  const groups = new Map<string, LocalInvoice[]>();
  for (const inv of invoices) {
    const d = new Date(inv.paidAt || inv.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(inv);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, items]) => ({ month, items }));
}

export function invoicesToCsv(invoices: LocalInvoice[]) {
  const headers = [
    "month",
    "invoice_number",
    "ens",
    "client",
    "description",
    "amount",
    "symbol",
    "chain",
    "status",
    "created_at",
    "sent_at",
    "paid_at",
    "payment_tx",
    "deposit_address",
  ];
  const rows = invoices.map((inv) => {
    const d = new Date(inv.paidAt || inv.createdAt);
    const month = Number.isNaN(d.getTime())
      ? ""
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return [
      month,
      inv.invoiceNumber,
      inv.ens,
      inv.clientName,
      inv.description,
      inv.amountFormatted || inv.amount,
      inv.originSymbol,
      inv.originChain,
      inv.status,
      inv.createdAt,
      inv.sentAt ?? "",
      inv.paidAt ?? "",
      inv.paymentTxHash ?? "",
      inv.depositAddress,
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadPdfBase64(filename: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Map payment-check API / Intents payload into a ledger status (not including "sent"). */
export function inferPaymentStatus(payload: unknown): InvoiceStatus {
  if (payload && typeof payload === "object" && "status" in payload) {
    const s = String((payload as { status: unknown }).status).toLowerCase();
    if (s === "paid") return "paid";
    if (s === "failed") return "failed";
    if (s === "pending") return "pending";
    if (s === "sent") return "sent";
  }
  const text = JSON.stringify(payload).toLowerCase();
  if (
    text.includes("success") ||
    text.includes('"completed"') ||
    text.includes("fulfilled") ||
    text.includes("settled") ||
    text.includes('"paid"')
  ) {
    return "paid";
  }
  if (text.includes("fail") || text.includes("refund") || text.includes("error")) {
    return "failed";
  }
  if (text.includes("pending") || text.includes("waiting") || text.includes("known")) {
    return "pending";
  }
  return "unknown";
}
