import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { RuleConfigManager } from "../src/scanner/rule-config.js";
import { Severity } from "../src/scanner/types.js";

function tmpConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npm-safe-rules-"));
  return path.join(dir, "rules.json");
}

describe("RuleConfigManager", () => {
  it("starts with an empty config when no file exists", () => {
    const mgr = new RuleConfigManager(tmpConfigPath());
    expect(mgr.getConfiguredRuleIds()).toEqual([]);
    expect(mgr.isEnabled("x", true)).toBe(true);
    expect(mgr.getSeverityOverride("x")).toBe(undefined);
  });

  it("treats a corrupt config file as empty", () => {
    const file = tmpConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    const mgr = new RuleConfigManager(file);
    expect(mgr.getConfiguredRuleIds()).toEqual([]);
  });

  it("persists enable/disable overrides", () => {
    const file = tmpConfigPath();
    const mgr = new RuleConfigManager(file);
    mgr.setEnabled("install-script", false);
    expect(mgr.isEnabled("install-script", true)).toBe(false);

    const reloaded = new RuleConfigManager(file);
    expect(reloaded.isEnabled("install-script", true)).toBe(false);
  });

  it("persists severity overrides and can clear them", () => {
    const file = tmpConfigPath();
    const mgr = new RuleConfigManager(file);
    mgr.setSeverity("typosquatting", Severity.Critical);
    expect(
      mgr.getSeverityOverride("typosquatting"),
    ).toBe(Severity.Critical);

    mgr.setSeverity("typosquatting", undefined);
    expect(mgr.getSeverityOverride("typosquatting")).toBe(undefined);
  });

  it("persists free-form options", () => {
    const file = tmpConfigPath();
    const mgr = new RuleConfigManager(file);
    mgr.setOptions("my-rule", { threshold: 3 });
    expect(mgr.getOptions("my-rule")).toEqual({ threshold: 3 });

    const reloaded = new RuleConfigManager(file);
    expect(reloaded.getOptions("my-rule")).toEqual({ threshold: 3 });
  });

  it("returns {} for options of an unconfigured rule", () => {
    const mgr = new RuleConfigManager(tmpConfigPath());
    expect(mgr.getOptions("nope")).toEqual({});
  });
});
