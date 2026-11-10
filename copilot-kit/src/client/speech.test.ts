import { describe, expect, it } from "vitest";
import { SentenceBuffer, SpokenSummary, cleanForSpeech } from "./speech.js";

describe("cleanForSpeech", () => {
  it("does not say remaining useful life twice", () => {
    expect(cleanForSpeech("a remaining useful life (RUL) of 7 days")).toBe("a remaining useful life of 7 days");
  });

  it("strips markdown and bullets", () => {
    expect(cleanForSpeech("**T1** on [Hurco](/map)\n• Tools — ok")).toBe(
      "T1 on Hurco\nTools — ok",
    );
  });

  it("reads units naturally", () => {
    expect(cleanForSpeech("health 53.0% , 7d left")).toContain("53.0 percent");
    expect(cleanForSpeech("7d left")).toBe("7 days left");
    expect(cleanForSpeech("1d left")).toBe("1 day left");
    expect(cleanForSpeech("RUL is low")).toBe("remaining useful life is low");
  });

  it("spells out machine codes but leaves normal words alone", () => {
    expect(cleanForSpeech("Mazak IC035302")).toBe("Mazak I C 0 3 5 3 0 2");
    expect(cleanForSpeech("Mazak E 500")).toBe("Mazak E 500");
  });
});

describe("SentenceBuffer", () => {
  it("emits sentences as they complete across chunks", () => {
    const b = new SentenceBuffer();
    expect(b.push("The Mazak is in warn")).toEqual([]);
    expect(b.push(" state. Its RUL is 7")).toEqual(["The Mazak is in warn state."]);
    expect(b.push(" days. Check the")).toEqual(["Its RUL is 7 days."]);
    expect(b.flush()).toEqual(["Check the"]);
  });

  it("does not split decimals", () => {
    const b = new SentenceBuffer();
    expect(b.push("Health is 53.0 percent now. ")).toEqual(["Health is 53.0 percent now."]);
  });

  it("splits list lines", () => {
    const b = new SentenceBuffer();
    expect(b.push("Also short RUL:\n• A — 8d\n• B — 9d")).toEqual([
      "Also short RUL:",
      "• A — 8d",
    ]);
    expect(b.flush()).toEqual(["• B — 9d"]);
  });
});

describe("SpokenSummary", () => {
  const run = (chunks: string[]) => {
    const s = new SpokenSummary();
    return [...chunks.flatMap((c) => s.push(c)), ...s.flush()];
  };

  it("speaks a short reply in full, with no pointer", () => {
    expect(run(["Mazak is in warn state. RUL is 8 days."])).toEqual([
      "Mazak is in warn state.",
      "RUL is 8 days.",
    ]);
  });

  it("speaks the first two sentences, skips the rest, and points to the chat", () => {
    expect(
      run(["A is next. It has 7d left. Also B is low. And C too. "]),
    ).toEqual(["A is next.", "It has 7d left.", "The details are in the chat."]);
  });

  it("skips list items and lead-ins", () => {
    expect(run(["T1 fails next in 7d.\nAlso short RUL:\n• A — 8d\n• B — 9d"])).toEqual([
      "T1 fails next in 7d.",
      "The details are in the chat.",
    ]);
  });

  it("caps total length after the first sentence", () => {
    const long = "x".repeat(300) + ".";
    expect(run([long + " Short one. "])).toEqual([long, "The details are in the chat."]);
  });

  it("works across streamed chunks", () => {
    expect(run(["T1 fai", "ls next. Then", " more. Third one. "])).toEqual([
      "T1 fails next.",
      "Then more.",
      "The details are in the chat.",
    ]);
  });
});
