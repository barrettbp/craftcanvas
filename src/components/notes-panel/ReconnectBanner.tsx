"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";

export type ReconnectBannerProps = {
  message?: string;
  href?: string;
  actionLabel?: string;
  className?: string;
  /** Compact variant for narrow places like the notes panel. */
  compact?: boolean;
};

/**
 * "Your Craft connection stopped working. Reconnect." Reused by the canvas page
 * (WP3) and the notes panel.
 */
export function ReconnectBanner({
  message = "Your Craft connection stopped working. Reconnect to keep browsing your notes.",
  href = "/settings/craft",
  actionLabel = "Reconnect",
  className = "",
  compact = false,
}: ReconnectBannerProps) {
  return (
    <div
      role="alert"
      className={`flex ${compact ? "flex-col items-start gap-2 p-3" : "flex-wrap items-center gap-3 px-4 py-3"} rounded-md border border-red-200 bg-red-50 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100 ${className}`}
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      <Link
        href={href}
        className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

export default ReconnectBanner;
