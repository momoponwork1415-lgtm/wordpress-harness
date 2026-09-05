import { describe, expect, it } from "vitest";

import {
  currentResearchAttackerScopePrompt,
  isWithinCurrentResearchAttackerScope,
} from "../../src/research/current-research-attacker-scope.js";

describe("current Research attacker scope", () => {
  it("admits only unauthenticated and subscriber-equivalent premises", () => {
    expect(
      ["unauthenticated", "subscriber", "customer"].every(
        isWithinCurrentResearchAttackerScope,
      ),
    ).toBe(true);
    expect(
      ["contributor", "author", "administrator", "unresolved"].some(
        isWithinCurrentResearchAttackerScope,
      ),
    ).toBe(false);
    expect(currentResearchAttackerScopePrompt).toContain(
      "effective capabilities do not exceed the built-in Subscriber baseline",
    );
  });
});
