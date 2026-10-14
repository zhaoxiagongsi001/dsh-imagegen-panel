/**
 * OpenRouter 图像接口适配层（阶段 4）。
 *
 * 官方文档与 2026-10-10 实测（`.ref/probe-openrouter.mjs`）确认的事实：
 *
 * | 端点 | 鉴权 | 内容 |
 * |---|---|---|
 * | `GET  {base}/images/models` | **公开**（无需 Key） | 59 个模型；每个带 `architecture`、`supported_parameters`、`supports_streaming`、`endpoints` 链接。**没有定价** |
 * | `GET  {base}/images/models/<id>/endpoints` | **公开** | 每个 provider 的权威 `supported_parameters` + `pricing` + `allowed_passthrough_parameters` |
 * | `POST {base}/images` | **要 Key** | 请求 `{model, prompt, n, resolution, aspect_ratio, quality, output_format, input_references, …}`；响应 `{created, data:[{b64_json, media_type}], usage:{cost,…}}` |
 *
 * `supported_parameters` 的值是**能力描述符**：`{type:'enum', values:[…]}` /
 * `{type:'range', min, max}` / `{type:'boolean'}`。**key 缺失 = 不支持** ——
 * 这条规矩是整个插件的核心约束（PLAN 硬约束 3），所以这里的 `sanitizeBody()`
 * 就是它的执行者：模型不声明的字段，一个都不往上送。
 *
 * 定价形状（实测）：`pricing` 是数组，元素 `{billable, unit, cost_usd, variant?}`。
 * `unit: 'image'` 时按张计价，可能带 `variant`（分辨率档位）；`unit: 'token'` 时
 * 是 token 价（`billable: 'output_image'` 那项才是出图成本）。
 */

/** 一个模型的能力描述符。 */
export interface ParameterSpec {
  type?: string
  values?: unknown[]
  min?: number
  max?: number
}

/** `supported_parameters` 映射。 */
export type SupportedParameters = Record<string, ParameterSpec | undefined>

/** 参考图的允许张数区间（`min > 0` = **必填**，是「改图专用」模型）。 */
export interface ReferenceRange {
  min: number
  max: number
}

/** 一个 provider 允许透传的私有参数（key 就是它的 slug）。 */
export interface ProviderOption {
  /** 作 `provider.options[<slug>]` 的键 —— **实测带区域/variant 后缀，必须动态取**。 */
  slug: string
  /** 展示名（如 Google AI Studio）。 */
  name: string
  /** 该 provider 允许透传的参数名。 */
  params: string[]
}

/** 面板要的模型候选（与 `src/client/types.ts` 的 `ModelOption` 逐字段对应）。 */
export interface ModelOption {
  id: string
  caps: string[]
  price: string
  supportsReferences: boolean
  /** 参考图张数区间（0/0 = 不支持）。`min >= 1` 时不给参考图就是非法请求。 */
  references: ReferenceRange
  options: {
    aspectRatio: string[]
    resolution: string[]
    count: string[]
    quality: string[]
    /** 该模型允许的输出格式；空数组 = 不声明 `output_format`（发了反而错）。 */
    outputFormat: string[]
  }
  /**
   * 该模型可配置的参数表（列表接口就能算出来，不用等 `/capabilities`）。
   *
   * 它和 `options` 是**同一份事实的两种形态**：`options` 是给固定四行的老界面用的
   * 候选值，`parameters` 是给「按模型变形」的参数表用的。两个都留着是为了让
   * 没有能力表的协议（OpenAI / Gemini / 自定义）继续走 `options` 那条老路。
   */
  parameters: ParameterField[]
  /** 顶层 `supports_streaming`（`stream` 字段不在 `supported_parameters` 里）。 */
  supportsStreaming: boolean
}

/** 一个模型的能力明细（`GET /capabilities` 的返回体）。 */
export interface ModelCapabilities {
  model: string
  price: string
  supportsReferences: boolean
  caps: string[]
  providers: string[]
  passthrough: string[]
  /** 每个 provider 的 slug 与可透传参数（拼 `provider.options` 用）。 */
  providerOptions: ProviderOption[]
  /** 该模型当前有没有可服务的 endpoint。false = 调了必失败（如 `meta/muse-image`）。 */
  available: boolean
  references: ReferenceRange
  /**
   * 模型**自己声明**的参考图上限（未按网关全局 `maxItems: 16` 收敛）。
   *
   * 只有它大于 `references.max` 时才值得一提 —— 那是
   * `tencent/hy-image-v3.5-preview` 这种「模型说 20、接口只收 16」的情况，
   * 界面需要用它解释差额。
   */
  referencesDeclaredMax: number
  options: ModelOption['options']
  /** 该模型可配置的参数表（界面按它渲染，选不同模型就长不一样）。 */
  parameters: ParameterField[]
  /** 是否有任何 endpoint 原生支持 SSE。 */
  supportsStreaming: boolean
}

/** 出图结果里的一张图。 */
export interface RawImage {
  b64: string
  mediaType: string
}

/** 上游一次生成的解析结果。 */
export interface ParsedGeneration {
  images: RawImage[]
  cost?: number
  usage?: Record<string, unknown>
}

/** 模型列表的缓存时长；`DSH_IMAGEGEN_MODELS_TTL_MS=0` 可关掉（自检用）。 */
function modelsTtlMs(): number {
  const raw = process.env.DSH_IMAGEGEN_MODELS_TTL_MS
  if (raw === undefined || raw.trim() === '') return 10 * 60 * 1000
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : 10 * 60 * 1000
}

/**
 * 模型目录缓存。
 *
 * 为什么这里可以缓存而配置不行：配置是**用户状态**（磁盘文件是唯一真相，缓存会掩盖手改）；
 * 模型目录是**上游只读数据**，10 分钟内不会变，而 `/generate` 每次都要靠它做字段裁剪 ——
 * 不缓存就等于每出一张图多打一次 1.4 秒的上游请求。
 */
interface ModelsCache {
  at: number
  baseUrl: string
  models: ModelOption[]
  params: Map<string, SupportedParameters>
}

let cache: ModelsCache | undefined

/** 清掉模型缓存（换 Base URL 或测试用）。 */
export function clearModelsCache(): void {
  cache = undefined
}

// --------------------------------------------------------------- 纯函数

/** 是否是对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 取字符串数组（`{type:'enum', values:[…]}`）。 */
function enumValues(spec: ParameterSpec | undefined): string[] {
  if (spec === undefined || !Array.isArray(spec.values)) return []
  return spec.values.filter((item): item is string => typeof item === 'string')
}

/** 把 `{type:'range', min, max}` 展开成张数候选。 */
function rangeValues(spec: ParameterSpec | undefined, cap: number): string[] {
  if (spec === undefined) return []
  const min = typeof spec.min === 'number' ? Math.max(1, Math.round(spec.min)) : 1
  const max = typeof spec.max === 'number' ? Math.min(cap, Math.round(spec.max)) : min
  if (max < min) return []
  const out: string[] = []
  for (let value = min; value <= max; value += 1) out.push(String(value))
  return out
}

/**
 * `input_references` 的**网关全局上限**（官方 OpenAPI `maxItems: 16`）。
 *
 * 为什么模型自己的 `max` 不够用：两者会打架。实测
 * `tencent/hy-image-v3.5-preview` 声明 `input_references: {min:0, max:20}`，
 * 而 OpenAPI 的 `ImageGenerationRequest.input_references.maxItems` 写死 **16**。
 * 模型级枚举网关**不校验**（越界值透传 provider），但全局 `maxItems` **是校验的**
 * （400 ZodError、全有或全无计费）。所以能真的发出去的张数是
 * `min(模型声明, 16)` —— 发 17 张换回来的是一次失败。
 */
export const GLOBAL_MAX_REFERENCES = 16

/**
 * 参考图的张数区间。
 *
 * `min >= 1` 的模型是**改图专用**（实测 5 个：`ming-image-0.1-design-layer` 必须 1 张、
 * `recraft-v4-styles` 四兄弟必须 ≥1）—— 不给参考图就是非法请求，面板必须自己拦住。
 * `{type:'boolean'}` 这种没有数值的描述符按「最多 1 张」处理（保守，不虚报额度）。
 *
 * **上限一律按 {@link GLOBAL_MAX_REFERENCES} 收敛**：模型声明得再宽，网关也只收 16 张。
 * 原始声明值由 {@link declaredReferencesFrom} 单独取，用来向用户解释差额。
 * @param spec - `input_references` 的描述符。
 * @returns `{min, max}`；不支持时 `{0, 0}`。
 */
function referencesFrom(spec: ParameterSpec | undefined): ReferenceRange {
  const declared = declaredReferencesFrom(spec)
  return { min: declared.min, max: Math.min(declared.max, GLOBAL_MAX_REFERENCES) }
}

/**
 * 模型**自己声明**的参考图区间（未按全局上限收敛）。
 * @param spec - `input_references` 的描述符。
 * @returns 原始 `{min, max}`；不支持时 `{0, 0}`。
 */
function declaredReferencesFrom(spec: ParameterSpec | undefined): ReferenceRange {
  if (spec === undefined) return { min: 0, max: 0 }
  if (spec.type === 'boolean') return { min: 0, max: 1 }
  const min = typeof spec.min === 'number' && spec.min > 0 ? Math.round(spec.min) : 0
  const max = typeof spec.max === 'number' && spec.max > 0 ? Math.round(spec.max) : 0
  return { min, max: Math.max(min, max) }
}

/**
 * 由 `supported_parameters` 生成面板要的参数候选值。
 *
 * **没有硬编码的候选值**：每一项都来自上游声明，key 缺失就是空数组
 * （面板侧会退化成「保持当前值」，而不是给一个假的候选表）。
 * @param params - 模型的 supported_parameters。
 * @returns 五项候选值。
 */
export function optionsFrom(params: SupportedParameters): ModelOption['options'] {
  return {
    aspectRatio: enumValues(params.aspect_ratio),
    resolution: enumValues(params.resolution),
    count: rangeValues(params.n, 10),
    quality: enumValues(params.quality),
    outputFormat: enumValues(params.output_format),
  }
}

/**
 * 一个模型参数在界面上的**规格**。
 *
 * 上游的 `supported_parameters` 只告诉我们「声明形状」（`enum` / `range` / `boolean`），
 * 而**形状不等于值类型** —— 这是整件事里最容易搞错的一处：
 * `seed: {type:'boolean'}` 不是说 seed 的值是布尔，而是说「这个字段被支持」，
 * 它的值是整数；`size: {type:'boolean'}` 同理，值是字符串（`"2K"` 或 `"2048x2048"`）。
 * 所以「控件形态 / 值类型 / 中文标签」必须由本地的 {@link FIELD_SPECS} 补齐，
 * 只有取值来源（枚举值 / 区间）来自上游。
 */
export interface ParameterField {
  /** 请求体字段名，如 `n` / `resolution` / `background`。 */
  name: string
  /** 中文标签。 */
  label: string
  /** 面板控件形态。 */
  control: 'select' | 'count' | 'number' | 'toggle' | 'text'
  /** 写进请求体时的值类型。 */
  valueType: 'string' | 'integer' | 'boolean'
  /** 分组：`output` = 输出规格，`advanced` = 高级。 */
  group: 'output' | 'advanced'
  /** `select` / `count` 的候选值（**只来自该模型自己的声明**）。 */
  values?: string[]
  /** `number` 的区间。 */
  min?: number
  /** `number` 的区间。 */
  max?: number
  /** 留空是否等于「不发这个字段」（`seed` / `size` / `output_compression` 是）。 */
  clearable: boolean
  /** 面板首次见到该字段时用的值；`''` = 默认不发。 */
  default: string
  /** 一句说明（含该字段特有的坑）。 */
  hint: string
  /**
   * 值必须匹配的正则（宿主侧校验）。
   *
   * 只给 `size` 用：它的描述符是 `{type:'boolean'}` —— 只说明「支持这个字段」，
   * **没有值域**。而 {@link allowsValue} 对非 enum 描述符一律放行，于是任何非空字符串
   * 都会被原样透传上游（换回一个被忽略的字段或一次 502）。官方对它的口径是
   * 「档位（`2K`）或像素（`2048x2048`）」，那就按这个形状在本地先拦一道。
   */
  pattern?: string
}

/**
 * 字段规格表 —— 这张表 + 上游的 `supported_parameters` 共同决定界面。
 *
 * **只列模型级请求字段**：`input_references` 由参考图槽单独承载（它不是一行下拉），
 * `provider` / `user` / `session_id` 是全局字段（对所有模型都合法，与模型能力无关），
 * 它们都不在这张表里。
 *
 * 这张表是 2026-10-10 对 **全部 59 个真实模型**逐个扫描后定的：
 * `GET /images/models` 与逐 endpoint 的 `supported_parameters` 里，
 * 一共只出现过 10 个键：`input_references` `aspect_ratio` `n` `resolution`
 * `output_format` `seed` `background` `quality` `output_compression` `size`。
 * 表里没有、上游也没声明的字段，面板一律不显示、也绝不发送。
 */
export const FIELD_SPECS: readonly ParameterField[] = [
  {
    name: 'aspect_ratio',
    label: '比例',
    control: 'select',
    valueType: 'string',
    group: 'output',
    clearable: false,
    default: '1:1',
    hint: '取值就是该模型声明的那些，没有 `auto` 的模型别硬填 auto。',
  },
  {
    name: 'resolution',
    label: '分辨率',
    control: 'select',
    valueType: 'string',
    group: 'output',
    clearable: false,
    default: '1K',
    hint: '标准化档位，具体像素由 provider 换算。',
  },
  {
    name: 'size',
    label: '尺寸',
    control: 'text',
    valueType: 'string',
    group: 'output',
    clearable: true,
    default: '',
    hint: '档位（512 / 768 / 1K / 1.5K / 2K / 4K）或像素（2048x2048）。给像素时它是权威值，别再同时给比例/分辨率（会 400）。',
    // 官方口径就是这两种写法。上游描述符是 boolean（没有值域），不自己拦一道
    // 的话任何手滑的字符串都会被打上去。
    pattern: '^(512|768|1K|1\\.5K|2K|4K|[0-9]{2,5}x[0-9]{2,5})$',
  },
  {
    name: 'n',
    label: '张数',
    control: 'count',
    valueType: 'integer',
    group: 'output',
    clearable: false,
    default: '1',
    hint: '上游可以返回比 n 更少的张数。',
  },
  {
    name: 'quality',
    label: '质量',
    control: 'select',
    valueType: 'string',
    group: 'output',
    clearable: false,
    default: 'auto',
    hint: '官方全局 6 档，但**每个模型只收自己声明的那几档**（有的只有 low/medium）。',
  },
  {
    name: 'output_format',
    label: '输出格式',
    control: 'select',
    valueType: 'string',
    group: 'output',
    clearable: false,
    default: 'png',
    hint: '矢量模型只收 svg、`riverflow-v2.5-fast` 只收 jpeg —— 以本模型的枚举为准。',
  },
  {
    name: 'background',
    label: '背景',
    control: 'select',
    valueType: 'string',
    group: 'output',
    clearable: false,
    default: 'auto',
    hint: 'transparent 要求输出格式是 png 或 webp，否则会被上游忽略。',
  },
  {
    name: 'output_compression',
    label: '压缩',
    control: 'number',
    valueType: 'integer',
    group: 'advanced',
    clearable: true,
    default: '',
    hint: '0–100，只对 jpeg/webp 生效，png 忽略；留空 = 用上游默认。',
  },
  {
    name: 'seed',
    label: '随机种子',
    control: 'number',
    valueType: 'integer',
    group: 'advanced',
    clearable: true,
    default: '',
    hint: '留空 = 每次随机（**默认就该留空**，填死会让每次出图都一样）；填了也只是「尽量」复现。',
  },
]

/** `stream` 不在 `supported_parameters` 里，它由顶层 `supports_streaming` 表达。 */
export const STREAM_FIELD: ParameterField = {
  name: 'stream',
  label: '流式预览',
  control: 'toggle',
  valueType: 'boolean',
  group: 'advanced',
  clearable: false,
  default: 'false',
  hint: '只有原生支持 SSE 的通道真支持（目前是 OpenAI 系）；其余忽略这个标志。',
}

/** 该字段的候选值里挑一个能用的默认值（声明的默认值不在候选里时退第一个）。 */
function defaultValueOf(field: ParameterField, values: string[], min: number | undefined): string {
  if (field.clearable && field.default === '') return ''
  if (field.control === 'select' || field.control === 'count') {
    if (field.default !== '' && values.includes(field.default)) return field.default
    return values[0] ?? ''
  }
  if (field.control === 'number') return field.default
  return field.default
}

/**
 * 由模型的 `supported_parameters` 生成界面参数表。
 *
 * **只输出该模型真的声明了的字段** —— key 缺失 = 不支持，不发也不显示。
 * 这条规矩的代价是界面会随模型变，收益是用户不会再看到一堆「选了也没用」的下拉。
 * @param params - 该模型的 `supported_parameters`（模型级与 endpoint 级并集）。
 * @param supportsStreaming - 顶层 `supports_streaming`。
 * @returns 该模型可配置的参数，顺序与 {@link FIELD_SPECS} 一致。
 */
export function parametersFrom(params: SupportedParameters, supportsStreaming: boolean): ParameterField[] {
  const out: ParameterField[] = []
  for (const field of FIELD_SPECS) {
    const spec = params[field.name]
    if (spec === undefined) continue
    const next: ParameterField = { ...field }
    if (field.control === 'select') {
      const values = enumValues(spec)
      // 声明了字段但描述符不是 enum（例如 `size: {type:'boolean'}`）→ 退回自由文本，
      // 而不是给一个空下拉。宁可让用户手填，也不能假装我们知道候选值。
      if (values.length === 0) { next.control = 'text'; next.clearable = true; next.default = '' }
      else { next.values = values; next.default = defaultValueOf(field, values, undefined) }
    } else if (field.control === 'count') {
      const values = rangeValues(spec, 10)
      if (values.length === 0) continue
      next.values = values
      next.min = Number(values[0])
      next.max = Number(values[values.length - 1])
      next.default = values.includes(field.default) ? field.default : values[0]!
    } else if (field.control === 'number') {
      // `range` 描述符给的是**值域**；`boolean` 描述符（`seed` 是这种）没有值域，
      // 那就只给一个输入框，不在前端编造上下限 —— 交给上游判定。
      if (spec.type === 'range') {
        if (typeof spec.min === 'number') next.min = Math.round(spec.min)
        if (typeof spec.max === 'number') next.max = Math.round(spec.max)
      }
      next.default = defaultValueOf(field, [], next.min)
    }
    out.push(next)
  }
  if (supportsStreaming) out.push({ ...STREAM_FIELD })
  return out
}

/** 能力标签（弹层里那几个小 chip）。 */
function capsFrom(model: Record<string, unknown>, params: SupportedParameters): string[] {
  const caps: string[] = []
  const refs = referencesFrom(params.input_references)
  if (refs.max > 0) caps.push(refs.min > 0 ? '改图必填底图' : '图生图')
  else caps.push('仅文生图')

  const architecture = isRecord(model.architecture) ? model.architecture : {}
  const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : []
  if (outputs.includes('text')) caps.push('图文双出')

  const ratios = enumValues(params.aspect_ratio).length
  if (ratios > 0) caps.push(`${ratios} 种比例`)

  const resolutions = enumValues(params.resolution)
  if (resolutions.length > 0) caps.push(`分辨率 ${resolutions.join('/')}`)

  const qualities = enumValues(params.quality).length
  if (qualities > 0) caps.push(`${qualities} 档质量`)

  if (model.supports_streaming === true) caps.push('流式')

  return caps
}

/**
 * 解析 `GET /images/models` 的响应。
 * @param payload - 上游 JSON。
 * @returns 模型候选（没有 id 的条目丢弃）。
 */
export function parseImageModels(payload: unknown): { models: ModelOption[]; params: Map<string, SupportedParameters> } {
  const models: ModelOption[] = []
  const params = new Map<string, SupportedParameters>()

  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
  for (const item of data) {
    if (!isRecord(item)) continue
    const id = typeof item.id === 'string' ? item.id : ''
    if (id === '') continue

    const supported = isRecord(item.supported_parameters)
      ? (item.supported_parameters as SupportedParameters)
      : {}
    params.set(id, supported)
    const references = referencesFrom(supported.input_references)
    const streaming = item.supports_streaming === true
    models.push({
      id,
      caps: capsFrom(item, supported),
      // 定价不在列表接口里，得单独拉 /endpoints —— 面板选中模型后再补。
      price: '',
      supportsReferences: references.max > 0,
      references,
      options: optionsFrom(supported),
      // 列表接口就带了 `supported_parameters` 与 `supports_streaming`，所以参数表
      // 在这里就能算出来 —— 用户切模型时立刻看到正确的参数行，不用等第二次请求。
      parameters: parametersFrom(supported, streaming),
      supportsStreaming: streaming,
    })
  }
  return { models, params }
}

/** 一个定价条目。 */
interface PricingEntry {
  billable?: string
  unit?: string
  cost_usd?: number
  variant?: string
}

/** 把美元金额格式化成人看的样子（定价位数不固定，所以按量级选小数位）。 */
function formatUsd(value: number): string {
  if (value === 0) return '$0'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  if (value >= 0.0001) return `$${value.toFixed(4)}`
  return `$${value.toFixed(6)}`
}

/**
 * 从定价数组里算一句人话。
 *
 * 优先「按张」（`unit: 'image'`）；有 `variant`（分辨率档位）时优先匹配当前分辨率，
 * 匹配不上就取最便宜的那档 —— 报价宁可偏低也别虚高，虚高会让人不敢用。
 * 没有按张定价时退回出图 token 价。
 * @param pricing - 一个 endpoint 的 pricing 数组。
 * @param resolution - 当前分辨率档位（可空）。
 * @returns 如 `$0.041/张`、`$0.00012/token`；算不出时空串。
 */
export function priceFrom(pricing: unknown, resolution?: string): string {
  if (!Array.isArray(pricing)) return ''
  const entries = pricing.filter(isRecord) as PricingEntry[]

  const perImage = entries.filter((entry) => entry.unit === 'image' && typeof entry.cost_usd === 'number')
  if (perImage.length > 0) {
    const wanted = typeof resolution === 'string' ? resolution.toLowerCase() : ''
    const matched = wanted === ''
      ? undefined
      : perImage.find((entry) => typeof entry.variant === 'string' && entry.variant.toLowerCase() === wanted)
    // 「最便宜」只在正价里挑：上游有些档位挂着 `cost_usd: 0`（多半是还没定价，
    // 不是免费）。拿 0 当最便宜会把报价显示成 `$0`，那是在骗用户。
    const positive = perImage.filter((entry) => entry.cost_usd! > 0)
    const pool = positive.length > 0 ? positive : perImage
    const chosen = matched ?? pool.reduce((best, entry) => (entry.cost_usd! < best.cost_usd! ? entry : best))
    return `${formatUsd(chosen.cost_usd!)}/张${typeof chosen.variant === 'string' ? `（${chosen.variant}）` : ''}`
  }

  const outputTokens = entries.filter((entry) => entry.billable === 'output_image' && typeof entry.cost_usd === 'number')
  if (outputTokens.length > 0) {
    const cheapest = outputTokens.reduce((best, entry) => (entry.cost_usd! < best.cost_usd! ? entry : best))
    return `${formatUsd(cheapest.cost_usd!)}/token（出图）`
  }

  return ''
}

/** 合并两个参数描述符（跨 provider 取并集）。 */
function unionSpec(left: ParameterSpec | undefined, right: ParameterSpec | undefined): ParameterSpec | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  if (left.type === 'enum' || right.type === 'enum') {
    const values: string[] = []
    for (const value of [...enumValues(left), ...enumValues(right)]) {
      if (!values.includes(value)) values.push(value)
    }
    return { type: 'enum', values }
  }
  if (left.type === 'range' || right.type === 'range') {
    const leftMin = typeof left.min === 'number' ? left.min : Number.POSITIVE_INFINITY
    const rightMin = typeof right.min === 'number' ? right.min : Number.POSITIVE_INFINITY
    const leftMax = typeof left.max === 'number' ? left.max : Number.NEGATIVE_INFINITY
    const rightMax = typeof right.max === 'number' ? right.max : Number.NEGATIVE_INFINITY
    return { type: 'range', min: Math.min(leftMin, rightMin), max: Math.max(leftMax, rightMax) }
  }
  return { type: 'boolean' }
}

/**
 * 解析 `GET /images/models/<id>/endpoints`，合并出该模型的权威能力与定价。
 * @param payload - 上游 JSON。
 * @param resolution - 当前分辨率档位，用于挑对应档位的报价。
 * @returns 能力明细。
 */
export function parseCapabilities(payload: unknown, resolution?: string): ModelCapabilities {
  const endpoints = isRecord(payload) && Array.isArray(payload.endpoints) ? payload.endpoints : []
  const providers: string[] = []
  const passthrough: string[] = []
  const providerOptions: ProviderOption[] = []
  let merged: SupportedParameters = {}
  let price = ''
  /** 任一 endpoint 原生支持 SSE 就算支持。 */
  let streaming = false
  /** 参考图的跨 provider 交集（见下方注释）；`undefined` = 还没有 provider 表态。 */
  let refMin = 0
  let refMax: number | undefined
  /** 模型声明的原始上限（未按全局 `maxItems` 收敛），供界面解释差额。 */
  let refDeclaredMax = 0

  for (const endpoint of endpoints) {
    if (!isRecord(endpoint)) continue
    const name = typeof endpoint.provider_name === 'string' ? endpoint.provider_name : ''
    if (name !== '' && !providers.includes(name)) providers.push(name)
    if (endpoint.supports_streaming === true) streaming = true

    const slug = typeof endpoint.provider_slug === 'string' ? endpoint.provider_slug : ''
    const allowed = Array.isArray(endpoint.allowed_passthrough_parameters)
      ? endpoint.allowed_passthrough_parameters.filter((item): item is string => typeof item === 'string')
      : []
    // `provider.options` 的键是 **slug**（实测带区域/variant 后缀，同族还各不相同：
    // flux.2-pro 是 `black-forest-labs`，flux.2-max 是 `black-forest-labs/us-3`）。
    // 所以只能在拿到 endpoints 之后才知道该填什么，不能照抄文档示例。
    if (slug !== '' && allowed.length > 0 && !providerOptions.some((item) => item.slug === slug)) {
      providerOptions.push({ slug, name: name === '' ? slug : name, params: allowed })
    }
    for (const item of allowed) {
      if (!passthrough.includes(item)) passthrough.push(item)
    }

    const supported = isRecord(endpoint.supported_parameters)
      ? (endpoint.supported_parameters as SupportedParameters)
      : {}
    const next: SupportedParameters = { ...merged }
    for (const [key, spec] of Object.entries(supported)) next[key] = unionSpec(merged[key], spec)
    merged = next

    // 参考图张数**取交集**（只在与声明了 `input_references` 的 provider 之间取），
    // 与上面参数候选值的「取并集」相反：比例/分辨率是给用户挑的范围，多一个不亏；
    // 而参考图数量是硬约束 —— 取并集会让面板放行一个某个 provider 必拒的张数。
    // 完全不声明这个键的 provider 不参与：那只说明「它对此没有说法」，
    // 而模型级（列表接口）已经表态支持了，不该被一个沉默的 endpoint 归零。
    if (supported.input_references !== undefined) {
      // 模型声明的原始上限（未收敛）—— 跨 provider 取最大，用来解释与全局上限的差额。
      refDeclaredMax = Math.max(refDeclaredMax, declaredReferencesFrom(supported.input_references).max)
      const refs = referencesFrom(supported.input_references)
      if (refMax === undefined) { refMin = refs.min; refMax = refs.max }
      else { refMin = Math.max(refMin, refs.min); refMax = Math.min(refMax, refs.max) }
    }

    // 多 provider 时取第一个能算出报价的（同一模型各 provider 价差通常很小，
    // 真要精确比价得看 order/sort 配置，那是阶段 6 的事）。
    if (price === '') price = priceFrom(endpoint.pricing, resolution)
  }

  const references: ReferenceRange = refMax === undefined
    ? { min: 0, max: 0 }
    : { min: refMin, max: Math.max(refMin, refMax) }

  return {
    model: isRecord(payload) && typeof payload.id === 'string' ? payload.id : '',
    price,
    supportsReferences: references.max > 0,
    caps: capsFrom({}, merged),
    providers,
    passthrough,
    providerOptions,
    available: endpoints.length > 0,
    references,
    referencesDeclaredMax: refDeclaredMax,
    options: optionsFrom(merged),
    parameters: parametersFrom(merged, streaming),
    supportsStreaming: streaming,
  }
}

/** 面板参数里的中文质量档 → OpenRouter 的英文枚举。 */
const QUALITY_ALIASES: Record<string, string> = {
  自动: 'auto',
  高: 'high',
  中: 'medium',
  低: 'low',
  极高: 'xhigh',
  最高: 'max',
}

/**
 * 归一化质量档。
 *
 * 面板的历史默认值是中文（「高」），而 OpenRouter 只认 `auto/low/medium/high` ——
 * 不归一化就会把「高」原样发上去，换回一个 400。
 * @param value - 面板给的值。
 * @returns 英文枚举；认不出来时返回空串（调用方据此丢弃该字段）。
 */
export function normalizeQuality(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed in QUALITY_ALIASES) return QUALITY_ALIASES[trimmed]!
  return ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(trimmed.toLowerCase())
    ? trimmed.toLowerCase()
    : ''
}

/** 一次生成的入参（宿主侧）。 */
export interface GenerateInput {
  prompt: string
  model: string
  aspectRatio: string
  resolution: string
  count: number
  quality: string
  /** 参考图的 data URL（图生图）。 */
  references: string[]
  /**
   * 模型驱动表单收集到的**其它**字段（键 = 请求体字段名，值一律字符串）。
   *
   * 哪些键会出现完全由所选模型的 `supported_parameters` 决定：`background`
   * `output_compression` `seed` `size` `stream`，以及覆盖配置默认值的 `output_format`。
   * 空串 = 用户没填（`seed` / `size` / `output_compression` 允许留空）→ 不发这个字段。
   */
  extra?: Record<string, string>
}

/** 组装请求体时需要知道的东西。 */
export interface BuildContext {
  /** 该模型的 `supported_parameters`；undefined = 未知模型（此时只发核心字段，交给上游校验）。 */
  params: SupportedParameters | undefined
  /**
   * 该模型是否原生支持 SSE。
   *
   * **`stream` 不在 `supported_parameters` 里**，它由模型/endpoint 顶层的
   * `supports_streaming` 单独表达 —— 光看 `params` 会把 `stream` 当成「模型没声明」
   * 而裁掉，那就等于这个开关永远发不出去。所以要单独传一路。
   */
  supportsStreaming?: boolean
  /** 配置里的输出格式。 */
  outputFormat: string
  /** 配置里的「额外参数」原文（JSON 字符串）。 */
  extraJson: string
}

/**
 * 该描述符接受这个取值吗。
 *
 * `enum` 严格比对；`range` / `boolean` 或没有 `values` 的按「不限制」放行 ——
 * 上游对取值不做校验（实测：给只收 `["svg"]` 的模型发 `output_format:"png"`，
 * 网关只报了 `n` 的问题，这两个字段一字未提），越界值会**原样透传给 provider**，
 * 换回一个被忽略的字段或者一次 502。所以值级校验只能我们自己做。
 * @param spec - 参数描述符。
 * @param value - 待发值。
 * @returns 是否允许。
 */
function allowsValue(spec: ParameterSpec | undefined, value: string): boolean {
  if (spec === undefined || spec.type !== 'enum') return true
  const values = enumValues(spec)
  return values.length === 0 || values.includes(value)
}

/** 把张数夹进 `n` 声明的区间。 */
function clampCount(spec: ParameterSpec | undefined, value: number): number {
  if (spec === undefined) return value
  const min = typeof spec.min === 'number' ? Math.max(1, Math.round(spec.min)) : 1
  const max = typeof spec.max === 'number' ? Math.max(min, Math.round(spec.max)) : Number.POSITIVE_INFINITY
  return Math.min(max, Math.max(min, value))
}

/**
 * 把「其它整数参数」夹进它声明的区间。
 *
 * 与 {@link clampCount} 的区别：**下限不硬提** —— `output_compression` 的合法值从 0 开始，
 * 用张数那套会把 0 改成 1。描述符不是 `range`（例如 `seed` 的 `{type:'boolean'}`）
 * 就不夹：上游没给值域，我们也不编一个。
 * @param spec - 参数描述符。
 * @param value - 待发值（已取整）。
 * @returns 收敛后的值。
 */
function clampExtraNumber(spec: ParameterSpec | undefined, value: number): number {
  if (spec === undefined || spec.type !== 'range') return value
  const min = typeof spec.min === 'number' ? Math.round(spec.min) : Number.NEGATIVE_INFINITY
  const max = typeof spec.max === 'number' ? Math.round(spec.max) : Number.POSITIVE_INFINITY
  return Math.min(max, Math.max(min, value))
}

/** 把描述符还原成一句人话（用于 `dropped` 里的原因说明）。 */
function describeSpec(spec: ParameterSpec | undefined): string {
  if (spec === undefined) return '未知'
  if (spec.type === 'enum') return enumValues(spec).join('/') || '枚举'
  if (spec.type === 'range') {
    const min = typeof spec.min === 'number' ? spec.min : '?'
    const max = typeof spec.max === 'number' ? spec.max : '?'
    return `${min}–${max}`
  }
  return '上游声明的取值'
}

/**
 * 组装 `POST /images` 的请求体。
 *
 * **两级规矩**：
 * 1. 键级 —— 模型没声明的字段一个都不发（key 缺失 = 不支持）。把不支持的字段
 *    发上去，上游要么 400、要么静默忽略 —— 前者让用户困惑，后者更糟：用户以为自己选了。
 * 2. 值级 —— 模型声明了但取值不在它的枚举/区间里，**也不发**（并如实记入 `dropped`）。
 *    上游网关只校验全局 schema（`output_format` 只要是 png/jpeg/webp/svg 就放行），
 *    不看每个模型自己的枚举，所以诸如「给只收 svg 的向量模型发 png」不会被拦下 ——
 *    它会被透传给 provider，换回一个被忽略的字段或一次 502。
 *
 * `extraJson` 最后合并，且**不许覆盖 model/prompt**（那是本次请求的身份）。
 * @param input - 本次生成参数。
 * @param context - 模型能力与配置。
 * @returns 请求体；`dropped` 列出被裁掉的字段，便于日志与自检。
 */
export function buildImageRequest(input: GenerateInput, context: BuildContext): { body: Record<string, unknown>; dropped: string[]; overridden: string[] } {
  const { params } = context
  const spec = (key: string): ParameterSpec | undefined => params?.[key]
  const supports = (key: string): boolean => params === undefined || params[key] !== undefined
  const dropped: string[] = []
  /**
   * 被配置里那段「额外参数」JSON **覆盖掉**的字段名。
   *
   * 与 `dropped` 是相反的两件事：`dropped` 是「没发出去」，这里是「发出去了、
   * 但不是面板上那个值」。不区分开的话，用户永远查不出「我明明选了 80」。
   */
  const overridden: string[] = []

  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
  }

  if (input.count > 1 || supports('n')) {
    if (supports('n')) {
      const wanted = clampCount(spec('n'), input.count)
      body.n = wanted
      if (wanted !== input.count) dropped.push(`n（该模型只允许 ${wanted} 张）`)
    } else if (input.count > 1) {
      dropped.push('n')
    }
  }

  if (input.aspectRatio !== '') {
    if (!supports('aspect_ratio')) dropped.push('aspect_ratio')
    else if (!allowsValue(spec('aspect_ratio'), input.aspectRatio)) dropped.push(`aspect_ratio（该模型不支持 ${input.aspectRatio}）`)
    else body.aspect_ratio = input.aspectRatio
  }

  if (input.resolution !== '') {
    if (!supports('resolution')) dropped.push('resolution')
    else if (!allowsValue(spec('resolution'), input.resolution)) dropped.push(`resolution（该模型不支持 ${input.resolution}）`)
    else body.resolution = input.resolution
  }

  const quality = normalizeQuality(input.quality)
  if (quality !== '') {
    if (!supports('quality')) dropped.push('quality')
    else if (!allowsValue(spec('quality'), quality)) dropped.push(`quality（该模型不支持 ${quality}）`)
    else body.quality = quality
  } else if (input.quality.trim() !== '') {
    dropped.push('quality（无法识别）')
  }

  // 输出格式：**本次请求里模型驱动表单选的那个优先**（它才是按该模型枚举来的），
  // 配置里的 `outputFormat` 退居「默认值 / 非 OpenRouter 协议」的角色。
  const outputFormat = input.extra?.['output_format'] ?? context.outputFormat
  if (outputFormat !== '') {
    if (!supports('output_format')) dropped.push('output_format')
    else if (!allowsValue(spec('output_format'), outputFormat)) {
      dropped.push(`output_format（该模型只支持 ${enumValues(spec('output_format')).join('/') || '其它格式'}）`)
    } else body.output_format = outputFormat
  }

  // ---- 模型驱动表单里的其它字段（`background` / `output_compression` / `seed` /
  //      `size` / `stream`）。规矩与上面完全一致：模型没声明就不发；声明了但取值
  //      不在枚举/区间里，也不发（并如实记进 `dropped`）。
  for (const [key, raw] of Object.entries(input.extra ?? {})) {
    if (key === 'output_format') continue
    const value = typeof raw === 'string' ? raw.trim() : ''
    // 空串 = 用户没填（`seed` / `size` / `output_compression` 允许留空），
    // 这是「不发这个字段」，不是「发一个空值」。
    if (value === '') continue
    const field = FIELD_SPECS.find((item) => item.name === key) ?? (key === 'stream' ? STREAM_FIELD : undefined)
    if (field === undefined) {
      // 面板只会提交它还认识、且该模型声明过的字段；能走到这里说明是外部构造的请求体。
      dropped.push(`${key}（不是模型级请求字段）`)
      continue
    }
    // `stream` 是唯一的例外：它的「声明」在顶层 `supports_streaming` 上，
    // 不在 `supported_parameters` 里，所以要按另一路判。
    const declared = key === 'stream'
      ? context.supportsStreaming === true
      : supports(key)
    if (!declared) {
      dropped.push(key === 'stream' ? 'stream（该模型没有原生流式通道）' : key)
      continue
    }

    if (field.valueType === 'boolean') {
      // 开关只在「开」的时候发：`stream:false` 与不发这个字段在语义上等价，
      // 少发一个字段就少一处能被上游挑剔的地方。
      if (value === 'true') body[key] = true
      continue
    }
    if (field.valueType === 'integer') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) { dropped.push(`${key}（不是数字）`); continue }
      const rounded = Math.round(parsed)
      // 注意**不能**复用 `clampCount()`：那个函数把下限硬提到 1（对「张数」是对的，
      // 因为 0 张没有意义），而 `output_compression` 的合法下限就是 0。
      const clamped = clampExtraNumber(spec(key), rounded)
      body[key] = clamped
      if (clamped !== rounded) dropped.push(`${key}（超出该模型允许的 ${describeSpec(spec(key))}，已收敛为 ${clamped}）`)
      continue
    }
    if (!allowsValue(spec(key), value)) {
      dropped.push(`${key}（该模型不支持 ${value}）`)
      continue
    }
    // `size` 这种「描述符没值域」的字段只能靠本地形状校验兜住 —— 上游不会拦，
    // 它只会把这个字符串透传给 provider，换回一个被忽略的字段或一次 502。
    if (field.pattern !== undefined && !new RegExp(field.pattern).test(value)) {
      dropped.push(`${key}（格式不对：应是档位如 2K，或像素如 2048x2048）`)
      continue
    }
    body[key] = value
  }

  if (input.references.length > 0) {
    if (supports('input_references')) {
      const refs = referencesFrom(spec('input_references'))
      if (refs.max === 0) {
        // 声明了这个键、但区间是 0/0（实测 `inclusionai/ming-image-0.1-design` 就是）
        // —— 那是「明确不接受参考图」，不是「没限制」。
        dropped.push('input_references（该模型不接受参考图）')
      } else if (input.references.length > refs.max) {
        // 不发超出上限的那些：上游对 per-model 上限同样不校验，多出来的会让
        // provider 拒掉整次请求（502）。截断 + 如实回报，比整次失败好。
        dropped.push(`input_references（该模型最多 ${refs.max} 张，已只用前 ${refs.max} 张）`)
        body.input_references = input.references.slice(0, refs.max).map((url) => ({ type: 'image_url', image_url: { url } }))
      } else {
        body.input_references = input.references.map((url) => ({ type: 'image_url', image_url: { url } }))
      }
    } else {
      dropped.push('input_references（该模型不支持参考图）')
    }
  }

  // 额外参数最后合并：用户显式写的东西优先，但不许改掉 model/prompt。
  //
  // ⚠️ 它可能覆盖面板上**看得见**的同名字段 —— 本机默认配置里就写着
  // `output_compression: 90` 与 `background: "opaque"`，而那两个字段原来没有界面、
  // 现在有了。覆盖照旧生效（配置是用户显式写的，优先级最高），但必须**如实记下来**：
  // 否则用户会在面板上选 80、实际发 90 —— 这正是「以为设上了」的老毛病。
  if (context.extraJson.trim() !== '') {
    try {
      const extra: unknown = JSON.parse(context.extraJson)
      if (isRecord(extra)) {
        for (const [key, value] of Object.entries(extra)) {
          if (key === 'model' || key === 'prompt') continue
          if (key in body) overridden.push(key)
          body[key] = value
        }
      }
    } catch {
      // 配置在写入时已经校验过 JSON；这里静默跳过（生成不该因为一段额外参数崩掉）。
    }
  }

  return { body, dropped, overridden }
}

/**
 * 解析 `POST /images` 的响应。
 * @param payload - 上游 JSON。
 * @returns 图片数组与花费；结构不成形时 images 为空。
 */
export function parseGeneration(payload: unknown): ParsedGeneration {
  const out: ParsedGeneration = { images: [] }
  if (!isRecord(payload)) return out

  if (isRecord(payload.usage) && typeof payload.usage.cost === 'number') {
    out.cost = payload.usage.cost
    out.usage = payload.usage
  }

  const data = Array.isArray(payload.data) ? payload.data : []
  for (const item of data) {
    if (!isRecord(item)) continue
    const b64 = typeof item.b64_json === 'string' ? item.b64_json : ''
    if (b64 === '') continue
    out.images.push({
      b64,
      mediaType: typeof item.media_type === 'string' && item.media_type !== '' ? item.media_type : 'image/png',
    })
  }
  return out
}

/** 一条 Zod 校验问题（400 响应体里的原始形状，实测）。 */
interface ZodIssue {
  code?: string
  path?: unknown[]
  message?: string
  minimum?: number
  maximum?: number
}

/** 把一条 Zod 问题翻成一句人话。 */
function describeIssue(issue: ZodIssue): string {
  const parts = Array.isArray(issue.path) ? issue.path.filter((item) => typeof item === 'string' || typeof item === 'number') : []
  const name = parts.length > 0 ? parts.join('.') : '请求体'
  switch (issue.code) {
    case 'too_small': return `${name} 必须 ≥ ${issue.minimum ?? '?'}`
    case 'too_big': return `${name} 必须 ≤ ${issue.maximum ?? '?'}`
    case 'invalid_value': return `${name} 的取值不在允许范围内`
    case 'invalid_type': return `${name} 的类型不对`
    case 'unrecognized_keys': return `${name} 里有上游不认识的字段`
    default: return `${name}：${issue.message ?? '校验失败'}`
  }
}

/**
 * 试图解开 ZodError 的 `message`。
 *
 * 400 的 `error.message` **本身是一段 JSON 字符串**（实测），原样展示就是一坨
 * 转义字符，用户看不懂。这里尝试二次解析，成功就把每条问题翻成人话；失败返回
 * undefined，由调用方退回原文（**绝不吞掉上游信息**）。
 * @param message - `error.message` 原文。
 * @returns 每行一条的可读文本；解不开时 undefined。
 */
function describeZodError(message: string): string | undefined {
  let issues: unknown
  try {
    issues = JSON.parse(message) as unknown
  } catch {
    return undefined
  }
  if (!Array.isArray(issues)) return undefined
  const lines = issues.filter(isRecord).map((issue) => describeIssue(issue as ZodIssue)).filter((line) => line !== '')
  return lines.length > 0 ? lines.join('\n') : undefined
}

/**
 * 把上游的报错转成一句能直接展示给用户的话。
 *
 * **不做美化转述**：OpenRouter 的原文（402 余额不足、429 限流、模型不存在…）
 * 比我们编的更有用。只在前面补一个 HTTP 状态，方便用户贴给别人看。
 * 唯一的加工是 400 的 ZodError：它的 `message` 是转义 JSON，翻成人话再展示。
 * @param status - HTTP 状态码。
 * @param text - 响应体原文。
 * @returns 可展示文本。
 */
export function describeUpstreamError(status: number, text: string): string {
  const trimmed = text.trim()
  if (trimmed !== '') {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isRecord(parsed)) {
        const error = parsed.error
        if (isRecord(error) && typeof error.message === 'string' && error.message !== '') {
          const friendly = error.name === 'ZodError' ? describeZodError(error.message) : undefined
          return `HTTP ${status}\n${friendly ?? error.message}`
        }
        if (typeof error === 'string' && error !== '') return `HTTP ${status}\n${error}`
        if (typeof parsed.message === 'string' && parsed.message !== '') return `HTTP ${status}\n${parsed.message}`
      }
    } catch {
      // 不是 JSON：原样带出去。
    }
    return `HTTP ${status}\n${trimmed.slice(0, 2000)}`
  }
  return `HTTP ${status}（上游没有返回内容）`
}

// --------------------------------------------------------------- 网络调用

/** 拼接 base 与路径（base 可能带或不带尾斜杠）。 */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/** 读一个上游 JSON（GET）。 */
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    ...signal === undefined ? {} : { signal },
  })
  const text = await response.text()
  if (!response.ok) {
    const error = new Error(describeUpstreamError(response.status, text)) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`上游返回了非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`)
  }
}

/** 探测可用性时的单条超时与并发度。 */
const PROBE_TIMEOUT_MS = 8000
const PROBE_CONCURRENCY = 6

/**
 * 把外部信号与一个超时合成一个。
 *
 * 不用 `AbortSignal.any`：那要求运行环境与 tsconfig 的 lib 都认识它，手写这几行
 * 不挑环境，语义也一目了然。
 * @param signal - 外部信号（可空）。
 * @param ms - 毫秒超时。
 * @returns 合成信号 + 清理函数。
 */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  const onAbort = (): void => { controller.abort() }
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** 探测可用性的开关：`DSH_IMAGEGEN_SKIP_AVAILABILITY=1` 可整体跳过（排查用）。 */
function skipAvailabilityProbe(): boolean {
  return process.env.DSH_IMAGEGEN_SKIP_AVAILABILITY === '1'
}

/**
 * 剔掉目录里**没有可服务通道**的模型。
 *
 * 为什么必须单独探一次：`/images/models` 的条目里**没有任何「有没有通道」的信号**
 * （`ImageModelListItem` 只有 architecture / supported_parameters / endpoints 链接），
 * 而目录里确实躺着 `meta/muse-image` 这种 `endpoints: []` 的模型 —— 选中它生成必失败，
 * 报价还是空的。只有逐个拉 `/endpoints` 才知道谁是真的死的。
 *
 * **失败即放行**：超时 / 报错 / 被限流一律当作「有通道」。探测本身的问题绝不能
 * 把一个能用的模型从列表里删掉 —— 那比多显示一个坏条目严重得多。
 * @param baseUrl - 上游基础地址。
 * @param models - 目录里的模型。
 * @param signal - 取消。
 * @returns 保留下来的模型。
 */
async function dropUnservedModels(baseUrl: string, models: ModelOption[], signal?: AbortSignal): Promise<ModelOption[]> {
  const served: boolean[] = models.map(() => true)
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= models.length) return
      const gate = withTimeout(signal, PROBE_TIMEOUT_MS)
      try {
        const payload = await getJson(joinUrl(baseUrl, `/images/models/${models[index]!.id}/endpoints`), gate.signal)
        const endpoints = isRecord(payload) && Array.isArray(payload.endpoints) ? payload.endpoints : []
        // 只有「拿到 200、且明确是空数组」才算死条目；其余情况都不动它。
        served[index] = endpoints.length > 0
      } catch {
        // 失败即放行。
      } finally {
        gate.dispose()
      }
    }
  }

  const size = Math.max(1, Math.min(PROBE_CONCURRENCY, models.length))
  await Promise.all(Array.from({ length: size }, () => worker()))
  return models.filter((_model, index) => served[index] === true)
}

/**
 * 拉模型目录（带缓存）。
 * @param baseUrl - 形如 `https://openrouter.ai/api/v1`。
 * @param signal - 取消。
 * @param force - 忽略缓存。
 * @returns 模型候选与各自的 supported_parameters。
 */
export async function getImageModels(
  baseUrl: string,
  signal?: AbortSignal,
  force = false,
): Promise<{ models: ModelOption[]; params: Map<string, SupportedParameters> }> {
  const ttl = modelsTtlMs()
  if (!force && cache !== undefined && cache.baseUrl === baseUrl && Date.now() - cache.at < ttl) {
    return { models: cache.models, params: cache.params }
  }
  const payload = await getJson(joinUrl(baseUrl, '/images/models'), signal)
  const parsed = parseImageModels(payload)
  const models = skipAvailabilityProbe() ? parsed.models : await dropUnservedModels(baseUrl, parsed.models, signal)
  if (ttl > 0) {
    cache = { at: Date.now(), baseUrl, models, params: parsed.params }
  }
  return { models, params: parsed.params }
}

/** 拉一个模型的权威能力与定价。 */
export async function getModelCapabilities(
  baseUrl: string,
  modelId: string,
  resolution?: string,
  signal?: AbortSignal,
): Promise<ModelCapabilities> {
  // 模型 id 里有斜杠（`google/gemini-3-pro-image`），直接拼进路径 —— 上游就是这么设计的。
  const payload = await getJson(joinUrl(baseUrl, `/images/models/${modelId}/endpoints`), signal)
  return parseCapabilities(payload, resolution)
}

/** 一次上游生成调用的结果。 */
export type GenerateOutcome =
  | { kind: 'ok'; parsed: ParsedGeneration; elapsedSec: number }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'aborted' }

/**
 * 发一次生成请求（协议无关：URL / 请求头 / 请求体 / 响应解析都由调用方给）。
 *
 * 取消与超时都靠 `AbortSignal`：调用方把「客户端断开」与「超时」两个信号合成一个传进来。
 * 这里把 abort 的两种原因分开报 —— 「用户点了取消」和「上游太慢」对用户是两件事。
 * @param options - 计划（URL/头/体/解析器）+ 信号 + 是否因超时而中断。
 * @returns 归一化结果。
 */
export async function postGeneration(options: {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  /** 把上游响应解析成图片数组（各协议形状不同，由 `providers.ts` 决定）。 */
  parse: (payload: unknown) => ParsedGeneration
  signal: AbortSignal
  timedOut: () => boolean
}): Promise<GenerateOutcome> {
  const started = Date.now()
  let response: Response
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal.aborted) {
      return options.timedOut()
        ? { kind: 'timeout', message: `上游在超时时间内没有响应（可在「高级」里调大超时）` }
        : { kind: 'aborted' }
    }
    return { kind: 'error', status: 0, message: `连不上上游：${error instanceof Error ? error.message : String(error)}` }
  }

  const text = await response.text()
  if (!response.ok) {
    return { kind: 'error', status: response.status, message: describeUpstreamError(response.status, text) }
  }

  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch {
    return { kind: 'error', status: response.status, message: `上游返回了非 JSON：${text.slice(0, 400)}` }
  }

  const parsed = options.parse(payload)
  if (parsed.images.length === 0) {
    return {
      kind: 'error',
      status: response.status,
      message: `上游返回里没有图片数据（这个协议的响应里没有 base64 图片）。原始响应：${text.slice(0, 600)}`,
    }
  }

  return { kind: 'ok', parsed, elapsedSec: Math.max(1, Math.round((Date.now() - started) / 1000)) }
}
