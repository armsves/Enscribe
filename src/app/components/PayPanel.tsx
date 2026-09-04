"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, PAY_CHAINS, type PayToken } from "@/lib/pay-chains";
import {
  inferPaymentStatus,
  updateInvoiceStatus,
} from "@/lib/invoice-store";

type InvoiceRecord = {
  ens: string;
  depositAddress: string | null;
  amount: string | null;
  amountFormatted: string | null;
  originChain: string | null;
  originSymbol: string | null;
  clientName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  freelancerName: string | null;
  createdAt: string | null;
  chainLabel?: string | null;
  payToken?: PayToken | null;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
}

async function ensureChain(eth: EthereumProvider, chainId: number) {
  const hexId = `0x${chainId.toString(16)}`;
  const meta = Object.values(PAY_CHAINS).find((c) => c.chainId === chainId);
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 4902 || !meta) throw err;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: meta.chain.name,
          nativeCurrency: meta.chain.nativeCurrency,
          rpcUrls: [...meta.chain.rpcUrls.default.http],
          blockExplorerUrls: meta.chain.blockExplorers
            ? [meta.chain.blockExplorers.default.url]
            : [],
        },
      ],
    });
  }
}

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function PayPanel({ ens }: { ens: string }) {
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [paying, setPaying] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/invoice?ens=${encodeURIComponent(ens)}`);
        const data = (await res.json()) as InvoiceRecord & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Invoice not found");
        setInvoice(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    })();
  }, [ens]);

  const pollStatus = useCallback(async () => {
    if (!invoice?.depositAddress) return;
    setPolling(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        ens: invoice.ens,
        depositAddress: invoice.depositAddress,
        ...(invoice.amount ? { amount: invoice.amount } : {}),
        ...(invoice.originChain ? { originChain: invoice.originChain } : {}),
        ...(invoice.originSymbol ? { originSymbol: invoice.originSymbol } : {}),
        ...(invoice.createdAt ? { createdAt: invoice.createdAt } : {}),
      });
      const res = await fetch(`/api/status?${qs}`);
      const data = (await res.json()) as {
        status?: string;
        paymentTxHash?: string | null;
        source?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Status failed");
      const inferred = inferPaymentStatus(data);
      if (inferred === "paid") {
        updateInvoiceStatus(invoice.ens, "paid", {
          paidAt: new Date().toISOString(),
          paymentTxHash: data.paymentTxHash,
        });
      } else if (inferred === "failed") {
        updateInvoiceStatus(invoice.ens, "failed", {
          paymentTxHash: data.paymentTxHash,
        });
      }
      setStatus(
        data.status
          ? `${data.status}${data.paymentTxHash ? ` · ${data.paymentTxHash}` : ""}${data.source ? ` (${data.source})` : ""}`
          : JSON.stringify(data, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status failed");
    } finally {
      setPolling(false);
    }
  }, [invoice]);

  const connect = async () => {
    setError(null);
    const eth = getEthereum();
    if (!eth) {
      setError("Install MetaMask (or another EVM wallet)");
      return;
    }
    const chainId = invoice?.payToken?.chainId;
    if (chainId) await ensureChain(eth, chainId);
    const accounts = (await eth.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accounts[0]) {
      setError("No account returned");
      return;
    }
    setWallet(accounts[0] as Address);
  };

  const pay = async () => {
    setPaying(true);
    setError(null);
    try {
      const eth = getEthereum();
      if (!eth) throw new Error("Wallet not available");
      if (!invoice?.depositAddress || !invoice.amount || !invoice.payToken) {
        throw new Error("Invoice details incomplete");
      }
      if (!/^\d+$/.test(invoice.amount)) throw new Error("Invalid amount");

      await ensureChain(eth, invoice.payToken.chainId);
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const account = accounts[0] as Address | undefined;
      if (!account) throw new Error("Connect a wallet first");
      setWallet(account);

      const chainMeta = PAY_CHAINS[invoice.payToken.blockchain];
      if (!chainMeta) throw new Error("Unsupported payment chain");

      const walletClient = createWalletClient({
        account,
        chain: chainMeta.chain,
        transport: custom(eth as never),
      });
      const publicClient = createPublicClient({
        chain: chainMeta.chain,
        transport: custom(eth as never),
      });

      const amount = BigInt(invoice.amount);
      const to = invoice.depositAddress as Address;
      let hash: Hex;

      if (invoice.payToken.contractAddress) {
        const balance = await publicClient.readContract({
          address: invoice.payToken.contractAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        });
        if (balance < amount) {
          throw new Error(
            `Insufficient ${invoice.payToken.symbol}. Need ${invoice.amountFormatted}, have ${formatUnits(balance, invoice.payToken.decimals)}.`,
          );
        }
        hash = await walletClient.writeContract({
          address: invoice.payToken.contractAddress,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to, amount],
        });
      } else {
        hash = await walletClient.sendTransaction({ to, value: amount });
      }

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`Payment reverted (${hash})`);
      }
      updateInvoiceStatus(invoice.ens, "paid", {
        paidAt: new Date().toISOString(),
        paymentTxHash: hash,
      });
      await pollStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center text-[var(--fg-muted)]">
        Resolving ENS invoice…
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">{ens}</h1>
        <p className="mt-4 text-[var(--danger)]">{error}</p>
      </div>
    );
  }

  if (!invoice?.depositAddress) return null;

  const chainLabel =
    invoice.chainLabel ??
    PAY_CHAINS[invoice.originChain ?? ""]?.label ??
    invoice.originChain ??
    "EVM";
  const explorer =
    invoice.payToken && PAY_CHAINS[invoice.payToken.blockchain]?.explorerTx;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-10 md:py-14">
      <header className="mb-10 max-w-2xl">
        <p className="mb-3 font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
          Invoice payment
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight md:text-5xl">
          {invoice.clientName || "Client"} · {invoice.invoiceNumber || ens}
        </h1>
        <p className="mt-4 text-[var(--fg-muted)]">
          {invoice.freelancerName
            ? `Pay ${invoice.freelancerName}. `
            : ""}
          {invoice.description ? `${invoice.description}. ` : ""}
          Send {invoice.amountFormatted}{" "}
          {invoice.originSymbol} on {chainLabel}. ENS resolved by Enscribe —
          your wallet does not need Sepolia ENS.
        </p>
        <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-[var(--fg-muted)]">
          {invoice.ens}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="border border-[var(--ledger)]/35 bg-[var(--ledger-dim)] p-6 md:p-8">
          <p className="text-xs tracking-wide text-[var(--ledger)] uppercase">
            Pay in wallet
          </p>
          <p className="mt-3 font-[family-name:var(--font-display)] text-3xl">
            {invoice.amountFormatted} {invoice.originSymbol}
          </p>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">{chainLabel}</p>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void connect()}
              className="border border-[var(--line)] px-4 py-3 text-sm hover:border-[var(--ledger)]"
            >
              {wallet
                ? `MetaMask · ${shorten(wallet)}`
                : `Connect MetaMask (${chainLabel})`}
            </button>
            <button
              type="button"
              disabled={paying || !invoice.payToken}
              onClick={() => void pay()}
              className="bg-[var(--ledger)] px-4 py-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              {paying
                ? "Confirm in wallet…"
                : `Pay ${invoice.amountFormatted} ${invoice.originSymbol}`}
            </button>
          </div>

          {txHash && (
            <p className="mt-4 font-[family-name:var(--font-mono)] text-xs text-[var(--ok)]">
              Sent{" "}
              {explorer ? (
                <a href={explorer(txHash)} target="_blank" rel="noreferrer" className="underline">
                  {shorten(txHash)}
                </a>
              ) : (
                shorten(txHash)
              )}
            </p>
          )}

          <p className="mt-6 break-all font-[family-name:var(--font-mono)] text-xs text-[var(--fg-muted)]">
            Deposit: {invoice.depositAddress}
          </p>
          <button
            type="button"
            disabled={polling}
            onClick={() => void pollStatus()}
            className="mt-4 border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
          >
            {polling ? "Checking…" : "Check payment status"}
          </button>
          {status && (
            <pre className="mt-4 overflow-x-auto bg-black/30 p-3 font-[family-name:var(--font-mono)] text-xs text-[var(--ok)]">
              {status}
            </pre>
          )}
          {error && invoice && (
            <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
          )}
        </section>

        <aside className="border border-[var(--line)] bg-[var(--bg-panel)] p-6 text-sm text-[var(--fg-muted)]">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--fg)]">
            Settlement privacy
          </h2>
          <ul className="mt-4 space-y-2">
            <li>
              Invoice name lives on ENS (Sepolia) — Enscribe resolves it so your
              wallet only needs {chainLabel}.
            </li>
            <li>Connect MetaMask, then pay the listed USDC amount.</li>
            <li>Deposit address is public for this invoice.</li>
            <li>Freelancer Solana wallet is never written to ENS.</li>
            <li>Confidential Intents routes the settlement.</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
