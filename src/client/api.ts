/**
 * 真后端：打宿主路由 `/dsh-imagegen/*`。
 *
 * 这是 {@link Backend} 的生产实现 —— UI 不认识它，只认识接口，所以接上它
 * 不需要改任何组件（这是阶段 2 就留好的缝）。`mock.ts` 已删除：留着两份实现
 * 迟早会出现「改了一边、界面看起来正常、其实没生效」。
 *
 * 三条纪律：
 *   1. **明文 Key 只出现在 PUT 的请求体里**，进去就没了 —— 读回来的配置里
 *      只有 `hasKey` / `keyHint`。前端任何地方都不缓存明文。
 *   2. **路径只在这一处拼**。宿主侧同一张表在 `src/index.ts` 的 `API` 里，
 *      `scripts/host-check.mjs` 会断言两边字面一致。
 *   3. **失败要能读懂**。宿主回 `{ ok: false, code, message }`，这里原样抛出
 *      那句 message —— 面板把它显示给用户，不做二次美化。
 */
import { DEFAULT_CONFIG } from './defaults.ts'
import {
  GenerateError,
  type Backend,
  type GeneratedImage,
  type GenerateRequest,
  type HostLogEntry,
  type HostLogs,
  type ImageParams,
  type ModelCapabilities,
  type ModelOption,
  type PanelConfig,
  type PanelDraft,
  type ParameterField,
  type Protocol,
  type ProviderOption,
  type ReferenceRange,
} from './types.ts'

/**
 * 宿主路由（相对路径，不带前导斜杠）。
 *
 * 与 `src/index.ts` 的 `API` 表一一对应。刻意写相对形式：DSH 可能被反代挂在
 * 前缀下（`https://host/app/dsh/`），根绝对路径会绕过前缀直接 404 ——
 * 这正是 `dshmarket` 踩过的坑（#345）。
 */
const ROUTES = {
  config: 'dsh-imagegen/config',
  models: 'dsh-imagegen/models',
  capabilities: 'dsh-imagegen/capabilities',
  history: 'dsh-imagegen/history',
  generate: 'dsh-imagegen/generate',
  save: 'dsh-imagegen/save',
  open: 'dsh-imagegen/open',
  logs: 'dsh-imagegen/logs',
  draft: 'dsh-imagegen/draft',
} as const

/** 请求头里的 JSON 类型。 */
const JSON_HEADERS = { 'content-type': 'application/json' }

/**
 * 把一个相对路由解析成当前页面挂载点下的绝对路径。
 *
 * 锚点是 `document.baseURI`（宿主实际服务 UI 的那个目录），不是 `location.pathname`
 * —— dsh 的 Web UI 不做路径路由，所以 `pathname` 不能当挂载点用。
 * @param route - {@link ROUTES} 里的相对路径。
 * @returns 可直接喂给 `fetch` 的路径。
 */
export function apiPath(route: string): string {
  const relative = route.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const base = document.baseURI
  if (typeof base !== 'string' || base === '') return `/${relative}`
  try {
    return new URL(relative, base).pathname
  } catch {
    return `/${relative}`
  }
}

/** 可读的错误文本。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 宿主路由返回的业务失败，附带机器可读的 code。 */
export class HostRouteError extends Error {
  /** 宿主给的错误码，如 `bad-extra-json`。 */
  readonly code: string
  /** HTTP 状态码（网络层失败时为 0）。 */
  readonly status: number
  /**
   * 宿主附带的诊断行（`/generate` 失败时给）。
   *
   * 这是「看不全」的补丁：上游只说一句 `HTTP 400 …`，而这几行告诉用户
   * 「我们实际发了哪些字段、裁掉了什么、日志文件在哪」。
   */
  readonly diagnostics: string[]

  constructor(message: string, code: string, status: number, diagnostics: string[] = []) {
    super(message)
    this.name = 'HostRouteError'
    this.code = code
    this.status = status
    this.diagnostics = diagnostics
  }
}

/**
 * 打一次宿主路由，返回 `ok: true` 的响应体。
 *
 * 网络层失败（宿主半边没挂上、路由 404、非 JSON 响应）统一抛
 * {@link HostRouteError}：调用方只需要处理一种错误形状。
 * @param route - 相对路由。
 * @param init - fetch 参数。
 * @returns 解析后的响应对象。
 */
async function callHost(route: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const path = apiPath(route)
  let response: Response
  try {
    response = await fetch(path, { headers: { accept: 'application/json' }, ...init })
  } catch (error) {
    throw new HostRouteError(`连不上宿主路由 ${path}：${messageOf(error)}`, 'network', 0)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new HostRouteError(
      `宿主路由 ${path} 返回了非 JSON（HTTP ${response.status}）—— 多半是路由没挂上，被 SPA 兜底处理了`,
      'non-json',
      response.status,
    )
  }
  if (typeof body !== 'object' || body === null) {
    throw new HostRouteError(`宿主路由 ${path} 返回了非对象响应`, 'bad-shape', response.status)
  }

  const record = body as Record<string, unknown>
  if (record.ok !== true) {
    const message = typeof record.message === 'string' && record.message !== ''
      ? record.message
      : `宿主路由 ${path} 拒绝了请求（HTTP ${response.status}）`
    const code = typeof record.code === 'string' ? record.code : 'unknown'
    const diagnostics = Array.isArray(record.diagnostics)
      ? record.diagnostics.filter((item): item is string => typeof item === 'string')
      : []
    throw new HostRouteError(message, code, response.status, diagnostics)
  }
  return record
}

// -------------------------------------------------------------- 响应收敛

/** 取字符串字段，缺省时回退。 */
function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** 协议取值守卫。 */
function isProtocol(value: unknown): value is Protocol {
  return value === 'openrouter' || value === 'openai' || value === 'gemini' || value === 'custom'
}

/** 输出格式取值守卫。`svg` 是上游矢量化模型唯一接受的格式。 */
function isOutputFormat(value: unknown): value is PanelConfig['outputFormat'] {
  return value === 'png' || value === 'jpeg' || value === 'webp' || value === 'svg'
}

/** 张数区间（缺省 0/0 = 不支持参考图）。 */
function toReferenceRange(raw: unknown): ReferenceRange {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  const min = num(source.min)
  return { min, max: Math.max(min, num(source.max)) }
}

/**
 * 把宿主回的配置收敛成 {@link PanelConfig}。
 *
 * 宽松：字段缺失/类型不对就退回默认值。宿主已经校验过一遍，这里只是不让一个
 * 意外字段把整个面板打成白屏。
 * @param raw - 响应里的 `config`。
 * @returns 面板可直接用的配置。
 */
export function toPanelConfig(raw: unknown): PanelConfig {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    protocol: isProtocol(source.protocol) ? source.protocol : DEFAULT_CONFIG.protocol,
    baseUrl: asString(source.baseUrl, DEFAULT_CONFIG.baseUrl),
    // 这两个字段**只信宿主**：hasKey 是布尔、keyHint 是掩码，明文根本到不了这里。
    hasKey: source.hasKey === true,
    keyHint: asString(source.keyHint, ''),
    model: asString(source.model, DEFAULT_CONFIG.model),
    autoSaveDir: asString(source.autoSaveDir, DEFAULT_CONFIG.autoSaveDir),
    extraJson: typeof source.extraJson === 'string' ? source.extraJson : DEFAULT_CONFIG.extraJson,
    timeoutSec: typeof source.timeoutSec === 'number' && Number.isFinite(source.timeoutSec)
      ? source.timeoutSec
      : DEFAULT_CONFIG.timeoutSec,
    outputFormat: isOutputFormat(source.outputFormat) ? source.outputFormat : DEFAULT_CONFIG.outputFormat,
  }
}

/**
 * 取出要发给宿主的字段。
 *
 * 刻意**丢掉** `hasKey` / `keyHint`：那是宿主算出来的状态，前端回传只会制造
 * 「谁说了算」的歧义。明文 Key 走 `plainKey` 参数，是另一条独立通道。
 * @param config - 面板配置。
 * @returns 只含宿主可写字段的对象。
 */
export function toOutboundConfig(config: PanelConfig): Record<string, unknown> {
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    autoSaveDir: config.autoSaveDir,
    extraJson: config.extraJson,
    timeoutSec: config.timeoutSec,
    outputFormat: config.outputFormat,
  }
}

/**
 * 收敛「模型可配置参数表」。
 *
 * 每个字段都要过一遍类型守卫才收：宿主已经按字段规格表组装过，但这里是最后一道
 * 防线 —— 一个形状不对的字段会让参数行渲染成空白控件，比整行不显示更难排查。
 * @param raw - 响应里的 `parameters`。
 * @returns 可渲染的参数字段；形状不对的条目直接丢弃。
 */
export function toParameters(raw: unknown): ParameterField[] {
  if (!Array.isArray(raw)) return []
  const controls = ['select', 'count', 'number', 'toggle', 'text']
  const valueTypes = ['string', 'integer', 'boolean']
  const out: ParameterField[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const source = item as Record<string, unknown>
    const name = asString(source.name, '')
    if (name === '') continue
    const control = controls.includes(asString(source.control, '')) ? asString(source.control, '') as ParameterField['control'] : 'text'
    const valueType = valueTypes.includes(asString(source.valueType, ''))
      ? asString(source.valueType, '') as ParameterField['valueType']
      : 'string'
    const num = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined
    const values = Array.isArray(source.values)
      ? source.values.filter((entry): entry is string => typeof entry === 'string')
      : undefined
    out.push({
      name,
      label: asString(source.label, name),
      control,
      valueType,
      group: source.group === 'advanced' ? 'advanced' : 'output',
      ...values === undefined || values.length === 0 ? {} : { values },
      ...num(source.min) === undefined ? {} : { min: num(source.min)! },
      ...num(source.max) === undefined ? {} : { max: num(source.max)! },
      clearable: source.clearable === true,
      default: asString(source.default, ''),
      hint: asString(source.hint, ''),
    })
  }
  return out
}

/** 参数候选值表（五项都必须是字符串数组）。 */
function toOptions(raw: unknown): ModelOption['options'] {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return {
    aspectRatio: list(source.aspectRatio),
    resolution: list(source.resolution),
    count: list(source.count),
    quality: list(source.quality),
    outputFormat: list(source.outputFormat),
  }
}

/**
 * 收敛模型列表。
 *
 * 没有 `id` 的条目直接丢弃 —— 一个 id 为空的模型会让下拉框出现一个选不中的幽灵项。
 * @param raw - 响应里的 `models`。
 * @returns 可用的模型候选。
 */
export function toModelOptions(raw: unknown): ModelOption[] {
  if (!Array.isArray(raw)) return []
  const out: ModelOption[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const source = item as Record<string, unknown>
    if (typeof source.id !== 'string' || source.id === '') continue
    out.push({
      id: source.id,
      caps: Array.isArray(source.caps) ? source.caps.filter((cap): cap is string => typeof cap === 'string') : [],
      price: asString(source.price, ''),
      supportsReferences: source.supportsReferences === true,
      references: toReferenceRange(source.references),
      options: toOptions(source.options),
      parameters: toParameters(source.parameters),
      supportsStreaming: source.supportsStreaming === true,
    })
  }
  return out
}

/**
 * 收敛一张图（历史条目 / 生成结果同形）。
 * @param raw - 宿主给的图对象。
 * @returns 可渲染的图；结构不成形时返回 undefined（该条目被跳过）。
 */
export function toImage(raw: unknown): GeneratedImage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = raw as Record<string, unknown>
  const id = typeof source.id === 'string' && source.id !== '' ? source.id : undefined
  if (id === undefined) return undefined
  // `imageUrl` 是宿主给的**相对路径**，这里按挂载点解析 —— 反代挂前缀也取得到图。
  const imageUrl = typeof source.imageUrl === 'string' && source.imageUrl !== ''
    ? apiPath(source.imageUrl)
    : undefined
  const model = asString(source.model, '')
  const params = toImageParams(source.params)
  const sentFields = toStringMap(source.sentFields)
  const referenceCount = typeof source.referenceCount === 'number' && Number.isFinite(source.referenceCount)
    ? Math.max(0, Math.round(source.referenceCount))
    : undefined
  return {
    id,
    art: asString(source.art, 'a'),
    ...imageUrl === undefined ? {} : { imageUrl },
    size: asString(source.size, ''),
    ...typeof source.cost === 'number' && Number.isFinite(source.cost) ? { cost: source.cost } : {},
    seconds: typeof source.seconds === 'number' && Number.isFinite(source.seconds) ? source.seconds : 0,
    prompt: asString(source.prompt, ''),
    aspectRatio: asString(source.aspectRatio, '1:1'),
    resolution: asString(source.resolution, '1K'),
    createdAt: typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
    ...typeof source.savedPath === 'string' && source.savedPath !== '' ? { savedPath: source.savedPath } : {},
    ...typeof source.autoSavedPath === 'string' && source.autoSavedPath !== '' ? { autoSavedPath: source.autoSavedPath } : {},
    ...typeof source.count === 'number' && Number.isFinite(source.count) && source.count > 1 ? { count: source.count } : {},
    // ---- 2026-10-11 新增：这张图当时用的是哪个模型、哪些参数。
    // 老条目没有这些键 —— 界面按「升级前的记录」降级，不用空对象冒充。
    ...model === '' ? {} : { model },
    ...params === undefined ? {} : { params },
    ...sentFields === undefined ? {} : { sentFields },
    ...referenceCount === undefined ? {} : { referenceCount },
  }
}

/**
 * 收敛「当时用的参数」。
 * @param raw - 宿主给的 `params`。
 * @returns 参数快照；结构不成形时返回 undefined（当作老条目）。
 */
export function toImageParams(raw: unknown): ImageParams | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = raw as Record<string, unknown>
  const count = typeof source.count === 'number' && Number.isFinite(source.count) ? Math.max(1, Math.round(source.count)) : 1
  return {
    aspectRatio: asString(source.aspectRatio, ''),
    resolution: asString(source.resolution, ''),
    count,
    quality: asString(source.quality, ''),
    extra: toStringMap(source.extra) ?? {},
  }
}

/** 收敛一个「字符串 → 字符串」的扁平表；不是对象时返回 undefined。 */
function toStringMap(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value)
    else if (typeof value === 'boolean') out[key] = String(value)
  }
  return out
}

/**
 * 收敛一份草稿。
 * @param raw - 宿主给的 `draft`（`null` = 还没有草稿）。
 * @returns 草稿；没有/结构不成形时返回 undefined。
 */
export function toPanelDraft(raw: unknown): PanelDraft | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = raw as Record<string, unknown>
  const params = (typeof source.params === 'object' && source.params !== null ? source.params : {}) as Record<string, unknown>
  return {
    prompt: asString(source.prompt, ''),
    params: {
      aspectRatio: asString(params.aspectRatio, ''),
      resolution: asString(params.resolution, ''),
      count: asString(params.count, '1') || '1',
      quality: asString(params.quality, ''),
    },
    extra: toStringMap(source.extra) ?? {},
    lastGeneratedPrompt: asString(source.lastGeneratedPrompt, ''),
    // 舞台恢复用的那根引用。旧宿主 / 旧草稿文件里没有这个键 → 空串 = 不恢复舞台。
    lastImageId: asString(source.lastImageId, ''),
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
  }
}

/**
 * 收敛模型能力明细。
 * @param raw - 响应里的 `capabilities`。
 * @returns 面板可直接用的能力对象；缺字段时给安全默认。
 */
export function toCapabilities(raw: unknown): ModelCapabilities {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  const providerOptions: ProviderOption[] = []
  if (Array.isArray(source.providerOptions)) {
    for (const item of source.providerOptions) {
      if (typeof item !== 'object' || item === null) continue
      const entry = item as Record<string, unknown>
      const slug = asString(entry.slug, '')
      if (slug === '') continue
      providerOptions.push({ slug, name: asString(entry.name, slug), params: strings(entry.params) })
    }
  }
  return {
    model: asString(source.model, ''),
    price: asString(source.price, ''),
    supportsReferences: source.supportsReferences === true,
    caps: strings(source.caps),
    providers: strings(source.providers),
    passthrough: strings(source.passthrough),
    providerOptions,
    // 拿不到这个字段时按「可用」处理（老宿主 / 其他协议）—— 宁可放行一次必失败的调用，
    // 也不要因为字段缺失就把模型全标成不可用。
    available: source.available !== false,
    references: toReferenceRange(source.references),
    referencesDeclaredMax: typeof source.referencesDeclaredMax === 'number' && Number.isFinite(source.referencesDeclaredMax)
      ? Math.max(0, Math.round(source.referencesDeclaredMax))
      : 0,
    options: toOptions(source.options),
    parameters: toParameters(source.parameters),
    supportsStreaming: source.supportsStreaming === true,
  }
}

/**
 * 收敛一条宿主日志（级别不认识就按 info 记）。
 * @param raw - 宿主给的条目。
 * @returns 可渲染的日志；没有正文时返回 undefined（该条被跳过）。
 */
export function toLogEntry(raw: unknown): HostLogEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const source = raw as Record<string, unknown>
  const text = asString(source.text, '')
  if (text === '') return undefined
  const level = source.level === 'warn' || source.level === 'error' ? source.level : 'info'
  return {
    seq: typeof source.seq === 'number' && Number.isFinite(source.seq) ? source.seq : 0,
    at: asString(source.at, ''),
    level,
    text,
  }
}

// ------------------------------------------------------------------ 后端
/**
 * 造一个打宿主路由的后端。
 * @returns 生产用 {@link Backend} 实现。
 */
export function createHttpBackend(): Backend {
  return {
    async loadConfig(signal) {
      const body = await callHost(ROUTES.config, signal === undefined ? {} : { signal })
      return toPanelConfig(body.config)
    },

    async saveConfig(config, plainKey, signal) {
      // 明文 Key 只在这一次 PUT 里存在。空串 = 不改动已有的 Key。
      const body = await callHost(ROUTES.config, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ config: toOutboundConfig(config), apiKey: plainKey }),
        ...signal === undefined ? {} : { signal },
      })
      return toPanelConfig(body.config)
    },

    async listModels(_config, signal) {
      const body = await callHost(ROUTES.models, signal === undefined ? {} : { signal })
      return {
        models: toModelOptions(body.models),
        ...typeof body.note === 'string' && body.note !== '' ? { note: body.note } : {},
      }
    },

    async modelCapabilities(_config, modelId, resolution, signal) {
      const query = new URLSearchParams({ model: modelId })
      if (resolution !== undefined && resolution !== '') query.set('resolution', resolution)
      const body = await callHost(`${ROUTES.capabilities}?${query.toString()}`, signal === undefined ? {} : { signal })
      return toCapabilities(body.capabilities)
    },

    async generate(config, request: GenerateRequest, signal) {
      const started = Date.now()
      try {
        const body = await callHost(ROUTES.generate, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ config: toOutboundConfig(config), request }),
          ...signal === undefined ? {} : { signal },
        })
        const image = toImage(body.image)
        if (image === undefined) {
          throw new GenerateError('生成失败', '宿主返回的图片结构不完整（缺少 id）')
        }
        const count = typeof body.count === 'number' && Number.isFinite(body.count) ? body.count : 1
        return {
          ...image,
          ...count > 1 ? { count } : {},
          seconds: image.seconds > 0 ? image.seconds : Math.round((Date.now() - started) / 1000),
        }
      } catch (error) {
        // 宿主拒绝 / 网络失败 / 上游报错，全都变成面板能直接展示的「生成失败 + 原文」。
        if (error instanceof GenerateError) throw error
        const code = error instanceof HostRouteError ? error.code : 'unknown'
        const lines = [messageOf(error), `（code: ${code}）`]
        // 诊断行是宿主给的「我到底发了什么」—— 直接摊在错误卡片里，
        // 用户不用去翻日志就能判断是不是参数没发对。
        if (error instanceof HostRouteError && error.diagnostics.length > 0) {
          lines.push('', '本次请求的实际参数：', ...error.diagnostics.map((line) => `· ${line}`))
        }
        throw new GenerateError('生成失败', lines.join('\n'))
      }
    },

    async listHistory(signal) {
      const body = await callHost(ROUTES.history, signal === undefined ? {} : { signal })
      if (!Array.isArray(body.images)) return []
      return body.images.map(toImage).filter((image): image is GeneratedImage => image !== undefined)
    },

    async saveImage(id, target, signal) {
      const body = await callHost(ROUTES.save, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id, ...target === undefined ? {} : { target } }),
        ...signal === undefined ? {} : { signal },
      })
      const savedPath = typeof body.savedPath === 'string' ? body.savedPath : ''
      if (savedPath === '') throw new HostRouteError('宿主没有返回保存路径', 'bad-shape', 200)
      return savedPath
    },

    async openImage(id, signal) {
      const body = await callHost(ROUTES.open, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id }),
        ...signal === undefined ? {} : { signal },
      })
      return typeof body.path === 'string' ? body.path : ''
    },

    async fetchLogs(limit = 200, signal) {
      const body = await callHost(`${ROUTES.logs}?limit=${encodeURIComponent(String(limit))}`, signal === undefined ? {} : { signal })
      const raw = Array.isArray(body.entries) ? body.entries : []
      return {
        entries: raw.map(toLogEntry).filter((entry): entry is HostLogEntry => entry !== undefined),
        file: asString(body.file, ''),
        dir: asString(body.dir, ''),
        count: typeof body.count === 'number' && Number.isFinite(body.count) ? body.count : raw.length,
      }
    },

    async loadDraft(signal) {
      const body = await callHost(ROUTES.draft, signal === undefined ? {} : { signal })
      return toPanelDraft(body.draft)
    },

    async saveDraft(draft, signal) {
      try {
        const body = await callHost(ROUTES.draft, {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ draft }),
          ...signal === undefined ? {} : { signal },
        })
        return body.ok === true
      } catch {
        // 草稿落盘失败不打扰用户：宿主已经记了 warn 日志，面板照常能用，
        // 而且下一次改动会再试一遍。**不能抛** —— 抛出去会打断正在打字的人。
        return false
      }
    },
  }
}

export { ROUTES }
