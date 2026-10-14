/**
 * 「当时用的参数」怎么显示成中文。
 *
 * 为什么单独一个模块：结果行要显示的是**任意一张历史图**的参数 —— 那张图可能是
 * 另一个模型生的，而面板上的参数表（`ModelCapabilities.parameters`）只描述**当前**
 * 模型。所以标签不能从当前模型的参数表里取，得有一份与模型无关的对照表。
 *
 * 这份表必须与宿主 `src/openrouter.ts` 的 `FIELD_SPECS` 对齐（那是权威），
 * 由 `scripts/host-check.mjs` 断言「每个字段都有中文标签」—— 少了哪个字段，
 * 界面上就会冒出一个英文键名。
 */

/** 请求体字段名 → 中文标签。 */
export const FIELD_LABELS: Record<string, string> = {
  aspect_ratio: '比例',
  resolution: '分辨率',
  size: '尺寸',
  n: '张数',
  quality: '质量',
  output_format: '输出格式',
  background: '背景',
  output_compression: '压缩',
  seed: '随机种子',
  stream: '流式预览',
  /** 来自配置里那段「额外参数」JSON 的透传对象（`{"sort":"price"}`）。 */
  provider: '上游透传',
  /** 参考图**张数**（data URL 不落盘，只记数量）——结果行里追加的一条。 */
  input_references: '参考图',
}

/**
 * 展示顺序：核心四项在最前（用户最关心），然后是输出规格、高级项、最后透传对象。
 *
 * 不按字典序排的原因很实际：结果行只有一行，`+N` 折叠时先被裁掉的应该是
 * 「上游透传」而不是「比例」。
 */
export const FACT_ORDER: readonly string[] = [
  'aspect_ratio',
  'resolution',
  'quality',
  'n',
  'output_format',
  'background',
  'output_compression',
  'size',
  'seed',
  'stream',
  'provider',
]

/** 一条参数事实。 */
export interface FieldFact {
  /** 请求体字段名。 */
  name: string
  /** 中文标签（没有对照时退回字段名）。 */
  label: string
  /** 展示用取值。 */
  value: string
}

/** 字段名的中文标签；没有对照时退回字段名本身（宁可露出英文，也不假装知道）。 */
export function fieldLabelOf(name: string): string {
  return FIELD_LABELS[name] ?? name
}

/** 取值的展示形态：布尔值翻成开/关，其余原样。 */
export function formatFieldValue(value: string): string {
  if (value === 'true') return '开'
  if (value === 'false') return '关'
  return value
}

/**
 * 把一份「字段名 → 取值」的表排成可展示的事实列表。
 * @param fields - 例如 `GeneratedImage.sentFields`。
 * @returns 按 {@link FACT_ORDER} 排好的列表；未知字段按字典序接在后面。
 */
export function factListOf(fields: Record<string, string> | undefined): FieldFact[] {
  if (fields === undefined) return []
  const names = Object.keys(fields).filter((name) => fields[name] !== '')
  const rank = (name: string): number => {
    const at = FACT_ORDER.indexOf(name)
    return at < 0 ? FACT_ORDER.length : at
  }
  names.sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  return names.map((name) => ({ name, label: fieldLabelOf(name), value: formatFieldValue(fields[name]!) }))
}

/** 一条事实的一行文本（`比例 16:9`）。 */
export function factTextOf(fact: FieldFact): string {
  return `${fact.label} ${fact.value}`
}
