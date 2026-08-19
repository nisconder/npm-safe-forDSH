import { describe, it, expect } from "vitest";
import {
  validatePackageName,
  validateVersion,
  validateDomain,
  isKnownRegistryDomain,
} from "../src/registry/validator.js";

// ============================================================================
// validatePackageName
// ============================================================================

describe("validatePackageName", () => {
  // --- valid unscoped names ---
  it("accepts a simple unscoped name", () => {
    expect(validatePackageName("lodash")).toEqual({
      valid: true,
    });
  });

  it("accepts name with hyphens", () => {
    expect(validatePackageName("my-cool-package")).toEqual({
      valid: true,
    });
  });

  it("accepts name with dots and underscores", () => {
    expect(validatePackageName("dot.env_file")).toEqual({
      valid: true,
    });
  });

  it("accepts name starting and ending with digit", () => {
    expect(validatePackageName("7zip")).toEqual({ valid: true });
  });

  // --- valid scoped names ---
  it("accepts a scoped package name", () => {
    expect(validatePackageName("@babel/core")).toEqual({
      valid: true,
    });
  });

  it("accepts scoped name with hyphens in scope", () => {
    expect(validatePackageName("@my-scope/pkg")).toEqual({
      valid: true,
    });
  });

  it("accepts scoped name with dots in name", () => {
    expect(validatePackageName("@types/node.fs")).toEqual({
      valid: true,
    });
  });

  // --- edge cases: length ---
  it("accepts name at max length (214 chars)", () => {
    const name = "a".repeat(214);
    expect(validatePackageName(name)).toEqual({ valid: true });
  });

  it("rejects name exceeding max length (215 chars)", () => {
    const name = "a".repeat(215);
    expect(validatePackageName(name)).toEqual({
      valid: false,
      reason: "Package name must not exceed 214 characters.",
    });
  });

  // --- invalid: empty / non-string ---
  it("rejects empty string", () => {
    expect(validatePackageName("")).toEqual({
      valid: false,
      reason: "Package name must be a non-empty string.",
    });
  });

  it("rejects whitespace-only", () => {
    const result = validatePackageName(" ");
    expect(result.valid).toBe(false);
  });

  // --- invalid: case ---
  it("rejects uppercase characters", () => {
    const result = validatePackageName("Lodash");
    expect(result.valid).toBe(false);
    expect(result.reason?.includes("lowercase")).toBeTruthy();
  });

  it("rejects mixed-case scoped name", () => {
    const result = validatePackageName("@Babel/Core");
    expect(result.valid).toBe(false);
  });

  // --- invalid: spaces ---
  it("rejects name containing spaces", () => {
    const result = validatePackageName("my package");
    expect(result.valid).toBe(false);
    expect(result.reason?.includes("spaces")).toBeTruthy();
  });

  // --- invalid: leading dot / underscore ---
  it("rejects name starting with dot", () => {
    const result = validatePackageName(".hidden-pkg");
    expect(result.valid).toBe(false);
    expect(
      result.reason?.includes("begin with a dot"),
    ).toBeTruthy();
  });

  it("rejects name starting with underscore", () => {
    const result = validatePackageName("_private");
    expect(result.valid).toBe(false);
    expect(
      result.reason?.includes("begin with a dot"),
    ).toBeTruthy();
  });

  // --- invalid: scoped names ---
  it("rejects scoped name without '/' separator", () => {
    const result = validatePackageName("@noscope");
    expect(result.valid).toBe(false);
    expect(result.reason?.includes('"/" separator')).toBeTruthy();
  });

  it("rejects scoped name with empty scope", () => {
    const result = validatePackageName("@/pkg");
    expect(result.valid).toBe(false);
    expect(result.reason?.includes("scope must not be empty")).toBeTruthy();
  });

  it("rejects scoped name with empty name segment", () => {
    const result = validatePackageName("@scope/");
    expect(result.valid).toBe(false);
    expect(
      result.reason?.includes("name segment must not be empty"),
    ).toBeTruthy();
  });

  it("rejects name segment starting with @", () => {
    const result = validatePackageName("@outer/@inner");
    expect(result.valid).toBe(false);
    expect(result.reason?.includes("invalid characters")).toBeTruthy();
  });

  // --- invalid: special characters ---
  it("rejects name with special chars like !", () => {
    const result = validatePackageName("bad!");
    expect(result.valid).toBe(false);
    expect(result.reason?.includes("invalid characters")).toBeTruthy();
  });

  it("rejects Unicode homograph characters (Cyrillic)", () => {
    const result = validatePackageName("evo"); // using ASCII for demonstration
    expect(result.valid).toBe(true);
    // Real homograph test: Cyrillic 'а' (U+0430) in "lodash"
    const homograph = "lod\u0430sh"; // lodаsh with Cyrillic a
    const r = validatePackageName(homograph);
    expect(r.valid).toBe(false);
    expect(r.reason?.includes("invalid characters")).toBeTruthy();
  });
});

// ============================================================================
// validateVersion
// ============================================================================

describe("validateVersion", () => {
  it("accepts a simple semver (1.2.3)", () => {
    expect(validateVersion("1.2.3")).toBe(true);
  });

  it("accepts a leading-zero-free version (0.0.1)", () => {
    expect(validateVersion("0.0.1")).toBe(true);
  });

  it("accepts a large version number", () => {
    expect(validateVersion("999999.999999.999999")).toBe(true);
  });

  it("accepts pre-release identifiers", () => {
    expect(validateVersion("1.0.0-alpha.1")).toBe(true);
  });

  it("accepts build metadata", () => {
    expect(validateVersion("1.0.0+build.2024")).toBe(true);
  });

  it("accepts pre-release with build metadata", () => {
    expect(
      validateVersion("1.0.0-beta.1+build.42"),
    ).toBe(true);
  });

  // --- invalid ---
  it("rejects empty string", () => {
    expect(validateVersion("")).toBe(false);
  });

  it("rejects partial semver (1.2)", () => {
    expect(validateVersion("1.2")).toBe(false);
  });

  it("rejects non-numeric version (a.b.c)", () => {
    expect(validateVersion("a.b.c")).toBe(false);
  });

  it("rejects leading zero in major (01.2.3)", () => {
    expect(validateVersion("01.2.3")).toBe(false);
  });

  it("rejects leading zero in minor (1.02.3)", () => {
    expect(validateVersion("1.02.3")).toBe(false);
  });

  it("rejects leading zero in patch (1.2.03)", () => {
    expect(validateVersion("1.2.03")).toBe(false);
  });

  it("rejects v-prefixed version (v1.2.3)", () => {
    expect(validateVersion("v1.2.3")).toBe(false);
  });

  it("rejects version with trailing characters", () => {
    expect(validateVersion("1.2.3 ")).toBe(false);
  });

  it("rejects single number (1)", () => {
    expect(validateVersion("1")).toBe(false);
  });

  it("rejects negative numbers", () => {
    expect(validateVersion("-1.2.3")).toBe(false);
  });
});

// ============================================================================
// validateDomain
// ============================================================================

describe("validateDomain", () => {
  it("extracts domain from a full URL", () => {
    const result = validateDomain("https://registry.npmjs.org/package");
    expect(result).toEqual({
      valid: true,
      domain: "registry.npmjs.org",
    });
  });

  it("prepends https:// for bare domain", () => {
    const result = validateDomain("github.com/user/repo");
    expect(result.valid).toBe(true);
    expect(result.domain).toBe("github.com");
  });

  it("lowercases the domain", () => {
    const result = validateDomain("HTTPS://GitHub.com");
    expect(result.domain).toBe("github.com");
  });

  it("returns invalid for empty string", () => {
    const result = validateDomain("");
    expect(result.valid).toBe(false);
    expect(result.domain).toBe("");
  });

  it("returns valid for relative paths (treated as hostname)", () => {
    const result = validateDomain("/relative/path");
    expect(result.valid).toBe(true);
    expect(result.domain).toBe("relative");
  });

  it("returns invalid for invalid URL syntax", () => {
    const result = validateDomain("not a url at all !!!");
    expect(result.valid).toBe(false);
    expect(result.domain).toBe("");
  });
});

// ============================================================================
// isKnownRegistryDomain
// ============================================================================

describe("isKnownRegistryDomain", () => {
  it("recognizes registry.npmjs.org", () => {
    expect(
      isKnownRegistryDomain("registry.npmjs.org"),
    ).toBe(true);
  });

  it("recognizes npmjs.com", () => {
    expect(isKnownRegistryDomain("npmjs.com")).toBe(true);
  });

  it("recognizes github.com", () => {
    expect(isKnownRegistryDomain("github.com")).toBe(true);
  });

  it("recognizes gitlab.com", () => {
    expect(isKnownRegistryDomain("gitlab.com")).toBe(true);
  });

  it("recognizes bitbucket.org", () => {
    expect(isKnownRegistryDomain("bitbucket.org")).toBe(true);
  });

  it("recognizes domain case-insensitively", () => {
    expect(
      isKnownRegistryDomain("REGISTRY.NPMJS.ORG"),
    ).toBe(true);
  });

  it("rejects unknown domain", () => {
    expect(
      isKnownRegistryDomain("evil-registry.io"),
    ).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isKnownRegistryDomain("")).toBe(false);
  });

  it("rejects subdomains of known hosts", () => {
    expect(
      isKnownRegistryDomain("evil.github.com"),
    ).toBe(false);
  });
});
