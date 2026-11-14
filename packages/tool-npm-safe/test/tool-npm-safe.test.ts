/**
 * T12 — Plugin tool-level tests (network-free, engine stubbed).
 *
 * The plugin's `apply()` constructs `new NpmSafeEngine()` internally with no
 * injection seam, so we mock the `@npm-safe/core` module entirely.  No real
 * engine, no better-sqlite3, no network, no DEEPSEEK_API_KEY.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

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
        contentScan: {
          status: 'complete',
          archiveBytes: 123,
          unpackedBytes: 456,
          filesScanned: 7,
          filesSkipped: 1,
          integrityVerified: true,
          truncated: false,
        },
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

vi.mock('@npm-safe/core-dsh', () => ({
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
  const capturedCleanups: Array<() => void> = []
  const capturedListeners: Array<{ event: string; listener: (...args: any[]) => any }> = []
  const workingDirectory = {
    ensure: vi.fn(async () => '/workspace'),
  }

  const ctx: any = {
    tools: {
      register(def: any) {
        capturedTools.push(def)
        return () => {}
      },
    },
    workingDirectory,
    jobs: {
      start(spec: any) {
        capturedJobSpecs.push(spec)
        return 'npm-safe-1'
      },
    },
    effect(fn: () => () => void) {
      const cleanup = fn()
      capturedCleanups.push(cleanup)
      return () => cleanup()
    },
    on(event: string, listener: (...args: any[]) => any) {
      capturedListeners.push({ event, listener })
      return () => {}
    },
  }

  return { ctx, capturedTools, capturedJobSpecs, capturedCleanups, capturedListeners, workingDirectory }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('tool-npm-safe plugin', () => {
  let capturedTools: any[]
  let capturedJobSpecs: any[]
  let engine: any
  let capturedCleanups: Array<() => void>
  let capturedListeners: Array<{ event: string; listener: (...args: any[]) => any }>
  let workingDirectory: { ensure: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mock.instances.length = 0
    const stub = createStubContext()
    apply(stub.ctx)
    capturedTools = stub.capturedTools
    capturedJobSpecs = stub.capturedJobSpecs
    capturedCleanups = stub.capturedCleanups
    capturedListeners = stub.capturedListeners
    workingDirectory = stub.workingDirectory
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
      { name: 'lodash', version: '4.17.21', forceRefresh: true, deep: true },
      { signal } as any,
    )
    expect(result).toEqual({
      package: 'lodash',
      version: '4.17.21',
      level: 'safe',
      score: 90,
      findingCount: 1,
      deepScanStatus: 'complete',
      filesScanned: 7,
      integrityVerified: true,
      findings: [
        {
          ruleId: 'r',
          ruleName: 'R',
          severity: 'high',
          category: 'install-script',
          message: 'm',
        },
      ],
      findingsTruncated: false,
    })
    expect(engine.checkPackage).toHaveBeenCalledWith('lodash', {
      version: '4.17.21',
      forceRefresh: true,
      deep: true,
      signal,
    })
    expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
    const blocks = tool.output.render({}, result)
    expect(blocks[0].text).toContain('[high/install-script] R: m')
  })

  it('exposes version selection in the tool schema', () => {
    const tool = capturedTools.find((t) => t.name === 'check_package')
    expect(tool.parameters.properties.version.type).toBe('string')
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
      { names: ['a', 'b'], deep: true },
      { signal } as any,
    )
    expect(typeof result).toBe('string')
    // ok entry: "a: safe (90/100, 1 findings)"
    expect(result).toContain('a: safe')
    expect(result).toContain('90/100')
    // failing entry: "b: ERROR boom"
    expect(result).toContain('b: ERROR boom')
    expect(engine.checkPackages).toHaveBeenCalledWith(['a', 'b'], {
      concurrency: undefined,
      deep: true,
      signal,
    })
  })

  // (e) refresh_all background job
  it('refresh_all starts a background job via ctx.jobs.start and the run hook completes', async () => {
    const tool = capturedTools.find((t) => t.name === 'refresh_all')
    const agent = { id: 'agent-1' }
    const execResult = await tool.execute({}, { agent } as any)
    expect(execResult).toEqual({ kind: 'background', jobId: 'npm-safe-1' })
    expect(validateJsonSchemaValue(tool.output.schema, execResult)).toEqual([])

    // ctx.jobs.start was called with the expected spec shape
    expect(capturedJobSpecs).toHaveLength(1)
    const spec = capturedJobSpecs[0]
    expect(spec.kind).toBe('npm-safe')
    expect(spec.label).toBe('Refresh all watched packages')
    expect(spec.owner).toBe(agent.id)
    expect(typeof spec.run).toBe('function')

    // Invoke the captured run() and await its done promise
    const hooks = spec.run()
    expect(typeof hooks.cancel).toBe('function')
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(engine.refreshAll).toHaveBeenCalled()
  })

  it('refresh_all propagates background job cancellation to the shared engine signal', async () => {
    engine.refreshAll.mockImplementation(({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        reject(new DOMException('Cancelled', 'AbortError'))
      }, { once: true })),
    )
    const tool = capturedTools.find((t) => t.name === 'refresh_all')
    await tool.execute({}, { agent: { id: 'agent' } })
    const hooks = capturedJobSpecs[0].run()
    hooks.cancel('user cancelled')
    expect(await hooks.done).toEqual({ status: 'killed', detail: 'Cancelled' })
    expect(engine.refreshAll.mock.calls[0][0].signal.aborted).toBe(true)
  })

  it('closes the shared engine when Cordis unloads the plugin', () => {
    for (const cleanup of capturedCleanups) cleanup()
    expect(engine.close).toHaveBeenCalledOnce()
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
      { failLevel: 'dangerous', deep: true },
      { signal } as any,
    )
    expect(typeof result).toBe('string')
    expect(result.startsWith('dir:')).toBe(true)
    expect(engine.ciScan).toHaveBeenCalledWith({
      failLevel: 'dangerous',
      lockfile: false,
      prod: false,
      deep: true,
      signal,
    })
  })

  it('ci_scan scans the agent working directory and lists failed package evidence', async () => {
    engine.ciScan.mockResolvedValueOnce({
      dir: '/workspace',
      scannedAt: '2026-01-01T00:00:00.000Z',
      dependencyCount: 1,
      failLevel: 'dangerous',
      failed: true,
      summary: { safe: 0, suspicious: 0, dangerous: 1, unknown: 0, errors: 0, deepIncomplete: 0 },
      packages: [
        {
          name: 'bad-pkg',
          exists: true,
          version: '1.0.0',
          level: 'dangerous',
          score: 12,
          findingCount: 1,
          failed: true,
          findings: [
            {
              ruleId: 'install-script',
              ruleName: 'Install script',
              severity: 'high',
              category: 'install-script',
              message: 'runs curl at install time',
              filePath: 'package.json',
            },
          ],
        },
      ],
    })
    const tool = capturedTools.find((t) => t.name === 'ci_scan')
    const agent = { id: 'agent-1' }
    const signal = new AbortController().signal
    const result = await tool.execute({ failLevel: 'dangerous' }, { agent, signal } as any)

    expect(workingDirectory.ensure).toHaveBeenCalledWith(agent, signal)
    expect(engine.ciScan).toHaveBeenCalledWith(expect.objectContaining({ dir: '/workspace' }))
    expect(result).toContain('failed packages:')
    expect(result).toContain('bad-pkg@1.0.0')
    expect(result).toContain('Install script')
    expect(result).toContain('package.json')
    expect(result).not.toContain('report output limit reached')
  })

  // (h) package-controlled text must not bypass the output budget
  describe('output text bounds', () => {
    const hugeText = 'https://example.invalid/' + 'x'.repeat(1_000_000)
    const hugeName = 'n'.repeat(1_000_000)
    const hugeVersion = `9.${'9'.repeat(1_000_000)}`

    it('ci_scan bounds a large report while preserving totals and complete package evidence', async () => {
      const findings = Array.from({ length: 3 }, (_, index) => ({
        ruleId: `rule-${index}`,
        ruleName: `Install rule ${index}`,
        severity: 'high',
        category: 'install-script',
        message: 'Install-script evidence. '.repeat(12),
        filePath: 'package.json',
      }))
      const packages = Array.from({ length: 1000 }, (_, index) => ({
        name: `package-${index}`,
        exists: true,
        version: '1.0.0',
        level: 'dangerous',
        score: 0,
        findingCount: findings.length,
        failed: true,
        findings,
      }))
      engine.ciScan.mockResolvedValueOnce({
        dir: '/workspace',
        scannedAt: '2026-01-01T00:00:00.000Z',
        dependencyCount: packages.length,
        failLevel: 'dangerous',
        failed: true,
        summary: { safe: 0, suspicious: 0, dangerous: 1000, unknown: 0, errors: 0, deepIncomplete: 0 },
        packages,
      })
      const tool = capturedTools.find((t) => t.name === 'ci_scan')
      const result = await tool.execute(
        { lockfile: true },
        { agent: { id: 'agent-1' }, signal: new AbortController().signal } as any,
      )
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
      expect(result.length).toBeLessThanOrEqual(20_000)
      expect(result).toContain('dependencies: 1000')
      expect(result).toContain('dangerous: 1000')
      expect(result).toContain('failed: true')
      const shown = (result.match(/^- package-\d+@1\.0\.0:/gm) ?? []).length
      const omitted = result.match(/\(\+(\d+) failed packages not shown; report output limit reached\)$/)
      expect(shown).toBeGreaterThan(0)
      expect(omitted).not.toBeNull()
      expect(shown + Number(omitted![1])).toBe(packages.length)
      expect((result.match(/\[high\/install-script\]/g) ?? []).length).toBe(shown * 3)
    })
    const hugeFinding = () => ({
      ruleId: 'registry-mismatch',
      ruleName: 'Registry mismatch',
      severity: 'high',
      category: 'registry-mismatch',
      message: `publishConfig.registry is set to a non-standard registry: ${hugeText}`,
      filePath: `dist/${'p'.repeat(60_000)}/package.json`,
      lineNumber: 1,
      codeSnippet: hugeText,
      recommendation: hugeText,
    })
    const hugeCheckResult = () => ({
      packageName: 'evil',
      exists: true,
      latestVersion: '1.0.0',
      security: {
        overallLevel: 'dangerous',
        overallScore: 0,
        staticScan: {
          packageName: 'evil',
          version: '1.0.0',
          overallLevel: 'dangerous',
          score: 0,
          findings: [hugeFinding()],
          contentScan: {
            status: 'complete',
            archiveBytes: 1,
            unpackedBytes: 1,
            filesScanned: 1,
            filesSkipped: 0,
            integrityVerified: true,
            truncated: false,
          },
          scannedAt: '2026-01-01T00:00:00.000Z',
        },
        llmScan: undefined,
      },
      registryInfo: { description: '', homepage: '', repository: '' },
      cachedAt: null,
    })

    it('check_package clamps message, recommendation, path and snippet in schema and render', async () => {
      engine.checkPackage.mockResolvedValueOnce(hugeCheckResult())
      const tool = capturedTools.find((t) => t.name === 'check_package')
      const result = await tool.execute(
        { name: 'evil' },
        { signal: new AbortController().signal } as any,
      )
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
      const [finding] = result.findings
      expect(finding.message.length).toBeLessThanOrEqual(303)
      expect(finding.message.endsWith('...')).toBe(true)
      expect(finding.recommendation.length).toBeLessThanOrEqual(303)
      expect(finding.filePath.length).toBeLessThanOrEqual(203)
      expect(finding.codeSnippet.length).toBeLessThanOrEqual(163)
      const text = tool.output.render({}, result)[0].text
      expect(text.length).toBeLessThan(1500)
      expect(text).not.toContain('x'.repeat(1000))
    })

    it('check_packages clamps finding text and error text', async () => {
      engine.checkPackages.mockResolvedValueOnce([
        { name: 'evil', ok: true, result: hugeCheckResult() },
        { name: 'dead', ok: false, error: hugeText },
      ])
      const tool = capturedTools.find((t) => t.name === 'check_packages')
      const result = await tool.execute(
        { names: ['evil', 'dead'] },
        { signal: new AbortController().signal } as any,
      )
      expect(result.length).toBeLessThan(1500)
      expect(result).not.toContain('x'.repeat(1000))
      expect(result).not.toContain('p'.repeat(1000))
    })

    it('ci_scan clamps finding text and package error text', async () => {
      engine.ciScan.mockResolvedValueOnce({
        dir: '/workspace',
        scannedAt: '2026-01-01T00:00:00.000Z',
        dependencyCount: 1,
        failLevel: 'dangerous',
        failed: true,
        summary: { safe: 0, suspicious: 0, dangerous: 1, unknown: 0, errors: 1, deepIncomplete: 0 },
        packages: [
          {
            name: 'evil',
            exists: true,
            version: '1.0.0',
            level: 'dangerous',
            score: 0,
            findingCount: 1,
            failed: true,
            findings: [hugeFinding()],
            error: hugeText,
          },
        ],
      })
      const tool = capturedTools.find((t) => t.name === 'ci_scan')
      const result = await tool.execute(
        { failLevel: 'dangerous' },
        { agent: { id: 'agent-1' }, signal: new AbortController().signal } as any,
      )
      expect(result.length).toBeLessThan(2000)
      expect(result).not.toContain('x'.repeat(1000))
      expect(result).not.toContain('p'.repeat(1000))
    })

    it('check_package clamps the echoed package name and version', async () => {
      engine.checkPackage.mockResolvedValueOnce({
        ...hugeCheckResult(),
        packageName: hugeName,
        latestVersion: hugeVersion,
      })
      const tool = capturedTools.find((t) => t.name === 'check_package')
      const result = await tool.execute(
        { name: 'evil' },
        { signal: new AbortController().signal } as any,
      )
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
      expect(result.package.length).toBeLessThanOrEqual(217)
      expect(result.version.length).toBeLessThanOrEqual(103)
      const text = tool.output.render({}, result)[0].text
      expect(text.length).toBeLessThan(1500)
      expect(text).not.toContain('n'.repeat(1000))
      expect(text).not.toContain('9'.repeat(1000))
    })

    it('check_packages clamps a package name echoed into the report', async () => {
      engine.checkPackages.mockResolvedValueOnce([
        { name: hugeName, ok: true, result: hugeCheckResult() },
      ])
      const tool = capturedTools.find((t) => t.name === 'check_packages')
      const result = await tool.execute(
        { names: ['evil'] },
        { signal: new AbortController().signal } as any,
      )
      expect(result.length).toBeLessThan(1500)
      expect(result).not.toContain('n'.repeat(1000))
    })

    it('ci_scan clamps the package name and version listed in the report', async () => {
      engine.ciScan.mockResolvedValueOnce({
        dir: '/workspace',
        scannedAt: '2026-01-01T00:00:00.000Z',
        dependencyCount: 1,
        failLevel: 'dangerous',
        failed: true,
        summary: { safe: 0, suspicious: 0, dangerous: 1, unknown: 0, errors: 0, deepIncomplete: 0 },
        packages: [
          {
            name: hugeName,
            exists: true,
            version: hugeVersion,
            level: 'dangerous',
            score: 0,
            findingCount: 0,
            failed: true,
          },
        ],
      })
      const tool = capturedTools.find((t) => t.name === 'ci_scan')
      const result = await tool.execute(
        { failLevel: 'dangerous' },
        { agent: { id: 'agent-1' }, signal: new AbortController().signal } as any,
      )
      expect(result.length).toBeLessThan(1500)
      expect(result).not.toContain('n'.repeat(1000))
      expect(result).not.toContain('9'.repeat(1000))
    })

    it('search_packages clamps name, version and description from registry metadata', async () => {
      engine.searchPackages.mockResolvedValueOnce([
        {
          package: { name: hugeName, version: hugeVersion, description: hugeText },
          score: { final: 1 },
        },
      ])
      const tool = capturedTools.find((t) => t.name === 'search_packages')
      const result = await tool.execute(
        { query: 'evil', limit: 1 },
        { signal: new AbortController().signal } as any,
      )
      expect(result.length).toBeLessThan(1500)
      expect(result).not.toContain('n'.repeat(1000))
      expect(result).not.toContain('x'.repeat(1000))
    })
  })

  describe('source review evidence', () => {
    const sourceFinding = {
      ruleId: 'source-review-critical',
      ruleName: 'Source review',
      severity: 'critical',
      category: 'known-malicious',
      message: 'Source review flagged credential exfiltration.',
    }
    const sourceReviewedResult = () => ({
      packageName: 'evil',
      exists: true,
      latestVersion: '1.0.0',
      security: {
        overallLevel: 'dangerous',
        overallScore: 0,
        staticScan: null,
        sourceReview: {
          enabled: true,
          status: 'complete',
          verdict: 'malicious',
          findings: [sourceFinding],
        },
      },
      registryInfo: { description: '', homepage: '', repository: '' },
      cachedAt: null,
    })

    it('check_package surfaces critical source review findings', async () => {
      engine.checkPackage.mockResolvedValueOnce(sourceReviewedResult())
      const tool = capturedTools.find((t) => t.name === 'check_package')
      const result = await tool.execute(
        { name: 'evil' },
        { signal: new AbortController().signal } as any,
      )
      expect(validateJsonSchemaValue(tool.output.schema, result)).toEqual([])
      expect(result.findingCount).toBe(1)
      expect(result.findings[0]).toMatchObject({
        ruleId: 'source-review-critical',
        severity: 'critical',
        category: 'known-malicious',
      })
      expect(tool.output.render({}, result)[0].text).toContain('Source review')
    })

    it('check_packages surfaces source review findings in batch output', async () => {
      engine.checkPackages.mockResolvedValueOnce([
        { name: 'evil', ok: true, result: sourceReviewedResult() },
      ])
      const tool = capturedTools.find((t) => t.name === 'check_packages')
      const result = await tool.execute(
        { names: ['evil'] },
        { signal: new AbortController().signal } as any,
      )
      expect(result).toContain('Source review')
      expect(result).toContain('1 findings')
    })
  })

  describe('security hardening', () => {
    it('registers a tools/pre-execute approval gate for mutating tools', async () => {
      const gate = capturedListeners.find((l) => l.event === 'tools/pre-execute')
      expect(gate).toBeDefined()
      const next = vi.fn(async () => ({ kind: 'allow' as const }))
      const decision = await gate!.listener({ name: 'rule_disable' } as any, next)
      expect(decision).toEqual({
        kind: 'ask',
        reason: expect.stringContaining('rule_disable'),
      })
      expect(next).not.toHaveBeenCalled()
    })

    it('approval gate passes read-only tools through to next()', async () => {
      const gate = capturedListeners.find((l) => l.event === 'tools/pre-execute')
      const next = vi.fn(async () => ({ kind: 'allow' as const }))
      const decision = await gate!.listener({ name: 'check_package' } as any, next)
      expect(decision).toEqual({ kind: 'allow' })
      expect(next).toHaveBeenCalledOnce()
    })

    it('check_packages rejects batches exceeding the size limit', async () => {
      const tool = capturedTools.find((t) => t.name === 'check_packages')
      const names = Array.from({ length: 51 }, (_, i) => `pkg-${i}`)
      await expect(
        tool.execute({ names }, { signal: new AbortController().signal } as any),
      ).rejects.toThrow('Too many packages')
      expect(engine.checkPackages).not.toHaveBeenCalled()
    })

    it('check_packages rejects an empty batch', async () => {
      const tool = capturedTools.find((t) => t.name === 'check_packages')
      await expect(
        tool.execute({ names: [] }, { signal: new AbortController().signal } as any),
      ).rejects.toThrow('at least one')
    })

    it('check_packages clamps concurrency to the allowed range', async () => {
      engine.checkPackages.mockResolvedValueOnce([
        { name: 'a', ok: true, result: { exists: true, security: { overallLevel: 'safe', overallScore: 90, staticScan: { findings: [] } } } },
      ])
      const tool = capturedTools.find((t) => t.name === 'check_packages')
      await tool.execute(
        { names: ['a'], concurrency: 999 },
        { signal: new AbortController().signal } as any,
      )
      expect(engine.checkPackages).toHaveBeenCalledWith(['a'], expect.objectContaining({ concurrency: 10 }))
    })

    it('search_packages clamps limit to the allowed range', async () => {
      const tool = capturedTools.find((t) => t.name === 'search_packages')
      await tool.execute(
        { query: 'test', limit: 999 },
        { signal: new AbortController().signal } as any,
      )
      expect(engine.searchPackages).toHaveBeenCalledWith('test', expect.objectContaining({ size: 50 }))
    })

    it('settings_set rejects keys with invalid characters', async () => {
      const tool = capturedTools.find((t) => t.name === 'settings_set')
      await expect(tool.execute({ key: '../etc/passwd', value: 'x' })).rejects.toThrow('Invalid setting key')
      expect(engine.setSetting).not.toHaveBeenCalled()
    })

    it('settings_set rejects values exceeding the length limit', async () => {
      const tool = capturedTools.find((t) => t.name === 'settings_set')
      await expect(
        tool.execute({ key: 'validKey', value: 'x'.repeat(1001) }),
      ).rejects.toThrow('too long')
      expect(engine.setSetting).not.toHaveBeenCalled()
    })

    it('settings_get rejects invalid keys', async () => {
      const tool = capturedTools.find((t) => t.name === 'settings_get')
      await expect(tool.execute({ key: 'bad key!' })).rejects.toThrow('Invalid setting key')
    })

    it('watch_add clips the echoed package name', async () => {
      const tool = capturedTools.find((t) => t.name === 'watch_add')
      const result = await tool.execute({ name: 'n'.repeat(500) })
      expect(result.length).toBeLessThanOrEqual(230)
      expect(result).not.toContain('n'.repeat(300))
    })
  })
})
