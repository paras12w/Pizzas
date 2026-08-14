"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Board" },
  { href: "/performance", label: "Performance" },
  { href: "/alerts", label: "Alert Log" },
  { href: "/weights", label: "Weights" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/bot-b", label: "Bot B" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-[var(--hairline)] bg-[var(--panel)]">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 sm:px-6">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs font-mono-board uppercase tracking-widest transition-colors ${
                active
                  ? "border-[var(--amber)] text-[var(--amber)]"
                  : "border-transparent text-[var(--ink-dim)] hover:text-[var(--ink)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
