import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosaveController, type AutosavePort, type SaveState } from "./autosave";
import type { FetchLike } from "./client";
import { emptyCanvas } from "./schema";
import type { CanvasData } from "./types";

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (call: Call) => Response | Promise<Response> | never): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makePort(initial: { data?: CanvasData; version?: number } = {}) {
  const state = {
    data: initial.data ?? emptyCanvas(),
    version: initial.version ?? 1,
    seq: 0,
    dirty: false,
    saveState: "saved" as SaveState,
    saved: [] as Array<{ version: number; seq: number }>,
    conflicts: [] as unknown[],
    gone: 0,
  };
  const port: AutosavePort = {
    snapshot: () => ({ data: state.data, version: state.version, seq: state.seq }),
    isDirty: () => state.dirty,
    setSaveState: (s) => {
      state.saveState = s;
    },
    onSaved: (version, seq) => {
      state.saved.push({ version, seq });
      state.version = version;
      state.dirty = state.seq !== seq;
      state.saveState = "saved";
    },
    onConflict: (fresh) => {
      state.conflicts.push(fresh);
      state.dirty = false;
    },
    onGone: () => {
      state.gone += 1;
    },
  };
  const change = () => {
    state.seq += 1;
    state.dirty = true;
  };
  return { state, port, change };
}

/** Lets fetch + Response.json settle; setImmediate is left real on purpose. */
async function flushPromises() {
  for (let i = 0; i < 3; i += 1) await new Promise<void>((r) => setImmediate(r));
}

describe("createAutosaveController", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and PUTs { data, version }, then marks saved with the new version", async () => {
    const { fetch, calls } = fakeFetch(() => json({ version: 2, updatedAt: "2026-01-01T00:00:00Z" }));
    const { state, port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true, debounceMs: 1500 });

    change();
    c.schedule();
    change();
    c.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/canvases/abc");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ data: emptyCanvas(), version: 1 });
    expect(state.saved).toEqual([{ version: 2, seq: 2 }]);
    expect(state.saveState).toBe("saved");
    expect(state.dirty).toBe(false);
    c.dispose();
  });

  it("keeps the document dirty when it changed during the save", async () => {
    let resolve: (r: Response) => void = () => {};
    const { fetch } = fakeFetch(() => new Promise<Response>((r) => (resolve = r)));
    const { state, port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true });
    change();
    c.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.saveState).toBe("saving");
    change(); // edit while the PUT is in flight
    resolve(json({ version: 2, updatedAt: "x" }));
    await flushPromises();
    expect(state.version).toBe(2);
    expect(state.dirty).toBe(true);
    c.dispose();
  });

  it("on 409 marks conflict, reloads from GET and hands the fresh copy over", async () => {
    const fresh = { id: "abc", title: "T", version: 7, thumbnail: null, createdAt: "", updatedAt: "", data: emptyCanvas() };
    const { fetch, calls } = fakeFetch((call) =>
      call.init?.method === "PUT" ? json({ error: "version_conflict", version: 7 }, 409) : json(fresh),
    );
    const { state, port, change } = makePort({ version: 3 });
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true });
    change();
    c.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    expect(calls.map((x) => x.init?.method ?? "GET")).toEqual(["PUT", "GET"]);
    expect(state.saveState).toBe("conflict");
    expect(state.conflicts).toEqual([fresh]);
    expect(state.saved).toEqual([]);
    c.dispose();
  });

  it("goes offline when fetch throws and retries later", async () => {
    let fail = true;
    const { fetch, calls } = fakeFetch(() => {
      if (fail) throw new TypeError("Failed to fetch");
      return json({ version: 2, updatedAt: "x" });
    });
    const { state, port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true, retryMs: 5000 });
    change();
    c.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(state.saveState).toBe("offline");
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(state.saveState).toBe("saved");
    c.dispose();
  });

  it("does not call the network while navigator is offline, and saves on retry()", async () => {
    let online = false;
    const { fetch, calls } = fakeFetch(() => json({ version: 2, updatedAt: "x" }));
    const { state, port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => online });
    change();
    c.schedule();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(0);
    expect(state.saveState).toBe("offline");
    online = true;
    c.retry();
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(state.saveState).toBe("saved");
    c.dispose();
  });

  it("flush saves immediately and skips when nothing is dirty", async () => {
    const { fetch, calls } = fakeFetch(() => json({ version: 2, updatedAt: "x" }));
    const { port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true });
    await c.flush();
    expect(calls).toHaveLength(0);
    change();
    await c.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.keepalive).toBe(false);
    change();
    await c.flush({ keepalive: true });
    expect(calls[1].init?.keepalive).toBe(true);
    c.dispose();
  });

  it("reports when the canvas is gone", async () => {
    const { fetch } = fakeFetch(() => json({ error: "not_found" }, 404));
    const { state, port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true });
    change();
    await c.flush();
    expect(state.gone).toBe(1);
    c.dispose();
  });

  it("does nothing after dispose", async () => {
    const { fetch, calls } = fakeFetch(() => json({ version: 2, updatedAt: "x" }));
    const { port, change } = makePort();
    const c = createAutosaveController("abc", port, { fetchImpl: fetch, isOnline: () => true });
    change();
    c.schedule();
    c.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(0);
  });
});
