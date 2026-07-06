import { describe, expect, it } from "vitest";
import { subtitleHasContent } from "./subtitle-content.js";

describe("subtitleHasContent", () => {
  it("detects dialogue in SRT-style blocks", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:08,000
Second line`;
    expect(subtitleHasContent(srt)).toBe(true);
  });

  it("detects dialogue in WebVTT cues", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<c.en>Hello</c>`;
    expect(subtitleHasContent(vtt)).toBe(true);
  });

  it("rejects empty files and metadata-only blocks", () => {
    expect(subtitleHasContent("")).toBe(false);
    expect(subtitleHasContent("WEBVTT\n\nNOTE\nThis is a note")).toBe(false);
    expect(subtitleHasContent("1\n00:00:01,000 --> 00:00:04,000\n")).toBe(false);
  });
});
