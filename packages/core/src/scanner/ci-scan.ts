/**
 * Pure CI dependency-scan helpers extracted from the legacy `ci` CLI command.
 *
 * This module is intentionally free of CLI concerns: no `commander` option
 * parsing, no i18n (`t()`), no telemetry recording, and no console output.
 * The {@link NpmSafeEngine.ciScan} method composes these helpers with the
 * engine to produce a {@link CiReport}; rendering and exit-code mapping are
 * the caller's responsibility.
 *
 * @module scanner/ci-scan
 */

import fs from 'node:fs';
import path from 'node:path';

import { SecurityLevel } from './types.js';

/**
 * Severity ordering used for the failure gate: lower rank = more severe.
 *
 * Exported so the engine's `ciScan` method can evaluate the fail gate without
 * re-declaring this mapping.
 */
export const LEVEL_RANK: Readonly<Record<string, number>> = {
  [SecurityLevel.Dangerous]: 1,
  [SecurityLevel.Unknown]: 2,
  [SecurityLevel.Suspicious]: 3,
  [SecurityLevel.Safe]: 4,
};

/**
 * Display order of security levels (used for option help text in the CLI).
 */
export const LEVEL_ORDER: readonly string[] = [
  SecurityLevel.Safe,
  SecurityLevel.Suspicious,
  SecurityLevel.Dangerous,
  SecurityLevel.Unknown,
];

/** A dependency name extracted from a manifest or lockfile. */
export interface Dependency {
  readonly name: string;
}

/** Per-package result within a {@link CiReport}. */
export interface PackageResult {
  readonly name: string;
  readonly exists: boolean;
  readonly version: string;
  readonly level: string;
  readonly score: number;
  readonly findingCount: number;
  readonly error?: string;
}

/** Aggregated CI scan report for a project directory. */
export interface CiReport {
  readonly dir: string;
  readonly scannedAt: string;
  readonly dependencyCount: number;
  readonly failLevel: string;
  readonly failed: boolean;
  readonly summary: Readonly<Record<string, number>>;
  readonly packages: readonly PackageResult[];
}

/** Options accepted by {@link NpmSafeEngine.ciScan}. */
export interface CiScanOptions {
  /** Project directory containing `package.json`. @default process.cwd() */
  readonly dir?: string;
  /** Fail when any dependency reaches this level. @default SecurityLevel.Dangerous */
  readonly failLevel?: SecurityLevel;
  /** Scan every dependency in `package-lock.json` (including transitive). */
  readonly lockfile?: boolean;
  /** Only scan `dependencies` (skip devDependencies). */
  readonly prod?: boolean;
  /** Optional external abort signal for cooperative cancellation. */
  readonly signal?: AbortSignal;
}

/**
 * Read direct dependencies (and optionally devDependencies) from a manifest.
 *
 * @param dir - Project directory containing a `package.json` file.
 * @param includeDev - When `true`, also include `devDependencies`.
 * @returns A list of dependency names (deduplicated, insertion-ordered).
 * @throws {Error} When `package.json` cannot be read or parsed.
 */
export function readDependencies(
  dir: string,
  includeDev: boolean,
): Dependency[] {
  const manifestPath = path.join(dir, 'package.json');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    throw new Error(`No package.json found in ${dir}`);
  }
  const names = new Set<string>();
  for (const key of ['dependencies', ...(includeDev ? ['devDependencies'] : [])]) {
    const section = manifest[key];
    if (section && typeof section === 'object') {
      for (const name of Object.keys(section as Record<string, unknown>)) {
        if (name !== 'optionalDependencies') names.add(name);
      }
    }
  }
  return [...names].map((name) => ({ name }));
}

/**
 * Read every package (including transitive dependencies) from a
 * `package-lock.json` (npm lockfile v2/v3 `packages` map, with a fallback to
 * the v1 `dependencies` tree). When `includeDev` is `false`, the result is
 * restricted to the direct `dependencies` declared in `package.json` (`--prod`).
 *
 * @param dir - Project directory containing a `package-lock.json` file.
 * @param includeDev - When `false`, restrict to `dependencies` from `package.json`.
 * @returns A list of dependency names (deduplicated).
 * @throws {Error} When `package-lock.json` cannot be read or parsed.
 */
export function readLockfileDependencies(
  dir: string,
  includeDev: boolean,
): Dependency[] {
  const lockPath = path.join(dir, 'package-lock.json');
  let lock: Record<string, unknown>;
  try {
    lock = JSON.parse(
      fs.readFileSync(lockPath, 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    throw new Error(`No package-lock.json found in ${dir}`);
  }

  const names = new Set<string>();
  const packages = lock.packages;
  if (packages && typeof packages === 'object') {
    for (const key of Object.keys(packages as Record<string, unknown>)) {
      if (key === '') continue; // root project entry
      // "node_modules/a" -> "a"; "node_modules/@scope/c" -> "@scope/c";
      // "node_modules/a/node_modules/d" -> "d" (the innermost package).
      const stripped = key.replace(/^node_modules\//, '');
      const parts = stripped.split('/node_modules/');
      const name = parts[parts.length - 1];
      if (name.length > 0) names.add(name);
    }
  }

  // npm lockfile v1 fallback: nested dependencies tree.
  const collect = (section: unknown): void => {
    if (!section || typeof section !== 'object') return;
    for (const [name, entry] of Object.entries(
      section as Record<string, unknown>,
    )) {
      if (name === 'optionalDependencies') continue;
      names.add(name);
      if (entry && typeof entry === 'object') {
        collect((entry as Record<string, unknown>).dependencies);
      }
    }
  };
  collect(lock.dependencies);

  if (!includeDev) {
    // --prod: restrict to the direct dependencies declared in package.json.
    const manifestPath = path.join(dir, 'package.json');
    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf8'),
      ) as Record<string, unknown>;
      const prod = new Set<string>(
        Object.keys(
          (manifest.dependencies as Record<string, unknown>) ?? {},
        ),
      );
      return [...names]
        .filter((name) => prod.has(name))
        .map((name) => ({ name }));
    } catch {
      // No package.json — fall through to the full lockfile set.
    }
  }

  return [...names].map((name) => ({ name }));
}
