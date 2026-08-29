import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published DSH bundle", () => {
  it("declares and ships the Cordis patch used by dsh plugin", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dsh?: { bundle?: { patch?: string } };
      exports?: Record<string, unknown>;
      files?: string[];
    };

    expect(manifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    expect(manifest.files).toContain("cordis.patch.yml");
    expect(manifest.exports).not.toHaveProperty("./src/*");

    const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
    expect(patch).toContain("@npm-safe/dsh-tool-npm-safe");
  });
});
