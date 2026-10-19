/**
 * 兼容门禁：用**本机实际安装的 DSH**（可能比 devDependencies 里的更旧或更新）的类型面
 * 做一次 `tsc --noEmit`，用来回答"这个插件还能不能跟上当前/后续版本"。
 *
 * 做法：在仓库根生成一个临时 tsconfig，把 `@deepseek-ai/dsh-tools` 映射到 DSH 安装里
 * 自带的那一份类型入口，跑类型检查后删除临时文件 —— 不修改 node_modules、不改动依赖，
 * 因此可以在任何时候（升级 DSH 之后）复跑。
 *
 * 用法：
 *   npm run check:harness                     # 自动探测 DSH 安装
 *   DSH_INSTALL=/path/to/dsh npm run check:harness
 *
 * 找不到 DSH 安装时**跳过（退出码 0）**：CI 里没有 harness 安装属正常情况。
 * @module dsh-local-file-share/scripts/harness-types
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [
  process.env.DSH_INSTALL,
  '/usr/local/lib/node_modules/@deepseek-ai/dsh',
  join(root, 'node_modules/@deepseek-ai/dsh'),
].filter((entry) => typeof entry === 'string' && entry.length > 0)

/** 探测 DSH 安装目录（含 dsh-tools 的那个）。 */
const install = candidates.find((entry) => existsSync(join(entry, 'package.json'))
  && existsSync(join(entry, 'node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts')))

if (install === undefined) {
  console.log('[check:harness] 未找到本机 DSH 安装，跳过（设置 DSH_INSTALL 可指定路径）')
  process.exit(0)
}

const version = JSON.parse(readFileSync(join(install, 'package.json'), 'utf8')).version
const toolsTypes = join(install, 'node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts')
const tempConfig = join(root, '.tsconfig.harness.json')

const config = {
  extends: './tsconfig.json',
  compilerOptions: {
    // 只覆盖顶层 specifier；dsh-tools 自己的 import 会从它所在的安装目录解析。
    paths: { '@deepseek-ai/dsh-tools': [relative(root, toolsTypes)] },
  },
}

try {
  writeFileSync(tempConfig, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`[check:harness] 用 DSH ${version} 自带的 dsh-tools 类型面做检查 …`)
  execFileSync('npx', ['tsc', '-p', tempConfig, '--noEmit'], { cwd: root, stdio: 'inherit' })
  console.log(`[check:harness] 通过：源码与 DSH ${version} 的类型面兼容`)
} finally {
  rmSync(tempConfig, { force: true })
}
