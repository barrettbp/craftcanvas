import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

type TopBarProps = {
  /** Optional content rendered in the middle (e.g. an editable canvas title). */
  children?: ReactNode;
  /** Optional content rendered just before the user button (e.g. a save indicator). */
  trailing?: ReactNode;
};

/**
 * Shared top bar: logo on the left, optional slot in the middle,
 * Clerk's UserButton (profile and sign out) on the right.
 */
export function TopBar({ children, trailing }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-zinc-200 px-4 dark:border-zinc-800">
      <Link href="/canvases" className="text-sm font-semibold tracking-tight">
        CraftCanvas
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/canvases" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Canvases
        </Link>
        <Link href="/settings" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Settings
        </Link>
        <Link href="/privacy" className="hidden hover:text-zinc-900 sm:inline dark:hover:text-zinc-100">
          Privacy
        </Link>
      </nav>
      {trailing}
      <UserButton />
    </header>
  );
}

export default TopBar;
