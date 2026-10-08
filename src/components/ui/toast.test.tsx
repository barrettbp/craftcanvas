import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_TOASTS, ToastProvider, clearToasts, dismissToast, getToasts, toast, toastRateLimited, useToast } from "./toast";

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

describe("toast emitter", () => {
  it("adds, replaces by id, dismisses and caps the list", () => {
    const id = toast("Hello");
    expect(getToasts().map((t) => t.title)).toEqual(["Hello"]);

    toast({ id: "x", title: "First" });
    toast({ id: "x", title: "Second" });
    expect(getToasts().filter((t) => t.id === "x").map((t) => t.title)).toEqual(["Second"]);

    dismissToast(id);
    expect(getToasts().some((t) => t.id === id)).toBe(false);

    for (let i = 0; i < MAX_TOASTS + 3; i += 1) toast(`t${i}`);
    expect(getToasts()).toHaveLength(MAX_TOASTS);
    expect(getToasts()[MAX_TOASTS - 1].title).toBe(`t${MAX_TOASTS + 2}`);
  });

  it("builds a single deduped rate limit toast from Retry-After seconds", () => {
    toastRateLimited(30);
    toastRateLimited("12");
    const items = getToasts().filter((t) => t.id === "rate-limited");
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Too many requests. Retrying in 12s.");
    expect(items[0].tone).toBe("warning");
    toastRateLimited(undefined);
    expect(getToasts().find((t) => t.id === "rate-limited")?.description).toBe("Too many requests. Retrying shortly.");
  });
});

describe("<ToastProvider>", () => {
  it("renders toasts, auto dismisses them and lets the user close them", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <p>page</p>
      </ToastProvider>,
    );
    expect(screen.queryByLabelText("Notifications")).not.toBeInTheDocument();

    act(() => {
      toast({ title: "Saved", description: "All good", tone: "success", durationMs: 1000 });
      toast({ title: "Sticky", tone: "error", durationMs: 0 });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Sticky");

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByText("Sticky")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Sticky")).not.toBeInTheDocument();
  });

  it("raises offline and back online toasts", () => {
    render(
      <ToastProvider>
        <p>page</p>
      </ToastProvider>,
    );
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("You're offline");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Back online");
  });

  it("exposes the hook with the live list inside and outside the provider", () => {
    function Probe() {
      const { toasts, toast: show } = useToast();
      return (
        <button type="button" onClick={() => show("From hook")}>
          {toasts.length} toasts
        </button>
      );
    }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "0 toasts" }));
    expect(screen.getByRole("button", { name: "1 toasts" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("From hook");
  });
});
