/**
 * 宿主侧配置存储（阶段 3）。
 *
 * 位置：`<用户主目录>/.dsh/dsh-imagegen-panel/config.json`
 *
 * 为什么**不**用 `.dsh/dsh-imagegen/`：那个目录已经被内置 `dsh-image-gen` 插件占用
 * （`templates/` + `template-images/`，约 1.6 GB）。把我们的 `config.json` 混进去，
 * 一旦内置插件哪天也读同名文件就会互相踩 —— 插件各占一个目录是更省心的边界。
 *
 * 为什么 Key 存宿主：明文只在宿主进程里出现。HTTP 路由只回 `hasKey` + 掩码
 * `keyHint`，明文永不下发到浏览器 —— 这是阶段 3 的负面验收项。
 *
 * 读盘策略：**不做内存缓存**。每次 GET 都重新读文件，代价是一个几 KB 的读，
 * 换来的是「磁盘文件就是唯一真相」—— 手改文件立刻生效，也不用担心半年前
 * 缓存住的值覆盖用户的新配置。
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** 生图协议。各家接口形式不同，所以这是配置项而不是硬编码分支。 */
export type Protocol = 'openrouter' | 'openai' | 'gemini' | 'custom'

/** 输出图片格式。`svg` 是给上游 6 个矢量化模型用的 —— 它们只收 `svg`。 */
export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'svg'

/**
 * 可下发到浏览器的配置字段。
 *
 * 与 `src/client/types.ts` 的 `PanelConfig` **逐字段对应**，只少了宿主才能回答的
 * `hasKey` / `keyHint`。两半边的字段清单一致性由 `scripts/host-check.mjs` 断言 ——
 * 免得某天只改了一边。
 */
export interface Settings {
  protocol: Protocol
  baseUrl: string
  model: string
  autoSaveDir: string
  extraJson: string
  timeoutSec: number
  outputFormat: OutputFormat
}

/** 下发给浏览器的配置视图：字段与 Settings 相同，另加 Key 的两个状态位。 */
export interface PublicConfig extends Settings {
  /** Key 是否已配置。**不回明文**。 */
  hasKey: boolean
  /** Key 掩码，仅用于让用户确认「配的是哪一把」。 */
  keyHint: string
}

/** 允许的协议取值。 */
export const PROTOCOLS: readonly Protocol[] = ['openrouter', 'openai', 'gemini', 'custom']

/** 允许的输出格式。 */
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['png', 'jpeg', 'webp', 'svg']

/** 配置文件格式版本，供将来迁移用。 */
export const CONFIG_VERSION = 1

/** 超时秒数的允许区间。 */
export const MIN_TIMEOUT_SEC = 5
export const MAX_TIMEOUT_SEC = 3600

/** 未配置时的默认值。宿主是权威；客户端 `defaults.ts` 那份只为首帧打底。 */
export const DEFAULT_SETTINGS: Settings = {
  protocol: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-pro-image',
  autoSaveDir: 'D:\\DSH\\.dsh-imagegen\\out\\',
  extraJson: '{\n  "background": "opaque",\n  "output_compression": 90,\n  "provider": { "sort": "price" }\n}',
  timeoutSec: 180,
  outputFormat: 'png',
}

/**
 * 本插件的数据根目录。
 *
 * `DSH_IMAGEGEN_HOME` 覆盖只为一个目的存在：`scripts/host-check.mjs` 要在一个临时
 * 目录里跑完整的落盘往返，不能碰老板的真实配置。生产路径不受影响。
 * @returns 绝对路径。
 */
export function imagegenHome(): string {
  const override = process.env.DSH_IMAGEGEN_HOME
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override)
  return path.join(homedir(), '.dsh', 'dsh-imagegen-panel')
}

/** 配置文件绝对路径（含明文 Key）。 */
export function configFilePath(): string {
  return path.join(imagegenHome(), 'config.json')
}

/** 历史索引绝对路径（阶段 5 写入，阶段 3 只读）。 */
export function historyIndexPath(): string {
  return path.join(imagegenHome(), 'index.json')
}

/** 出图落盘目录（阶段 5 使用）。 */
export function imageOutDir(): string {
  return path.join(imagegenHome(), 'out')
}

/** 是否属于允许的协议。 */
function isProtocol(value: unknown): value is Protocol {
  return typeof value === 'string' && (PROTOCOLS as readonly string[]).includes(value)
}

/** 是否属于允许的输出格式。 */
function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && (OUTPUT_FORMATS as readonly string[]).includes(value)
}

/** 一个非空字符串？ */
function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * 把任意来源（磁盘文件、PUT body）的字段宽松地收敛成 Settings。
 *
 * 宽松是刻意的：磁盘上的文件可能被手改过，一个错字段不该让整个面板起不来 ——
 * 非法值退回默认值，整体永远返回一份可直接使用的配置。
 * @param raw - 未知来源的对象。
 * @returns 完整的 Settings。
 */
export function coerceSettings(raw: unknown): Settings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const timeout = typeof source.timeoutSec === 'number' && Number.isFinite(source.timeoutSec)
    ? Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, Math.round(source.timeoutSec)))
    : DEFAULT_SETTINGS.timeoutSec

  return {
    protocol: isProtocol(source.protocol) ? source.protocol : DEFAULT_SETTINGS.protocol,
    baseUrl: isFilledString(source.baseUrl) ? source.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
    model: isFilledString(source.model) ? source.model.trim() : DEFAULT_SETTINGS.model,
    autoSaveDir: isFilledString(source.autoSaveDir) ? source.autoSaveDir.trim() : DEFAULT_SETTINGS.autoSaveDir,
    extraJson: typeof source.extraJson === 'string' ? source.extraJson : DEFAULT_SETTINGS.extraJson,
    timeoutSec: timeout,
    outputFormat: isOutputFormat(source.outputFormat) ? source.outputFormat : DEFAULT_SETTINGS.outputFormat,
  }
}

/** PUT 校验失败。 */
export interface PatchRejection {
  ok: false
  code: string
  message: string
}

/** PUT 校验通过。 */
export interface PatchAcceptance {
  ok: true
  patch: Partial<Settings>
}

/**
 * 校验浏览器提交的配置增量。
 *
 * 只接受**出现过的**字段（PUT 语义），出现的字段必须合法 —— 这里拒绝而不是静默
 * 纠正，因为用户就在弹层里，报错能让他当场改；静默改写只会让「我明明填了」变成一个谜。
 * 手工编辑磁盘文件走的是另一条宽松路径（{@link coerceSettings}）。
 * @param raw - PUT body 里的 `config` 对象。
 * @returns 通过则给出增量，否则给出可展示的原因。
 */
export function validatePatch(raw: unknown): PatchAcceptance | PatchRejection {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, code: 'bad-config', message: 'config 必须是一个对象' }
  }
  const source = raw as Record<string, unknown>
  const patch: Partial<Settings> = {}

  if ('protocol' in source) {
    if (!isProtocol(source.protocol)) {
      return { ok: false, code: 'bad-protocol', message: `协议只能是 ${PROTOCOLS.join(' / ')}` }
    }
    patch.protocol = source.protocol
  }

  if ('baseUrl' in source) {
    const value = source.baseUrl
    if (!isFilledString(value)) {
      return { ok: false, code: 'bad-base-url', message: 'Base URL 不能为空' }
    }
    let parsed: URL
    try {
      parsed = new URL(value.trim())
    } catch {
      return { ok: false, code: 'bad-base-url', message: `Base URL 不是合法地址：${value.trim()}` }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, code: 'bad-base-url', message: 'Base URL 必须是 http(s) 地址' }
    }
    patch.baseUrl = value.trim().replace(/\/+$/, '')
  }

  if ('model' in source) {
    if (!isFilledString(source.model)) {
      return { ok: false, code: 'bad-model', message: '默认模型不能为空' }
    }
    patch.model = source.model.trim()
  }

  if ('autoSaveDir' in source) {
    if (!isFilledString(source.autoSaveDir)) {
      return { ok: false, code: 'bad-auto-save-dir', message: '自动保存目录不能为空' }
    }
    patch.autoSaveDir = source.autoSaveDir.trim()
  }

  if ('extraJson' in source) {
    const value = source.extraJson
    if (typeof value !== 'string') {
      return { ok: false, code: 'bad-extra-json', message: '额外参数必须是字符串' }
    }
    if (value.trim() !== '') {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch (error) {
        return {
          ok: false,
          code: 'bad-extra-json',
          message: `额外参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
        }
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, code: 'bad-extra-json', message: '额外参数必须是一个 JSON 对象' }
      }
    }
    patch.extraJson = value
  }

  if ('timeoutSec' in source) {
    const value = source.timeoutSec
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, code: 'bad-timeout', message: '超时必须是数字（秒）' }
    }
    if (value < MIN_TIMEOUT_SEC || value > MAX_TIMEOUT_SEC) {
      return {
        ok: false,
        code: 'bad-timeout',
        message: `超时需在 ${MIN_TIMEOUT_SEC}–${MAX_TIMEOUT_SEC} 秒之间`,
      }
    }
    patch.timeoutSec = Math.round(value)
  }

  if ('outputFormat' in source) {
    if (!isOutputFormat(source.outputFormat)) {
      return { ok: false, code: 'bad-output-format', message: `输出格式只能是 ${OUTPUT_FORMATS.join(' / ')}` }
    }
    patch.outputFormat = source.outputFormat
  }

  return { ok: true, patch }
}

/** 磁盘上的配置读盘结果。 */
export interface ConfigReadResult {
  settings: Settings
  /** 明文 Key；未配置时是空串。**绝不能进 HTTP 响应**。 */
  apiKey: string
  /** 配置文件是否存在。 */
  existed: boolean
  /** 文件存在但解析失败时，改名备份的落地路径。 */
  backupPath?: string
}

/**
 * 读配置。
 *
 * 文件不存在 = 首次使用，返回默认值（不写盘，避免「装完插件就凭空多一个文件」）。
 * 文件损坏 = 改名备份 + 返回默认值：宁可用户重填一次，也不要让面板卡在报错上，
 * 同时**不销毁**原始内容，方便事后查。
 * @returns 配置 + 明文 Key + 是否存在。
 */
export async function readConfig(): Promise<ConfigReadResult> {
  const file = configFilePath()
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, apiKey: '', existed: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const backupPath = `${file}.corrupt-${Date.now()}`
    try {
      await rename(file, backupPath)
    } catch {
      // 备份失败不影响返回默认值。
    }
    return { settings: { ...DEFAULT_SETTINGS }, apiKey: '', existed: false, backupPath }
  }

  const source = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
  const apiKey = typeof source.apiKey === 'string' ? source.apiKey : ''
  return { settings: coerceSettings(source), apiKey, existed: true }
}

/**
 * 落盘配置（原子写：先写同目录临时文件再 rename）。
 *
 * 为什么原子：这个进程和用户的手可能同时碰这个文件；`rename` 在同分区上是原子的，
 * 于是任何时刻读到的都是「旧的完整版本」或「新的完整版本」，不会读到半截 JSON。
 * @param settings - 完整配置。
 * @param apiKey - 明文 Key（空串 = 未配置）。
 */
export async function writeConfig(settings: Settings, apiKey: string): Promise<void> {
  const home = imagegenHome()
  await mkdir(home, { recursive: true })

  const payload = {
    version: CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
    apiKey,
    ...settings,
  }
  const file = configFilePath()
  const temp = `${file}.tmp`

  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)

  // 权限收紧（best-effort）。Windows 上 chmod 基本是空操作 —— NTFS 的实际 ACL
  // 不由 POSIX mode 表达。真正的保护是「这台机器只有老板一个用户 + 文件在个人目录
  // 下」，README 里已经写明，不要在这里假装做到了。
  try {
    await chmod(home, 0o700)
    await chmod(file, 0o600)
  } catch {
    // 不影响功能。
  }
}

/**
 * Key 掩码。
 *
 * 保留头部 6 位（`sk-or-` 这种前缀不足以还原 Key）+ 尾部 4 位，让用户能对上号，
 * 但任何拿到掩码的人都复原不出明文。
 * @param apiKey - 明文 Key。
 * @returns 掩码；未配置时是空串。
 */
export function maskKey(apiKey: string): string {
  if (apiKey === '') return ''
  const head = apiKey.slice(0, 6)
  const tail = apiKey.length > 12 ? apiKey.slice(-4) : ''
  return `${head}••••••••${tail}`
}

/**
 * 组装下发给浏览器的配置视图。
 *
 * **唯一**允许离开宿主进程的配置形态 —— 明文 Key 在返回类型里根本没有位置，
 * 所以「不小心回传明文」在类型上就写不出来。
 * @param settings - 配置字段。
 * @param apiKey - 明文 Key（只用来算 hasKey / keyHint）。
 * @returns 可安全下发的视图。
 */
export function publicConfig(settings: Settings, apiKey: string): PublicConfig {
  return {
    ...settings,
    hasKey: apiKey !== '',
    keyHint: maskKey(apiKey),
  }
}
