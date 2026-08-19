import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { loadRulesFromDirectory } from "../src/scanner/rule-loader.js";
import { FindingCategory, Severity } from "../src/scanner/types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "npm-safe-rules-dir-"));
}

function writeRuleFile(dir: string, name: string, body: string): void {
  fs.writeFileSync(path.join(dir, name), body, "utf8");
}

describe("loadRulesFromDirectory", () => {
  it("returns [] when the directory does not exist", async () => {
    const results = await loadRulesFromDirectory(path.join(os.tmpdir(), "no-such-dir"));
    expect(results).toEqual([]);
  });

  it("loads a single rule exported as `rule`", async () => {
    const dir = tmpDir();
    writeRuleFile(
      dir,
      "one.mjs",
      `export const rule = {
        id: "test-one",
        name: "One",
        description: "d",
        severity: "${Severity.High}",
        category: "${FindingCategory.Informational}",
        enabled: true,
        match: () => [],
      };`,
    );
    const results = await loadRulesFromDirectory(dir);
    expect(results.length).toBe(1);
    expect(results[0].rules.length).toBe(1);
    expect(results[0].rules[0].id).toBe("test-one");
  });

  it("loads multiple rules exported as `rules`", async () => {
    const dir = tmpDir();
    writeRuleFile(
      dir,
      "multi.mjs",
      `export const rules = [
        { id: "a", name: "A", description: "d", severity: "low", category: "informational", enabled: true, match: () => [] },
        { id: "b", name: "B", description: "d", severity: "low", category: "informational", enabled: true, match: () => [] },
      ];`,
    );
    const results = await loadRulesFromDirectory(dir);
    expect(results.length).toBe(1);
    expect(results[0].rules.length).toBe(2);
  });

  it("loads rules from a `default` export", async () => {
    const dir = tmpDir();
    writeRuleFile(
      dir,
      "default.mjs",
      `export default {
        id: "dflt",
        name: "Default",
        description: "d",
        severity: "medium",
        category: "informational",
        enabled: true,
        match: () => [],
      };`,
    );
    const results = await loadRulesFromDirectory(dir);
    expect(results.length).toBe(1);
    expect(results[0].rules[0].id).toBe("dflt");
  });

  it("loads rules from a factory function", async () => {
    const dir = tmpDir();
    writeRuleFile(
      dir,
      "factory.mjs",
      `export const rule = () => ({
        id: "fact",
        name: "Factory",
        description: "d",
        severity: "high",
        category: "informational",
        enabled: true,
        match: () => [],
      });`,
    );
    const results = await loadRulesFromDirectory(dir);
    expect(results.length).toBe(1);
    expect(results[0].rules[0].id).toBe("fact");
  });

  it("skips files that do not export rules", async () => {
    const dir = tmpDir();
    writeRuleFile(dir, "empty.mjs", `export const nothing = 42;`);
    writeRuleFile(dir, "broken.mjs", `export const rule = { nope: true };`);
    const results = await loadRulesFromDirectory(dir);
    expect(results).toEqual([]);
  });

  it("loads files in lexical order", async () => {
    const dir = tmpDir();
    writeRuleFile(dir, "10-late.mjs", `export const rule = { id: "late", name: "L", description: "d", severity: "low", category: "informational", enabled: true, match: () => [] };`);
    writeRuleFile(dir, "01-early.mjs", `export const rule = { id: "early", name: "E", description: "d", severity: "low", category: "informational", enabled: true, match: () => [] };`);
    const results = await loadRulesFromDirectory(dir);
    expect(
      results.map((r) => r.rules[0].id),
    ).toEqual(["early", "late"]);
  });
});
