"use client";

import Image from "next/image";
import Link from "next/link";
import { useEnscribeAuth } from "@/app/providers";
import { shorten } from "@/lib/wallets";

export function SiteNav() {
  const { ready, session, login, logout } = useEnscribeAuth();

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
              onClick={() => void logout()}
              className="border border-[var(--line)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-xs hover:border-[var(--ledger)]"
              title={session.address}
            >
              {shorten(session.address)}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={() => void login()}
            className="rounded-lg bg-[var(--ledger)] px-3 py-1.5 font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            {!ready ? "…" : "Log in"}
          </button>
        )}
      </div>
    </nav>
  );
}
