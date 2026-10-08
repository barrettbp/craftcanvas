"use client";

import { useState, useTransition } from "react";

import { deleteAccount } from "@/app/settings/actions";

import { ConfirmDialog } from "./ConfirmDialog";

const CONFIRM_WORD = "DELETE";

export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (typed !== CONFIRM_WORD) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount();
      // On success the action redirects and never resolves here.
      if (result && !result.ok) setError(result.error);
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
        className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
      >
        Delete account
      </button>
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <ConfirmDialog
        open={open}
        title="Delete your account?"
        confirmLabel="Delete everything"
        tone="danger"
        busy={pending}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      >
        <p>This cannot be undone. All canvases, the document index and the Craft key are deleted, then your sign in is removed.</p>
        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Type {CONFIRM_WORD} to confirm</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        {typed.length > 0 && typed !== CONFIRM_WORD ? <p className="mt-1 text-xs text-zinc-500">Type {CONFIRM_WORD} exactly.</p> : null}
      </ConfirmDialog>
    </div>
  );
}
