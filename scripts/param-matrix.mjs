/**
 * 逐模型参数配置表生成器（真上游，只读公开接口，不花钱）。
 *
 * 数据来源（全部是 **GET**，无需 Key）：
 *   1. `GET /api/v1/images/models`                        → 模型目录 + 模型级 `supported_parameters`
 *   2. `GET /api/v1/images/models/<author>/<slug>/endpoints` → 每个 provider 的**权威**参数表
 *      + `allowed_passthrough_parameters` + `pricing`
 *
 * 产出两份：
 *   - `stage-param-matrix/matrix.json`  —— 给代码/自检用的机器可读快照
 *   - `PARAM-MATRIX.md`                 —— 人看的参数配置表（本文件生成，不手写）
 *
 * 用法：
 *   node scripts/param-matrix.mjs              # 生成两份
 *   node scripts/param-matrix.mjs --json       # 只打印 JSON
 *   node scripts/param-matrix.mjs --base=https://openrouter.ai/api/v1
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const args = process.argv.slice(2)
const baseArg = args.find((item) => item.startsWith('--base='))
const BASE = baseArg === undefined ? 'https://openrouter.ai/api/v1' : baseArg.slice('--base='.length).replace(/\/+$/u, '')
const JSON_ONLY = args.includes('--json')

/** 并发度：59 个 endpoint 请求，6 路足够快又不至于被限流。 */
const CONCURRENCY = 6
/** 单条超时。 */
const TIMEOUT_MS = 15000

/** GET 一个 JSON（带超时）。 */
async function getJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}\n${text.slice(0, 300)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

/** 是否是普通对象。 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 描述符 → 一个紧凑可读的字符串（`enum(a|b|c)` / `range(1..10)` / `boolean`）。 */
function describeSpec(spec) {
  if (!isRecord(spec)) return '?'
  if (spec.type === 'enum') {
    const values = Array.isArray(spec.values) ? spec.values : []
    return `enum(${values.join('|')})`
  }
  if (spec.type === 'range') {
    const min = typeof spec.min === 'number' ? spec.min : '?'
    const max = typeof spec.max === 'number' ? spec.max : '?'
    return `range(${min}..${max})`
  }
  if (spec.type === 'boolean') return 'boolean'
  return '?'
}

/** 两个描述符取并集（多 provider 时用）。 */
function unionSpec(left, right) {
  if (left === undefined) return right
  if (right === undefined) return left
  if (left.type === 'enum' || right.type === 'enum') {
    const values = []
    for (const value of [...(Array.isArray(left.values) ? left.values : []), ...(Array.isArray(right.values) ? right.values : [])]) {
      if (!values.includes(value)) values.push(value)
    }
    return { type: 'enum', values }
  }
  if (left.type === 'range' || right.type === 'range') {
    const mins = [left.min, right.min].filter((value) => typeof value === 'number')
    const maxs = [left.max, right.max].filter((value) => typeof value === 'number')
    return {
      type: 'range',
      ...(mins.length > 0 ? { min: Math.min(...mins) } : {}),
      ...(maxs.length > 0 ? { max: Math.max(...maxs) } : {}),
    }
  }
  return { type: 'boolean' }
}

/** 描述符取交集（参考图张数用：跨 provider 必须都满足）。 */
function intersectRange(left, right) {
  if (left === undefined) return right
  if (right === undefined) return left
  const min = Math.max(typeof left.min === 'number' ? left.min : 0, typeof right.min === 'number' ? right.min : 0)
  const max = Math.min(typeof left.max === 'number' ? left.max : Infinity, typeof right.max === 'number' ? right.max : Infinity)
  return { type: 'range', min, max: Number.isFinite(max) ? max : min }
}

/** 并发跑一个数组，保持输入顺序。 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const run = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      out[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run))
  return out
}

/** 主流程。 */
async function main() {
  const catalog = await getJson(`${BASE}/images/models`)
  const models = (Array.isArray(catalog.data) ? catalog.data : []).filter((item) => isRecord(item) && typeof item.id === 'string')
  if (models.length === 0) throw new Error('目录接口没有返回任何模型 —— 检查 Base URL')

  const rows = await mapLimit(models, CONCURRENCY, async (model) => {
    const url = `${BASE}/images/models/${model.id}/endpoints`
    let payload
    let error = ''
    try {
      payload = await getJson(url)
    } catch (caught) {
      error = caught instanceof Error ? caught.message.split('\n')[0] : String(caught)
    }

    const endpoints = payload && Array.isArray(payload.endpoints) ? payload.endpoints.filter(isRecord) : []
    /** 模型级声明（目录接口）。 */
    const modelLevel = isRecord(model.supported_parameters) ? model.supported_parameters : {}

    /** 逐 endpoint 的并集（参数候选值口径，与插件 `parseCapabilities()` 一致）。 */
    let merged = { ...modelLevel }
    for (const endpoint of endpoints) {
      const supported = isRecord(endpoint.supported_parameters) ? endpoint.supported_parameters : {}
      const next = { ...merged }
      for (const [key, spec] of Object.entries(supported)) next[key] = unionSpec(merged[key], spec)
      merged = next
    }

    /** 参考图张数取交集（硬约束）。 */
    let refs
    for (const endpoint of endpoints) {
      const supported = isRecord(endpoint.supported_parameters) ? endpoint.supported_parameters : {}
      if (supported.input_references !== undefined) refs = intersectRange(refs, supported.input_references)
    }
    const referenceRange = refs === undefined
      ? { min: 0, max: 0 }
      : { min: typeof refs.min === 'number' ? refs.min : 0, max: typeof refs.max === 'number' ? refs.max : 0 }

    /** provider.options 的 slug 与可透传参数。 */
    const providerOptions = []
    for (const endpoint of endpoints) {
      const slug = typeof endpoint.provider_slug === 'string' ? endpoint.provider_slug : ''
      const allowed = Array.isArray(endpoint.allowed_passthrough_parameters)
        ? endpoint.allowed_passthrough_parameters.filter((item) => typeof item === 'string')
        : []
      if (slug !== '' && allowed.length > 0 && !providerOptions.some((item) => item.slug === slug)) {
        providerOptions.push({ slug, params: allowed })
      }
    }

    return {
      id: model.id,
      name: typeof model.name === 'string' ? model.name : '',
      available: endpoints.length > 0,
      endpointCount: endpoints.length,
      providers: endpoints.map((endpoint) => (typeof endpoint.provider_name === 'string' ? endpoint.provider_name : '')).filter((item) => item !== ''),
      params: Object.fromEntries(Object.entries(merged).map(([key, spec]) => [key, describeSpec(spec)])),
      paramCount: Object.keys(merged).length,
      references: referenceRange,
      /**
       * 真正能发出去的张数上限 = `min(声明, 16)`。
       *
       * 16 是官方 OpenAPI `ImageGenerationRequest.input_references.maxItems`。
       * 模型级枚举**网关不校验**，但**全局 maxItems 校验** —— 发超了就是 400
       * （全有或全无计费：不给钱，但白等一次）。
       */
      referencesEffective: { min: referenceRange.min, max: Math.min(referenceRange.max, 16) },
      referencesRequired: referenceRange.min >= 1,
      /**
       * 顶层 `supports_streaming`（模型级；任一 endpoint 支持也算）。
       *
       * 它不是 `supported_parameters` 里的键，所以必须单独记 —— 否则
       * 「这个模型能不能流式」这件事在快照里就查不到。
       */
      supportsStreaming: model.supports_streaming === true || endpoints.some((endpoint) => endpoint.supports_streaming === true),
      providerOptions,
      error,
    }
  })

  const available = rows.filter((row) => row.available)
  const matrix = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    modelCount: rows.length,
    availableCount: available.length,
    unserved: rows.filter((row) => !row.available).map((row) => row.id),
    rows,
  }

  mkdirSync(join(root, 'stage-param-matrix'), { recursive: true })
  writeFileSync(join(root, 'stage-param-matrix', 'matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`, 'utf8')

  if (JSON_ONLY) {
    process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`)
    return
  }

  writeFileSync(join(root, 'PARAM-MATRIX.md'), renderMarkdown(matrix), 'utf8')
  process.stdout.write(
    `模型 ${rows.length} 个（可服务 ${available.length}，无通道 ${matrix.unserved.length}: ${matrix.unserved.join(', ') || '无'}）\n`
    + `已写入 stage-param-matrix/matrix.json 与 PARAM-MATRIX.md\n`,
  )
}

/** 出现过的所有参数键（按出现次数排序）。 */
function keyStats(rows) {
  const counts = new Map()
  for (const row of rows) {
    for (const key of Object.keys(row.params)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
}

/**
 * 转义 Markdown 表格单元格里的竖线。
 *
 * **必须做**：`describeSpec()` 产出的是 `enum(1K|2K|4K)` 这种写法，裸竖线会被
 * 任何 Markdown 渲染器当成列分隔符 —— 于是那张 11 列的表每一行都往后错位，
 * 看起来像数据坏了，其实只是没转义。
 * @param value - 单元格文本。
 * @returns 可直接放进表格的文本。
 */
function cell(value) {
  return String(value).replaceAll('|', '\\|')
}

/** 生成 Markdown 参数配置表。 */
function renderMarkdown(matrix) {
  const rows = matrix.rows
  const available = rows.filter((row) => row.available)
  const lines = []

  lines.push('# 逐模型参数配置表（真上游生成，勿手改）')
  lines.push('')
  lines.push(`> 生成时间：${matrix.generatedAt}　数据源：\`${matrix.base}\`（公开只读接口，无需 Key）`)
  lines.push(`> 模型 **${matrix.modelCount}** 个 · 有可服务通道 **${matrix.availableCount}** 个`)
  lines.push('')
  lines.push('**读法**：`enum(a|b|c)` = 枚举白名单；`range(min..max)` = 闭区间整数；`boolean` = 上游只标了「支持」')
  lines.push('（`seed` / `stream` 这类就是 boolean 声明，值类型见下面的字段规格表）。**键缺失 = 该模型不支持这个字段**，')
  lines.push('发过去不是被忽略就是换回一次 502。')
  lines.push('')

  lines.push('## 1. 字段出现频次（谁在声明什么）')
  lines.push('')
  lines.push('| 字段 | 声明该字段的模型数 | 覆盖面 |')
  lines.push('|---|---:|---:|')
  for (const [key, count] of keyStats(rows)) {
    lines.push(`| \`${key}\` | ${count} | ${Math.round((count / rows.length) * 100)}% |`)
  }
  lines.push('')

  const refModels = available.filter((row) => row.references.max > 0)
  const required = available.filter((row) => row.referencesRequired)
  const oneOnly = refModels.filter((row) => row.references.max === 1)
  const noRef = available.filter((row) => row.references.max === 0)

  lines.push('## 2. 图生图（`input_references`）专项 —— 最容易出错的地方')
  lines.push('')
  lines.push('OpenRouter **没有独立的改图端点**：图生图 = `POST /images` + `input_references`。')
  lines.push('元素形状 `{"type":"image_url","image_url":{"url":"<https URL 或 data URL>"}}`，')
  lines.push('URL 与 base64 data URL 都收。**没有** `mask` / `negative_prompt` / `strength`，所以不支持局部重绘。')
  lines.push('')
  lines.push(`| 类别 | 模型数 | 说明 |`)
  lines.push('|---|---:|---|')
  lines.push(`| **必填底图**（\`min ≥ 1\`） | ${required.length} | 不给参考图就是**非法请求**，面板必须先拦住 |`)
  lines.push(`| 支持图生图（\`max ≥ 1\`） | ${refModels.length} | |`)
  lines.push(`| 上限 **= 1 张** | ${oneOnly.length} | 多给一张就超界 |`)
  lines.push(`| 完全不支持参考图 | ${noRef.length} | 参考图槽应禁用 |`)
  lines.push('')
  lines.push('### 2.1 逐模型参考图额度（全部可服务模型）')
  lines.push('')
  lines.push('> **「声明」是模型自己报的数，「可发」才是真能发出去的张数。** 两者差在网关的全局')
  lines.push('> `maxItems: 16` —— 模型级枚举网关不校验，全局 `maxItems` 校验。`tencent/hy-image-v3.5-preview`')
  lines.push('> 声明 20 张，实际发 17 张就是一次 400（失败不计费，但白等一次）。')
  lines.push('')
  lines.push('| 模型 | 最少 | 声明最多 | **可发最多** | 备注 |')
  lines.push('|---|---:|---:|---:|---|')
  for (const row of available) {
    const note = row.referencesRequired
      ? (row.references.min === 1 ? '**必填 · 恰好 1 张**' : `**必填 · 至少 ${row.references.min} 张**`)
      : row.references.max === 0 ? '不支持参考图' : (row.references.max === 1 ? '最多 1 张' : '')
    const clamped = row.referencesEffective.max < row.references.max
      ? `声明 ${row.references.max} 张，被网关全局上限压到 16`
      : ''
    lines.push(`| \`${row.id}\` | ${row.references.min} | ${row.references.max} | ${row.referencesEffective.max} | ${[note, clamped].filter((item) => item !== '').join('；')} |`)
  }
  lines.push('')

  lines.push('## 3. 逐模型完整参数表')
  lines.push('')
  const allKeys = keyStats(rows).map(([key]) => key)
  lines.push(`| 模型 | ${allKeys.map((key) => `\`${key}\``).join(' | ')} | 流式 |`)
  lines.push(`|---|${allKeys.map(() => '---').join('|')}|---|`)
  for (const row of available) {
    const cells = allKeys.map((key) => cell(row.params[key] ?? '—'))
    lines.push(`| \`${row.id}\` | ${cells.join(' | ')} | ${row.supportsStreaming ? '✔' : '—'} |`)
  }
  lines.push('')

  if (matrix.unserved.length > 0) {
    lines.push('## 4. 无服务通道的模型（选中必失败，列表阶段就该过滤）')
    lines.push('')
    for (const id of matrix.unserved) lines.push(`- \`${id}\``)
    lines.push('')
  }

  lines.push('## 5. `provider.options` 的键（逐模型）')
  lines.push('')
  lines.push('官方文档示例写死的 `black-forest-labs` **只对 `flux.2-pro` 成立**：同族 slug 带区域/variant 后缀且互不相同。')
  lines.push('只能按 `/endpoints` 返回的 `provider_slug`（官方口径是 `provider_tag`）动态取。')
  lines.push('')
  lines.push('| 模型 | `provider.options` 的键 | 可透传参数 |')
  lines.push('|---|---|---|')
  for (const row of available) {
    if (row.providerOptions.length === 0) continue
    for (const option of row.providerOptions) {
      lines.push(`| \`${row.id}\` | \`${option.slug}\` | ${option.params.join('、')} |`)
    }
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
