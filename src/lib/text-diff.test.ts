import { describe, expect, it } from "vitest";
import { diffLines } from "./text-diff";

describe("diffLines", () => {
  it("marks additions and removals while preserving shared lines", () => {
    expect(diffLines("第一行\n旧内容\n第三行", "第一行\n新内容\n第三行")).toEqual([
      { type: "same", text: "第一行" }, { type: "removed", text: "旧内容" }, { type: "added", text: "新内容" }, { type: "same", text: "第三行" },
    ]);
  });
});
