/**
 * 生图面板的共享类型。
 *
 * 这些类型刻意按「宿主路由会返回什么」来定，而不是按某个后端实现来定 ——
 * 阶段 3 把实现从 mock 换成真 fetch 时，UI 一行都没改。
 */

/** 生图协议。各家接口形式不同，所以这是配置项而非硬编码。 */
export type Protocol = 'openrouter' | 'openai' | 'gemini' | 'custom'

/**
 * 输出图片格式。
 *
 * `svg` 是**必须的**：上游 6 个矢量化模型（`recraft/*-vector`）的
 * `output_format` 枚举只有 `["svg"]`，发别的都是越界值。
 */
export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'svg'

/** 参考图张数区间（`min >= 1` = 必须给底图，是「改图专用」模型）。 */
export interface ReferenceRange {
  min: number
  max: number
}

/** 一个 provider 允许透传的私有参数（key 就是它的 slug）。 */
export interface ProviderOption {
  /** 作 `provider.options[<slug>]` 的键；**带区域/variant 后缀，必须按接口返回的用**。 */
  slug: string
  /** 展示名。 */
  name: string
  /** 允许透传的参数名。 */
  params: string[]
}

/**
 * 一个模型参数在界面上的规格。
 *
 * 为什么不能直接用 `supported_parameters` 渲染：它的描述符只说明**声明形状**
 * （`enum` / `range` / `boolean`），而**形状不等于值类型** ——
 * `seed: {type:'boolean'}` 是说「支持 seed 这个字段」，值其实是整数；
 * `size: {type:'boolean'}` 同理，值是字符串（`"2K"` / `"2048x2048"`）。
 * 所以「控件形态 / 值类型 / 中文标签」由宿主侧的字段规格表补齐，
 * 只有取值来源（枚举值 / 区间）来自上游。
 *
 * 这张表是**按模型变**的：选 A 模型可能是「比例 + 分辨率 + 张数」，
 * 选 B 模型可能是「尺寸 + 背景 + 种子」。界面完全由它驱动。
 */
export interface ParameterField {
  /** 请求体字段名，如 `n` / `resolution` / `background`。 */
  name: string
  /** 中文标签。 */
  label: string
  /** 控件形态。 */
  control: 'select' | 'count' | 'number' | 'toggle' | 'text'
  /** 写进请求体时的值类型。 */
  valueType: 'string' | 'integer' | 'boolean'
  /** 分组：`output` = 输出规格（常态展示），`advanced` = 高级。 */
  group: 'output' | 'advanced'
  /** `select` / `count` 的候选值（只来自该模型自己的声明）。 */
  values?: string[]
  /** `number` 的区间。 */
  min?: number
  /** `number` 的区间。 */
  max?: number
  /** 留空是否等于「不发这个字段」。 */
  clearable: boolean
  /** 首次见到该字段时用的值；`''` = 默认不发。 */
  default: string
  /** 一句说明。 */
  hint: string
}

/** 面板配置。对应宿主 `~/.dsh/dsh-imagegen-panel/config.json` 的**可下发部分**。 */
export interface PanelConfig {
  protocol: Protocol
  /** 各协议基础地址。OpenRouter 默认 https://openrouter.ai/api/v1 */
  baseUrl: string
  /**
   * Key 是否已在宿主侧配置好。
   *
   * 注意这里是 **boolean 而不是 key 本身** —— 宿主路由只回 `hasKey`，
   * 明文永不下发到浏览器。阶段 3 的实现必须守住这条。
   */
  hasKey: boolean
  /** Key 的掩码尾串，仅用于让用户确认「配的是哪一把」。宿主提供。 */
  keyHint: string
  /** 默认模型 id，如 google/gemini-3-pro-image */
  model: string
  /** 出图后自动落盘目录 */
  autoSaveDir: string
  /** 高级：原样透传给提供商的额外 JSON */
  extraJson: string
  /** 超时秒数 */
  timeoutSec: number
  outputFormat: OutputFormat
}

/** 可选生图模型（阶段 4 由 `GET /images/models` 动态拉取）。 */
export interface ModelOption {
  id: string
  /** 能力标签，如「图生图」「1:1…21:9」 */
  caps: string[]
  /** 展示用价格，如 `$0.039/张` */
  price: string
  /** 是否支持参考图（图生图）。不支持时 UI 应禁用参考图槽。 */
  supportsReferences: boolean
  /**
   * 参考图张数区间。
   *
   * 为什么不能写死一个上限：实测 59 个模型的上限从 **1 到 20** 都有，其中 15 个
   * 只允许 1 张；另有 5 个 `min >= 1`（不给底图就是非法请求）。
   */
  references: ReferenceRange
  /**
   * 该模型支持的参数候选值。
   *
   * 关键设计：比例 / 分辨率 / 张数 / 质量 / 输出格式的候选值是**模型能力驱动**的，
   * 不是硬编码。阶段 4 从 `GET /images/models/<id>/endpoints` 的
   * `supported_parameters` 生成（key 缺失 = 不支持；`outputFormat` 为空数组表示
   * 该模型不声明这个字段，发过去只会被忽略）。
   */
  options: {
    aspectRatio: string[]
    resolution: string[]
    count: string[]
    quality: string[]
    outputFormat: string[]
  }
  /**
   * 该模型可配置的参数表 —— **界面就是按它渲染的**。
   *
   * 与 `options` 的关系：同一份事实的两种形态。`options` 只覆盖固定的四项
   * （比例/分辨率/张数/质量），是「没有能力表的协议」那条老路用的；
   * `parameters` 覆盖该模型声明的**全部**字段，选不同模型就长不一样。
   */
  parameters: ParameterField[]
  /** 顶层 `supports_streaming`（`stream` 不在 `supported_parameters` 里）。 */
  supportsStreaming: boolean
}

/** 一次生成的请求参数。 */
export interface GenerateRequest {
  prompt: string
  model: string
  aspectRatio: string
  resolution: string
  count: number
  quality: string
  /** 参考图的 data URL（图生图）。空数组 = 纯文生图。 */
  references: string[]
  /**
   * 模型驱动表单收集到的其它字段（键 = 请求体字段名，值一律字符串）。
   *
   * 键的集合完全由所选模型的 `parameters` 决定。空串 = 用户没填 → 宿主不发这个字段。
   */
  extra?: Record<string, string>
}

/** 一张生成的图。 */
export interface GeneratedImage {
  id: string
  /** 占位图形变体键（历史里的种子数据 / 无真图时用）。 */
  art: string
  /**
   * 真图的地址（宿主 `/dsh-imagegen/image/<id>`，已按挂载点解析成绝对路径）。
   *
   * 阶段 4 起是真图；`art` 只在没有它时才被渲染成占位插画。
   */
  imageUrl?: string
  /** 像素尺寸，展示用 */
  size: string
  /** OpenRouter 返回的 `usage.cost`（美元）。失败/未计费时为 undefined。 */
  cost?: number
  /** 生成耗时（秒） */
  seconds: number
  prompt: string
  aspectRatio: string
  resolution: string
  createdAt: number
  /** 落盘在宿主数据目录里的完整路径（`~/.dsh/dsh-imagegen-panel/out/…`） */
  savedPath?: string
  /**
   * **自动另存到工作区目录**后的完整路径（配置了「自动保存目录」时才有）。
   *
   * 与 `savedPath` 的区别：`savedPath` 是插件的仓库，`autoSavedPath` 是用户配的那个目录 ——
   * 也就是他真正会去找图的地方。界面上优先显示后者。
   */
  autoSavedPath?: string
  /** 同一次生成实际落盘的张数（`n > 1` 时大于 1）。 */
  count?: number
  /**
   * 生成这张图时用的模型。
   *
   * 面板**不会**因为点了一条历史记录就切模型（老板拍板：设置区的模型不动），
   * 所以这个值只用来在结果行里如实告诉用户「这张是哪个模型生的」。
   * 2026-10-11 之前的历史条目没有这一项。
   */
  model?: string
  /** 生成时面板上的参数（回填参数区用）。老条目没有。 */
  params?: ImageParams
  /**
   * **真正发给上游**的标量字段（结果行显示用）。
   *
   * 与 {@link GeneratedImage.params} 的差别是刻意的：面板值可能被配置里那段
   * 「额外参数」JSON 覆盖，也可能因为该模型不声明而被裁掉；显示这一份才不是骗人。
   */
  sentFields?: Record<string, string>
  /** 参考图张数（参考图的 data URL 本身不落盘）。 */
  referenceCount?: number
}

/**
 * 一张图「当时用的参数」。
 *
 * 键与 {@link GenerateRequest} 的字段对齐：`aspectRatio` / `resolution` / `count` /
 * `quality` 是四个一等字段，其余在 `extra` 里（键 = 请求体字段名）。
 */
export interface ImageParams {
  aspectRatio: string
  resolution: string
  count: number
  quality: string
  extra: Record<string, string>
}

/**
 * 面板草稿（宿主 `<数据目录>/draft.json`）。
 *
 * 它跨 DSH 重启活着，所以「首次进入面板时提示词该不该在」这条规则可以在重启后
 * 照样成立：`prompt` 与 `lastGeneratedPrompt` 不同 = 有一份没生成过的草稿。
 */
export interface PanelDraft {
  /** 输入框里的提示词。 */
  prompt: string
  /** 参数区的取值（`ParamState` 的原样）。 */
  params: { aspectRatio: string; resolution: string; count: string; quality: string }
  /** 模型驱动表单里那些额外字段。 */
  extra: Record<string, string>
  /** 最后一次**成功生成**用的提示词。 */
  lastGeneratedPrompt: string
  /**
   * 最后一次**成功生成**的那张图的 id（`''` = 还没有 / 已清空）。
   *
   * 面板重挂载（切会话再回来）或 DSH 重启后，舞台靠它把那张图找回来 ——
   * 见 `ImageGenPanel.tsx` 的 `stageImageIdFor()`。旧版本落的盘里没有这个键，
   * 解析时按空串处理（= 舞台不恢复，其余行为不变）。
   */
  lastImageId: string
  /** 服务端写入时间（毫秒）；`0` = 还没有草稿。 */
  updatedAt: number
}

/** 一个模型的权威能力明细（`GET /capabilities` 的返回体）。 */
export interface ModelCapabilities {
  model: string
  /** 展示用价格，如 `$0.041/张（1k）`。上游算不出时为空串。 */
  price: string
  supportsReferences: boolean
  caps: string[]
  /** 提供该模型的 provider 名（如 Google AI Studio）。 */
  providers: string[]
  /** 允许透传的额外字段（「额外参数」提示用）。 */
  passthrough: string[]
  /** 每个 provider 的 slug 与可透传参数 —— 拼 `provider.options` 的键就在这儿。 */
  providerOptions: ProviderOption[]
  /** 该模型当前有没有可服务的通道。false = 调了必失败，UI 应拦住。 */
  available: boolean
  /** 参考图张数区间。 */
  references: ReferenceRange
  /**
   * 模型自己声明的参考图上限（未按网关全局 `maxItems: 16` 收敛）。
   *
   * 大于 `references.max` 时界面要解释差额：模型说 20 张、接口只收 16 张。
   */
  referencesDeclaredMax: number
  options: ModelOption['options']
  /**
   * 该模型可配置的参数表（endpoint 级并集，比列表接口更权威）。
   *
   * 界面用它渲染参数行；为空数组表示拿不到能力表（非 OpenRouter 协议），
   * 那时退化成固定的四项。
   */
  parameters: ParameterField[]
  /** 是否有任何 endpoint 原生支持 SSE。 */
  supportsStreaming: boolean
}

/** 面板的一次生成状态机。 */
export type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'done'; image: GeneratedImage }
  | { kind: 'error'; message: string; detail: string }

/** 生成失败时抛出的错误，携带面向用户的原始报错文本。 */
export class GenerateError extends Error {
  /** 提供商返回的原始报错，原样展示给用户（如 OpenRouter 的 402 文案）。 */
  readonly detail: string

  constructor(message: string, detail: string) {
    super(message)
    this.name = 'GenerateError'
    this.detail = detail
  }
}

/** UI 需要的后端能力面。阶段 3 起由 `api.ts`（打宿主 `/dsh-imagegen/*`）实现。 */
export interface Backend {
  /**
   * 读配置。
   * @param signal - 卸载/切换面板时取消在飞请求。
   */
  loadConfig(signal?: AbortSignal): Promise<PanelConfig>
  /**
   * 保存配置。
   *
   * `plainKey` 是**独立通道**：它只在这一次调用里存在，宿主吞掉它、只回掩码。
   * 空串表示「不改动已有的 Key」—— 面板从来不持有明文，所以也无法回传明文。
   * @param config - 配置字段（`hasKey` / `keyHint` 由宿主决定，会被忽略）。
   * @param plainKey - 新输入的明文 Key，空串 = 不改。
   * @param signal - 取消在飞请求。
   * @returns 宿主归一化后的配置（含新的 `hasKey` / `keyHint`）。
   */
  saveConfig(config: PanelConfig, plainKey: string, signal?: AbortSignal): Promise<PanelConfig>
  /**
   * 拉模型候选（候选值由上游 `supported_parameters` 驱动）。
   *
   * `note` 用于「这个协议根本没有能力表」这类如实说明（OpenAI / Gemini / 自定义）——
   * 面板会把它显示出来，而不是假装「拉到 0 个模型」。
   */
  listModels(config: PanelConfig, signal?: AbortSignal): Promise<{ models: ModelOption[]; note?: string }>
  /**
   * 拉某个模型的权威能力与定价。
   *
   * 模型列表接口不含定价，所以选中模型后再单独拉一次 —— 换来的是界面上那句
   * `$0.041/张（1k）` 是真报价，而不是编的。
   * @param config - 当前配置（提供 Base URL）。
   * @param modelId - 模型 id，如 `google/gemini-3-pro-image`。
   * @param resolution - 当前分辨率档位，用于挑对应档位的报价。
   * @param signal - 取消在飞请求。
   */
  modelCapabilities(config: PanelConfig, modelId: string, resolution?: string, signal?: AbortSignal): Promise<ModelCapabilities>
  /** 生成一张图。 */
  generate(config: PanelConfig, request: GenerateRequest, signal?: AbortSignal): Promise<GeneratedImage>
  /** 历史列表（阶段 4 起读宿主索引，最新在前）。 */
  listHistory(signal?: AbortSignal): Promise<GeneratedImage[]>
  /**
   * 把某张图另存一份到目录（面板上的「保存」按钮）。
   *
   * 目标只给**目录**，文件名由宿主决定 —— 用户给一个没有扩展名的完整路径之后，
   * 自己都认不出是什么格式。
   * @param id - 图片 id。
   * @param target - 目标目录；省略时用配置里的「自动保存目录」。
   * @param signal - 取消在飞请求。
   * @returns 落地后的完整路径。
   */
  saveImage(id: string, target?: string, signal?: AbortSignal): Promise<string>
  /**
   * 用**系统默认程序**打开某张图的本地原图。
   *
   * 这件事只能由宿主做：浏览器最多下载或新开标签页，起不来老板的看图工具。
   * 宿主回的是那张图的绝对路径，面板拿它拼提示文案。
   * @param id - 图片 id。
   * @param signal - 取消在飞请求。
   * @returns 被打开的绝对路径。
   */
  openImage(id: string, signal?: AbortSignal): Promise<string>
  /**
   * 读宿主侧日志（面板「查看日志」抽屉）。
   *
   * 为什么要有这条：桌面版 DSH 没有可见的宿主控制台（宿主进程的 stdout 没人接），
   * `console.log` 里的东西老板根本看不到。日志改由宿主留一份缓冲 + 落盘，这里取回来
   * 直接渲染在面板里 —— 排查不再依赖一个不存在的窗口。
   * @param limit - 取最后 N 条。
   * @param signal - 取消在飞请求。
   */
  fetchLogs(limit?: number, signal?: AbortSignal): Promise<HostLogs>
  /**
   * 读面板草稿。
   *
   * 返回 `undefined` = 还没有草稿（宿主回了 `draft: null`，或这条路由不可用）——
   * 两种情况对面板是同一个意思：不要拿内存里的旧状态冒充「我上次写的东西」。
   * @param signal - 取消在飞请求。
   */
  loadDraft(signal?: AbortSignal): Promise<PanelDraft | undefined>
  /**
   * 写面板草稿（边打字边自动落盘，失败不致命）。
   *
   * 失败**不抛**：草稿丢一份不该弹一个错误框打断用户，宿主侧已经记了 warn 日志。
   * @param draft - 要落盘的草稿。
   * @param signal - 取消在飞请求。
   * @returns 是否写成功（给自检与将来的「草稿没存上」提示用）。
   */
  saveDraft(draft: PanelDraft, signal?: AbortSignal): Promise<boolean>
}

/** 一条宿主日志（形状由 `src/log-store.ts` 的 `LogEntry` 决定）。 */
export interface HostLogEntry {
  seq: number
  /** 本地时间 `2026-10-10 18:42:03`。 */
  at: string
  level: 'info' | 'warn' | 'error'
  text: string
}

/** 一次日志读取的结果。 */
export interface HostLogs {
  /** 新的在前。 */
  entries: HostLogEntry[]
  /** 磁盘上的日志文件（面板把它显示出来，方便直接去翻）。 */
  file: string
  /** 日志目录。 */
  dir: string
  /** 缓冲里当前的总条数。 */
  count: number
}
