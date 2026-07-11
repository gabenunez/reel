import { describe, expect, it } from "vitest";
import { errorMessage, parseIdParam, parsePagination } from "./util.js";

describe("errorMessage", () => {
  it("uses the Error message when present", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("falls back for non-errors and empty messages", () => {
    expect(errorMessage("nope", "fallback")).toBe("fallback");
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("parsePagination", () => {
  it("applies shared defaults", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 48 });
  });

  it("parses valid values", () => {
    expect(parsePagination({ page: "3", limit: "20" })).toEqual({ page: 3, limit: 20 });
  });

  it("clamps invalid or out-of-range values", () => {
    // Zero falls back to defaults (falsy parse), then page is floored to 1.
    expect(parsePagination({ page: "0", limit: "0" })).toEqual({ page: 1, limit: 48 });
    expect(parsePagination({ page: "-5", limit: "9999" })).toEqual({ page: 1, limit: 200 });
    expect(parsePagination({ page: "abc", limit: "xyz" })).toEqual({ page: 1, limit: 48 });
  });
});

describe("parseIdParam", () => {
  it("parses positive integer ids", () => {
    expect(parseIdParam("42")).toBe(42);
  });

  it("rejects non-numeric, zero, negative, and missing values", () => {
    expect(parseIdParam("abc")).toBeNull();
    expect(parseIdParam("0")).toBeNull();
    expect(parseIdParam("-3")).toBeNull();
    expect(parseIdParam(undefined)).toBeNull();
  });
});
