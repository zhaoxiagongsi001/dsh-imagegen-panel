/**
 * 真机验收：对着**运行中的 DSH** 打 `/dsh-imagegen/*`，验阶段 3 的管道。
 *
 * 与 `host-check.mjs` 的分工：
 *   - `host-check.mjs`  = 离线，用假 ctx 跑真路由，覆盖边界与围栏（358 项）
 *   - `live-check.mjs`  = 真机，HTTP 打真进程，覆盖「装进 DSH 之后确实是这样」（本文件）
 *
 * 安全约定（重要）：
 *   - 写测试只在**当前没有 Key** 时进行，用一把一次性测试 Key，跑完清掉；
 *   - 若检测到**已经有 Key**（老板填过真的），则跳过写 Key 的那段，只做「不碰 Key 的
 *     PUT + 掩码不变 + 响应无明文」这类安全断言 —— 绝不清掉老板的真 Key。
 *
 * 用法：
 *   node scripts/live-check.mjs                  # 默认 http://127.0.0.1:19387
 *   node scripts/live-check.mjs --keep           # 保留测试 Key 不清（调试用）
 *   $env:DSH_IMAGE_BASE='http://127.0.0.1:19387'; node scripts/live-check.mjs
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const BASE = (process.env.DSH_IMAGE_BASE ?? 'http://127.0.0.1:19387').replace(/\/+$/, '')
const KEEP = process.argv.includes('--keep')

/** 一次性测试 Key：刻意长得像真的，但它是假的，跑完会被清掉。 */
const TEST_KEY = 'sk-or-v1-livecheck-0000000000000000deadbeef'

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

function checkContains(haystack, needle, label) {
  check(typeof haystack === 'string' && haystack.includes(needle), `${label}  ← 期待包含 ${JSON.stringify(needle)}`)
}

/** 打一次路由，返回 { status, text, json }。 */
async function call(path, init) {
  const response = await fetch(`${BASE}${path}`, init)
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: response.status, text, json }
}

/** 发一个 PUT。 */
async function putConfig(body) {
  return call('/dsh-imagegen/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

console.log(`目标：${BASE}\n`)

// ---------------------------------------------------------------- 1. 路由在不在

console.log('--- 1. 宿主半边是否挂上（重启前这里是 404） ---')

const health = await call('/dsh-imagegen/health')
checkEqual(health.status, 200, 'GET /dsh-imagegen/health 返回 200')
check(health.json?.ok === true, 'health.ok === true')
checkEqual(health.json?.plugin, 'dsh-imagegen-panel', 'health 报告的是本插件')
check(typeof health.json?.configPath === 'string' && health.json.configPath.endsWith('config.json'), 'health 给出配置文件路径')

if (health.status !== 200) {
  console.error('\n宿主路由没挂上 —— 先重启 DSH 一次（见 HANDOVER-2026-10-10.md §3）')
  process.exit(1)
}

const CONFIG_PATH = health.json.configPath
console.log(`      配置路径 ${CONFIG_PATH}`)

// ---------------------------------------------------------------- 2. 读配置

console.log('\n--- 2. 读配置（GET） ---')

const initial = await call('/dsh-imagegen/config')
checkEqual(initial.status, 200, 'GET /config 返回 200')
check(initial.json?.ok === true, 'GET /config ok === true')
checkEqual(initial.json?.config?.protocol, 'openrouter', '默认协议 openrouter')

const initialConfig = initial.json?.config ?? {}
const hadKey = initialConfig.hasKey === true
console.log(`      检查前是否已配置 Key：${hadKey ? '是（写 Key 的测试会被跳过，绝不碰真 Key）' : '否'}`)

// 字段集合必须与客户端 PanelConfig 完全一致（逐字段断言在 host-check 里做）。
const expectedKeys = ['autoSaveDir', 'baseUrl', 'extraJson', 'hasKey', 'keyHint', 'model', 'outputFormat', 'protocol', 'timeoutSec']
checkEqual(Object.keys(initialConfig).sort().join(','), expectedKeys.join(','), '下发字段集合与客户端 PanelConfig 一致')
check(!('apiKey' in initialConfig), '下发面里没有 apiKey 字段（类型上就不该有）')

// ---------------------------------------------------------------- 3. 其余路由

console.log('\n--- 3. models / history / generate ---')

const models = await call('/dsh-imagegen/models')
checkEqual(models.status, 200, 'GET /models 返回 200')
checkEqual(models.json?.stub, undefined, '不再是阶段 3 的占位表（stub 标记已去掉）')
checkContains(models.json?.source ?? '', '/images/models', '响应里带上游出处')
const modelList = Array.isArray(models.json?.models) ? models.json.models : []
check(modelList.length >= 1, `拉到真实模型（${modelList.length} 个）`)
check(
  modelList.every((model) => Array.isArray(model.options?.aspectRatio)
    && Array.isArray(model.options?.resolution)
    && Array.isArray(model.options?.count)
    && Array.isArray(model.options?.quality)),
  '每个模型都带四项候选值（形状与 ModelOption 一致）',
)
check(modelList.some((model) => model.options.aspectRatio.length > 0), '至少有一个模型给出比例候选值（说明能力表解析成功）')

// 阶段 4：模型能力与定价（上游这两个接口是公开的，不需要 Key）
const sampleModel = modelList.find((model) => model.options.resolution.length > 0) ?? modelList[0]
const capabilities = await call(`/dsh-imagegen/capabilities?model=${encodeURIComponent(sampleModel.id)}&resolution=${encodeURIComponent(sampleModel.options.resolution[0] ?? '')}`)
checkEqual(capabilities.status, 200, `GET /capabilities 返回 200（${sampleModel.id}）`)
check(Array.isArray(capabilities.json?.capabilities?.providers) && capabilities.json.capabilities.providers.length > 0, '解析出 provider')
check(capabilities.json?.capabilities?.options?.aspectRatio?.length > 0, '合并出参数候选值')
console.log(`      ${sampleModel.id} 报价：${capabilities.json?.capabilities?.price || '（上游没给可展示的价）'}`)

const history = await call('/dsh-imagegen/history')
checkEqual(history.status, 200, 'GET /history 返回 200')
check(Array.isArray(history.json?.images), 'history.images 是数组')

// 宿主日志：桌面版 DSH 没有可见的宿主控制台（宿主进程 stdout 无人接管），
// 所以这条路由是面板「查看日志」的唯一后端 —— 它 404 就等于老板又回到「看不到日志」。
const logs = await call('/dsh-imagegen/logs')
checkEqual(logs.status, 200, 'GET /logs 返回 200（「查看日志」有后端）')
check(Array.isArray(logs.json?.entries), '/logs 回 entries 数组')
check(typeof logs.json?.file === 'string' && logs.json.file.endsWith('.log'), `/logs 回日志文件路径（${logs.json?.file ?? '—'}）`)
check(typeof logs.json?.count === 'number', '/logs 回缓冲条数')
const logsText = await call('/dsh-imagegen/logs?format=text')
check(logsText.status === 200 && logsText.text.includes('[info]'), '?format=text 回带级别标记的纯文本（可直接下载）')
checkEqual((await call('/dsh-imagegen/logs', { method: 'POST' })).status, 405, 'POST /logs → 405')

// 图片路由：宿主把落盘的图喂给浏览器的那条 prefix 路由。
// 这条断言是有来历的 —— 2026-10-10 真机上 prefix 带了尾斜杠，匹配不上，
// 面板里图全裂、这里回 404 且 content-type 为空。
if (Array.isArray(history.json?.images) && history.json.images.length > 0) {
  const first = history.json.images[0]
  // 宿主给的是**相对路径**（`dsh-imagegen/image/<id>`），浏览器侧由 apiPath() 补挂载点；
  // 这里直接拼 BASE 时别忘了斜杠。
  const imageResponse = await fetch(`${BASE}/${first.imageUrl}`)
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer())
  checkEqual(imageResponse.status, 200, `GET ${first.imageUrl} 返回 200`)
  check((imageResponse.headers.get('content-type') ?? '').startsWith('image/'), `图片路由回 image/* 的 content-type（实际 ${imageResponse.headers.get('content-type')}）`)
  check(imageBytes.length > 1000, `图片字节数合理（${imageBytes.length} B）`)
  check(imageBytes.subarray(0, 4).toString('hex') === '89504e47' || imageResponse.headers.get('content-type') !== 'image/png', 'PNG 文件头正确')

  // 阶段 5：「保存」按钮走的那条路由。用显式 target 指向系统临时目录 ——
  // 真机验收不该往老板的工作区目录里塞副本（那正是「自动保存目录」的行为，
  // 但那是生成时的事，验收脚本不替用户做这个决定）。
  const saveDir = path.join(tmpdir(), 'dsh-imagegen-livecheck')
  const saveResponse = await call('/dsh-imagegen/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: first.id, target: saveDir }),
  })
  checkEqual(saveResponse.status, 200, 'POST /save 返回 200')
  const savedPath = saveResponse.json?.savedPath ?? ''
  check(savedPath.startsWith(saveDir), `保存到指定目录（${savedPath}）`)
  check(existsSync(savedPath), '保存出来的文件确实存在')
  if (existsSync(savedPath)) {
    checkEqual(readFileSync(savedPath).length, imageBytes.length, '保存的副本与原图字节数一致')
    rmSync(savedPath, { force: true })
  }
  checkEqual((await call('/dsh-imagegen/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'no-such-id' }) })).status, 404, '/save 未知 id → 404')
} else {
  console.log('      还没出过图 → 跳过图片路由断言')
}

// ------------------------------------------------- 提示词优化（跨插件）
// 我们只负责把 prompt-forge 的「文生图优化」模板文本取出来；真正的优化是打
// **prompt-forge 自己的 SSE 路由**（同源），所以这里也直接打那条路由验一次。
const presetRes = await call('/dsh-imagegen/preset')
checkEqual(presetRes.status, 200, 'GET /preset 返回 200（读得到 prompt-forge 的模板）')
checkEqual(presetRes.json?.name, '文生图优化', '拿到的是「文生图优化」模板')
check((presetRes.json?.system ?? '').length > 50, `模板 system 文本够长（${(presetRes.json?.system ?? '').length} 字）`)
console.log(`      模板用的渠道：${presetRes.json?.provider ?? '?'} · ${presetRes.json?.model ?? '?'}`)

if (presetRes.status === 200) {
  const optimized = await optimizeOnce('一只柴犬坐在窗边，午后阳光', presetRes.json.system)
  check(optimized.ok, `prompt-forge 真跑通了一次优化（${optimized.chars} 字）${optimized.ok ? '' : `：${optimized.message}`}`)
  if (optimized.ok) {
    check(optimized.text.trim() !== '一只柴犬坐在窗边，午后阳光', '返回的确实是改写过的文本（不是原样回显）')
    console.log(`      优化结果前 60 字：${optimized.text.slice(0, 60).replace(/\s+/gu, ' ')}`)
  }
}

/**
 * 打 prompt-forge 的 optimize 路由，读它的 SSE，拼出完整结果。
 * @param text - 草稿。
 * @param system - 模板文本。
 * @returns 结果或失败原因。
 */
async function optimizeOnce(text, system) {
  try {
    const response = await fetch(`${BASE}/api/dsh-prompt-forge/optimize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      // 与 src/client/optimize.ts 保持一致：模板末尾补一句输出约束。
      body: JSON.stringify({ text, system: `${system}\n\n只输出改写后的提示词本身。不要解释你做了什么，不要加标题、前言、说明、Markdown 代码块包裹，也不要加「优化后的提示词：」这类标签。` }),
    })
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const body = await response.json()
        if (typeof body.message === 'string') message = body.message
      } catch { /* 保持状态码文案 */ }
      return { ok: false, chars: 0, message }
    }
    const raw = await response.text()
    let assembled = ''
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.startsWith('data:')) continue
      try {
        const event = JSON.parse(line.slice(5).trim())
        if (event.type === 'delta' && typeof event.text === 'string') assembled += event.text
        if (event.type === 'done' && typeof event.text === 'string' && event.text !== '') assembled = event.text
        if (event.type === 'error') return { ok: false, chars: 0, message: event.message ?? event.code ?? 'error' }
      } catch { /* 忽略解析不了的帧 */ }
    }
    if (assembled.trim() === '') return { ok: false, chars: 0, message: '结果为空' }
    return { ok: true, text: assembled, chars: assembled.length }
  } catch (error) {
    return { ok: false, chars: 0, message: error instanceof Error ? error.message : String(error) }
  }
}

// 阶段 4：/generate 的**免费**边界断言。
// ⚠️ 这里绝不发一次真生成：配了 Key 的话那是真花钱、还可能撞上游限流。
// 只用「宿主在调上游之前就会拒绝」的输入 —— 空提示词。
const generate = await call('/dsh-imagegen/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ request: { prompt: '   ', model: sampleModel.id, aspectRatio: '1:1', resolution: '1K', count: 1, quality: '', references: [] } }),
})
checkEqual(generate.status, 400, '空提示词 → 400（宿主在调上游之前就拒绝，不花钱）')
checkEqual(generate.json?.code, 'empty-prompt', '拒绝码是 empty-prompt')

if (!hadKey) {
  const noKey = await call('/dsh-imagegen/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: { prompt: 'x', model: sampleModel.id, aspectRatio: '1:1', resolution: '1K', count: 1, quality: '', references: [] } }),
  })
  checkEqual(noKey.status, 400, '没配 Key 时 POST /generate → 400')
  checkEqual(noKey.json?.code, 'no-key', '拒绝码是 no-key（不是 501/网络错误）')
  checkContains(noKey.json?.message ?? '', '连接配置', '提示去哪里配 Key')
} else {
  console.log('      已有 Key → 跳过 no-key 断言（那条会真的去调上游，花钱）')
}

// ---------------------------------------------------------------- 4. 写配置

console.log('\n--- 4. 写配置（PUT） ---')

// 用一个与当前不同的值，确认写进去了。
const probeModel = initialConfig.model === 'openai/gpt-image-1' ? 'google/gemini-3-pro-image' : 'openai/gpt-image-1'
const probeTimeout = initialConfig.timeoutSec === 240 ? 180 : 240

if (!hadKey) {
  console.log('      （当前无 Key → 走完整写 Key 路径，跑完清掉）')
  const put = await putConfig({ config: { model: probeModel, timeoutSec: probeTimeout }, apiKey: TEST_KEY })
  checkEqual(put.status, 200, 'PUT /config 返回 200')
  checkEqual(put.json?.config?.hasKey, true, 'PUT 后 hasKey=true')
  checkEqual(put.json?.config?.model, probeModel, 'PUT 后模型已更新')
  checkEqual(put.json?.config?.timeoutSec, probeTimeout, 'PUT 后超时已更新')

  // 负面验收①：PUT 的响应里不能有明文
  check(!put.text.includes(TEST_KEY), '负面验收①：PUT 响应里搜不到明文 Key')
  check(put.json?.config?.keyHint?.includes('••••••••') === true, 'PUT 只回掩码')
  check(put.json?.config?.keyHint?.endsWith(TEST_KEY.slice(-4)) === true, '掩码保留尾 4 位（能对上号）')

  // 落盘：明文必须只存在于宿主侧那个文件里
  let onDisk
  try {
    onDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    check(false, `读配置文件失败：${error instanceof Error ? error.message : String(error)}`)
  }
  check(onDisk?.apiKey === TEST_KEY, '磁盘上确实写了明文（宿主侧唯一允许出现的地方）')
  check(typeof onDisk?.updatedAt === 'string' && onDisk.updatedAt !== '', '落盘文件带 updatedAt')

  // 负面验收②：GET 的响应里不能有明文
  const afterPut = await call('/dsh-imagegen/config')
  check(!afterPut.text.includes(TEST_KEY), '负面验收②：GET 响应里搜不到明文 Key')
  checkEqual(afterPut.json?.config?.hasKey, true, 'GET 看到 hasKey=true')
  checkEqual(afterPut.json?.config?.keyHint, put.json?.config?.keyHint, 'GET 与 PUT 的掩码一致')
} else {
  console.log('      （已有 Key → 跳过写 Key，只验「不改 Key 的 PUT 不会动它」）')
  const put = await putConfig({ config: { model: probeModel, timeoutSec: probeTimeout }, apiKey: '' })
  checkEqual(put.status, 200, 'PUT /config 返回 200')
  checkEqual(put.json?.config?.hasKey, true, '不传新 Key 时旧 Key 保持（没被误清）')
  checkEqual(put.json?.config?.keyHint, initialConfig.keyHint, '不传新 Key 时掩码不变')
  checkEqual(put.json?.config?.model, probeModel, '不传新 Key 时其余字段照样更新')
  check(!put.text.includes(initialConfig.keyHint.replace(/•+/u, '')), 'PUT 响应里没有 Key 的任何片段')
}

// ------------------------------------------------------- 5. 无内存缓存（等价于重启后读得到）

console.log('\n--- 5. 「重启后还在」的等价证明：磁盘是唯一真相 ---')

// 直接改宿主侧那个文件，看 GET 是否立刻反映。
// 注意：这一步会写宿主工作区**之外**的文件，DSH 的 agent 沙箱下会 EPERM ——
// 那时如实报 SKIP，不算失败（离线 host-check 的「模拟重启」那组已经覆盖同一路径）。
const mutated = { ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')), model: 'live-check-mutated-model' }
try {
  writeFileSync(CONFIG_PATH, JSON.stringify(mutated, null, 2), 'utf8')
  const afterMutation = await call('/dsh-imagegen/config')
  checkEqual(afterMutation.json?.config?.model, 'live-check-mutated-model', '外部改文件后 GET 立刻反映（没有任何内存缓存）')
} catch (error) {
  const code = error?.code ?? ''
  if (code === 'EPERM' || code === 'EACCES') {
    console.log('SKIP  外部改文件后 GET 立刻反映  ← 沙箱不允许写工作区外的文件（EPERM）；')
    console.log('      等价证据：host-check.mjs 第 5 组「模拟重启」（重新 apply 一套新路由、只靠磁盘）')
  } else {
    check(false, `外部改文件测试异常：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------- 6. 收尾

console.log('\n--- 6. 收尾（把配置还原成检查前的样子） ---')

if (KEEP) {
  console.log('      --keep：保留测试期间写入的值，不还原')
} else if (hadKey) {
  const restored = await putConfig({
    config: {
      model: initialConfig.model,
      timeoutSec: initialConfig.timeoutSec,
      baseUrl: initialConfig.baseUrl,
      autoSaveDir: initialConfig.autoSaveDir,
      extraJson: initialConfig.extraJson,
      outputFormat: initialConfig.outputFormat,
      protocol: initialConfig.protocol,
    },
    apiKey: '',
  })
  checkEqual(restored.json?.config?.model, initialConfig.model, '已还原 model')
  checkEqual(restored.json?.config?.timeoutSec, initialConfig.timeoutSec, '已还原 timeoutSec')
  checkEqual(restored.json?.config?.hasKey, true, '真 Key 原封不动')
} else {
  const restored = await putConfig({
    config: {
      model: initialConfig.model,
      timeoutSec: initialConfig.timeoutSec,
      baseUrl: initialConfig.baseUrl,
      autoSaveDir: initialConfig.autoSaveDir,
      extraJson: initialConfig.extraJson,
      outputFormat: initialConfig.outputFormat,
      protocol: initialConfig.protocol,
    },
    clearKey: true,
  })
  checkEqual(restored.json?.config?.hasKey, false, 'clearKey 已清掉一次性测试 Key')
  checkEqual(restored.json?.config?.model, initialConfig.model, '已还原 model')
  checkEqual(restored.json?.config?.timeoutSec, initialConfig.timeoutSec, '已还原 timeoutSec')
  const finalDisk = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  checkEqual(finalDisk.apiKey, '', '磁盘上的测试 Key 已清空')
  check(!JSON.stringify(finalDisk).includes(TEST_KEY), '磁盘上不留测试 Key 痕迹')
}

// ------------------------------------------------- 7. 模型驱动参数表（真机）

console.log('\n--- 7. 模型驱动参数表：界面渲染的就是这里下发的东西 ---')

const KNOWN_FIELDS = new Set([
  'input_references', 'aspect_ratio', 'n', 'resolution',
  'output_format', 'seed', 'background', 'quality', 'output_compression', 'size',
])

const liveModels = await call('/dsh-imagegen/models')
checkEqual(liveModels.status, 200, 'GET /models 返回 200')
const catalog = Array.isArray(liveModels.json?.models) ? liveModels.json.models : []
check(catalog.length > 0, `真机拿到 ${catalog.length} 个模型`)

// 每个模型都必须带 `parameters` 与 `supportsStreaming` —— 缺了它们界面会退回
// 固定四项（老行为），那就等于这次改造没生效。
const missingParameters = catalog.filter((model) => !Array.isArray(model.parameters)).map((model) => model.id)
const missingStreaming = catalog.filter((model) => typeof model.supportsStreaming !== 'boolean').map((model) => model.id)
checkEqual(missingParameters.length, 0, `每个模型都带 parameters（缺的：${missingParameters.join('、') || '无'}）`)
checkEqual(missingStreaming.length, 0, `每个模型都带 supportsStreaming（缺的：${missingStreaming.join('、') || '无'}）`)

const declaredNames = new Set()
for (const model of catalog) {
  for (const field of model.parameters ?? []) declaredNames.add(field.name)
}
const strayFields = [...declaredNames].filter((name) => !KNOWN_FIELDS.has(name) && name !== 'stream')
checkEqual(strayFields.length, 0, `下发的字段都在已知的 10 个键 + stream 里（多出来的：${strayFields.join('、') || '无'}）`)

// 参考图**不是**参数行里的一行 —— 它由参考图槽承载，混进来会多出一个没用的下拉。
const refAsField = catalog.filter((model) => (model.parameters ?? []).some((field) => field.name === 'input_references'))
checkEqual(refAsField.length, 0, 'input_references 没有被当成普通参数下发')

const withStream = catalog.filter((model) => model.supportsStreaming === true)
console.log(`      声明字段的模型 ${catalog.filter((model) => (model.parameters ?? []).length > 0).length} · 支持流式 ${withStream.length} · 字段全集 ${[...declaredNames].sort().join(' ')}`)
check(withStream.length > 0, `真机确实有支持流式的模型（${withStream.length} 个）—— stream 开关不是摆设`)

// 挑一个声明得最全的模型，逐字段核它的参数表与上游描述符一致。
const richest = catalog.filter((model) => (model.parameters ?? []).length > 0)
  .reduce((best, model) => ((model.parameters ?? []).length > (best.parameters ?? []).length ? model : best))
console.log(`      声明最全：${richest.id} → ${(richest.parameters ?? []).map((field) => `${field.name}[${field.control}]`).join(' ')}`)

const richestCaps = (await call(`/dsh-imagegen/capabilities?model=${encodeURIComponent(richest.id)}`)).json?.capabilities
check(richestCaps !== undefined && Array.isArray(richestCaps.parameters), `${richest.id} 的 /capabilities 也带 parameters`)
if (richestCaps !== undefined) {
  checkEqual(richestCaps.available, true, `该模型有可服务通道（available=true）`)
  const bad = (richestCaps.parameters ?? []).filter((field) => {
    if (field.name === 'stream') return field.control !== 'toggle'
    // `seed` 的值是整数、`size` 是字符串 —— 「boolean 描述符 ≠ 布尔值」这条最容易做错。
    if (field.name === 'seed') return field.valueType !== 'integer'
    if (field.name === 'size') return field.valueType !== 'string'
    if (field.control === 'select') return !Array.isArray(field.values) || field.values.length === 0
    return false
  })
  checkEqual(bad.length, 0, `参数表的控件 / 值类型都正确（异常：${bad.map((field) => field.name).join('、') || '无'}）`)
}

// 参考图上限：模型声明 > 16 的必须被收敛（tencent 声明 20，网关全局 maxItems 16）。
const over16 = catalog.filter((model) => (model.references?.max ?? 0) > 16)
checkEqual(over16.length, 0, `真机没有模型的参考图上限超过 16（异常的：${over16.map((model) => model.id).join('、') || '无'}）`)

const clampProbe = (await call('/dsh-imagegen/capabilities?model=tencent%2Fhy-image-v3.5-preview')).json?.capabilities
if (clampProbe !== undefined && clampProbe.model === 'tencent/hy-image-v3.5-preview') {
  checkEqual(clampProbe.references.max, 16, 'tencent：上限收敛到网关全局的 16')
  checkEqual(clampProbe.referencesDeclaredMax, 20, 'tencent：同时回报模型声明的 20（界面据此解释差额）')
}

// ---------------------------------- 8. `extra` 通路的端到端（真上游，不花钱）

console.log('\n--- 8. `extra` 通路端到端：面板选的字段真的发到了上游 ---')

/**
 * 怎么做到「真打上游 + 一分钱不花」：**用一个不存在的模型 id**。
 *
 * 试过的两条歪路，都别走：
 *  - 把 `n` 发成 11 想骗一个 400 —— **宿主会先在本地 `Math.min(10, …)` 夹住**，
 *    请求会正常出图、**真的计费**；
 *  - 往配置里塞一个非法的 `extraJson` 想骗 400 —— 要临时改老板的配置，风险不值得。
 *
 * 用不存在的模型则不碰这两种风险：本地裁剪逻辑照走（这一步正是要验的），
 * 上游直接回「模型不存在」，**失败不计费**（官方口径：全有或全无计费），
 * 而失败响应里的 diagnostics 带「实际发送」——那是宿主自己的记录。
 */
if (!hadKey) {
  console.log('      没有 Key → 跳过（这一段要真打上游）')
} else {
  const ABSENT_MODEL = 'acme/definitely-not-a-real-model-livecheck'
  const probe = await call('/dsh-imagegen/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      config: { model: ABSENT_MODEL },
      request: {
        prompt: 'live-check extra 通路探针（模型不存在，不会计费）',
        model: ABSENT_MODEL,
        aspectRatio: '',
        resolution: '',
        count: 1,
        quality: '',
        references: [],
        extra: {
          seed: '12345',
          background: 'opaque',
          output_compression: '80',
          size: '2048x2048',
          stream: 'true',
          // 下面两个**必须**被白名单拦掉：请求体来自浏览器，
          // 不能让它塞路由字段或改身份字段。
          provider: '{"only":["evil"]}',
          nonsense_field: 'x',
        },
      },
    }),
  })
  const sent = (probe.json?.diagnostics ?? []).join('\n')
  console.log(`      HTTP ${probe.status} · code=${probe.json?.code ?? '?'}（模型不存在，按官方口径不计费）`)

  check(probe.status >= 400, `不存在的模型被上游拒（HTTP ${probe.status}）`)
  checkContains(sent, '实际发送', 'diagnostics 里有「实际发送」那一行')

  // 「额外参数」里写了什么决定了面板值会不会被覆盖 —— 断言必须**按当前配置推**，
  // 不能写死，否则老板哪天改了配置这条自检就变成假警报。
  let configExtra = {}
  try { configExtra = JSON.parse(initialConfig.extraJson ?? '{}') ?? {} } catch { configExtra = {} }

  // 正向：白名单内的字段**真的进了请求体**。这就是「面板能填 = 真的会发」。
  // 挑两个配置里没有的键，避免被「额外参数」盖住。
  const cleanKeys = [
    ['seed', '12345'],
    ['size', '"2048x2048"'],
  ].filter(([name]) => !(name in configExtra))
  check(cleanKeys.length > 0, '探针里至少有两个键不在「额外参数」里（否则测不出「真的会发」）')
  for (const [name, value] of cleanKeys) {
    checkContains(sent, `${name}=${value}`, `${name} 真的进了请求体（${value}）`)
  }

  // 覆盖：配置里写了的键，实发值必须是配置那个（优先级最高），而且**被如实回报**。
  const colliding = ['output_compression', 'background'].filter((name) => name in configExtra)
  if (colliding.length === 0) {
    console.log('      当前「额外参数」与探针没有重名键 → 跳过覆盖断言（这条依赖老板的配置内容）')
  } else {
    for (const name of colliding) {
      const expected = typeof configExtra[name] === 'string' ? `"${configExtra[name]}"` : String(configExtra[name])
      checkContains(sent, `${name}=${expected}`, `${name} 被「额外参数」覆盖成配置里的值（${expected}）`)
    }
    checkContains(sent, '被「额外参数」覆盖', '覆盖行为被如实写进诊断行（不是无声无息）')
  }

  // `stream` 是例外：它的「声明」在顶层 `supports_streaming` 上，模型未知时取不到
  // → 宿主按「不支持」处理、不发。这是保守但正确的行为，这里如实断言。
  // （「声明了就会发」那一半由 host-check 的假上游覆盖：`acme/rich-v1` 断言 stream=true。）
  check(!sent.includes('stream='), '模型未知时不下发 stream（拿不到 supports_streaming 就不猜）')
  // 反向：白名单外的字段一个都没进去。
  check(!sent.includes('nonsense_field'), '没见过的字段被白名单拦下（没进请求体）')
  check(!sent.includes('"only"'), 'extra 里塞不进 provider（路由权不给浏览器）')

  // 日志里也不能出现明文 Key（宿主侧唯一允许出现明文的地方是配置文件本身）。
  const logs = await call('/dsh-imagegen/logs?limit=50')
  const logText = (logs.json?.entries ?? []).map((entry) => entry.text).join('\n')
  check(!/sk-or-v1-[A-Za-z0-9]{8,}/u.test(logText), '宿主日志里没有明文 Key')
}

// ---------------------------------- 9. 面板草稿 + 历史里的「当时用了什么」（真机）
//
// 这两条是 2026-10-11 的新能力，都**只在重启后**才可能生效（宿主半边启动时加载）。
// 所以这里既验接口，也验「跑着的这半边确实是新代码」——上次的教训：重启前 live-check
// 全绿，可那个数字完全没覆盖新能力，真正的 bug 是加了真机断言才暴露的。

console.log('\n--- 9. 面板草稿（/draft）与历史里的「当时用了什么」 ---')

const draftPath = health.json?.draftPath
check(typeof draftPath === 'string' && draftPath.endsWith('draft.json'), 'health 给出草稿文件路径（新宿主才有的字段）')
checkEqual(typeof health.json?.hasDraft, 'boolean', 'health 报 hasDraft（新宿主才有的字段）')

const draftBefore = await call('/dsh-imagegen/draft')
checkEqual(draftBefore.status, 200, 'GET /draft 返回 200（新路由真的挂上了）')

/**
 * 备份老板当前的草稿，跑完原样写回。
 *
 * 这条和 live-check 一贯的纪律一致：**绝不留下痕迹** —— 草稿里是老板写了一半的
 * 提示词，比配置更私人。
 */
const draftBackup = draftBefore.json?.draft ?? null

const probeDraft = {
  prompt: 'live-check 探针：这句跑完会被还原',
  params: { aspectRatio: '4:5', resolution: '2K', count: '2', quality: 'medium' },
  extra: { background: 'opaque' },
  lastGeneratedPrompt: 'live-check 上一句',
}
const draftPut = await call('/dsh-imagegen/draft', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ draft: probeDraft }),
})
checkEqual(draftPut.status, 200, 'PUT /draft 返回 200')
check(draftPut.json?.draft?.updatedAt > 0, 'PUT 回的是落盘后的草稿（带服务端时间戳）')

const draftAfter = await call('/dsh-imagegen/draft')
checkEqual(draftAfter.json?.draft?.prompt, probeDraft.prompt, '草稿写得进、读得回（跨重启保留就是靠它）')
checkEqual(draftAfter.json?.draft?.params?.aspectRatio, '4:5', '草稿里的参数存得住')
checkEqual(draftAfter.json?.draft?.extra?.background, 'opaque', '草稿里的额外字段存得住')
checkEqual(draftAfter.json?.draft?.lastGeneratedPrompt, probeDraft.lastGeneratedPrompt, '「最后一次成功生成用的提示词」存得住')

// 还原（没有原草稿就写回一份空的，让面板回到「没有草稿」的状态）。
const restored = await call('/dsh-imagegen/draft', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ draft: draftBackup ?? { prompt: '', params: { aspectRatio: '', resolution: '', count: '1', quality: '' }, extra: {}, lastGeneratedPrompt: '' } }),
})
checkEqual(restored.status, 200, '草稿已还原成检查前的样子')

// 历史条目里必须带上「当时用了什么」——新生成的图才有；老图没有也不该报错。
const historyNow = await call('/dsh-imagegen/history')
checkEqual(historyNow.status, 200, 'GET /history 返回 200')
const images = historyNow.json?.images ?? []
console.log(`      历史 ${images.length} 张 · 其中 ${images.filter((item) => item.sentFields !== undefined).length} 张带实发字段`)
check(images.every((item) => typeof item.model === 'string' && item.model !== ''), '每条历史都带 model（结果行要显示「这张是哪个模型生的」）')
const withFacts = images.filter((item) => item.sentFields !== undefined || item.params !== undefined)
if (withFacts.length === 0) {
  console.log('      当前历史里全是升级前的记录（没有 params/sentFields）→ 相关断言跳过；生成一张新图后再跑就会覆盖到')
} else {
  const sample = withFacts[0]
  check(sample.params !== undefined, '新记录带参数快照（点历史图回填参数靠它）')
  check(sample.sentFields !== undefined, '新记录带实发字段（结果行显示靠它）')
  check(!JSON.stringify(sample.sentFields).includes('data:'), '实发字段里不含参考图的 data URL（只记张数）')
  check(!('model' in (sample.sentFields ?? {})), '实发字段里不重复存 model（它有自己的列）')
  check(typeof sample.params.extra === 'object' && sample.params.extra !== null, '参数快照里带 extra（模型驱动表单那些字段）')
}

// ---------------------------------------------------------------- 10. 「打开」

console.log('\n--- 10. 用系统默认程序打开原图（/open） ---')

// 这一节默认**只打错误分支**：成功分支会在老板屏幕上真的弹一个看图器窗口，每次跑
// 自检都弹太吵。要连成功分支一起验就设 DSH_IMAGEGEN_OPEN_PROBE=1 —— 那时会真的
// 打开历史里最新的一张图。
// （宿主侧另有 DSH_IMAGEGEN_OPEN_DRY_RUN=1 的干跑开关，但它是宿主进程的环境变量，
// 外部脚本改不了，所以这里用「默认不测成功分支」而不是「默认干跑」。）
const openNoId = await call('/dsh-imagegen/open', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
})
checkEqual(openNoId.status, 400, '/open 缺 id → 400')

const openUnknown = await call('/dsh-imagegen/open', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'live-check-no-such-image' }),
})
checkEqual(openUnknown.status, 404, '/open 未知 id → 404（只认索引里的图，开不了任意文件）')
checkContains(openUnknown.json?.message ?? '', '索引里没有', '未知 id 的报错是人话')

checkEqual((await call('/dsh-imagegen/open')).status, 405, 'GET /open → 405')

const newestImage = images[0]
if (newestImage === undefined) {
  console.log('      历史是空的 → 成功分支跳过（先出一张图再跑这一节）')
} else if (process.env.DSH_IMAGEGEN_OPEN_PROBE === '1') {
  const openOk = await call('/dsh-imagegen/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: newestImage.id }),
  })
  checkEqual(openOk.status, 200, `/open 打开最新一张（${newestImage.id}）返回 200`)
  checkEqual(openOk.json?.path, newestImage.savedPath, '回的是那张图的绝对路径（面板拿它写提示）')
  console.log('      ↑ 此刻屏幕上应该已经弹出了系统默认看图程序，关掉它即可')
} else {
  console.log(`      成功分支跳过（设 DSH_IMAGEGEN_OPEN_PROBE=1 真的打开 ${newestImage.id} 一次）`)
}

console.log(`\n${total - failures.length}/${total} passed`)
if (failures.length > 0) {
  console.error('\n失败项：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
