"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  loadSession,
  loginWithMetaMask,
  restoreSessionIfConnected,
  type WalletSession,
} from "@/lib/session";
import {
  loadInvoices,
  loadProfile,
  saveProfile,
  type FreelancerProfile,
  type LocalInvoice,
} from "@/lib/invoice-store";
import { isValidSolanaAddress } from "@/lib/ens-records";
import { pushUserStoreToSwarm } from "@/lib/swarm-client";
import {
  connectMetaMaskSolana,
  connectPhantom,
  payUrlAbsolute,
  shorten,
} from "@/lib/wallets";

const DASHBOARD_LINKS = [
  {
    href: "/invoices",
    title: "Invoices",
    body: "Track pending → sent → paid and check deposit transactions.",
  },
  {
    href: "/accounting",
    title: "Accounting",
    body: "Monthly ledger and CSV export for taxes.",
  },
  {
    href: "/profile",
    title: "Swarm sync",
    body: "Push / pull your encrypted profile + ledger on EthSwarm.",
  },
] as const;

export function HomeDashboard() {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [profile, setProfile] = useState<FreelancerProfile>({
    displayName: "",
    solanaAddress: "",
    defaultRefundTo: "",
  });
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [appOrigin, setAppOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const refreshLocal = useCallback(() => {
    const p = loadProfile();
    setProfile(p);
    setInvoices(loadInvoices());
  }, []);

  useEffect(() => {
    void (async () => {
      const restored = await restoreSessionIfConnected();
      setSession(restored ?? loadSession());
      refreshLocal();
      try {
        const res = await fetch("/api/config");
        const cfg = (await res.json()) as { appUrl?: string };
        setAppOrigin(
          (cfg.appUrl?.trim() || window.location.origin).replace(/\/$/, ""),
        );
      } catch {
        setAppOrigin(window.location.origin);
      }
      setReady(true);
    })();
  }, [refreshLocal]);

  const stats = useMemo(
    () => ({
      invoices: invoices.length,
      paid: invoices.filter((i) => i.status === "paid").length,
      recent: invoices.slice(0, 5),
    }),
    [invoices],
  );

  const setupComplete = Boolean(
    profile.solanaAddress.trim() && isValidSolanaAddress(profile.solanaAddress),
  );

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const next = await loginWithMetaMask();
      setSession(next);
      refreshLocal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connect failed");
    } finally {
      setConnecting(false);
    }
  };

  const logout = () => {
    clearSession();
    setSession(null);
  };

  const persistProfile = (next: FreelancerProfile) => {
    setProfile(next);
    saveProfile(next);
  };

  const saveSetup = async () => {
    setSetupMsg(null);
    setError(null);
    if (
      profile.solanaAddress.trim() &&
      !isValidSolanaAddress(profile.solanaAddress)
    ) {
      setError("Invalid Solana receiving address");
      return;
    }
    const next = {
      ...profile,
      defaultRefundTo: session?.address || profile.defaultRefundTo,
    };
    persistProfile(next);
    setSaving(true);
    try {
      // Encrypt + upload profile (+ invoice ledger) to Swarm; feed keyed by MetaMask wallet.
      const { updatedAt } = await pushUserStoreToSwarm({
        profile: next,
        invoices: loadInvoices(),
        address: session?.address,
      });
      setSetupMsg(`Saved locally and on Swarm · ${updatedAt}`);
    } catch (e) {
      setSetupMsg("Saved in this browser");
      setError(
        e instanceof Error
          ? `Swarm sync failed: ${e.message}`
          : "Swarm sync failed — profile is only local until you retry",
      );
    } finally {
      setSaving(false);
    }
  };

  const linkPhantom = async () => {
    setSetupMsg(null);
    setError(null);
    try {
      const address = await connectPhantom();
      persistProfile({
        ...profile,
        solanaAddress: address,
        defaultRefundTo: session?.address || profile.defaultRefundTo,
      });
      setSetupMsg(`Phantom Solana linked · ${shorten(address, 6)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Phantom connect failed");
    }
  };

  const linkMetaMaskSolana = async () => {
    setSetupMsg(null);
    setError(null);
    try {
      const address = await connectMetaMaskSolana();
      persistProfile({
        ...profile,
        solanaAddress: address,
        defaultRefundTo: session?.address || profile.defaultRefundTo,
      });
      setSetupMsg(`MetaMask Solana linked · ${shorten(address, 6)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MetaMask Solana connect failed");
    }
  };

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  if (!ready) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-20 text-[var(--fg-muted)]">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-20 pt-8 md:pt-14">
        <header className="relative max-w-3xl animate-[rise_0.7s_ease_both]">
          <div
            className="pointer-events-none absolute -left-24 -top-20 h-64 w-64 rounded-full opacity-40"
            style={{
              background:
                "radial-gradient(circle, rgba(31,169,122,0.35), transparent 70%)",
            }}
          />
          <div className="mb-6 flex items-center gap-3">
            <Image
              src="/logo.png"
              alt=""
              width={48}
              height={48}
              className="rounded-xl"
              priority
            />
            <p className="font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
              Freelancer invoicing on ENS
            </p>
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-5xl leading-[0.95] tracking-tight md:text-7xl">
            Enscribe
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--fg-muted)]">
            Freelancers log in with MetaMask, set a Solana receiving wallet
            (Phantom or MetaMask Solana), then share pay links. Clients pay with
            MetaMask only.
          </p>
          <div className="mt-8">
            <button
              type="button"
              disabled={connecting}
              onClick={() => void connect()}
              className="rounded-xl bg-[var(--ledger)] px-5 py-3 font-semibold text-[var(--ink)] transition hover:brightness-110 disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Log in with MetaMask"}
            </button>
          </div>
          {error && (
            <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
          )}
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-20 pt-6 md:pt-10">
      <header className="animate-[rise_0.6s_ease_both]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
              Dashboard
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight md:text-5xl">
              {profile.displayName ? `Hi, ${profile.displayName}` : "Your workspace"}
            </h1>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-sm text-[var(--fg-muted)]">
              Login · {shorten(session.address, 6)} (MetaMask)
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--ledger)]"
          >
            Log out
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-6 text-sm text-[var(--fg-muted)]">
          <span>
            <span className="text-[var(--fg)]">{stats.invoices}</span> invoices
          </span>
          <span>
            <span className="text-[var(--ledger)]">{stats.paid}</span> paid
          </span>
          <span>
            Receiving ·{" "}
            {setupComplete ? (
              <span className="font-[family-name:var(--font-mono)] text-[var(--ok)]">
                {shorten(profile.solanaAddress, 6)}
              </span>
            ) : (
              <span className="text-[var(--amber)]">not set</span>
            )}
          </span>
        </div>
      </header>

      {/* Setup */}
      <section className="mt-8 border border-[var(--line)] bg-[var(--bg-panel)] p-6 animate-[rise_0.7s_ease_both]">
        <p className="font-[family-name:var(--font-mono)] text-xs tracking-[0.18em] text-[var(--ledger)] uppercase">
          Setup
        </p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl">
          Your receiving wallet & client pay links
        </h2>
        <p className="mt-2 text-sm text-[var(--fg-muted)]">
          You receive settlement on <strong className="text-[var(--fg)]">Solana</strong>{" "}
          (Phantom or MetaMask Solana). Clients always pay with{" "}
          <strong className="text-[var(--fg)]">MetaMask</strong> on Arb/OP via your
          invoice pay page.
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm text-[var(--fg-muted)]">
              Display name
              <input
                value={profile.displayName}
                onChange={(e) =>
                  setProfile({ ...profile, displayName: e.target.value })
                }
                className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
              />
            </label>

            <div>
              <p className="text-sm text-[var(--fg-muted)]">
                Solana receiving address (private)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
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
                value={profile.solanaAddress}
                onChange={(e) =>
                  setProfile({ ...profile, solanaAddress: e.target.value })
                }
                placeholder="Solana address"
                className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
              />
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void saveSetup()}
              className="bg-[var(--ledger)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              {saving ? "Saving to Swarm…" : "Save setup (local + Swarm)"}
            </button>
            {setupMsg && (
              <p className="text-sm text-[var(--ok)]">{setupMsg}</p>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm text-[var(--fg-muted)]">Client pay link pattern</p>
            <p className="break-all border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-xs text-[var(--fg)]">
              {appOrigin}/pay/&lt;invoice-ens&gt;
            </p>
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
              After you create an invoice (e.g.{" "}
              <span className="font-[family-name:var(--font-mono)] text-[var(--fg)]">
                inv-….commons3nse.eth
              </span>
              ), send the client that pay URL. They open it, connect{" "}
              <strong className="text-[var(--fg)]">MetaMask</strong>, and pay
              USDC — Enscribe resolves Sepolia ENS for them.
            </p>

            {stats.recent.length > 0 ? (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-[var(--fg-muted)]">Recent pay links</p>
                {stats.recent.map((inv) => {
                  const url = payUrlAbsolute(inv.ens, appOrigin);
                  return (
                    <div
                      key={inv.ens}
                      className="flex flex-col gap-1 border border-[var(--line)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-[var(--fg)]">
                          {inv.clientName} · {inv.invoiceNumber}
                        </p>
                        <p className="truncate font-[family-name:var(--font-mono)] text-[10px] text-[var(--fg-muted)]">
                          {url}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => void copyText(inv.ens, url)}
                          className="border border-[var(--line)] px-2 py-1 hover:border-[var(--ledger)]"
                        >
                          {copied === inv.ens ? "Copied" : "Copy"}
                        </button>
                        <Link
                          href={inv.payUrl}
                          className="border border-[var(--line)] px-2 py-1 hover:border-[var(--ledger)]"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--fg-muted)]">
                No invoices yet — create one to get a client pay link.
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
        )}
      </section>

      <div className="mt-8 animate-[rise_0.75s_ease_0.05s_both]">
        <Link
          href="/invoices/new"
          className={`flex flex-col gap-2 border px-6 py-8 transition ${
            setupComplete
              ? "border-[var(--ledger)]/40 bg-[var(--ledger-dim)] hover:border-[var(--ledger)]"
              : "border-[var(--amber)]/40 bg-[var(--amber-dim)] hover:border-[var(--amber)]"
          }`}
        >
          <p className="font-[family-name:var(--font-mono)] text-xs tracking-[0.18em] text-[var(--ledger)] uppercase">
            Primary action
          </p>
          <p className="font-[family-name:var(--font-display)] text-3xl text-[var(--fg)]">
            Create invoice
          </p>
          <p className="max-w-xl text-sm text-[var(--fg-muted)]">
            {setupComplete
              ? "Mint inv-*.eth, generate a client PDF with the MetaMask pay link, settle to your Solana wallet."
              : "Set your Solana receiving wallet above first — invoices need it for private settlement."}
          </p>
        </Link>
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-3 animate-[rise_0.85s_ease_0.08s_both]">
        {DASHBOARD_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="border border-[var(--line)] bg-[var(--bg-panel)] px-5 py-6 transition hover:border-[var(--ledger)]"
          >
            <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ledger)]">
              {item.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fg-muted)]">
              {item.body}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
