import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published DSH bundle", () => {
  it("declares and ships the Cordis patch used by dsh plugin", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dsh?: { manifestVersion?: number; bundle?: { patch?: string } };
      engines?: { dsh?: string };
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      files?: string[];
    };

    expect(manifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    expect(manifest.dsh?.manifestVersion).toBe(1);
    expect(manifest.engines?.dsh).toBe(">=0.2.2-rc.3 <0.3.0");
    for (const name of ["@deepseek-ai/dsh-jobs", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-working-directory"]) {
      expect(manifest.peerDependencies?.[name]).toBe("^0.2.2-rc.3");
      expect(manifest.devDependencies?.[name]).toBe("0.2.2-rc.3");
    }
    expect(manifest.peerDependencies).not.toHaveProperty("@deepseek-ai/dsh-jobs-local");
    expect(manifest.files).toContain("cordis.patch.yml");
    expect(manifest.exports).not.toHaveProperty("./src/*");

    const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
    expect(patch).toContain("@npm-safe/dsh-tool-npm-safe");
  });
});
