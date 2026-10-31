import { NpmSafeEngine } from '@npm-safe/core-dsh'
import type { CiReport, RuleDescriptor, ScanFinding, SecurityLevel, Severity } from '@npm-safe/core-dsh'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JobKind, JobOutcome } from '@deepseek-ai/dsh-jobs'
// Loads the Context augmentation for ctx.workingDirectory.
import type {} from '@deepseek-ai/dsh-working-directory'

export const name = 'tool-npm-safe'
export const inject = ['tools', 'jobs', 'workingDirectory']

const MAX_FINDINGS = 10
const MAX_BATCH_FINDINGS = 3
const MAX_SNIPPET = 160

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

interface FindingLike {
  readonly ruleId: string
  readonly ruleName: string
  readonly severity: string
  readonly category: string
  readonly message: string
  readonly filePath?: string
  readonly lineNumber?: number
  readonly codeSnippet?: string
  readonly recommendation?: string
}

type OutputSeverity = 'low' | 'medium' | 'high' | 'critical'
type OutputCategory =
  | 'install-script'
  | 'code-obfuscation'
  | 'binary-download'
  | 'sensitive-exposure'
  | 'typosquatting'
  | 'suspicious-dependency'
  | 'homograph-attack'
  | 'registry-mismatch'
  | 'known-malicious'
  | 'informational'

function rankedFindings<T extends FindingLike>(findings: readonly T[]): T[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  )
}

function clipSnippet(text: string): string {
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET)}...` : text
}

function formatFinding(finding: FindingLike): string {
  const location = finding.filePath
    ? ` (${finding.filePath}${finding.lineNumber ? `:${finding.lineNumber}` : ''})`
    : finding.lineNumber
      ? ` (line ${finding.lineNumber})`
      : ''
  return `- [${finding.severity}/${finding.category}] ${finding.ruleName}: ${finding.message}${location}`
}

function toOutputFinding(finding: ScanFinding) {
  return {
    ruleId: finding.ruleId,
    ruleName: finding.ruleName,
    severity: finding.severity as OutputSeverity,
    category: finding.category as OutputCategory,
    message: finding.message,
    ...(finding.filePath ? { filePath: finding.filePath } : {}),
    ...(finding.lineNumber ? { lineNumber: finding.lineNumber } : {}),
    ...(finding.codeSnippet ? { codeSnippet: clipSnippet(finding.codeSnippet) } : {}),
    ...(finding.recommendation ? { recommendation: finding.recommendation } : {}),
  }
}

function formatBatch(
  results: ReadonlyArray<{
    readonly name: string
    readonly ok: boolean
    readonly error?: string
    readonly result?: {
      readonly exists: boolean
      readonly security: {
        readonly overallLevel: string
        readonly overallScore: number
        readonly staticScan: { readonly findings: readonly ScanFinding[] } | null
        readonly llmScan?: {
          readonly enabled: boolean
          readonly findings?: readonly ScanFinding[]
        }
      }
    }
  }>,
): string {
  return results
    .map((r) => {
      if (!(r.ok && r.result)) return `${r.name}: ERROR ${r.error ?? 'unknown error'}`
      const findings = [
        ...(r.result.security.staticScan?.findings ?? []),
        ...(r.result.security.llmScan?.enabled ? r.result.security.llmScan.findings ?? [] : []),
      ]
      const shown = rankedFindings(findings).slice(0, MAX_BATCH_FINDINGS)
      const lines = [
        `${r.name}: ${r.result.security.overallLevel} ` +
          `(${r.result.security.overallScore}/100, ${findings.length} findings)`,
        ...shown.map((finding) => `  ${formatFinding(finding)}`),
      ]
      if (findings.length > shown.length) {
        lines.push(`  (+${findings.length - shown.length} more)`)
      }
      return lines.join('\n')
    })
    .join('\n')
}

function formatRules(rules: readonly RuleDescriptor[]): string {
  return rules
    .map((r) => `${r.id} [${r.enabled ? 'enabled' : 'disabled'}] ${r.severity}: ${r.name}`)
    .join('\n')
}

function formatCiReport(report: CiReport): string {
  const parts = [
    `dir: ${report.dir}`,
    `dependencies: ${report.dependencyCount}`,
    `fail level: ${report.failLevel}`,
    `failed: ${report.failed}`,
  ]
  for (const [level, count] of Object.entries(report.summary)) {
    parts.push(`${level}: ${count}`)
  }
  const failedPackages = report.packages.filter((pkg) => pkg.failed || pkg.error)
  if (failedPackages.length > 0) {
    parts.push('failed packages:')
    for (const pkg of failedPackages) {
      const findings = pkg.findings ?? []
      const shown = rankedFindings(findings).slice(0, MAX_BATCH_FINDINGS)
      parts.push(
        `- ${pkg.name}@${pkg.version}: ${pkg.level} ` +
          `(${pkg.score}/100, ${pkg.findingCount} findings)` +
          (pkg.deepScanStatus ? `; deep scan ${pkg.deepScanStatus}` : '') +
          (pkg.error ? `; ${pkg.error}` : ''),
      )
      for (const finding of shown) {
        parts.push(`  ${formatFinding(finding)}`)
      }
      if (findings.length > shown.length) {
        parts.push(`  (+${findings.length - shown.length} more)`)
      }
    }
  }
  return parts.join('\n')
}

export function apply(ctx: Context) {
  // 引擎实例在插件挂载时创建，卸载时关闭（释放 SQLite 连接与调度定时器）。
  const engine = new NpmSafeEngine()
  ctx.effect(() => () => {
    engine.close()
  })

  // 1. check_package：前台工具，转发 exec.signal。
  ctx.tools.register(defineTool({
    name: 'check_package',
    description: 'Check an npm package for supply-chain security risks.',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name' },
      version: { type: 'string', description: 'Exact version, dist-tag or semver range (defaults to latest)' },
      forceRefresh: { type: 'boolean', description: 'Ignore cache and re-fetch' },
      deep: { type: 'boolean', description: 'Download and inspect the published tarball' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          package: { type: 'string', required: true },
          version: { type: 'string', required: true },
          level: {
            type: 'string',
            required: true,
            enum: ['safe', 'suspicious', 'dangerous', 'unknown'],
          },
          score: { type: 'integer', required: true },
          findingCount: { type: 'integer', required: true },
          deepScanStatus: {
            type: 'string',
            enum: ['complete', 'partial', 'failed'],
          },
          filesScanned: { type: 'integer' },
          integrityVerified: { type: 'boolean' },
          findings: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ruleId: { type: 'string', required: true },
                ruleName: { type: 'string', required: true },
                severity: {
                  type: 'string',
                  required: true,
                  enum: ['low', 'medium', 'high', 'critical'],
                },
                category: {
                  type: 'string',
                  required: true,
                  enum: [
                    'install-script',
                    'code-obfuscation',
                    'binary-download',
                    'sensitive-exposure',
                    'typosquatting',
                    'suspicious-dependency',
                    'homograph-attack',
                    'registry-mismatch',
                    'known-malicious',
                    'informational',
                  ],
                },
                message: { type: 'string', required: true },
                filePath: { type: 'string' },
                lineNumber: { type: 'integer' },
                codeSnippet: {
                  type: 'string',
                  description: 'Truncated excerpt that triggered the finding',
                },
                recommendation: { type: 'string' },
              },
            },
          },
          findingsTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const findings = value.findings ?? []
        const lines = [
          `${value.package}@${value.version}: ${value.level} ` +
            `(${value.score}/100, ${value.findingCount} findings)` +
            (value.deepScanStatus
              ? `; deep scan ${value.deepScanStatus}, ${value.filesScanned ?? 0} files, integrity ${value.integrityVerified ? 'verified' : 'unverified'}`
              : ''),
        ]
        for (const finding of findings) {
          lines.push(formatFinding(finding))
          if (finding.codeSnippet) {
            lines.push(`    ${finding.codeSnippet.replace(/\s+/g, ' ')}`)
          }
        }
        if (value.findingsTruncated) {
          lines.push(`(+${value.findingCount - findings.length} more findings not shown)`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const result = await engine.checkPackage(args.name, {
        version: args.version,
        forceRefresh: args.forceRefresh ?? false,
        deep: args.deep ?? false,
        signal: exec.signal,
      })
      const contentScan = result.security.staticScan?.contentScan
      const findings = [
        ...(result.security.staticScan?.findings ?? []),
        ...(result.security.llmScan?.enabled ? result.security.llmScan.findings ?? [] : []),
      ]
      const shown = rankedFindings(findings).slice(0, MAX_FINDINGS)
      return {
        package: result.packageName,
        version: result.latestVersion,
        level: result.security.overallLevel,
        score: result.security.overallScore,
        findingCount: findings.length,
        ...(contentScan
          ? {
              deepScanStatus: contentScan.status,
              filesScanned: contentScan.filesScanned,
              integrityVerified: contentScan.integrityVerified,
            }
          : {}),
        findings: shown.map(toOutputFinding),
        findingsTruncated: findings.length > shown.length,
      }
    },
  }))

  // 2. check_packages：批量检查，引擎内部 TokenBucket 负责限流。
  ctx.tools.register(defineTool({
    name: 'check_packages',
    description: 'Check multiple npm packages for supply-chain security risks.',
    parameters: {
      names: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'npm package names',
      },
      concurrency: {
        type: 'integer',
        description: 'Max concurrent registry requests',
      },
      deep: { type: 'boolean', description: 'Download and inspect every published tarball' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const results = await engine.checkPackages(args.names, {
        concurrency: args.concurrency,
        deep: args.deep ?? false,
        signal: exec.signal,
      })
      return formatBatch(results)
    },
  }))

  // 3. search_packages：关键词搜索 npm 注册表。
  ctx.tools.register(defineTool({
    name: 'search_packages',
    description: 'Search the npm registry for packages by keyword.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search keyword' },
      limit: { type: 'integer', description: 'Max result count' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const rows = await engine.searchPackages(args.query, {
        size: args.limit,
        signal: exec.signal,
      })
      return rows
        .map((r) => `${r.package.name}@${r.package.version}: ${r.package.description ?? ''}`)
        .join('\n')
    },
  }))

  // 4. 监视列表：watch_add / watch_remove / watch_list。
  ctx.tools.register(defineTool({
    name: 'watch_add',
    description: 'Add a package to the watchlist.',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      await engine.addToWatchlist(args.name)
      return `Watched ${args.name}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_remove',
    description: 'Remove a package from the watchlist.',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      await engine.removeFromWatchlist(args.name)
      return `Unwatched ${args.name}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_list',
    description: 'List all watched packages.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      const list = await engine.getWatchlist()
      return list.length > 0 ? list.join('\n') : '(empty)'
    },
  }))

  // 5. 规则管理：rules_list / rule_enable / rule_disable / rule_set_severity。
  ctx.tools.register(defineTool({
    name: 'rules_list',
    description: 'List all scan rules with effective status.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return formatRules(engine.listRules())
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rule_enable',
    description: 'Enable a scan rule (persisted).',
    parameters: {
      ruleId: { type: 'string', required: true, description: 'Rule identifier' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      engine.setRuleEnabled(args.ruleId, true)
      return `Enabled rule ${args.ruleId}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rule_disable',
    description: 'Disable a scan rule (persisted).',
    parameters: {
      ruleId: { type: 'string', required: true, description: 'Rule identifier' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      engine.setRuleEnabled(args.ruleId, false)
      return `Disabled rule ${args.ruleId}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rule_set_severity',
    description: 'Override a scan rule severity (persisted).',
    parameters: {
      ruleId: { type: 'string', required: true, description: 'Rule identifier' },
      severity: {
        type: 'string',
        required: true,
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'New severity level',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      engine.setRuleSeverity(args.ruleId, args.severity as Severity)
      return `Rule ${args.ruleId} severity set to ${args.severity}`
    },
  }))

  // 6. 设置：settings_get / settings_set。
  ctx.tools.register(defineTool({
    name: 'settings_get',
    description: 'Read an engine setting.',
    parameters: {
      key: { type: 'string', required: true, description: 'Setting key' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const value = await engine.getSetting(args.key)
      return `${args.key}=${value ?? '(unset)'}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'settings_set',
    description: 'Write an engine setting (persisted).',
    parameters: {
      key: { type: 'string', required: true, description: 'Setting key' },
      value: { type: 'string', required: true, description: 'Setting value' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      await engine.setSetting(args.key, args.value)
      return `Setting ${args.key} written`
    },
  }))

  // 7. ci_scan：依赖门禁扫描（前台，转发 exec.signal）。
  ctx.tools.register(defineTool({
    name: 'ci_scan',
    description: 'Scan project dependencies and report severe findings.',
    parameters: {
      failLevel: {
        type: 'string',
        enum: ['safe', 'suspicious', 'dangerous', 'unknown'],
        description: 'Level that fails the build (defaults to dangerous)',
      },
      lockfile: { type: 'boolean', description: 'Scan every lockfile dependency' },
      prod: { type: 'boolean', description: 'Skip devDependencies' },
      deep: { type: 'boolean', description: 'Download and inspect every published tarball' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const dir = exec.agent
        ? await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        : undefined
      const report = await engine.ciScan({
        ...(dir ? { dir } : {}),
        failLevel: (args.failLevel ?? 'dangerous') as SecurityLevel,
        lockfile: args.lockfile ?? false,
        prod: args.prod ?? false,
        deep: args.deep ?? false,
        signal: exec.signal,
      })
      return formatCiReport(report)
    },
  }))

  // 8. refresh_all：长耗时操作，按迁移文档 4.5 节走后台任务路径。
  //    一旦 ctx.jobs.start 发布 job id，取消改用任务自有信号（不再使用 exec.signal）。
  ctx.tools.register(defineTool({
    name: 'refresh_all',
    description: 'Refresh all watched packages in a background job.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            required: true,
            const: 'background',
            description: 'Background job marker',
          },
          jobId: {
            type: 'string',
            required: true,
            description: 'Background job id',
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Background refresh job started: ${value.jobId}`,
      }],
    },
    async execute(_args, exec) {
      const jobId = ctx.jobs.start({
        // JobKindMap 声明在未导出的 ./types 子模块中，无法可靠声明合并，
        // 采用类型断言：kind 在运行时是不透明 id 前缀。
        kind: 'npm-safe' as JobKind,
        label: 'Refresh all watched packages',
        ...(exec.agent ? { owner: exec.agent.id } : {}),
        run: () => {
          const controller = new AbortController()
          const done = (async (): Promise<JobOutcome> => {
            try {
              const ok = await engine.refreshAll({ signal: controller.signal })
              return {
                status: 'completed',
                detail: ok ? 'All packages refreshed' : 'Some packages failed',
                result: ok ? 'Refresh completed' : 'Refresh finished with failures',
              }
            } catch (error) {
              if (controller.signal.aborted) {
                return { status: 'killed', detail: 'Cancelled' }
              }
              return {
                status: 'failed',
                detail: error instanceof Error ? error.message : String(error),
              }
            }
          })()
          return {
            cancel: (reason?: string) => controller.abort(reason),
            done,
          }
        },
      })
      return { kind: 'background' as const, jobId }
    },
  }))
}
