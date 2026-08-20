/**
 * T12 — Plugin tool-level tests (network-free, engine stubbed).
 *
 * The plugin's `apply()` constructs `new NpmSafeEngine()` internally with no
 * injection seam, so we mock the `@npm-safe/core` module entirely.  No real
 * engine, no better-sqlite3, no network, no DEEPSEEK_API_KEY.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @npm-safe/core — hoisted so vi.mock can reference it.
// ---------------------------------------------------------------------------
const mock = vi.hoisted(() => {
  const instances: any[] = []

  /** Canned CheckResult-shaped object shared across tests. */
  const cannedCheckResult = {
    packageName: 'lodash',
    exists: true,
    latestVersion: '4.17.21',
    security: {
      overallLevel: 'safe',
      overallScore: 90,
      staticScan: {
        packageName: 'lodash',
        version: '4.17.21',
        overallLevel: 'safe',
        score: 90,
        findings: [
          {
            ruleId: 'r',
            ruleName: 'R',
            severity: 'high',
            message: 'm',
            category: 'install-script',
          },
        ],
        scannedAt: '2026-01-01T00:00:00.000Z',
      },
      llmScan: undefined,
    },
    registryInfo: { description: 'x', homepage: '', repository: '' },
    cachedAt: null,
  }

  class FakeNpmSafeEngine {
    checkPackage = vi.fn(async () => ({ ...cannedCheckResult }))
    checkPackages = vi.fn(async (names: readonly string[]) => [
      { name: names[0], ok: true, result: { ...cannedCheckResult } },
      { name: names[1], ok: false, error: 'boom' },
    ])
    searchPackages = vi.fn(async () => [
      {
        package: { name: 'lodash', version: '4.17.21', description: 'x' },
        score: { final: 1 },
      },
    ])
    addToWatchlist = vi.fn(async () => undefined)
    removeFromWatchlist = vi.fn(async () => undefined)
    getWatchlist = vi.fn(async () => ['lodash'])
    listRules = vi.fn(() => [
      {
        id: 'no-install-script',
        name: 'X',
        description: '',
        severity: 'high',
        category: 'install-script',
        enabled: true,
        source: 'builtin',
      },
    ])
    setRuleEnabled = vi.fn()
    setRuleSeverity = vi.fn()
    getSetting = vi.fn(async () => null)
    setSetting = vi.fn(async () => undefined)
    ciScan = vi.fn(async () => ({
      dir: '/x',
      scannedAt: '2026-01-01T00:00:00.000Z',
      dependencyCount: 1,
      failLevel: 'dangerous',
      failed: false,
      summary: { safe: 0, suspicious: 0, dangerous: 0, unknown: 0, errors: 0 },
      packages: [],
    }))
    refreshAll = vi.fn(async () => true)
    close = vi.fn()

    constructor() {
      instances.push(this)
    }
  }

  return { FakeNpmSafeEngine, instances }
})

vi.mock('@npm-safe/core', () => ({
  NpmSafeEngine: mock.FakeNpmSafeEngine,
}))

// Import the plugin AFTER the mock is registered.
import { apply } from '../src/index.js'

// ---------------------------------------------------------------------------
// Stub Cordis-style context
// ---------------------------------------------------------------------------
function createStubContext() {
  const capturedTools: any[] = []
  const capturedJobSpecs: any[] = []

  const ctx: any = {
    tools: {
      register(def: any) {
        capturedTools.push(def)
        return () => {}
      },
    },
    jobs: {
      start(spec: any) {
        capturedJobSpecs.push(spec)
        return 'npm-safe-1'
      },
    },
    effect(fn: () => () => void) {
      const cleanup = fn()
      return () => cleanup()
    },
  }

  return { ctx, capturedTools, capturedJobSpecs }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('tool-npm-safe plugin', () => {
  let capturedTools: any[]
  let capturedJobSpecs: any[]
  let engine: any

  beforeEach(() => {
    mock.instances.length = 0
    const stub = createStubContext()
    apply(stub.ctx)
    capturedTools = stub.capturedTools
    capturedJobSpecs = stub.capturedJobSpecs
    engine = mock.instances[0]
  })

  // (a) apply registers exactly 14 tools with all required fields
  it('registers exactly 14 tools, each with name/description/parameters/output.schema/output.render/execute', () => {
    expect(capturedTools).toHaveLength(14)
    for (const def of capturedTools) {
      expect(typeof def.name).toBe('string')
      expect(typeof def.description).toBe('string')
      expect(def.parameters).toBeDefined()
      expect(def.output).toBeDefined()
      expect(def.output.schema).toBeDefined()
      expect(typeof def.output.render).toBe('function')
      expect(typeof def.execute).toBe('function')
    }
  })

  // (b) check_package happy path
  it('check_package maps the canned CheckResult to {package, version, level, score, findingCount}', async () => {
    const tool = capturedTools.find((t) => t.name === 'check_package')
    const signal = new AbortController().signal
    const result = await tool.execute(
      { name: 'lodash', forceRefresh: true },
      { signal } as any,
    )
    expect(result).toEqual({
      package: 'lodash',
      version: '4.17.21',
      level: 'safe',
      score: 90,
      findingCount: 1,
    })
    expect(engine.checkPackage).toHaveBeenCalledWith('lodash', {
      forceRefresh: true,
      signal,
    })
  })

  // (c) check_package render
  it('check_package output.render returns a text block containing level and score', () => {
    const tool = capturedTools.find((t) => t.name === 'check_package')
    const blocks = tool.output.render(
      {},
      { package: 'lodash', version: '4.17.21', level: 'safe', score: 90, findingCount: 1 },
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toContain('safe')
    expect(blocks[0].text).toContain('90')
  })

  // (d) check_packages batch formatting
  it('check_packages returns a string with a summary line for ok and an ERROR line for failure', async () => {
    const tool = capturedTools.find((t) => t.name === 'check_packages')
    const signal = new AbortController().signal
    const result = await tool.execute(
      { names: ['a', 'b'] },
      { signal } as any,
    )
    expect(typeof result).toBe('string')
    // ok entry: "a: safe (90/100, 1 findings)"
    expect(result).toContain('a: safe')
    expect(result).toContain('90/100')
    // failing entry: "b: ERROR boom"
    expect(result).toContain('b: ERROR boom')
  })

  // (e) refresh_all background job
  it('refresh_all starts a background job via ctx.jobs.start and the run hook completes', async () => {
    const tool = capturedTools.find((t) => t.name === 'refresh_all')
    const agent = { id: 'agent-1' }
    const execResult = await tool.execute({}, { agent } as any)
    expect(execResult).toEqual({ kind: 'background', jobId: 'npm-safe-1' })

    // ctx.jobs.start was called with the expected spec shape
    expect(capturedJobSpecs).toHaveLength(1)
    const spec = capturedJobSpecs[0]
    expect(spec.kind).toBe('npm-safe')
    expect(spec.label).toBe('Refresh all watched packages')
    expect(spec.owner).toBe(agent)
    expect(typeof spec.run).toBe('function')

    // Invoke the captured run() and await its done promise
    const hooks = spec.run()
    expect(typeof hooks.cancel).toBe('function')
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(engine.refreshAll).toHaveBeenCalled()
  })

  // (f) settings_get renders null as unset
  it('settings_get renders a null setting value as (unset)', async () => {
    const tool = capturedTools.find((t) => t.name === 'settings_get')
    const result = await tool.execute({ key: 'k' })
    expect(result).toBe('k=(unset)')
  })

  // (g) ci_scan formats the CI report and forwards options
  it('ci_scan returns a formatCiReport string starting with dir: and forwards options to the engine', async () => {
    const tool = capturedTools.find((t) => t.name === 'ci_scan')
    const signal = new AbortController().signal
    const result = await tool.execute(
      { failLevel: 'dangerous' },
      { signal } as any,
    )
    expect(typeof result).toBe('string')
    expect(result.startsWith('dir:')).toBe(true)
    expect(engine.ciScan).toHaveBeenCalledWith({
      failLevel: 'dangerous',
      lockfile: false,
      prod: false,
      signal,
    })
  })
})
