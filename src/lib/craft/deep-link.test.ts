import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCraftDeepLink, openInCraft } from "./deep-link";

describe("buildCraftDeepLink", () => {
  it("includes the space id when known and encodes the parts", () => {
    expect(buildCraftDeepLink("doc 1", "space/2")).toBe("craftdocs://open?blockId=doc+1&spaceId=space%2F2");
  });

  it("omits the space id when unknown", () => {
    expect(buildCraftDeepLink("abc")).toBe("craftdocs://open?blockId=abc");
    expect(buildCraftDeepLink("abc", null)).toBe("craftdocs://open?blockId=abc");
    expect(buildCraftDeepLink("abc", "")).toBe("craftdocs://open?blockId=abc");
  });
});

describe("openInCraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clicks the deep link and falls back to the web url when the page stays focused", () => {
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("open", open);
    const onResult = vi.fn();
    const onHint = vi.fn();

    openInCraft({ docId: "d1", spaceId: "s1", webUrl: "https://craft.example/d1", onHint, onResult, fallbackMs: 100 });
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(["craftdocs://open?blockId=d1&spaceId=s1"]);
    expect(open).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(open).toHaveBeenCalledWith("https://craft.example/d1", "_blank", "noopener,noreferrer");
    expect(onResult).toHaveBeenCalledWith("web");
    expect(onHint).not.toHaveBeenCalled();
  });

  it("shows the hint when there is no web url", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const onHint = vi.fn();
    const onResult = vi.fn();
    openInCraft({ docId: "d1", onHint, onResult, fallbackMs: 50 });
    vi.advanceTimersByTime(50);
    expect(onHint).toHaveBeenCalledWith({ webUrl: undefined });
    expect(onResult).toHaveBeenCalledWith("hint");
  });

  it("does nothing more when the app took focus", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const onHint = vi.fn();
    const onResult = vi.fn();
    openInCraft({ docId: "d1", webUrl: "https://craft.example/d1", onHint, onResult, fallbackMs: 50 });
    (document.hasFocus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(50);
    expect(open).not.toHaveBeenCalled();
    expect(onHint).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith("app");
  });
});
