/**
 * 读 prompt-forge 的提示词模板（宿主侧）。
 *
 * 为什么要有这个模块：生图面板上的「优化提示词」按钮想直接用
 * `dsh-prompt-forge` 里那个叫「文生图优化」的 preset，而 prompt-forge 的
 * `POST /api/dsh-prompt-forge/optimize` **要求调用方自己把 system 文本传进去**
 * （它的注释写得很清楚：preset-vs-main 的解析在浏览器侧完成，宿主不重新推导配置）。
 * 所以这里负责把那段文本取出来，交给前端去调 prompt-forge 的 SSE 路由。
 *
 * ## 为什么是「深度搜索」而不是按字段名取
 *
 * 第一版按 `configEditor.configuration()[].entry.name === 'dsh-prompt-forge'` 找，
 * 真机上直接回「没找到 prompt-forge」——`configuration()` 大概率只覆盖「通过配置编辑器
 * 改过的行」，返回的是空数组。与其继续猜 Loader Entry / SettingsDescriptor 的字段名
 * （它们不是我们自己的类型，随时可能变），不如**按语义找**：
 *
 * > 谁能给出一份「带 `presets` 数组、且其中某个 preset 叫『文生图优化』」的配置，
 * > 就是它。
 *
 * 两个来源都试：`settings.describe()`（官方设置服务，客户端渲染表单就用它，带值）
 * 和 `configEditor.configuration()`（配置编辑器，带 override/inherited）。形状不认识
 * 没关系，深度搜索只认 `presets` 这个键。最后还有一层保险：直接读 profile 的 patch 文件。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 生图面板固定用的模板名 —— 老板拍板写死这一个。 */
export const FORGE_PRESET_NAME = '文生图优化'

/** 一个模板。 */
export interface ForgePreset {
  id: string
  name: string
  system: string
}

/** 取模板的结果。 */
export type ForgePresetResult =
  | { kind: 'ok'; preset: ForgePreset; provider: string; model: string }
  /** 宿主两个服务都拿不到 —— 这不是「模板没配」，是环境不对。 */
  | { kind: 'no-service' }
  /** 扫到了配置，但没有这个名字的模板。 */
  | { kind: 'no-preset'; available: string[]; scanned: number }

/** 深度搜索的上限，防止在巨型对象上跑飞。 */
const MAX_DEPTH = 8

/** 速写里**只回长度**的字段名（提示词正文、密钥）。 */
const REDACT_KEYS = new Set(['system', 'mainSystemPrompt', 'apiKey', 'key', 'token', 'secret'])

/** 从一份配置里挑出 presets 数组。 */
function presetsOf(value: unknown): ForgePreset[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      name: typeof item.name === 'string' ? item.name : '',
      system: typeof item.system === 'string' ? item.system : '',
    }))
    .filter((preset) => preset.system.trim() !== '')
}

/** 名字匹配：先精确，再包含（老板把模板改名成「文生图优化 v2」也还能用）。 */
function matchPreset(presets: ForgePreset[], wanted: string): ForgePreset | undefined {
  return presets.find((preset) => preset.name.trim() === wanted)
    ?? presets.find((preset) => preset.name.includes(wanted))
}

/** 从一个对象里取字符串字段（浅层，两个来源的 provider/model 都在浅层）。 */
function stringField(source: unknown, key: string): string {
  if (source === null || typeof source !== 'object') return ''
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/** 深度搜索的统计（用来把「为什么没找到」说清楚）。 */
interface ScanStats {
  scanned: number
  names: string[]
}

/**
 * 在任意结构里找「带目标模板的 presets 数组」。
 * @param value - 任意 JSON 结构。
 * @param wanted - 目标模板名。
 * @param stats - 顺路收集诊断信息。
 * @param depth - 当前深度。
 * @returns 命中的模板与它所在配置里的渠道/模型。
 */
function deepFindPreset(
  value: unknown,
  wanted: string,
  stats: ScanStats,
  depth = 0,
): { preset: ForgePreset; provider: string; model: string } | undefined {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return undefined

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepFindPreset(item, wanted, stats, depth + 1)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  const record = value as Record<string, unknown>

  // 命中点：这个对象自己带 presets。
  if (record.presets !== undefined) {
    const presets = presetsOf(record.presets)
    if (presets.length > 0) {
      stats.scanned += 1
      for (const preset of presets) stats.names.push(preset.name)
      const found = matchPreset(presets, wanted)
      if (found !== undefined) {
        return {
          preset: found,
          provider: stringField(record, 'provider'),
          model: stringField(record, 'model'),
        }
      }
    }
  }

  for (const nested of Object.values(record)) {
    const hit = deepFindPreset(nested, wanted, stats, depth + 1)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** 能读配置的宿主服务（结构类型，避免硬依赖具体包）。 */
interface ConfigSource {
  describe?: () => unknown
  configuration?: () => unknown
}

/** 从任意值里窄化出可用的服务面。 */
function asSource(value: unknown, method: 'describe' | 'configuration'): ConfigSource | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  return typeof candidate[method] === 'function' ? (candidate as ConfigSource) : undefined
}

/**
 * 收集能读配置的宿主服务。
 * @param ctx - 插件上下文。
 * @returns 每个来源的名字与它返回的原始结构（读不到就跳过）。
 */
export function collectConfigSources(ctx: { get(name: string): unknown }): Array<{ name: string; value: unknown }> {
  const sources: Array<{ name: string; value: unknown }> = []

  const settings = asSource(ctx.get('settings'), 'describe')
  if (settings?.describe !== undefined) {
    try { sources.push({ name: 'settings.describe()', value: settings.describe() }) } catch { /* 换下一个来源 */ }
  }
  const editor = asSource(ctx.get('configEditor'), 'configuration')
  if (editor?.configuration !== undefined) {
    try { sources.push({ name: 'configEditor.configuration()', value: editor.configuration() }) } catch { /* 同上 */ }
  }
  return sources
}

// --------------------------------------------------------------- 兜底：直接读 patch 文件

/**
 * 兜底来源：profile 的 `cordis.patch.yml`。
 *
 * **为什么需要它**：上面两个服务到底带不带「生效值」取决于 DSH 版本 ——
 * `settings.describe()` 更像「把 schema 投成表单」，`configEditor.configuration()`
 * 可能只覆盖「通过配置编辑器改过的行」（真机上它就没给出 prompt-forge 那一行，
 * 于是第一版直接回了「没找到 prompt-forge」）。而这份文件是**确定的**：
 * profile 的 patch 里就存着 `presets` 数组。
 *
 * 只在服务都读不到时才走这条路 —— 它是保险，不是主路。
 */

/** 找 patch 文件：`<home>/.dsh/profiles/<profile>/cordis.patch.yml`。 */
export function defaultPatchPaths(): string[] {
  const base = join(homedir(), '.dsh', 'profiles')
  let profiles: string[]
  try {
    profiles = readdirSync(base)
  } catch {
    return []
  }
  return profiles
    .map((name) => join(base, name, 'cordis.patch.yml'))
    .filter((file) => existsSync(file))
}

/** 一行前面的空格数。 */
function indentOf(line: string): number {
  return (line.match(/^\s*/u) ?? [''])[0].length
}

/** YAML 块标量 → 文本（`|` 保留换行，`>` 折成空格）。 */
function blockScalar(lines: string[], keyIndex: number): string {
  const keyLine = lines[keyIndex] ?? ''
  const folded = keyLine.includes('>')
  const base = indentOf(keyLine)
  const body: string[] = []
  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') { body.push(''); continue }
    if (indentOf(line) <= base) break
    body.push(line.slice(Math.min(line.length, base + 2)))
  }
  if (!folded) return body.join('\n').trim()
  const out: string[] = []
  for (const line of body) {
    if (line === '') { out.push('\n'); continue }
    const last = out[out.length - 1]
    out.push(last === undefined || last === '\n' || last.endsWith(' ') ? line : ` ${line}`)
  }
  return out.join('').trim()
}

/**
 * 从一个 patch 文件里抠出 prompt-forge 那一行的 `presets` / `provider` / `model`。
 * @param file - patch 文件路径。
 * @returns 抠出来的片段；没有 prompt-forge 那一行时返回 undefined。
 */
function readPatchRow(file: string): Record<string, unknown> | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const lines = text.split(/\r?\n/u)
  const nameAt = lines.findIndex((line) => /^\s*name:\s*["']?dsh-prompt-forge["']?\s*$/u.test(line))
  if (nameAt < 0) return undefined

  /**
   * 这一行（列表项）的边界。
   *
   * YAML 列表项里 `id:` / `name:` / `config:` 是**同一缩进**的兄弟节点，
   * 所以「行」的判定不能按「缩进大于 name 行」来 —— 那会在下一行的 `config:` 处立刻停住，
   * 一行都收不到（第一版就是这么错的）。正确规则：从 name 行往后收，直到遇见
   * 缩进更小的下一个列表项（`- `）。
   */
  const memberIndent = indentOf(lines[nameAt] ?? '')
  const block: string[] = []
  for (let index = nameAt + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') { block.push(line); continue }
    if (indentOf(line) < memberIndent && /^\s*-\s/u.test(line)) break
    if (indentOf(line) < memberIndent) break
    block.push(line)
  }

  const row: Record<string, unknown> = {}
  const presetsAt = block.findIndex((line) => /^\s*presets:\s*$/u.test(line))
  if (presetsAt >= 0) {
    const listIndent = indentOf(block[presetsAt] ?? '')
    const presets: Array<{ id: string; name: string; system: string }> = []
    let current: { id: string; name: string; system: string } | undefined
    for (let index = presetsAt + 1; index < block.length; index += 1) {
      const line = block[index] ?? ''
      if (line.trim() === '') continue
      if (indentOf(line) <= listIndent) break
      const itemMatch = /^\s*-\s*id:\s*(.+)$/u.exec(line)
      if (itemMatch !== null) {
        if (current !== undefined) presets.push(current)
        current = { id: itemMatch[1]!.trim(), name: '', system: '' }
        continue
      }
      if (current === undefined) continue
      const nameMatch = /^\s*name:\s*(.+)$/u.exec(line)
      if (nameMatch !== null) { current.name = nameMatch[1]!.trim(); continue }
      if (/^\s*system:\s*[|>]-?\s*$/u.test(line)) {
        current.system = blockScalar(block, index)
        // 块标量的正文已经吃掉，跳到它结束的位置。
        const base = indentOf(line)
        while (index + 1 < block.length) {
          const next = block[index + 1] ?? ''
          if (next.trim() !== '' && indentOf(next) <= base) break
          index += 1
        }
      }
    }
    if (current !== undefined) presets.push(current)
    const usable = presets.filter((preset) => preset.system.trim() !== '')
    if (usable.length > 0) row.presets = usable
  }

  for (const key of ['provider', 'model']) {
    for (const line of block) {
      const match = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'u').exec(line)
      if (match !== null) {
        row[key] = match[1]!.trim().replace(/^["']|["']$/gu, '')
        break
      }
    }
  }

  return Object.keys(row).length > 0 ? row : undefined
}

/** 把 patch 文件也当成来源（值就是抠出来的那一行）。 */
export function collectPatchSources(paths: string[]): Array<{ name: string; value: unknown }> {
  const sources: Array<{ name: string; value: unknown }> = []
  for (const file of paths) {
    const row = readPatchRow(file)
    if (row !== undefined) sources.push({ name: `patch:${file}`, value: row })
  }
  return sources
}

/**
 * 结构速写：只回键名 / 类型 / 长度，不回长文本。
 *
 * 给 `GET /dsh-imagegen/preset?debug=1` 用 —— 万一真机上还是找不到模板，
 * 这一个请求就能看出两个服务到底回了什么形状，不用再来一轮「改代码 → 重启 → 猜」。
 * @param value - 任意结构。
 * @param depth - 当前深度（超过 3 层就截断）。
 * @returns 可安全打印的速写。
 */
export function outlineOf(value: unknown, depth = 0): unknown {
  if (depth > 5) return '…'
  if (value === null) return null
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      length: value.length,
      // 采样前 3 个：只给 1 个的话，命中行排在第二个就看不见了（真踩过）。
      sample: value.slice(0, 3).map((item) => outlineOf(item, depth + 1)),
    }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // 提示词正文与密钥一律只回长度：自查接口不该把别人的 prompt / key 吐出来。
      if (REDACT_KEYS.has(key) && typeof item === 'string') {
        out[key] = `<${key} ${item.length} 字>`
        continue
      }
      out[key] = outlineOf(item, depth + 1)
    }
    return out
  }
  if (typeof value === 'string') return value.length > 60 ? `<string ${value.length} 字>` : value
  return typeof value
}

/**
 * 找 prompt-forge 的「文生图优化」模板。
 *
 * 来源顺序：`settings.describe()` → `configEditor.configuration()` → profile 的 patch 文件。
 * 前两个是正经的宿主服务，第三个是保险（前两个都读不到时才会用到）。
 * @param ctx - 插件上下文（要 `ctx.get('settings')` / `ctx.get('configEditor')`）。
 * @param presetName - 要找的模板名。
 * @param patchPaths - 覆盖 patch 文件候选（自检用；省略时按 `~/.dsh/profiles/*` 找）。
 * @returns 找到的模板，或一个说明为什么没找到的结果。
 */
export function findForgePreset(
  ctx: { get(name: string): unknown },
  presetName: string = FORGE_PRESET_NAME,
  patchPaths?: string[],
): ForgePresetResult {
  const services = collectConfigSources(ctx)
  const stats: ScanStats = { scanned: 0, names: [] }

  for (const source of services) {
    const hit = deepFindPreset(source.value, presetName.trim(), stats)
    if (hit !== undefined) return { kind: 'ok', ...hit }
  }

  // 服务里没有 → 兜底读 patch 文件（它一定有这段文本）。
  const patches = collectPatchSources(patchPaths ?? defaultPatchPaths())
  for (const source of patches) {
    const hit = deepFindPreset(source.value, presetName.trim(), stats)
    if (hit !== undefined) return { kind: 'ok', ...hit }
  }

  if (services.length === 0 && patches.length === 0) return { kind: 'no-service' }

  // 去重，别把同一个模板名报两遍。
  return { kind: 'no-preset', available: [...new Set(stats.names)], scanned: stats.scanned }
}
