import { describe, expect, it } from "vitest";
import { countPhrase, editDistance, tokenize, wordMatches } from "../../../../src/features/dashboard/assistant/normalize";

describe("normalising questions", () => {
  it("splits the Tagalog superlative prefix in every spelling", () => {
    expect(tokenize("Pinakang busy")).toEqual(["pinaka", "busy"]);
    expect(tokenize("pinaka-busy")).toEqual(["pinaka", "busy"]);
    expect(tokenize("pinakabusy")).toEqual(["pinaka", "busy"]);
    expect(tokenize("PINAKAMARAMING bisita")).toEqual(["pinaka", "marami", "bisita"]);
    expect(tokenize("pinaka maraming")).toEqual(["pinaka", "marami"]);
  });

  it("removes accents and punctuation and maps spelling variants", () => {
    expect(tokenize("Ngayóng araw?!")).toEqual(["ngayon", "araw"]);
    expect(tokenize("kamusta, bc ba?")).toEqual(["kumusta", "busy", "ba"]);
    expect(tokenize("ilang bisitang dumating")).toEqual(["ilan", "bisita", "dumating"]);
    expect(tokenize("pakibuod")).toEqual(["buod"]);
    expect(tokenize("Today's   visitors")).toEqual(["today", "s", "visitors"]);
  });

  it("counts neighbouring swaps as one edit", () => {
    expect(editDistance("busiset", "busiest")).toBe(1);
    expect(editDistance("visotors", "visitors")).toBe(1);
    expect(editDistance("report", "visitors")).toBeGreaterThan(1);
  });

  it("matches long words within one edit but not short words or near-miss real words", () => {
    expect(wordMatches("visotors", "visitors")).toBe(true);
    expect(wordMatches("exit", "exits")).toBe(false);
    expect(wordMatches("malaki", "lalaki")).toBe(false);
    expect(wordMatches("house", "hours")).toBe(false);
  });

  it("matches phrases only as whole words", () => {
    expect(countPhrase(tokenize("account count"), "count")).toBe(1);
    expect(countPhrase(tokenize("the central plaza"), "entry")).toBe(0);
    expect(countPhrase(tokenize("right now right now"), "right now")).toBe(2);
  });
});
