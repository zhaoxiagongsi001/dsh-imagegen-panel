/**
 * 契约检查：拿**真上游的当前响应**喂给本插件的解析器。
 *
 * 与另外三关的分工：
 *   - `host-check.mjs`   离线，假上游，覆盖行为（215 项）
 *   - `render-check.mjs` 离线，浏览器半边渲染（66 项）
 *   - `live-check.mjs`   真机，打运行中的 DSH
 *   - **本文件**         真上游，验「解析器与上游形状没跑偏」
 *
 * 为什么能白跑：OpenRouter 的 `GET /images/models` 与 `/images/models/<id>/endpoints`
 * **都是公开接口**（2026-10-10 实测：不带 Key 也 200）。所以这一关不需要 Key、
 * 不花一分钱，却能在上游改字段时第一时间报警 —— 而 `POST /images` 要花钱，
 * 那部分只能靠 `host-check` 的假上游覆盖。
 *
 * 用法：node scripts/upstream-check.mjs
 * 退出码：0 通过 / 1 断言失败 / 2 网络不可达（这一关依赖外网，不是代码问题）
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BASE = process.env.DSH_IMAGE_UPSTREAM ?? 'https://openrouter.ai/api/v1'

const failures = []
let total = 0

function check(ok, label) {
  total += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures.push(label)
}

function checkEqual(actual, expected, label) {
  check(actual === expected, `${label}  ← 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

/** 取一个上游 JSON。 */
async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return await response.json()
}

console.log(`上游：${BASE}\n`)

// ------------------------------------------------------------ 1. 模型目录

console.log('--- 1. GET /images/models → parseImageModels ---')

let listPayload
try {
  listPayload = await getJson(`${BASE}/images/models`)
} catch (error) {
  console.error(`上游不可达：${error instanceof Error ? error.message : String(error)}`)
  console.error('（这一关依赖外网；不是代码问题，退出码 2）')
  process.exit(2)
}

const plugin = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
const { parseImageModels, parseCapabilities, buildImageRequest, normalizeQuality } = plugin

const rawModels = Array.isArray(listPayload.data) ? listPayload.data : []
console.log(`上游返回 ${rawModels.length} 个模型`)
check(rawModels.length > 0, '上游返回了模型（不是空表）')

let parsed
try {
  parsed = parseImageModels(listPayload)
  check(true, 'parseImageModels 没有抛错')
} catch (error) {
  check(false, `parseImageModels 抛错：${error instanceof Error ? error.message : String(error)}`)
  parsed = { models: [], params: new Map() }
}

checkEqual(parsed.models.length, rawModels.length, '解析后的模型数量与上游一致（没有条目被静默丢掉）')
check(parsed.models.every((model) => typeof model.id === 'string' && model.id !== ''), '每个模型都有非空 id')
check(parsed.models.every((model) => typeof model.supportsReferences === 'boolean'), '每个模型都有 supportsReferences')
check(
  parsed.models.every((model) => Array.isArray(model.options.aspectRatio)
    && Array.isArray(model.options.resolution)
    && Array.isArray(model.options.count)
    && Array.isArray(model.options.quality)),
  '每个模型都有四项候选值数组（形状与 ModelOption 一致）',
)
check(parsed.models.every((model) => model.caps.length > 0), '每个模型都有能力标签')

const withRatio = parsed.models.filter((model) => model.options.aspectRatio.length > 0).length
const withResolution = parsed.models.filter((model) => model.options.resolution.length > 0).length
const withCount = parsed.models.filter((model) => model.options.count.length > 0).length
const withQuality = parsed.models.filter((model) => model.options.quality.length > 0).length
const withRefs = parsed.models.filter((model) => model.supportsReferences).length

console.log(`  比例 ${withRatio} · 分辨率 ${withResolution} · 张数 ${withCount} · 质量 ${withQuality} · 支持参考图 ${withRefs}`)
check(withRatio > 0, '至少有一个模型声明了 aspect_ratio（否则说明上游字段改名了）')
check(withResolution > 0, '至少有一个模型声明了 resolution')
check(withCount > 0, '至少有一个模型声明了 n（张数）')
check(withRefs > 0, '至少有一个模型声明了 input_references（图生图）')

// 候选值必须来自上游，不是我们编的：抽查一个模型的张数上限是否等于上游 range。
const sampleRaw = rawModels.find((model) => model.supported_parameters?.n?.type === 'range')
if (sampleRaw !== undefined) {
  const sample = parsed.models.find((model) => model.id === sampleRaw.id)
  const expectedMax = Math.min(10, Math.round(sampleRaw.supported_parameters.n.max))
  checkEqual(sample.options.count.at(-1), String(expectedMax), `张数候选值展开自上游 range（${sampleRaw.id}）`)
}

// ------------------------------------------------------------ 2. 能力与定价

console.log('\n--- 2. GET /images/models/<id>/endpoints → parseCapabilities ---')

// 挑三个形态不同的：有定价档位的、有质量的、极简的。
const picks = []
const withQualityRaw = rawModels.find((model) => model.supported_parameters?.quality !== undefined)
if (withQualityRaw !== undefined) picks.push(withQualityRaw.id)
for (const model of rawModels.slice(0, 3)) {
  if (!picks.includes(model.id)) picks.push(model.id)
}

for (const id of picks) {
  let payload
  try {
    payload = await getJson(`${BASE}/images/models/${id}/endpoints`)
  } catch (error) {
    check(false, `拉 ${id} 的 endpoints 失败：${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  const caps = parseCapabilities(payload)
  checkEqual(caps.model, id, `${id}：解析出的 model id 正确`)
  check(caps.providers.length > 0, `${id}：解析出 provider（${caps.providers.join('、') || '无'}）`)
  const optionTotal = caps.options.aspectRatio.length + caps.options.resolution.length
    + caps.options.count.length + caps.options.quality.length
  check(optionTotal > 0, `${id}：至少解析出一项参数候选值`)
  console.log(`  ${id}`)
  console.log(`      报价 ${caps.price || '（上游没给可展示的价）'} | provider ${caps.providers.length} | 透传 ${caps.passthrough.join('/') || '无'}`)
  console.log(`      比例 ${caps.options.aspectRatio.length} · 分辨率 ${caps.options.resolution.length} · 张数 ${caps.options.count.join('/') || '-'} · 质量 ${caps.options.quality.join('/') || '-'}`)
}

// 定价解析：至少有一个模型能算出「按张」或「按 token」的报价。
let pricedCount = 0
for (const model of rawModels.slice(0, 8)) {
  try {
    const caps = parseCapabilities(await getJson(`${BASE}/images/models/${model.id}/endpoints`))
    if (caps.price !== '') pricedCount += 1
  } catch {
    // 单个模型拉不到不影响整体结论。
  }
}
check(pricedCount > 0, `前 8 个模型里至少有一个能算出报价（实际 ${pricedCount} 个）`)

// ------------------------------------------------------------ 3. 请求体裁剪

console.log('\n--- 3. buildImageRequest 拿真能力表做字段裁剪 ---')

const richModel = parsed.models.find((model) => model.options.quality.length > 0)
if (richModel !== undefined) {
  const built = buildImageRequest(
    { prompt: 'p', model: richModel.id, aspectRatio: '1:1', resolution: '1K', count: 2, quality: '高', references: ['data:image/png;base64,AA'] },
    { params: parsed.params.get(richModel.id), outputFormat: 'png', extraJson: '{"provider":{"sort":"price"}}' },
  )
  checkEqual(built.body.model, richModel.id, '请求体带 model')
  checkEqual(built.body.quality, 'high', '中文「高」→ high（真能力表下也是这个结果）')
  check(built.body.provider !== undefined, '额外参数合并进请求体')
  console.log(`  ${richModel.id} → ${JSON.stringify(built.body).slice(0, 220)}`)
  if (built.dropped.length > 0) console.log(`      裁掉：${built.dropped.join('、')}`)
}

const thinModel = parsed.models.find((model) => model.options.aspectRatio.length === 0 && model.options.quality.length === 0)
if (thinModel !== undefined) {
  const built = buildImageRequest(
    { prompt: 'p', model: thinModel.id, aspectRatio: '16:9', resolution: '1K', count: 1, quality: '高', references: [] },
    { params: parsed.params.get(thinModel.id), outputFormat: 'png', extraJson: '' },
  )
  checkEqual(built.body.aspect_ratio, undefined, `${thinModel.id} 没声明比例 → 一个字段都不发`)
  check(built.dropped.length > 0, `${thinModel.id}：被裁掉的字段如实回报`)
}

checkEqual(normalizeQuality('自动'), 'auto', '质量别名：自动 → auto')
checkEqual(normalizeQuality('不认识'), '', '无法识别的质量返回空串（调用方据此丢弃）')

// ------------------------------------- 4. 逐个模型核对「发出去的字段是否合法」

console.log('\n--- 4. 全部真实模型：发出去的每个字段都在它自己声明的范围内 ---')

/**
 * 面板出厂默认值里最容易撞墙的一组：`config.outputFormat` 默认 `png`，
 * 参数默认 16:9 / 1K / 3 张 / 中文「高」，参考图最多 4 张（面板的历史上限）。
 *
 * 用这组「最坏输入」跑一遍全部模型，逐个字段核对是否落在该模型声明的枚举/区间里 ——
 * 这正是上游**不校验**、只能我们自己做的那一层（实测：给只收 `["svg"]` 的模型发
 * `output_format:"png"`，网关只报了 `n` 的问题）。
 */
const WORST = {
  aspectRatio: '16:9',
  resolution: '1K',
  count: 3,
  quality: '高',
  outputFormat: 'png',
  references: [
    'data:image/png;base64,AA', 'data:image/png;base64,BB',
    'data:image/png;base64,CC', 'data:image/png;base64,DD',
  ],
}

const violations = []
/** 若没有值级裁剪，这 7 个模型会收到它们不认的 `output_format` —— 用来证明防护不是摆设。 */
const wouldBreach = []

for (const model of parsed.models) {
  const params = parsed.params.get(model.id)
  const spec = (key) => params?.[key]
  const built = buildImageRequest(
    {
      prompt: 'p',
      model: model.id,
      aspectRatio: WORST.aspectRatio,
      resolution: WORST.resolution,
      count: WORST.count,
      quality: WORST.quality,
      references: WORST.references,
    },
    { params, outputFormat: WORST.outputFormat, extraJson: '' },
  )
  const body = built.body

  // ① 键级：发出去的字段必须在该模型的能力表里
  for (const key of Object.keys(body)) {
    if (key === 'model' || key === 'prompt') continue
    if (spec(key) === undefined) violations.push(`${model.id}：发了未声明的 ${key}`)
  }

  // ② 值级：枚举字段的取值必须在枚举里
  for (const key of ['aspect_ratio', 'resolution', 'quality', 'output_format']) {
    const value = body[key]
    if (value === undefined) continue
    const s = spec(key)
    if (s?.type === 'enum' && Array.isArray(s.values) && !s.values.includes(value)) {
      violations.push(`${model.id}：${key}=${JSON.stringify(value)} 不在 ${JSON.stringify(s.values)} 内`)
    }
  }

  // ③ 张数必须落在 range 里
  if (typeof body.n === 'number') {
    const s = spec('n')
    if (typeof s?.min === 'number' && body.n < s.min) violations.push(`${model.id}：n=${body.n} < min ${s.min}`)
    if (typeof s?.max === 'number' && body.n > s.max) violations.push(`${model.id}：n=${body.n} > max ${s.max}`)
  }

  // ④ 参考图张数不能超过该模型的上限
  const sent = Array.isArray(body.input_references) ? body.input_references.length : 0
  if (sent > model.references.max) {
    violations.push(`${model.id}：发了 ${sent} 张参考图 > 上限 ${model.references.max}`)
  }

  // ⑤ 统计「没有这层防护就会出事」的模型
  const of = spec('output_format')
  if (of?.type === 'enum' && Array.isArray(of.values) && !of.values.includes('png')) {
    wouldBreach.push(`${model.id}（只收 ${of.values.join('/')}）`)
  }
}

checkEqual(violations.length, 0, `${parsed.models.length} 个模型 × 全部字段：零越界`)
for (const item of violations.slice(0, 20)) console.error(`    越界：${item}`)
check(
  wouldBreach.length > 0,
  `确有模型会因 output_format 越界出事 → 这条防护不是摆设（${wouldBreach.length} 个）`,
)
for (const item of wouldBreach) console.log(`    ${item}`)

// 配置改成 svg：向量模型必须收得到（证明不是「一律不发」）。
const svgOnly = parsed.models.filter((model) => (parsed.params.get(model.id)?.output_format?.values ?? []).join('/') === 'svg')
check(svgOnly.length > 0, `上游确实有只收 svg 的向量模型（${svgOnly.length} 个）`)
let svgSent = 0
for (const model of svgOnly) {
  const built = buildImageRequest(
    { prompt: 'p', model: model.id, aspectRatio: '', resolution: '', count: 1, quality: '', references: [] },
    { params: parsed.params.get(model.id), outputFormat: 'svg', extraJson: '' },
  )
  if (built.body.output_format === 'svg') svgSent += 1
}
checkEqual(svgSent, svgOnly.length, `配置成 svg 时这 ${svgOnly.length} 个向量模型全都收得到`)

// 参考图必填的模型：面板要靠这个区间在本地拦住空提交。
const refRequired = parsed.models.filter((model) => model.references.min >= 1)
check(refRequired.length > 0, `上游确实有「参考图必填」的模型（${refRequired.length} 个：${refRequired.map((model) => model.id).join('、')}）`)

// 解析器没漏字段：每个模型都拿到了参考图区间与输出格式候选。
check(parsed.models.every((model) => Number.isFinite(model.references?.min) && Number.isFinite(model.references?.max)), '每个模型都解析出 references 区间')
check(parsed.models.every((model) => Array.isArray(model.options.outputFormat)), '每个模型都解析出 options.outputFormat（可能是空数组）')

// ------------------------------------- 5. 可用性探测（真上游，逐模型拉 endpoints）

console.log('\n--- 5. getImageModels 的可用性探测：剔掉没有通道的条目 ---')

// 关掉缓存，两次调用都要真打上游。
process.env.DSH_IMAGEGEN_MODELS_TTL_MS = '0'
const { getImageModels } = plugin

const probeStart = Date.now()
const probed = await getImageModels(BASE, undefined, true)
const probeMs = Date.now() - probeStart
console.log(`  探测 ${rawModels.length} 个模型的 endpoints：${(probeMs / 1000).toFixed(1)}s`)

check(probed.models.length > 0, `探测后仍有模型（${probed.models.length} 个）`)
check(
  probed.models.length <= rawModels.length,
  `探测只会做减法（${rawModels.length} → ${probed.models.length}）`,
)
// 被剔掉的必须**确实**是 endpoints 为空的那些。
const dropped = rawModels.filter((model) => !probed.models.some((item) => item.id === model.id))
let confirmedDead = 0
for (const model of dropped) {
  try {
    const payload = await getJson(`${BASE}/images/models/${model.id}/endpoints`)
    const count = Array.isArray(payload.endpoints) ? payload.endpoints.length : 0
    if (count === 0) confirmedDead += 1
    else console.error(`    误杀：${model.id} 有 ${count} 个 endpoint 却被剔掉了`)
  } catch (error) {
    console.error(`    误杀：${model.id} 的 endpoints 拉不到（${error instanceof Error ? error.message : String(error)}）`)
  }
}
checkEqual(confirmedDead, dropped.length, `被剔掉的 ${dropped.length} 个模型全都确认是「零 endpoint」（${dropped.map((model) => model.id).join('、') || '无'}）`)

// 关掉开关后应当原样返回 —— 证明「少掉的那些」确实是探测做的。
process.env.DSH_IMAGEGEN_SKIP_AVAILABILITY = '1'
const unprobed = await getImageModels(BASE, undefined, true)
process.env.DSH_IMAGEGEN_SKIP_AVAILABILITY = '0'
checkEqual(unprobed.models.length, rawModels.length, '关掉可用性探测 → 目录原样返回（含死条目）')
checkEqual(
  rawModels.length - probed.models.length,
  unprobed.models.length - probed.models.length,
  '少掉的条目数 = 上游真实的「零 endpoint」条目数',
)

// ------------------------------------- 6. 逐模型参数表（真上游，59 个模型）

console.log('\n--- 6. 逐模型参数表：界面按它渲染，字段与值域都必须对得上 ---')

/**
 * 已知的模型级请求字段全集。
 *
 * 这是 2026-10-10 对全部 59 个真实模型扫描的结果：`supported_parameters` 里
 * 一共只出现过这 10 个键。出现第 11 个就说明上游加了新参数 —— 那是个**信号**，
 * 应当去 `FIELD_SPECS` 里补一条规格，而不是让它悄悄溜过去（没有规格的字段
 * 面板不会渲染，发过去也只会被当成「不是模型级请求字段」裁掉）。
 */
const KNOWN_FIELDS = new Set([
  'input_references', 'aspect_ratio', 'n', 'resolution',
  'output_format', 'seed', 'background', 'quality', 'output_compression', 'size',
])

const unknownFields = new Map()
for (const model of parsed.models) {
  for (const key of Object.keys(parsed.params.get(model.id) ?? {})) {
    if (!KNOWN_FIELDS.has(key)) unknownFields.set(key, (unknownFields.get(key) ?? 0) + 1)
  }
}
checkEqual(unknownFields.size, 0, `59 个模型只出现已知字段（未知：${[...unknownFields.keys()].join('、') || '无'}）`)

// 每个模型的参数表都必须与它自己的描述符一致。
const tableProblems = []
let withParameters = 0
let withStream = 0
let withSize = 0
let withSeed = 0
for (const model of parsed.models) {
  const fields = model.parameters ?? []
  if (fields.length > 0) withParameters += 1
  if (model.supportsStreaming) withStream += 1
  const raw = parsed.params.get(model.id) ?? {}
  for (const field of fields) {
    if (field.name === 'stream') {
      if (!model.supportsStreaming) tableProblems.push(`${model.id}：没有 supports_streaming 却给了 stream 字段`)
      if (field.control !== 'toggle' || field.valueType !== 'boolean') tableProblems.push(`${model.id}：stream 的控件/值类型不对`)
      continue
    }
    if (raw[field.name] === undefined) {
      tableProblems.push(`${model.id}：${field.name} 不在该模型的 supported_parameters 里`)
      continue
    }
    // 枚举 → 下拉且候选值一模一样；区间 → 候选值/上下限对得上。
    if (raw[field.name].type === 'enum') {
      const expected = (raw[field.name].values ?? []).join('/')
      if (field.control !== 'select' && expected !== '') tableProblems.push(`${model.id}：${field.name} 是 enum 却不是下拉`)
      else if ((field.values ?? []).join('/') !== expected) tableProblems.push(`${model.id}：${field.name} 候选值与上游不一致`)
    }
    // **最容易错的一条**：`boolean` 描述符 ≠ 布尔值。
    if (field.name === 'seed' && field.valueType !== 'integer') tableProblems.push(`${model.id}：seed 的值类型应当是 integer`)
    if (field.name === 'size' && field.valueType !== 'string') tableProblems.push(`${model.id}：size 的值类型应当是 string`)
    if (field.name === 'seed') withSeed += 1
    if (field.name === 'size') withSize += 1
  }
  // 参考图不是参数行里的普通字段（由参考图槽承载），不该出现在表里。
  if (fields.some((field) => field.name === 'input_references')) tableProblems.push(`${model.id}：input_references 不该出现在参数行`)
}
checkEqual(tableProblems.length, 0, `${parsed.models.length} 个模型的参数表与上游描述符逐字段一致`)
for (const problem of tableProblems.slice(0, 20)) console.error(`    不一致：${problem}`)

console.log(`  有参数表的模型 ${withParameters} · 声明流式 ${withStream} · 声明 seed ${withSeed} · 声明 size ${withSize}`)
check(withParameters > 0, '确实有模型声明了参数（参数表不是空的）')
check(withStream > 0, `上游确实有支持流式的模型（${withStream} 个）—— 所以 stream 开关不是摆设`)
check(withSeed > 0, `上游确实有声明 seed 的模型（${withSeed} 个）`)
check(withSize > 0, `上游确实有声明 size 的模型（${withSize} 个）`)

// 「boolean 描述符 ≠ 布尔值」：上游只有 seed / size 用 boolean，而它们的值类型都不是布尔。
const booleanSpecs = new Map()
for (const model of parsed.models) {
  for (const [key, spec] of Object.entries(parsed.params.get(model.id) ?? {})) {
    if (spec?.type === 'boolean') booleanSpecs.set(key, (booleanSpecs.get(key) ?? 0) + 1)
  }
}
console.log(`  用 boolean 描述符的键：${[...booleanSpecs.entries()].map(([key, count]) => `${key}(${count})`).join(' ') || '无'}`)
check(
  [...booleanSpecs.keys()].every((key) => key === 'seed' || key === 'size'),
  'boolean 描述符只出现在 seed / size 上（其余键都是 enum / range）',
)

// 参考图：模型声明的上限可能大于网关的全局 maxItems: 16 —— 一律按 16 收敛。
const over16 = parsed.models.filter((model) => (model.references?.max ?? 0) > 16)
checkEqual(over16.length, 0, `没有模型的参考图上限超过网关全局 16（声明 >16 的：${over16.map((model) => model.id).join('、') || '无'}）`)
const declaredOver16 = rawModels.filter((model) => {
  const spec = model.supported_parameters?.input_references
  return typeof spec?.max === 'number' && spec.max > 16
})
if (declaredOver16.length > 0) {
  console.log(`  上游确有声明 >16 张的模型（${declaredOver16.map((model) => `${model.id}:${model.supported_parameters.input_references.max}`).join('、')}）→ 已收敛到 16`)
}

// 模型级「不校验」而全局「校验」：buildImageRequest 里 size 的形状校验不是摆设。
const built = buildImageRequest(
  { prompt: 'p', model: parsed.models[0].id, aspectRatio: '', resolution: '', count: 1, quality: '', references: [], extra: { size: 'nonsense' } },
  { params: parsed.params.get(parsed.models[0].id), outputFormat: '', extraJson: '' },
)
check(built.dropped.some((item) => item.startsWith('size')) || built.body.size === undefined, 'size 的形状校验生效（描述符没有值域，只能在本地拦）')

// ------------------------------------------------------------------ 汇总

console.log(`\n${total - failures.length}/${total} passed`)
if (failures.length > 0) {
  console.error('\n失败项：')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\n（如果失败集中在字段缺失上，多半是上游改了响应形状 —— 去看 .ref/probe-openrouter.mjs 的输出）')
  process.exit(1)
}
