import { describe, expect, it } from "vitest";
import { parseImdbId } from "./metadata.js";

describe("parseImdbId", () => {
  it("accepts tt ids", () => {
    expect(parseImdbId("tt0094715")).toBe("tt0094715");
    expect(parseImdbId("TT0094715")).toBe("tt0094715");
  });

  it("accepts IMDb URLs", () => {
    expect(parseImdbId("https://www.imdb.com/title/tt0094715/")).toBe("tt0094715");
    expect(parseImdbId("imdb.com/title/tt0094715/?ref_=fn")).toBe("tt0094715");
  });

  it("accepts bare numeric ids", () => {
    expect(parseImdbId("0094715")).toBe("tt0094715");
  });

  it("rejects titles", () => {
    expect(parseImdbId("Beaches")).toBeNull();
    expect(parseImdbId("")).toBeNull();
  });
});
