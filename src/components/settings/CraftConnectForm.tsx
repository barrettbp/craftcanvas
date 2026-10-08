"use client";

import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatRelativeTime } from "@/components/notes-panel/relative-time";
import type { CraftStatusResponse } from "@/lib/craft/types";

type ApiErrorBody = { error?: string; message?: string; issues?: Array<{ path: string; message: string }> };

type ConnectResponse = {
  ok: true;
  dryRun: boolean;
  host: string | null;
  label: string;
  folderCount: number;
  connection?: { id: string; status: string };
};

function describeError(status: number, body: ApiErrorBody | null): string {
  if (body?.issues?.length) return body.issues.map((i) => i.message).join(" ");
  switch (body?.error) {
    case "craft_unauthorized":
      return "Craft rejected the key. Check that the connection is in API Key mode and that you copied the whole key.";
    case "not_found":
      return "That URL did not answer like a Craft API connection. Check that it ends with /api/v1.";
    case "craft_unavailable":
      return "Craft did not answer in time. Try again in a moment.";
    case "craft_rate_limited":
      return "Craft is rate limiting requests. Wait a minute and try again.";
    case "unauthenticated":
      return "You were signed out. Reload the page and sign in again.";
    case "server_misconfigured":
      return "The server is missing its encryption secret. Contact the administrator.";
    default:
      return body?.message ?? `Something went wrong (${status}).`;
  }
}

const POLL_MS = 2000;
const POLL_MAX_MS = 5 * 60 * 1000;

export function CraftConnectForm() {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<"idle" | "testing" | "saving" | "indexing" | "done">("idle");
  const [testResult, setTestResult] = useState<{ host: string | null; folderCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CraftStatusResponse | null>(null);
  const pollStarted = useRef<number>(0);

  const canSubmit = baseUrl.trim().length > 0 && apiKey.trim().length > 0 && phase !== "testing" && phase !== "saving";

  async function callConnect(dryRun: boolean): Promise<ConnectResponse | null> {
    const res = await fetch("/api/craft/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), dryRun }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      setError(describeError(res.status, body));
      return null;
    }
    return (await res.json()) as ConnectResponse;
  }

  async function test() {
    setError(null);
    setTestResult(null);
    setPhase("testing");
    try {
      const result = await callConnect(true);
      if (result) setTestResult({ host: result.host, folderCount: result.folderCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setPhase("idle");
    }
  }

  async function save() {
    setError(null);
    setPhase("saving");
    try {
      const result = await callConnect(false);
      if (!result) {
        setPhase("idle");
        return;
      }
      setTestResult({ host: result.host, folderCount: result.folderCount });
      setApiKey("");
      pollStarted.current = Date.now();
      setPhase("indexing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setPhase("idle");
    }
  }

  // Poll /api/craft/status while the initial index runs.
  useEffect(() => {
    if (phase !== "indexing") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch("/api/craft/status", { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as CraftStatusResponse;
          if (cancelled) return;
          setStatus(next);
          const finished = next.lastFullSync !== null && !next.syncing;
          const timedOut = Date.now() - pollStarted.current > POLL_MAX_MS;
          if (finished || timedOut || next.status === "unauthorized") {
            setPhase("done");
            router.refresh();
            return;
          }
        }
      } catch {
        // transient, keep polling
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, router]);

  const busy = phase === "testing" || phase === "saving";

  return (
    <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="font-medium">Connection details</h2>

      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void save();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Connection URL</span>
          <input
            type="url"
            name="baseUrl"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setTestResult(null);
            }}
            placeholder="https://connect.craft.do/links/XXXX/api/v1"
            autoComplete="off"
            spellCheck={false}
            required
            disabled={busy || phase === "indexing"}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">API Key</span>
          <input
            type="password"
            name="apiKey"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setTestResult(null);
            }}
            placeholder="pdk_…"
            autoComplete="off"
            spellCheck={false}
            required={phase !== "done"}
            disabled={busy || phase === "indexing"}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Stored encrypted. Only the server ever sees it.</span>
        </label>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        ) : null}

        {testResult && phase === "idle" ? (
          <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            <Check className="h-4 w-4" aria-hidden="true" />
            Connected to {testResult.host ?? "Craft"}: {testResult.folderCount} {testResult.folderCount === 1 ? "folder" : "folders"} visible.
          </p>
        ) : null}

        {phase === "indexing" || phase === "done" ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2">
              {phase === "indexing" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              )}
              <span className="font-medium">
                {phase === "indexing"
                  ? "Indexing your documents…"
                  : status?.status === "unauthorized"
                    ? "Craft rejected the key during indexing."
                    : "Initial index finished."}
              </span>
            </div>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {status ? `${status.documentCount} ${status.documentCount === 1 ? "document" : "documents"} indexed` : "Starting…"}
              {status?.lastFullSync ? ` · synced ${formatRelativeTime(status.lastFullSync)}` : ""}
            </p>
            {phase === "done" ? (
              <div className="mt-3 flex gap-2">
                <Link
                  href="/canvases"
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Go to canvases
                </Link>
                <Link href="/settings" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
                  Back to settings
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={!canSubmit || phase === "indexing"}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            {phase === "testing" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Test connection
          </button>
          <button
            type="submit"
            disabled={!canSubmit || phase === "indexing"}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {phase === "saving" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save and index
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Only documents included in the connection are visible to CraftCanvas. If something is missing later, edit the connection in
        Craft and switch it to All documents, then press Refresh notes in the panel.
      </p>
    </section>
  );
}
