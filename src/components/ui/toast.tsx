"use client";

/**
 * Tiny toast system, no dependencies.
 *
 * - `toast(input)` / `dismissToast(id)`: module level emitter, callable from
 *   plain modules (the autosave hook, the preview queue) without context.
 * - `useToast()`: the same API as a hook, plus the live list.
 * - `<ToastProvider>`: mount once in the root layout. Renders `<Toaster/>`
 *   and raises the offline / back online toasts for every page.
 *
 * Toasts with the same `id` replace each other, so a burst of 429s shows
 * one "slow down" toast instead of five. `durationMs: 0` keeps a toast until
 * it is dismissed.
 */
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

export type ToastAction = { label: string; onClick: () => void };

export type ToastInput = {
  /** Stable id to replace an earlier toast instead of stacking a new one. */
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Auto dismiss delay; 0 keeps the toast until dismissed. Defaults to 5s. */
  durationMs?: number;
  action?: ToastAction;
};

export type Toast = Required<Pick<ToastInput, "id" | "title" | "tone" | "durationMs">> & Pick<ToastInput, "description" | "action"> & { createdAt: number };

export const DEFAULT_TOAST_MS = 5000;
export const MAX_TOASTS = 5;

const EMPTY: Toast[] = [];
let toasts: Toast[] = EMPTY;
let counter = 0;
const listeners = new Set<() => void>();

function publish(next: Toast[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): Toast[] {
  return toasts;
}

/** Shows a toast and returns its id. A string is shorthand for `{ title }`. */
export function toast(input: ToastInput | string): string {
  const i = typeof input === "string" ? { title: input } : input;
  counter += 1;
  const id = i.id ?? `toast_${counter}`;
  const next: Toast = {
    id,
    title: i.title,
    description: i.description,
    tone: i.tone ?? "info",
    durationMs: i.durationMs ?? DEFAULT_TOAST_MS,
    action: i.action,
    createdAt: Date.now(),
  };
  publish([...toasts.filter((t) => t.id !== id), next].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: string): void {
  if (!toasts.some((t) => t.id === id)) return;
  publish(toasts.filter((t) => t.id !== id));
}

export function clearToasts(): void {
  if (toasts.length > 0) publish(EMPTY);
}

/**
 * The shared "rate limited" toast (spec section 7). `retryAfter` is seconds,
 * as our routes and Craft send it. Deduped so a burst shows one toast.
 */
export function toastRateLimited(retryAfter?: number | string | null): string {
  const parsed = Number(retryAfter);
  const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : undefined;
  return toast({
    id: "rate-limited",
    tone: "warning",
    title: "Slow down a little",
    description: seconds ? `Too many requests. Retrying in ${seconds}s.` : "Too many requests. Retrying shortly.",
    durationMs: seconds ? Math.min(15_000, Math.max(DEFAULT_TOAST_MS, seconds * 1000)) : DEFAULT_TOAST_MS,
  });
}

export type ToastApi = {
  toasts: Toast[];
  toast: (input: ToastInput | string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<Omit<ToastApi, "toasts"> | null>(null);
const contextApi: Omit<ToastApi, "toasts"> = { toast, dismiss: dismissToast, clear: clearToasts };

/** Works inside or outside `<ToastProvider>`; the provider only adds the rendered list. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext) ?? contextApi;
  const list = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);
  return { toasts: list, ...api };
}

const TONE: Record<ToastTone, { icon: typeof Info; className: string; role: "status" | "alert" }> = {
  info: { icon: Info, className: "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100", role: "status" },
  success: {
    icon: CircleCheck,
    className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    role: "status",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    role: "alert",
  },
  error: { icon: CircleAlert, className: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100", role: "alert" },
};

function ToastItem({ item }: { item: Toast }) {
  const tone = TONE[item.tone];
  const Icon = tone.icon;

  useEffect(() => {
    if (item.durationMs <= 0) return;
    const timer = setTimeout(() => dismissToast(item.id), item.durationMs);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs, item.createdAt]);

  return (
    <div
      role={tone.role}
      data-toast={item.id}
      data-tone={item.tone}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-lg ${tone.className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{item.title}</div>
        {item.description ? <div className="mt-0.5 text-xs opacity-80">{item.description}</div> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismissToast(item.id);
            }}
            className="mt-1.5 text-xs font-medium underline underline-offset-2"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 rounded p-1 opacity-60 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Renders the live toast list, bottom right. Mounted by `<ToastProvider>`. */
export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);
  if (list.length === 0) return null;
  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
    >
      {list.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
}

export const CONNECTIVITY_TOAST_ID = "connectivity";

/** Offline / back online toasts for every page (spec section 7 "Network down"). */
function useConnectivityToasts(): void {
  useEffect(() => {
    const onOffline = () =>
      toast({
        id: CONNECTIVITY_TOAST_ID,
        tone: "warning",
        title: "You're offline",
        description: "You can keep working. Changes are saved as soon as the connection is back.",
        durationMs: 0,
      });
    const onOnline = () =>
      toast({ id: CONNECTIVITY_TOAST_ID, tone: "success", title: "Back online", description: "Anything unsaved is being saved now." });
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  useConnectivityToasts();
  return (
    <ToastContext.Provider value={contextApi}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export default ToastProvider;
