"use client";

/**
 * Per browser conveniences (panel width, etc.) backed by localStorage and read
 * through `useSyncExternalStore`, so there is no setState-in-effect and the
 * server render uses the fallback.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readLocal<T>(key: string, fallback: T): T {
  const raw = typeof window === "undefined" ? null : readRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the value simply is not remembered.
  }
  listeners.forEach((l) => l());
}

/** Reads a JSON value from localStorage; `fallback` must be referentially stable. */
export function useLocalStorageValue<T>(key: string, fallback: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const setValue = useCallback((next: T) => writeLocal(key, next), [key]);
  return [value, setValue];
}
