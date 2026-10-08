"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatRelativeTime } from "@/components/notes-panel/relative-time";
import type { CraftConnectionStatus } from "@/lib/craft/types";

import { ConfirmDialog } from "./ConfirmDialog";

export type ConnectionSummary = {
  label: string;
  host: string | null;
  status: CraftConnectionStatus;
  lastFullSync: string | null;
  documentCount: number;
  syncing: boolean;
};

const STATUS_LABEL: Record<CraftConnectionStatus, { text: string; className: string }> = {
  ok: { text: "Connected", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  unauthorized: { text: "Needs reconnect", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100" },
  error: { text: "Error", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" },
};

export function ConnectionCard({ summary }: { summary: ConnectionSummary }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS_LABEL[summary.status];

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/craft/connect", { method: "DELETE" });
      if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{summary.label}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.text}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">{summary.host ?? "Unknown host"}</p>
        </div>
        <div className="flex gap-2">
          {summary.status === "unauthorized" ? (
            <Link
              href="/settings/craft"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Reconnect
            </Link>
          ) : (
            <Link
              href="/settings/craft"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              Change
            </Link>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            Disconnect
          </button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Documents indexed</dt>
          <dd className="font-medium">{summary.documentCount}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Last synced</dt>
          <dd className="font-medium">
            {summary.syncing ? "Syncing…" : summary.lastFullSync ? formatRelativeTime(summary.lastFullSync) : "Never"}
          </dd>
        </div>
      </dl>

      {summary.status === "unauthorized" ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          Your Craft connection stopped working. The key was probably revoked in Craft. Reconnect to keep browsing notes; your canvases
          keep their last previews.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <ConfirmDialog
        open={confirming}
        title="Disconnect Craft?"
        confirmLabel="Disconnect"
        tone="danger"
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirming(false)}
      >
        <p>This removes the encrypted API key and the document index from CraftCanvas.</p>
        <p className="mt-2">
          Your canvases stay as they are, but note cards will not refresh until you connect again. Nothing in Craft is changed.
        </p>
      </ConfirmDialog>
    </div>
  );
}
