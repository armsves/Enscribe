"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearSession,
  loadSession,
  loginWithMetaMask,
  restoreSessionIfConnected,
  type WalletSession,
} from "@/lib/session";
import { shorten } from "@/lib/wallets";

export function SiteNav() {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setSession((await restoreSessionIfConnected()) ?? loadSession());
    })();
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      setSession(await loginWithMetaMask());
    } catch {
      // stay logged out
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearSession();
    setSession(null);
  };

  return (
    <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
      <Link href="/" className="flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Enscribe"
          width={36}
          height={36}
          className="rounded-lg"
          priority
        />
        <span className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--fg)]">
          Enscribe
        </span>
      </Link>
      <div className="flex items-center gap-3 text-sm">
        {session ? (
          <>
            <Link
              href="/"
              className="hidden text-[var(--fg-muted)] transition hover:text-[var(--ledger)] sm:inline"
            >
              Dashboard
            </Link>
            <Link
              href="/invoices/new"
              className="rounded-lg bg-[var(--ledger)] px-3 py-1.5 font-semibold text-[var(--ink)]"
            >
              New invoice
            </Link>
            <button
              type="button"
              onClick={logout}
              className="border border-[var(--line)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-xs hover:border-[var(--ledger)]"
              title={session.address}
            >
              {shorten(session.address)}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void connect()}
            className="rounded-lg bg-[var(--ledger)] px-3 py-1.5 font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            {busy ? "…" : "Log in"}
          </button>
        )}
      </div>
    </nav>
  );
}
