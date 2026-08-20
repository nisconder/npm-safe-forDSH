// 门面冒烟脚本：验证插件工具所依赖的引擎门面方法（watchlist / settings / ciScan）真实可用。
//
// 用法：
//   node scripts/smoke-facade.mjs
//
// 该脚本会真实请求 npm registry（ciScan 会检查 fixture 项目的 lodash 依赖）。
// 状态文件 ./.smoke-facade.db 与 fixture 目录 .smoke-project/ 均已在 .gitignore 内。

import { NpmSafeEngine } from '@npm-safe/core'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const FIXTURE_DIR = '.smoke-project'

// 1. 准备一个最小 fixture 项目（含 lodash 依赖，供 ciScan 扫描）。
rmSync(FIXTURE_DIR, { recursive: true, force: true })
mkdirSync(FIXTURE_DIR, { recursive: true })
writeFileSync(
  `${FIXTURE_DIR}/package.json`,
  JSON.stringify({
    name: 'smoke',
    version: '0.0.0',
    dependencies: { lodash: '^4.17.21' },
  }, null, 2) + '\n',
)

const engine = new NpmSafeEngine({ dbPath: './.smoke-facade.db' })
try {
  // 2. watchlist：先读（空），再检查 lodash（缓存其元数据以满足 watchlist 的
  //    外键约束 REFERENCES packages(name)），再加入 watchlist，再读（应包含 lodash）。
  const before = await engine.getWatchlist()
  console.log('watchlist before:', JSON.stringify(before))

  await engine.checkPackage('lodash')
  await engine.addToWatchlist('lodash')

  const after = await engine.getWatchlist()
  console.log('watchlist after:', JSON.stringify(after))
  if (!after.includes('lodash')) {
    throw new Error(`addToWatchlist failed: lodash not in watchlist (${after.join(', ')})`)
  }

  // 3. settings：读取一个未设置的 key，应返回 null。
  const setting = await engine.getSetting('smoke-key')
  console.log('setting smoke-key:', setting === null ? '(unset)' : setting)

  // 4. ciScan：扫描 fixture 项目，打印 failed 与 dependencyCount。
  const report = await engine.ciScan({ dir: FIXTURE_DIR, failLevel: 'dangerous' })
  console.log(JSON.stringify({
    ciScan: {
      failed: report.failed,
      dependencyCount: report.dependencyCount,
      failLevel: report.failLevel,
      summary: report.summary,
    },
  }, null, 2))

  console.log('smoke-facade: OK')
} finally {
  engine.close()
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
}
