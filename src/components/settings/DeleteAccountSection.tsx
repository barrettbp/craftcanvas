"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteAccount, type DeleteAccountResult } from "@/app/settings/actions";

import { ConfirmDialog } from "./ConfirmDialog";

const CONFIRM_WORD = "DELETE";

/**
 * Account deletion (spec M5): confirm dialog with a typed word, the server
 * action wipes our data and the Clerk user, then the client signs out and
 * lands on `/`. Errors from the action are shown inline so the user can retry.
 */
export function DeleteAccountSection() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (typed !== CONFIRM_WORD) return;
    setError(null);
    startTransition(async () => {
      let result: DeleteAccountResult;
      try {
        result = await deleteAccount();
      } catch (err) {
        // A redirect thrown by the action (signed out) must keep propagating.
        if (typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
        setError("Could not delete your account. Please check your connection and try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      setOpen(false);
      try {
        await signOut({ redirectUrl: "/" });
      } catch {
        // The session is already gone on Clerk's side; leave the settings page anyway.
        router.push("/");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-red-200 p-5 dark:border-red-900">
      <h3 className="font-medium">Delete account</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Permanently removes your canvases, the cached note titles and previews, the encrypted Craft key, and your sign in. Your notes in
        Craft are not touched.
      </p>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setError(null);
          setOpen(true);
        }}
        disabled={done}
        className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {done ? "Account deleted, signing out…" : "Delete account"}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={open}
        title="Delete your account?"
        confirmLabel="Delete everything"
        tone="danger"
        busy={pending}
        confirmDisabled={typed !== CONFIRM_WORD}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      >
        <p>This cannot be undone. All canvases, the document index and the Craft key are deleted, then your sign in is removed.</p>
        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Type {CONFIRM_WORD} to confirm</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed === CONFIRM_WORD && !pending) confirm();
            }}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${CONFIRM_WORD} to confirm`}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        {typed.length > 0 && typed !== CONFIRM_WORD ? <p className="mt-1 text-xs text-zinc-500">Type {CONFIRM_WORD} exactly.</p> : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
