/**
 * 左栏输入区：提示词 + 参考图 + 参数 + 生成。
 *
 * 设计要点（都来自已批准的原型）：
 *   - 参数候选值**由所选模型的能力驱动**，不是硬编码 —— 见 ModelOption.options；
 *     切到不支持参考图的模型时，参考图槽要禁用而不是静默忽略。
 *   - 生成中时主按钮换成「取消」，且提示词与参数保持可读（用户要能看着改）。
 *   - 参考图只接受图片；超过上限直接拒绝并提示，不静默丢弃。
 */
import { useRef } from 'react'
import { CheckIcon, ChevronIcon, GearIcon, InfoIcon, ListIcon, PlusIcon, SparkIcon, StopIcon, WarnIcon } from './icons.tsx'
import type { ModelOption, OutputFormat, ParameterField } from './types.ts'
import css from './panel.module.css'

/**
 * 参考图上限的**兜底值**（拿不到模型能力时用）。
 *
 * 它**不是**上游规则：实测 59 个模型的上限从 1 到 20 都有，其中 17 个只允许 1 张。
 * 真实上限一律用 {@link referenceLimit} 从所选模型的 `input_references.max` 取。
 */
export const MAX_REFERENCES = 4

/**
 * `input_references` 的**网关全局上限**（官方 OpenAPI `maxItems: 16`）。
 *
 * 为什么必须单独记这一条：模型自己的能力表会报出比它更大的数 ——
 * 实测 `tencent/hy-image-v3.5-preview` 声明 `max: 20`。模型级枚举**网关不校验**，
 * 但**全局 `maxItems` 是校验的**（400 ZodError）。所以真正能发的张数是
 * `min(模型上限, 16)`，多出来的那张会让整次请求失败（全有或全无计费，
 * 不给钱但白等一次）。
 */
export const GLOBAL_MAX_REFERENCES = 16

/**
 * 该模型允许的参考图张数上限。
 * @param model - 所选模型（还没拉到时为 undefined）。
 * @returns 真实上限（已按全局 `maxItems: 16` 收敛）；模型信息缺失时退回 {@link MAX_REFERENCES}。
 */
export function referenceLimit(model: ModelOption | undefined): number {
  const max = model?.references?.max ?? 0
  if (max <= 0) return MAX_REFERENCES
  return Math.min(max, GLOBAL_MAX_REFERENCES)
}

/**
 * 该模型是否**必须**给参考图。
 *
 * `input_references.min >= 1` 的模型是「改图专用」（实测 5 个：`ming-image-0.1-design-layer`
 * 必须 1 张、`recraft-v4-styles` 四兄弟必须 ≥1）。不给底图就提交，上游必拒 ——
 * 这种错在本地拦住比让用户看 502 好。
 * @param model - 所选模型。
 * @returns 是否必填。
 */
export function referencesRequired(model: ModelOption | undefined): boolean {
  return (model?.references?.min ?? 0) >= 1
}

/** 参考图的本地表示。 */
export interface Reference {
  /** 稳定 key。 */
  id: string
  /** 文件名，展示在角标上。 */
  name: string
  /** 预览用 data URL。 */
  dataUrl: string
  /**
   * 来源历史图的 id（从历史右键「作为参考图」加进来时才有）。
   *
   * 用途是**去重**：同一张历史图不该被加两次 —— 菜单据此把那一项置灰。
   */
  sourceId?: string
  /**
   * 给用户看的一行处理说明（例如「已从 4096px 缩到 2048px」）。
   *
   * 参考图是随请求体一起 base64 发上去的，原图太大就会撞上游 413 ——
   * 客户端会先下采样。这件事**必须让用户看见**，否则他会以为发的是原图。
   */
  note?: string
}

/**
 * 参考图下采样的长边上限。
 *
 * 2048 的依据：它不是拍脑袋定的 —— 上游多数模型的分辨率档位到 2K/4K，
 * 但参考图只是「引导」，2048 长边足够保住构图与风格；而 base64 会让体积膨胀 4/3，
 * 一张 4096px 的 PNG 动辄 10 MB 以上，四张就是几十 MB，直接 413。
 */
export const MAX_REFERENCE_EDGE = 2048

/** 单张参考图重编码后的体积上限（data URL 字符数）；超过就再压一档。 */
export const MAX_REFERENCE_BYTES = 4 * 1024 * 1024

/**
 * 参考图的**总量**预算（data URL 字符数）。
 *
 * 为什么要有总量这一道：宿主 `/generate` 的请求体上限是 **32 MB**
 * （`src/index.ts` 的 `GENERATE_BODY_BYTES`），超限时 `readJsonBody()` 只能回一句
 * 「请求体不是合法 JSON，或超过了大小上限」—— 那个提示和真实原因对不上号，
 * 用户会去查 JSON 而不是查图片大小。而且单张上限卡不住总量：一张 4 MB × 16 张
 * 就是 64 MB，照样超。所以这里按总量算：**20 M 字符 ≈ 20 MB**，留足 JSON 包装、
 * 提示词与 base64 膨胀（4/3）的余量。
 */
export const MAX_REFERENCES_TOTAL_CHARS = 20 * 1024 * 1024

/** 一张参考图准备好之后的样子。 */
export interface PreparedReference {
  /** 可直接放进 `input_references[].image_url.url` 的 data URL。 */
  dataUrl: string
  /** 处理说明；没做任何处理时为空串。 */
  note: string
  /** data URL 的字符数（就是它占请求体的量）。 */
  chars: number
}

/**
 * 把一张图准备成可用的参考图：必要时下采样。
 *
 * 三条纪律：
 *  1. **失败即原样返回** —— 缩图是个优化，绝不能因为它把用户的图弄丢或弄坏。
 *     浏览器不支持 `createImageBitmap`、canvas 被污染、解码失败…一律退回原图。
 *  2. **不改格式语义**：PNG 保持 PNG（可能有透明通道），其余转 JPEG。
 *  3. **只在真的超限时才动**：小于上限的图一个字节都不改。
 * @param blob - 用户选的文件或从宿主取回的历史图。
 * @param budgetChars - 本轮还能用多少字符（总预算减去已有的参考图）。
 * @returns data URL + 说明 + 体积。
 */
export async function prepareReference(blob: Blob, budgetChars: number = MAX_REFERENCES_TOTAL_CHARS): Promise<PreparedReference> {
  const original = await readAsDataUrl(blob)
  // 本轮真正的上限：单张上限与「剩余总预算」取小。给一个下限，免得预算耗尽时
  // 被无限压到看不清。
  const cap = Math.max(256 * 1024, Math.min(MAX_REFERENCE_BYTES, budgetChars))
  // `createImageBitmap` 在部分内核/安全上下文里不可用 —— 那条路直接原样返回。
  if (typeof createImageBitmap !== 'function') return { dataUrl: original, note: '', chars: original.length }

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(blob)
    const longEdge = Math.max(bitmap.width, bitmap.height)
    // 本来就在上限内：一个字节都不改。
    if (longEdge <= MAX_REFERENCE_EDGE && original.length <= cap) {
      return { dataUrl: original, note: '', chars: original.length }
    }

    const keepPng = blob.type === 'image/png'
    // 逐档试，取第一个装得下的。PNG 的 quality 参数会被忽略，所以只能缩边。
    const plans = keepPng
      ? [{ edge: 2048, quality: 1 }, { edge: 1440, quality: 1 }, { edge: 1024, quality: 1 }]
      : [{ edge: 2048, quality: 0.92 }, { edge: 2048, quality: 0.78 }, { edge: 1440, quality: 0.7 }, { edge: 1024, quality: 0.62 }]

    let best = ''
    let bestEdge = longEdge
    let width = bitmap.width
    let height = bitmap.height
    for (const plan of plans) {
      const edge = Math.min(plan.edge, longEdge)
      const scale = edge / longEdge
      width = Math.max(1, Math.round(bitmap.width * scale))
      height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (context === null) return { dataUrl: original, note: '', chars: original.length }
      context.drawImage(bitmap, 0, 0, width, height)
      const out = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', plan.quality)
      if (!out.startsWith('data:image/')) return { dataUrl: original, note: '', chars: original.length }
      best = out
      bestEdge = edge
      if (out.length <= cap) break
    }
    if (best === '') return { dataUrl: original, note: '', chars: original.length }

    const shrink = longEdge > bestEdge ? `${bitmap.width}×${bitmap.height} → ${width}×${height}` : '已压缩'
    return { dataUrl: best, note: `已自动缩小（${shrink}）`, chars: best.length }
  } catch {
    // 解码/编码任何一步失败都退回原图 —— 宁可让上游报 413，也不能丢用户的图。
    return { dataUrl: original, note: '', chars: original.length }
  } finally {
    bitmap?.close()
  }
}

/** 参数行的当前取值。 */
export interface ParamState {
  aspectRatio: string
  resolution: string
  count: string
  quality: string
}

/**
 * 有专属状态槽的四个字段。
 *
 * `aspect_ratio` / `resolution` / `n` / `quality` 从阶段 4 起就是 `GenerateRequest`
 * 的一等字段（宿主、适配层、自检都按它们写），所以模型驱动表单里遇到这四个
 * 仍然写回老槽位；其余字段（`background` / `seed` / `size` / `output_format` /
 * `output_compression` / `stream`）走 `extra`。
 * 这样界面可以整个换掉，线上协议一个字都不用动。
 */
const CORE_SLOTS: Record<string, keyof ParamState> = {
  aspect_ratio: 'aspectRatio',
  resolution: 'resolution',
  n: 'count',
  quality: 'quality',
}

/**
 * 没有能力表时（OpenAI / Gemini / 自定义协议，或老宿主）展示的固定四项。
 *
 * 候选值取**官方全局枚举**，而不是留一个「只有一个选项」的死下拉 ——
 * 这是改版前最难看的地方：50/59 个模型的「质量」下拉里只有当前值一项，
 * 点了等于没点。协议没有能力表这件事本身由配置弹层如实说明，
 * 这里至少给用户一个能选的集合。
 */
const LEGACY_FIELDS: readonly ParameterField[] = [
  {
    name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output',
    values: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', 'auto'],
    clearable: false, default: '1:1', hint: '该协议没有能力表，这里是官方全局枚举。',
  },
  {
    name: 'resolution', label: '分辨率', control: 'select', valueType: 'string', group: 'output',
    values: ['512', '768', '1K', '1.5K', '2K', '4K'],
    clearable: false, default: '1K', hint: '该协议没有能力表，这里是官方全局枚举。',
  },
  {
    name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output',
    values: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], min: 1, max: 10,
    clearable: false, default: '1', hint: '该协议没有能力表，这里是官方全局区间 1–10。',
  },
  {
    name: 'quality', label: '质量', control: 'select', valueType: 'string', group: 'output',
    values: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    clearable: false, default: 'auto', hint: '该协议没有能力表，这里是官方全局枚举。',
  },
]

/** {@link Composer} 的 props。 */
export interface ComposerProps {
  prompt: string
  onPromptChange: (value: string) => void
  references: Reference[]
  /** 新增一张参考图。dataUrl 已由本组件读好（必要时下采样），交给上层存起来。 */
  onAddReference: (name: string, dataUrl: string, note?: string) => void
  onRemoveReference: (id: string) => void
  params: ParamState
  onParamChange: (key: keyof ParamState, value: string) => void
  /** 当前模型；用于取参数候选值与参考图支持情况。 */
  model: ModelOption | undefined
  /** 正在生成。 */
  running: boolean
  /** 未配置时为 true：主按钮禁用、参考图槽禁用。 */
  notConfigured: boolean
  onGenerate: () => void
  onCancel: () => void
  /** 展开模型下拉。 */
  onOpenModelPicker: () => void
  /**
   * 打开「连接配置」弹层（协议 / Base URL / API Key / 默认模型 / 自动保存目录 / 高级）。
   *
   * 这个按钮原来钉在**整宽页头**的右上角，2026-10-18 老板要求挪走 —— 页头那一行
   * 的高度是从右边预览区身上扣的。现在它与模型 chip 同排：换模型和改配置本来就是
   * 同一件事，凑在一起还省一次跨半屏的鼠标移动。
   */
  onOpenConfig: () => void
  /** 生成耗时提示用的上一条耗时（秒）。 */
  lastSeconds: number | undefined
  /**
   * 「优化提示词」：用 prompt-forge 的「文生图优化」模板改写当前草稿。
   *
   * 走的是另一个插件的 LLM 渠道，所以**不要求本插件配好 Key**。
   */
  onOptimize: () => void
  /** 正在优化：输入框只读、按钮变「优化中…」。 */
  optimizing: boolean
  /** 有一份可以一键还原的草稿（提示词优化刚完成，或刚被点历史记录覆盖掉）。 */
  canUndo: boolean
  onUndo: () => void
  /**
   * 配置里的输出格式（可空 = 未知）。
   *
   * 现在只作为**非 OpenRouter 协议**（没有能力表）那一条路的默认值 ——
   * OpenRouter 下面格式是模型驱动表单里的一行，以该模型的枚举为准。
   */
  outputFormat?: OutputFormat
  /**
   * 该模型可配置的参数表 —— 界面**按它渲染参数行**。
   *
   * `undefined` 或空数组 = 拿不到能力表（OpenAI / Gemini / 自定义协议，或老宿主），
   * 那时退化成固定的四项（比例/分辨率/张数/质量），候选值用官方全局枚举。
   */
  parameters?: ParameterField[]
  /** 模型驱动表单里「非核心四项」的取值（键 = 请求体字段名）。 */
  extra?: Record<string, string>
  /** 改一个 `extra` 字段。 */
  onExtraChange?: (name: string, value: string) => void
  /**
   * 该模型**声明**的参考图上限（未按全局上限收敛的那个数）。
   *
   * 只有它大于 {@link GLOBAL_MAX_REFERENCES} 时才传进来：那是
   * `tencent/hy-image-v3.5-preview` 这种「模型说 20 张、接口只收 16 张」的情况，
   * 必须让用户知道差额是怎么来的。
   */
  referenceDeclaredMax?: number
  /**
   * 一句给用户的提示（参考图被拒时用）。
   *
   * 为什么需要：参考图拒绝原来是**静默**的（文件类型不对、超上限都直接 return），
   * 用户点了「添加」没反应，只能自己猜。可选 —— 不传就不提示，行为与旧版一致。
   */
  onNotice?: (text: string, kind?: 'ok' | 'err') => void
  /**
   * 配置里那段「额外参数」JSON 覆盖了哪些**面板上看得见**的字段（中文标签）。
   *
   * 宿主侧那段 JSON 是**最后无条件合并**的、优先级最高 —— 本机默认配置里就写着
   * `output_compression: 90` 与 `background: "opaque"`，而这两个字段原来没有界面。
   * 现在有了，用户会在面板上选 80、实际发 90。**生成前**就得说，别等他去翻诊断行。
   */
  overriddenFields?: string[]
}

/** 把字符数说成人话（参考图预算用）。 */
function formatChars(chars: number): string {
  const mb = chars / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(chars / 1024)} KB`
}

/**
 * 把一个 Blob/File 读成 data URL。浏览器 FileReader，纯本地、不打网络。
 *
 * 导出是因为「历史图右键 → 作为参考图」也要用：那条路拿到的是一个从宿主取回的
 * Blob，不是用户选的文件。
 */
export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { resolve(String(reader.result)) }
    reader.onerror = () => { reject(reader.error ?? new Error('读取文件失败')) }
    reader.readAsDataURL(blob)
  })
}

/** 一个下拉参数（`enum` 与「张数」共用）。 */
function SelectField(props: {
  label: string
  value: string
  values: string[]
  hint?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  // 当前值不在候选里时**把它临时插到最前面**：直接用 `<select value>` 指向一个
  // 不存在的 option，浏览器会显示成空白 —— 那看起来像坏了。插进去至少让用户
  // 知道现在是什么值，而收敛逻辑会在能力回来时把它换成合法值。
  const values = props.values.includes(props.value) || props.value === ''
    ? props.values
    : [props.value, ...props.values]
  return (
    <div>
      <div className={css.paramLabel} title={props.hint}>{props.label}</div>
      <div className={css.select}>
        <select value={props.value} onChange={(event) => { props.onChange(event.target.value) }}>
          {values.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <span className={css.chev}><ChevronIcon /></span>
      </div>
    </div>
  )
}

/**
 * 一个数值/文本参数。
 *
 * `clearable`（`seed` / `size` / `output_compression`）留空 = **不发这个字段**，
 * 所以 placeholder 要说清「留空会怎样」—— 尤其 `seed`：填死会让每次出图都一样。
 */
function NumberField(props: {
  label: string
  value: string
  hint?: string
  min?: number
  max?: number
  numeric: boolean
  placeholder?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div>
      <div className={css.paramLabel} title={props.hint}>{props.label}</div>
      <div className={css.input}>
        <input
          className={css.mono}
          spellCheck={false}
          inputMode={props.numeric ? 'numeric' : 'text'}
          placeholder={props.placeholder ?? (props.numeric ? '留空 = 不发送' : '留空 = 不发送')}
          value={props.value}
          onChange={(event) => { props.onChange(event.target.value) }}
        />
      </div>
      {(props.min !== undefined || props.max !== undefined) && (
        <div className={css.paramRange}>
          允许 {props.min ?? '?'} – {props.max ?? '?'}
        </div>
      )}
    </div>
  )
}

/** 一个开关参数（目前只有 `stream`）。 */
function ToggleField(props: {
  label: string
  value: boolean
  hint?: string
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div>
      <div className={css.paramLabel} title={props.hint}>{props.label}</div>
      <button
        className={css.toggle}
        type="button"
        role="switch"
        aria-checked={props.value}
        aria-label={props.label}
        onClick={() => { props.onChange(!props.value) }}
      >
        <span className={css.toggleKnob} />
        <span className={css.toggleText}>{props.value ? '开' : '关'}</span>
      </button>
    </div>
  )
}

/** 左栏输入区。 */
export function Composer(props: ComposerProps): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null)
  const model = props.model
  const canReference = !props.notConfigured && (model?.supportsReferences ?? false)
  const refLimit = referenceLimit(model)
  const refRequired = referencesRequired(model)
  /** 必填底图却没给 —— 生成会被宿主/上游拒，界面上先把原因说清楚。 */
  const missingRequired = refRequired && props.references.length < (model?.references?.min ?? 1)
  const atLimit = props.references.length >= refLimit
  /**
   * 参考图的体积预算（data URL 字符数）。
   *
   * 参考图是随请求体 base64 发的，宿主 `/generate` 的请求体上限 32 MB —— 超了
   * 只会回一句「请求体不是合法 JSON，或超过了大小上限」，把用户引到错误的方向。
   * 所以在客户端就按总量卡住，并把用量显示出来（用户能自己判断该删哪张）。
   */
  const usedChars = props.references.reduce((sum, item) => sum + item.dataUrl.length, 0)
  const budgetLeft = Math.max(0, MAX_REFERENCES_TOTAL_CHARS - usedChars)
  const overBudget = budgetLeft <= 0

  /**
   * 参考图槽的状态文案。
   *
   * 分几种而不是两种 —— 「模型还没拉到」和「该模型就是不支持」是完全不同的两件事，
   * 混成一句会让用户以为模型选错了。「必填」还要单独说，否则用户不知道
   * 为什么生成按钮点不动。
   */
  const refHint = (): string => {
    if (props.notConfigured) return '配置后可上传'
    if (model === undefined) return '模型加载中…'
    if (!model.supportsReferences) return '当前模型不支持'
    const tally = `${props.references.length}/${refLimit}`
    // 「模型声明了 20 张、接口只收 16 张」必须说出来，否则计数器显示 0/16
    // 会被当成「这个模型只有 16 张额度」，用户不知道为什么加不进第 17 张。
    const clamped = (props.referenceDeclaredMax ?? 0) > refLimit
      ? `（该模型声明 ${props.referenceDeclaredMax} 张，接口全局上限 ${refLimit} 张）`
      : ''
    // 有参考图时把体积用量一并显示 —— 它是「为什么加不进第 N 张」的一个真实原因。
    const size = props.references.length === 0
      ? ''
      : ` · ${formatChars(usedChars)}/${formatChars(MAX_REFERENCES_TOTAL_CHARS)}`
    if (refRequired) return `必填 · 至少 ${model.references?.min ?? 1} 张（${tally}）${size}${clamped}`
    return `可多张 · 图生图（${tally}）${size}${clamped}`
  }

  // 参数行**由所选模型的参数表驱动**：模型声明了什么就显示什么。
  // 拿不到能力表（非 OpenRouter 协议 / 老宿主）时退化成固定的四项。
  const fields = props.parameters ?? []
  const dynamic = fields.length > 0
  const shown = dynamic ? fields : LEGACY_FIELDS
  const outputFields = shown.filter((field) => field.group === 'output')
  const advancedFields = shown.filter((field) => field.group === 'advanced')

  /** 该字段当前的取值（核心四项读老槽位，其余读 `extra`）。 */
  const valueOf = (field: ParameterField): string => {
    const slot = CORE_SLOTS[field.name]
    if (slot !== undefined) return props.params[slot]
    return props.extra?.[field.name] ?? field.default
  }

  /** 写回该字段（核心四项写老槽位，其余写 `extra`）。 */
  const setValue = (field: ParameterField, value: string): void => {
    const slot = CORE_SLOTS[field.name]
    if (slot !== undefined) props.onParamChange(slot, value)
    else props.onExtraChange?.(field.name, value)
  }

  /**
   * 该模型**没声明**的核心参数 —— 它们不会出现在参数行里，也不会被发出去。
   *
   * 这一行是「诚实的补充说明」：用户从别的模型切过来时，会发现「分辨率」不见了，
   * 不说一句他会以为是界面坏了，而不是「这个模型本来就不支持」。
   */
  const hiddenCore = dynamic
    ? ([['aspect_ratio', '比例'], ['resolution', '分辨率'], ['n', '张数'], ['quality', '质量']] as const)
        .filter(([name]) => !fields.some((field) => field.name === name))
        .map(([, label]) => label)
    : []

  /**
   * `background: transparent` 要求输出格式是 png / webp（官方口径）。
   *
   * 这是唯一一处**字段之间的约束**：单看两个下拉都合法，合起来是无效组合。
   * 上游不会 400（网关不校验模型级语义），只会把 transparent 悄悄忽略掉 ——
   * 用户以为拿到了透明底图，实际没有。所以必须在这里说。
   */
  const backgroundField = shown.find((field) => field.name === 'background')
  const formatField = shown.find((field) => field.name === 'output_format')
  const formatValue = formatField === undefined ? '' : valueOf(formatField)
  const transparentMismatch = backgroundField !== undefined && formatField !== undefined
    && valueOf(backgroundField) === 'transparent'
    && formatValue !== '' && formatValue !== 'png' && formatValue !== 'webp'

  /**
   * 配置里的输出格式与该模型不符。
   *
   * 只在**没有能力表**的那条路上才可能发生 —— 有参数表时「输出格式」就是参数行里的
   * 一行下拉，候选值来自该模型自己的枚举，用户根本选不出越界值。
   */
  const formatMismatch = !dynamic
    && props.outputFormat !== undefined
    && (model?.options.outputFormat?.length ?? 0) > 0
    && !model!.options.outputFormat.includes(props.outputFormat)

  /**
   * 底部那行参数摘要。
   *
   * 从**实际显示的字段**拼，而不是硬写「张数 · 比例 · 分辨率」——
   * 对一个不声明分辨率的模型（36/59 个），写「分辨率 1K」是在编。
   */
  const summaryParts = shown
    .map((field) => ({ field, value: valueOf(field) }))
    .filter((item) => item.value !== '')
    .map((item) => `${item.field.label} ${item.value}`)
    .slice(0, 5)

  /** 留空语义各不相同的三个字段，placeholder 必须分开写。 */
  const placeholderOf = (field: ParameterField): string => {
    if (field.name === 'seed') return '留空 = 每次随机'
    if (field.name === 'size') return '如 2K 或 2048x2048'
    if (field.name === 'output_compression') return '0–100，留空 = 上游默认'
    return '留空 = 不发送'
  }

  /** 按字段规格渲染一个控件。 */
  const renderField = (field: ParameterField): React.JSX.Element => {
    const value = valueOf(field)
    if (field.control === 'select' || field.control === 'count') {
      return (
        <SelectField
          key={field.name}
          label={field.label}
          hint={field.hint}
          value={value}
          values={field.values ?? []}
          onChange={(next) => { setValue(field, next) }}
        />
      )
    }
    if (field.control === 'toggle') {
      return (
        <ToggleField
          key={field.name}
          label={field.label}
          hint={field.hint}
          value={value === 'true'}
          onChange={(next) => { setValue(field, next ? 'true' : 'false') }}
        />
      )
    }
    return (
      <NumberField
        key={field.name}
        label={field.label}
        hint={field.hint}
        value={value}
        {...field.min === undefined ? {} : { min: field.min }}
        {...field.max === undefined ? {} : { max: field.max }}
        numeric={field.valueType === 'integer'}
        placeholder={placeholderOf(field)}
        onChange={(next) => { setValue(field, next) }}
      />
    )
  }

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    if (!file.type.startsWith('image/')) {
      props.onNotice?.(`「${file.name}」不是图片文件`, 'err')
      return
    }
    if (props.references.length >= refLimit) {
      props.onNotice?.(`参考图最多 ${refLimit} 张`, 'err')
      return
    }
    if (budgetLeft <= 0) {
      props.onNotice?.(`参考图总预算已满（${formatChars(MAX_REFERENCES_TOTAL_CHARS)}），先移除一张再加`, 'err')
      return
    }
    // 参考图会随请求体 base64 发上去，原图太大会撞宿主的 32 MB 请求体上限 ——
    // 先按「剩余预算」下采样。`prepareReference()` 失败时原样返回，绝不丢用户的图。
    const prepared = await prepareReference(file, budgetLeft)
    if (prepared.chars > budgetLeft) {
      props.onNotice?.(
        `「${file.name}」压到最小仍有 ${formatChars(prepared.chars)}，`
        + `加上已有的会超过参考图总预算 ${formatChars(MAX_REFERENCES_TOTAL_CHARS)}`,
        'err',
      )
      return
    }
    props.onAddReference(file.name, prepared.dataUrl, prepared.note === '' ? undefined : prepared.note)
  }

  return (
    <section className={css.composer}>
      <div className={css.field}>
        <div className={css.fieldLabel}>
          提示词
          <span className={css.hint}>Ctrl/⌘ + Enter 生成</span>
        </div>
        <div className={css.promptWrap}>
          <textarea
            className={css.prompt}
            spellCheck={false}
            value={props.prompt}
            readOnly={props.optimizing}
            placeholder="描述你想要的画面，例如：一只戴耳机的柴犬坐在窗边，午后阳光，胶片质感，景深浅…"
            onChange={(event) => { props.onPromptChange(event.target.value) }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !props.notConfigured) {
                event.preventDefault()
                props.onGenerate()
              }
            }}
          />
          <div className={css.promptTools}>
            <button
              className={`${css.btn} ${css.btnSm} ${css.btnGhost}`}
              type="button"
              disabled={props.optimizing || props.prompt.trim() === ''}
              title={
                props.prompt.trim() === ''
                  ? '先写点内容再优化'
                  : '用 prompt-forge 的「文生图优化」模板改写这段提示词（结果直接覆盖，可撤销）'
              }
              onClick={props.onOptimize}
            >
              <SparkIcon size={13} />
              {props.optimizing ? '优化中…' : '优化提示词'}
            </button>
            {props.canUndo && !props.optimizing && (
              <button
                className={`${css.btn} ${css.btnSm} ${css.btnGhost}`}
                type="button"
                title="还原成上一次的草稿（提示词优化前 / 点历史记录覆盖前）"
                onClick={props.onUndo}
              >
                撤销
              </button>
            )}
            <span className={css.counter}>{props.prompt.length} / 4000</span>
          </div>
        </div>
      </div>

      <div className={css.field}>
        <div className={css.fieldLabel}>
          参考图
          <span className={css.hint}>{refHint()}</span>
        </div>
        <div className={css.refGrid}>
          {props.references.map((reference) => (
            <div className={css.refThumb} key={reference.id} title={reference.note ?? reference.name}>
              <img src={reference.dataUrl} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
              <button className={css.rm} type="button" aria-label="移除参考图" onClick={() => { props.onRemoveReference(reference.id) }}>
                ✕
              </button>
              <span className={css.tag}>{reference.note === undefined ? '底图' : '已缩小'}</span>
            </div>
          ))}
          <button
            className={css.refAdd}
            type="button"
            disabled={!canReference || atLimit || overBudget}
            title={
              props.notConfigured ? '配置生图服务后可上传参考图'
                : model === undefined ? '正在读取模型能力…'
                  : !model.supportsReferences ? '当前模型不支持参考图'
                    : overBudget ? `参考图总预算已满（${formatChars(MAX_REFERENCES_TOTAL_CHARS)}），先移除一张`
                      : atLimit ? `最多 ${refLimit} 张` : '添加参考图'
            }
            onClick={() => { fileInput.current?.click() }}
          >
            <PlusIcon />
            <span>添加</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              for (const file of files) void pickFile(file)
            }}
          />
        </div>
      </div>

      <div className={css.field}>
        <div className={css.fieldLabel}>
          参数
          <span className={css.hint}>
            {dynamic ? `${model?.id ?? '所选模型'} 声明的字段（${shown.length} 项）` : '该协议没有能力表 · 官方全局枚举'}
          </span>
        </div>
        <div className={css.params}>
          {outputFields.map((field) => renderField(field))}
        </div>
        {advancedFields.length > 0 && (
          <>
            <div className={css.paramGroup}>高级</div>
            <div className={css.params}>
              {advancedFields.map((field) => renderField(field))}
            </div>
          </>
        )}
        <div className={css.paramsNote}>
          <InfoIcon />
          {dynamic
            ? '参数行完全由所选模型声明的 supported_parameters 生成：它没声明的字段不显示、也绝不发送；取值超出该模型枚举时同样不发'
            : '候选值为官方全局枚举；本协议没有模型能力表，参数能否生效由上游决定'}
          {hiddenCore.length > 0 && `。该模型不声明：${hiddenCore.join('、')}`}
        </div>
        {(props.overriddenFields?.length ?? 0) > 0 && (
          <div className={css.paramsNoteWarn}>
            <WarnIcon size={12} />
            「连接配置 → 额外参数」里写死了 {props.overriddenFields!.join('、')}，它会**覆盖**面板上选的值
            （那段 JSON 最后合并、优先级最高）。想让面板说了算，就把这几个键从那段 JSON 里删掉。
          </div>
        )}
        {transparentMismatch && (
          <div className={css.paramsNoteWarn}>
            <WarnIcon size={12} />
            背景选了 transparent，但输出格式是 {formatValue} —— 官方要求 transparent 搭配 png 或 webp，否则上游会忽略这个背景设置
          </div>
        )}
        {formatMismatch && (
          <div className={css.paramsNoteWarn}>
            <WarnIcon size={12} />
            配置里的输出格式 {props.outputFormat ?? ''} 不在该模型的枚举里，本次不会发送这个字段
          </div>
        )}
      </div>

      <div className={css.actions}>
        {/* 模型行：切模型 + 打开连接配置（后者 2026-10-18 从整宽页头挪到这里）。 */}
        <div className={css.modelRow}>
          <button className={css.chip} type="button" onClick={props.onOpenModelPicker} title="切换本次使用的模型">
            <ListIcon />
            模型 <b>{model?.id ?? '未选择'}</b>
            <ChevronIcon />
          </button>
          <button className={css.btn} type="button" onClick={props.onOpenConfig} title="协议 / Base URL / API Key / 默认模型 / 自动保存目录 / 高级">
            <GearIcon />
            连接配置
          </button>
        </div>
        <div className={css.genRow}>
          {props.running
            ? (
              <button className={`${css.btn} ${css.btnLg}`} type="button" onClick={props.onCancel}>
                <StopIcon />
                取消
              </button>
            )
            : (
              <button
                className={`${css.btn} ${css.btnPrimary} ${css.btnLg}`}
                type="button"
                disabled={props.notConfigured || props.prompt.trim() === '' || missingRequired}
                onClick={props.onGenerate}
              >
                <SparkIcon />
                生成
              </button>
            )}
        </div>
        <div className={css.genMeta}>
          <span>{summaryParts.length === 0 ? '无额外参数' : summaryParts.join(' · ')}</span>
          <span className={css.dot}>•</span>
          <span>{props.lastSeconds === undefined ? '尚无记录' : `上次耗时 ${props.lastSeconds}s`}</span>
          <span className={css.dot}>•</span>
          <span>失败不计费</span>
        </div>
        {props.notConfigured && (
          <div className={css.genMeta}>
            <CheckIcon size={12} />
            配好生图服务后即可生成
          </div>
        )}
        {missingRequired && (
          <div className={css.genMeta}>
            <WarnIcon size={12} />
            该模型是改图专用：至少要有 {model?.references?.min ?? 1} 张参考图才能生成
          </div>
        )}
      </div>
    </section>
  )
}
