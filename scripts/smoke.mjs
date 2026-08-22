// 一次性冒烟脚本：用真实 npm registry 验证迁移后的 @npm-safe/core-dsh 引擎端到端可用。
//
// 用法：
//   node scripts/smoke.mjs lodash                       # 检查一个真实包
//   node scripts/smoke.mjs definitely-not-a-real-pkg   # 不存在的包（应优雅返回 exists:false）
//
// 该脚本会真实请求 npm registry（触网），这是仓库中唯一允许触网的脚本。
// 引擎状态文件 ./.smoke.db 已在 .gitignore 内（*.db），不会入库。

import { NpmSafeEngine } from '@npm-safe/core-dsh'

const target = process.argv[2] ?? 'lodash'

const engine = new NpmSafeEngine({ dbPath: './.smoke.db' })
try {
  const result = await engine.checkPackage(target)
  const findingCount = result.security.staticScan?.findings.length ?? 0
  console.log(JSON.stringify({
    packageName: result.packageName,
    exists: result.exists,
    latestVersion: result.latestVersion,
    level: result.security.overallLevel,
    score: result.security.overallScore,
    findingCount,
  }, null, 2))
} finally {
  engine.close()
}
