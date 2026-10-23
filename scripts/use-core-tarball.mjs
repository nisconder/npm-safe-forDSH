import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const index = args.indexOf('--core-tarball')
if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
  throw new Error('Usage: node scripts/use-core-tarball.mjs --core-tarball <npm-safe-core.tgz> [--verify]')
}
const input = path.resolve(args[index + 1])
const bytes = await readFile(input)
const archive = gunzipSync(bytes)
const entries = new Map()
for (let offset = 0; offset + 512 <= archive.length;) {
  const header = archive.subarray(offset, offset + 512)
  if (header.every(byte => byte === 0)) break
  const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '')
  const size = Number.parseInt(header.subarray(124, 136).toString().trim().replace(/\0.*$/s, ''), 8)
  if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) {
    throw new Error('Invalid npm package archive')
  }
  entries.set(name, archive.subarray(offset + 512, offset + 512 + size))
  offset += 512 + Math.ceil(size / 512) * 512
}
const manifest = JSON.parse(entries.get('package/package.json')?.toString() ?? '{}')
if (manifest.name !== '@npm-safe/core' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) {
  throw new Error('Expected an @npm-safe/core release tarball with an exact version')
}
if (!entries.has('package/dist/index.js') || !entries.has('package/dist/index.d.ts')) {
  throw new Error('Build the shared core before packing it; dist entrypoints are missing')
}
const filename = `npm-safe-core-${manifest.version}.tgz`
await mkdir(path.join(root, 'vendor'), { recursive: true })
const destination = path.join(root, 'vendor', filename)
if (input !== destination) await copyFile(input, destination)
const wrapperPath = path.join(root, 'packages/core/package.json')
const wrapper = JSON.parse(await readFile(wrapperPath, 'utf8'))
wrapper.dependencies['@npm-safe/core'] = manifest.version
await writeFile(wrapperPath, JSON.stringify(wrapper, null, 2) + '\n')
const workspacePath = path.join(root, 'pnpm-workspace.yaml')
const workspace = await readFile(workspacePath, 'utf8')
if (!/^  '@npm-safe\/core': file:vendor\/[^\r\n]+$/m.test(workspace)) {
  throw new Error('Expected the shared core workspace override in pnpm-workspace.yaml')
}
await writeFile(workspacePath, workspace.replace(
  /^  '@npm-safe\/core': file:vendor\/[^\r\n]+$/m,
  `  '@npm-safe/core': file:vendor/${filename}`,
))
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
await writeFile(path.join(root, 'vendor/core-release.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, filename, integrity,
  sourceRepository: 'https://github.com/nisconder/npm-safe',
}, null, 2) + '\n')
console.log(`Pinned ${manifest.name}@${manifest.version}\n${integrity}`)
console.log('Regenerate pnpm-lock.yaml from this tarball before a frozen install.')

if (args.includes('--verify')) {
  // Verify only with existing dependencies; this script never installs packages
  // or runs dependency lifecycle scripts.
  const installedRoot = await realpath(path.join(root, 'packages/core/node_modules/@npm-safe/core'))
  const installedManifest = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'))
  if (installedManifest.version !== manifest.version) {
    throw new Error(`Installed core is ${installedManifest.version}; install the pinned tarball first`)
  }
  for (const [name, expected] of entries) {
    if (!name.startsWith('package/dist/') || name.endsWith('/')) continue
    const actual = await readFile(path.join(installedRoot, name.slice('package/'.length)))
    if (!actual.equals(expected)) {
      throw new Error(`Installed shared-core bytes differ from the pinned tarball: ${name}`)
    }
  }
  for (const pkg of ['core', 'tool-npm-safe']) {
    const cwd = path.join(root, 'packages', pkg)
    const localRequire = createRequire(path.join(cwd, 'package.json'))
    const tsc = localRequire.resolve('typescript/bin/tsc')
    const vitest = path.join(path.dirname(localRequire.resolve('vitest/package.json')), 'vitest.mjs')
    for (const command of [[tsc, '-p', 'tsconfig.json'], [tsc, '-p', 'tsconfig.json', '--noEmit'], [vitest, 'run']]) {
      const result = spawnSync(process.execPath, command, { cwd, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
  }
}
