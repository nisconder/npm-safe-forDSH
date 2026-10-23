/**
 * Compatibility facade for existing DSH consumers. Detection, caching, version
 * resolution, lockfile traversal and failure policy belong to @npm-safe/core.
 */
import {
  NpmSafeEngine as SharedNpmSafeEngine,
  SecurityLevel,
  SECURITY_LEVEL_RANK,
  readProjectDependencies,
  shouldFailCi,
} from '@npm-safe/core'
type SearchResult = Awaited<ReturnType<SharedNpmSafeEngine['searchPackages']>>[number]

export * from '@npm-safe/core'
export type { PackageCheckOptions as CheckPackageOptions } from '@npm-safe/core'
export type { ProjectDependency as Dependency } from '@npm-safe/core'
export { SECURITY_LEVEL_RANK as LEVEL_RANK } from '@npm-safe/core'

export function readDependencies(dir: string, includeDev: boolean) {
  return readProjectDependencies(dir, { prod: !includeDev })
}

export function readLockfileDependencies(dir: string, includeDev: boolean) {
  return readProjectDependencies(dir, { lockfile: true, prod: !includeDev })
}

export interface CiScanOptions {
  readonly dir?: string
  readonly failLevel?: SecurityLevel
  readonly lockfile?: boolean
  readonly prod?: boolean
  readonly deep?: boolean
  readonly signal?: AbortSignal
}

export interface PackageResult {
  readonly name: string
  readonly exists: boolean
  readonly version: string
  readonly level: SecurityLevel
  readonly score: number
  readonly findingCount: number
  readonly deepScanStatus?: 'complete' | 'partial' | 'failed'
  readonly error?: string
}

export interface CiReport {
  readonly dir: string
  readonly scannedAt: string
  readonly dependencyCount: number
  readonly failLevel: SecurityLevel
  readonly failed: boolean
  readonly summary: Readonly<Record<string, number>>
  readonly packages: readonly PackageResult[]
}

export class NpmSafeEngine extends SharedNpmSafeEngine {
  /** Retain the DSH options form while accepting the shared positional API. */
  override searchPackages(
    query: string,
    options?: number | { readonly size?: number; readonly signal?: AbortSignal },
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    return super.searchPackages(
      query,
      typeof options === 'number' ? options : options?.size,
      typeof options === 'number' ? signal : options?.signal ?? signal,
    )
  }

  /** Format shared dependency parsing and risk policy for the DSH CI tool. */
  async ciScan(options: CiScanOptions = {}): Promise<CiReport> {
    const dir = options.dir ?? process.cwd()
    const failLevel = options.failLevel ?? SecurityLevel.Dangerous
    if (!Object.hasOwn(SECURITY_LEVEL_RANK, failLevel)) {
      throw new Error(`Unknown CI failure level: ${failLevel}`)
    }
    const deps = readProjectDependencies(dir, {
      lockfile: options.lockfile,
      prod: options.prod,
    })
    const packages: PackageResult[] = []
    const summary: Record<string, number> = {
      safe: 0, suspicious: 0, dangerous: 0, unknown: 0, errors: 0, deepIncomplete: 0,
    }
    let failed = false
    for (const dep of deps) {
      throwIfAborted(options.signal)
      try {
        const result = await this.checkPackage(dep.name, {
          version: dep.version,
          deep: options.deep,
          signal: options.signal,
        })
        if (dep.version && result.exists && result.latestVersion !== dep.version) {
          throw new Error(`Requested ${dep.name}@${dep.version} but checked ${result.latestVersion}`)
        }
        const findings = [
          ...(result.security.staticScan?.findings ?? []),
          ...(result.security.llmScan?.enabled ? result.security.llmScan.findings ?? [] : []),
        ]
        const deepScanStatus = result.security.staticScan?.contentScan?.status
        packages.push({
          name: dep.name,
          exists: result.exists,
          version: result.latestVersion,
          level: result.security.overallLevel,
          score: result.security.overallScore,
          findingCount: findings.length,
          ...(deepScanStatus ? { deepScanStatus } : {}),
        })
        summary[result.security.overallLevel]++
        failed ||= !result.exists || shouldFailCi(
          result.security.overallLevel, failLevel, findings,
        )
        if (options.deep && deepScanStatus !== 'complete') {
          summary.deepIncomplete++
          failed = true
        }
        if (result.exists) await this.recordCheckHistory(result)
      } catch (error) {
        throwIfAborted(options.signal)
        packages.push({
          name: dep.name,
          exists: false,
          version: dep.version ?? '',
          level: SecurityLevel.Unknown,
          score: 0,
          findingCount: 0,
          error: error instanceof Error ? error.message : String(error),
        })
        summary.errors++
        failed = true
      }
    }
    throwIfAborted(options.signal)
    return {
      dir, scannedAt: new Date().toISOString(), dependencyCount: deps.length,
      failLevel, failed, summary, packages,
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
}
