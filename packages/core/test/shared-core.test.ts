import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NpmSafeEngine as SharedNpmSafeEngine,
  SecurityLevel,
  Severity,
  FindingCategory,
} from '@npm-safe/core'
import { NpmSafeEngine, LEVEL_RANK, readDependencies, readLockfileDependencies } from '../src/index.js'

describe('DSH compatibility facade using the actual shared scanner', () => {
  let dir: string
  let engine: NpmSafeEngine

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'npm-safe-dsh-contract-'))
    engine = new NpmSafeEngine({
      dbPath: ':memory:',
      rateLimit: 100,
      rateLimitBurst: 100,
      rulesConfigPath: join(dir, 'rules.json'),
      llmConfigPath: join(dir, 'llm.json'),
      rulesDir: join(dir, 'rules'),
    })
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'fixture', dependencies: { a: '^1.0.0' },
    }))
  })

  afterEach(async () => {
    engine.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await rm(dir, { recursive: true, force: true })
  })

  const metadata = (name = 'a') => ({
    name, modified: new Date().toISOString(), readme: '',
    'dist-tags': { latest: '2.0.0' },
    versions: Object.fromEntries(['1.0.0', '2.0.0'].map(version => [version, {
      name, version, scripts: {},
      dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` },
    }])),
  })

  it('inherits the shared scanner and forwards version and forceRefresh unchanged', async () => {
    expect(engine).toBeInstanceOf(SharedNpmSafeEngine)
    const fetch = vi.fn(async () => new Response(JSON.stringify(metadata())))
    vi.stubGlobal('fetch', fetch)
    expect((await engine.checkPackage('a', { version: '1.0.0' })).latestVersion).toBe('1.0.0')
    await engine.checkPackage('a', { version: '1.0.0' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await engine.checkPackage('a', { version: '1.0.0', forceRefresh: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('CI scans every locked version and keeps production transitive dependencies', async () => {
    await writeFile(join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { a: '^1.0.0' }, devDependencies: { dev: '*' } },
        'node_modules/a': { version: '1.0.0', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '1.0.0', dependencies: { a: '^2.0.0' } },
        'node_modules/b/node_modules/a': { version: '2.0.0' },
        'node_modules/dev': { version: '1.0.0', dev: true },
      },
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = decodeURIComponent(new URL(url).pathname.slice(1))
      return new Response(JSON.stringify(metadata(name)))
    }))
    const report = await engine.ciScan({ dir, lockfile: true, prod: true })
    expect(report.packages.map(p => `${p.name}@${p.version}`).sort()).toEqual([
      'a@1.0.0', 'a@2.0.0', 'b@1.0.0',
    ])
    expect(readLockfileDependencies(dir, false)).toHaveLength(3)
    expect(readDependencies(dir, false)).toEqual([{ name: 'a' }])
    expect(LEVEL_RANK.unknown).toBeLessThan(LEVEL_RANK.dangerous)
  })

  it('uses the shared risk policy for critical findings regardless of a zero score', async () => {
    vi.spyOn(engine, 'checkPackage').mockResolvedValue({
      packageName: 'a', exists: true, latestVersion: '1.0.0', cachedAt: null,
      registryInfo: null,
      security: {
        overallLevel: SecurityLevel.Dangerous, overallScore: 0,
        staticScan: {
          packageName: 'a', version: '1.0.0', score: 0,
          overallLevel: SecurityLevel.Dangerous, scannedAt: new Date().toISOString(),
          findings: Array.from({ length: 4 }, (_, index) => ({
            ruleId: `critical-${index}`, ruleName: 'Critical evidence',
            severity: Severity.Critical, message: 'Critical evidence',
            category: FindingCategory.CodeObfuscation,
          })),
        },
      },
    })
    vi.spyOn(engine, 'recordCheckHistory').mockResolvedValue(undefined)
    const report = await engine.ciScan({ dir })
    expect(report.failed).toBe(true)
  })

  it('retains the options-based search API and aborts registry work', async () => {
    const controller = new AbortController()
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const pending = engine.searchPackages('test', { size: 3, signal: controller.signal })
    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][0]).toContain('size=3')
  })

  it('does not swallow cancellation of the last CI dependency', async () => {
    const controller = new AbortController()
    vi.spyOn(engine, 'checkPackage').mockImplementation(async () => {
      controller.abort()
      throw new DOMException('Cancelled', 'AbortError')
    })
    await expect(engine.ciScan({ dir, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('fails when the shared engine returns a different version than the lockfile requested', async () => {
    await writeFile(join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3, packages: {
        '': { dependencies: { a: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0' },
      },
    }))
    vi.spyOn(engine, 'checkPackage').mockResolvedValue(safeResult('2.0.0'))
    const report = await engine.ciScan({ dir, lockfile: true })
    expect(report.failed).toBe(true)
    expect(report.packages[0].error).toContain('Requested a@1.0.0 but checked 2.0.0')
  })

  it('fails an incomplete requested deep scan even with the least restrictive failLevel', async () => {
    vi.spyOn(engine, 'checkPackage').mockResolvedValue(safeResult())
    const report = await engine.ciScan({ dir, deep: true, failLevel: SecurityLevel.Unknown })
    expect(report.failed).toBe(true)
    expect(report.summary.deepIncomplete).toBe(1)
  })

  it('blocks enabled LLM critical evidence even when the reported level would pass', async () => {
    const result = safeResult()
    vi.spyOn(engine, 'checkPackage').mockResolvedValue({
      ...result, security: {
        ...result.security,
        llmScan: { enabled: true, findings: [{
          ruleId: 'llm-critical', ruleName: 'Critical', severity: Severity.Critical,
          message: 'Critical evidence', category: FindingCategory.CodeObfuscation,
        }] },
      },
    })
    const report = await engine.ciScan({ dir, failLevel: SecurityLevel.Unknown })
    expect(report.failed).toBe(true)
    expect(report.packages[0].findingCount).toBe(1)
  })

  it('rejects an invalid failure level even for an empty dependency list', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }))
    await expect(engine.ciScan({ dir, failLevel: 'invalid' as SecurityLevel }))
      .rejects.toThrow('Unknown CI failure level')
  })
})

function safeResult(version = '1.0.0'): Awaited<ReturnType<NpmSafeEngine['checkPackage']>> {
  return {
    packageName: 'a', exists: true, latestVersion: version, cachedAt: null,
    registryInfo: null,
    security: { overallLevel: SecurityLevel.Safe, overallScore: 100, staticScan: null },
  }
}
