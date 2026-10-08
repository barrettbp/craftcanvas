import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TopBar } from "@/components/app-shell/TopBar";
import { ConnectionCard, type ConnectionSummary } from "@/components/settings/ConnectionCard";
import { DeleteAccountSection } from "@/components/settings/DeleteAccountSection";
import { findConnectionForUser } from "@/lib/craft/connection";
import { countDocuments, isRefreshInFlight } from "@/lib/craft/indexer";
import { log } from "@/lib/log";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

async function loadSummary(userId: string): Promise<{ summary: ConnectionSummary | null; error?: string }> {
  try {
    const connection = await findConnectionForUser(userId);
    if (!connection) return { summary: null };
    const documentCount = await countDocuments(connection.id);
    return {
      summary: {
        label: connection.label ?? "Craft space",
        host: connection.host,
        status: connection.status,
        lastFullSync: connection.lastFullSync ? connection.lastFullSync.toISOString() : null,
        documentCount,
        syncing: isRefreshInFlight(userId),
      },
    };
  } catch (err) {
    log.error("settings could not load connection", { err });
    return { summary: null, error: "Could not load your Craft connection right now." };
  }
}

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { summary, error } = await loadSummary(userId);

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Your Craft connection and account.</p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Craft</h2>
          {error ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              {error}
            </p>
          ) : summary ? (
            <ConnectionCard summary={summary} />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 p-5 text-sm dark:border-zinc-700">
              <p className="text-zinc-700 dark:text-zinc-300">No Craft space connected yet.</p>
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                Connect one to browse your notes from the canvas and drop them on a board.
              </p>
              <Link
                href="/settings/craft"
                className="mt-4 inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Connect Craft
              </Link>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Account</h2>
          <DeleteAccountSection />
        </section>
      </main>
    </>
  );
}
