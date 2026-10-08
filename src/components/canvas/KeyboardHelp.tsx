"use client";

/**
 * Keyboard map modal (spec M4 "keyboard map"). Opened with `?` from
 * `useCanvasShortcuts`, from the toolbar button, or by calling
 * `openKeyboardHelp()`. The open flag lives in a tiny module store so the
 * shortcut hook does not need React context.
 *
 * Key events inside the dialog do not bubble to the window, so canvas
 * shortcuts stay quiet while the map is open. Escape and the backdrop close it.
 */
import { Keyboard, X } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { create } from "zustand";

import { SHORTCUT_GROUPS, formatKey, isMacPlatform, type Shortcut } from "./shortcuts-table";

type KeyboardHelpStore = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useKeyboardHelpStore = create<KeyboardHelpStore>()((set) => ({
  open: false,
  setOpen: (open) => set((s) => (s.open === open ? s : { open })),
  toggle: () => set((s) => ({ open: !s.open })),
}));

export const openKeyboardHelp = (): void => useKeyboardHelpStore.getState().setOpen(true);
export const closeKeyboardHelp = (): void => useKeyboardHelpStore.getState().setOpen(false);
export const toggleKeyboardHelp = (): void => useKeyboardHelpStore.getState().toggle();

const subscribeNever = () => () => {};

function Keys({ chord, isMac }: { chord: string; isMac: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {formatKey(chord, isMac).map((cap, i) => (
        <kbd
          key={`${cap}-${i}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-zinc-300 bg-zinc-50 px-1.5 font-sans text-[11px] font-medium text-zinc-700 shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {cap}
        </kbd>
      ))}
    </span>
  );
}

function Row({ shortcut, isMac }: { shortcut: Shortcut; isMac: boolean }) {
  return (
    <li className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-sm text-zinc-800 dark:text-zinc-100">{shortcut.label}</div>
        {shortcut.mouse ? <div className="text-xs text-zinc-500 dark:text-zinc-400">{shortcut.mouse}</div> : null}
        {shortcut.note ? <div className="text-xs text-zinc-400 dark:text-zinc-500">{shortcut.note}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-xs text-zinc-400">
        {shortcut.keys.map((chord, i) => (
          <span key={chord} className="inline-flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden>or</span> : null}
            <Keys chord={chord} isMac={isMac} />
          </span>
        ))}
      </div>
    </li>
  );
}

export function KeyboardHelp() {
  const open = useKeyboardHelpStore((s) => s.open);
  const setOpen = useKeyboardHelpStore((s) => s.setOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The platform never changes, so there is nothing to subscribe to; the
  // server snapshot is `false` so the first client render matches the HTML.
  const isMac = useSyncExternalStore(subscribeNever, isMacPlatform, () => false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // jsdom does not implement showModal; fall back to the `open` attribute.
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-keyboard-help
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) setOpen(false);
      }}
      onKeyDown={(e) => {
        // Keep canvas shortcuts quiet while the map is open; `?` toggles it closed again.
        e.stopPropagation();
        if (e.key === "?") {
          e.preventDefault();
          setOpen(false);
        }
      }}
      className="max-h-[85vh] w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 open:flex open:flex-col dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="flex min-h-0 flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <Keyboard className="h-4 w-4 text-zinc-500" aria-hidden />
          <h2 id={titleId} className="text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <span className="ml-auto text-xs text-zinc-500">{isMac ? "⌘ is Command" : "Ctrl is Control"}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{group.title}</h3>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {group.shortcuts.map((shortcut) => (
                    <Row key={shortcut.label} shortcut={shortcut} isMac={isMac} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
        <div className="border-t border-zinc-200 px-5 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
          Press <kbd className="rounded border border-zinc-300 px-1 font-sans dark:border-zinc-600">?</kbd> on the canvas to open this list at any time. Snap to the
          8px grid and the minimap live in the toolbar settings menu.
        </div>
      </div>
    </dialog>
  );
}

export default KeyboardHelp;
