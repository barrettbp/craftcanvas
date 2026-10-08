import { describe, expect, it } from "vitest";

import { escapeLike, mergeSearchResults, normaliseQuery } from "./search";
import type { SearchResult } from "./types";

const row = (id: string, source: SearchResult["source"], title = id): SearchResult => ({
  id,
  title,
  folderPath: "",
  updatedAt: null,
  source,
});

describe("mergeSearchResults", () => {
  it("lists local rows first and de-duplicates by id", () => {
    const local = [row("a", "local", "A local"), row("b", "local")];
    const craft = [row("b", "craft", "B craft"), row("c", "craft"), row("a", "craft")];
    const merged = mergeSearchResults(local, craft);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(merged[0].title).toBe("A local");
    expect(merged.map((r) => r.source)).toEqual(["local", "local", "craft"]);
  });

  it("handles empty inputs and duplicates within one side", () => {
    expect(mergeSearchResults([], [])).toEqual([]);
    expect(mergeSearchResults([row("a", "local"), row("a", "local")], []).map((r) => r.id)).toEqual(["a"]);
    expect(mergeSearchResults([], [row("z", "craft")]).map((r) => r.source)).toEqual(["craft"]);
  });

  it("does not mutate inputs", () => {
    const local = [row("a", "local")];
    const craft = [row("a", "craft")];
    mergeSearchResults(local, craft);
    expect(craft[0].source).toBe("craft");
  });
});

describe("escapeLike", () => {
  it("escapes wildcard characters", () => {
    expect(escapeLike("100% _sure_ \\ok")).toBe("100\\% \\_sure\\_ \\\\ok");
  });
});

describe("normaliseQuery", () => {
  it("trims, collapses whitespace and caps the length", () => {
    expect(normaliseQuery("  foo   bar \n baz ")).toBe("foo bar baz");
    expect(normaliseQuery(null)).toBe("");
    expect(normaliseQuery("x".repeat(500)).length).toBe(200);
  });
});
