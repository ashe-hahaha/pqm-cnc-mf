import { describe, expect, it } from "vitest";
import { tidyReply } from "./stream.js";

describe("tidyReply", () => {
  it("collapses 'remaining useful life (RUL)'", () => {
    expect(tidyReply("a remaining useful life (RUL) of 7 days")).toBe("a RUL of 7 days");
  });
  it("leaves other text alone", () => {
    expect(tidyReply("RUL is 7 days")).toBe("RUL is 7 days");
  });
});
