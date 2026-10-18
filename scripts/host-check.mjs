/**
 * 宿主半边的离线自检 —— 阶段 3 的那道关。
 *
 * 为什么需要它：`render-check.mjs` 只覆盖浏览器半边，而阶段 3 的新代码全在宿主
 * 侧（路由 + 落盘 + Key 掩码）。拿运行中的 DSH 当测试台既慢又打扰老板，所以这里
 * 用**打包后的真产物**（`lib/index.js`）配一个假 ctx 跑：
 *
 *   假 ctx（`inject` / `effect` / `webServer.register`）
 *     → 真 `apply()` → 真路由处理器 → 真 `node:fs` 落盘（临时目录）
 *
 * 于是「配置能存、Key 不下发、重启后还在、非法输入被拒、跨机请求被拦」这五件事
 * 全部可以在 1 秒内验完，**不碰老板的真实配置**（`DSH_IMAGEGEN_HOME` 指向临时目录）。
 *
 * 用法：node scripts/host-check.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * 依赖解析：本包刻意不建 node_modules，react 从已验证的样板包里取
 * （与 render-check.mjs 同一套规则）。
 */
function requireFrom(specifier) {
  const tried = []
  // 本机开发布局：同版本的样板插件与本包目录并排（可用 DSH_SAMPLE_ROOT 覆盖）。
  const samples = process.env.DSH_SAMPLE_ROOT || path.join(root, '..', 'dsh-prompt-forge')
  for (const base of [samples, root]) {
    const anchor = path.join(base, 'package.json')
    if (!existsSync(anchor)) { tried.push(`${anchor}（不存在）`); continue }
    try {
      return createRequire(anchor)(specifier)
    } catch (error) {
      tried.push(`${anchor} → ${error?.code ?? error?.message ?? error}`)
    }
  }
  throw new Error(`找不到 ${specifier}。已尝试：\n  ${tried.join('\n  ')}`)
}

const React = requireFrom('react')

// ------------------------------------------------------------------ 断言

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

/** 一个**明文 Key 绝不能出现在响应里**的断言。 */
function checkNoPlainKey(text, plainKey, label) {
  check(!text.includes(plainKey), `${label}（明文 Key 不得出现在响应里）`)
}

// ------------------------------------------------------- 临时存储 + 假 ctx

/** 临时存储根：整个自检只在这里读写，老板的 `~/.dsh/dsh-imagegen-panel` 一个字节都不碰。 */
const tempRoot = mkdtempSync(path.join(tmpdir(), 'dsh-imagegen-host-check-'))
process.env.DSH_IMAGEGEN_HOME = tempRoot
// 模型目录缓存关掉：自检要数「打了几次上游」，缓存会让计数变得不可预测。
// （缓存本身单独有一条断言，见 §10「模型目录会被缓存」。）
process.env.DSH_IMAGEGEN_MODELS_TTL_MS = '0'

/** 一次「挂载」的结果：登记到的路由 + 卸载函数。 */
function mountRoutes(plugin, services = {}) {
  const routes = []
  const effects = []
  const ctx = {
    inject(names, callback) {
      check(names.includes('webServer'), 'apply 通过 ctx.inject 注入 webServer')
      callback({
        webServer: {
          register(route) {
            routes.push(route)
            return () => { route.removed = true }
          },
        },
        effect(callback2) {
          const dispose = callback2()
          if (typeof dispose === 'function') effects.push(dispose)
          return dispose
        },
        /** 宿主服务的假面：`/preset` 要 `ctx.get('configEditor')`。 */
        get(name) { return services[name] },
      })
      return undefined
    },
  }
  plugin.apply(ctx)
  return { routes, effects, ctx }
}

/** 造一个够真的 `IncomingMessage`（`readJsonBody` 靠 `for await` 读它）。 */
function makeReq(options = {}) {
  const method = options.method ?? 'GET'
  const bodyText = options.body === undefined ? '' : JSON.stringify(options.body)
  const headers = { host: '127.0.0.1:19387', ...options.headers ?? {} }
  const listeners = new Map()
  return {
    method,
    url: options.url ?? '/',
    headers,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    resume() {},
    on(event, callback) { listeners.set(event, callback) },
    /** 手动触发一个事件 —— 用来模拟「客户端断开」（面板上点取消 / 关面板）。 */
    emit(event) { const callback = listeners.get(event); if (typeof callback === 'function') callback() },
    async *[Symbol.asyncIterator]() {
      if (bodyText !== '') yield Buffer.from(bodyText, 'utf8')
    },
  }
}

/** 造一个够真的 `ServerResponse`。 */
function makeRes() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(text) { this.body = text ?? '' },
    json() { return JSON.parse(this.body) },
  }
}

/** 找一条已挂载的路由。 */
function routeOf(routes, routePath) {
  const route = routes.find((item) => item.path === routePath)
  if (route === undefined) throw new Error(`路由没挂上：${routePath}`)
  return route
}

/** 打一次路由（`options.url` 覆盖请求 URL —— prefix 路由靠它带 id/query）。 */
async function call(routes, routePath, options = {}) {
  const route = routeOf(routes, routePath)
  const req = makeReq({ url: routePath, ...options })
  const res = makeRes()
  if (typeof options.onRequest === 'function') options.onRequest(req)
  await route.handler(req, res)
  return res
}

/** 等一会儿（模拟「请求已经发出去」）。 */
function delayMs(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

// ================================================== 假上游（阶段 4 用，不需要真 Key）

/**
 * 一个把 OpenRouter 换掉的假上游。
 *
 * 阶段 4 的真出图要花真钱，而「请求体对不对、错误怎么映射、图有没有落盘」这些
 * 全都能在这里验完。**这是本文件里最值钱的一段**：它让「接真上游」从「希望它对」
 * 变成「已经验过 20 多种情况」。
 */
const upstream = {
  calls: [],
  /** 下一次 `POST /images` 的响应体（成功路径用）。 */
  payload: undefined,
  /** `'json'` 正常返回 / `'http-error'` 带状态码的错误 / `'hang'` 永不返回（测超时与取消）。 */
  mode: 'json',
  /** `'http-error'` 模式下的状态码与原文。 */
  errorStatus: 402,
  errorText: '',
}

/** 造一个「PNG」：`measureSize` 只读 IHDR，所以文件头对就够（顺带证明尺寸是真量出来的）。 */
function pngBytes(width, height) {
  const buffer = Buffer.alloc(33)
  buffer.writeUInt32BE(0x89504e47, 0)
  buffer.writeUInt32BE(0x0d0a1a0a, 4)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  buffer[24] = 8
  buffer[25] = 6
  return buffer
}

/** 造一个最小 JPEG（SOF0 段）。 */
function jpegBytes(width, height) {
  const buffer = Buffer.alloc(20)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  buffer[3] = 0xc0
  buffer.writeUInt16BE(17, 4)
  buffer[6] = 8
  buffer.writeUInt16BE(height, 7)
  buffer.writeUInt16BE(width, 9)
  return buffer
}

/** 造一个最小 WebP（VP8X 块）。 */
function webpBytes(width, height) {
  const buffer = Buffer.alloc(32)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(24, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8X', 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  const w = width - 1
  const h = height - 1
  buffer[24] = w & 0xff
  buffer[25] = (w >> 8) & 0xff
  buffer[26] = (w >> 16) & 0xff
  buffer[27] = h & 0xff
  buffer[28] = (h >> 8) & 0xff
  buffer[29] = (h >> 16) & 0xff
  return buffer
}

/** 假上游的模型目录（形状照抄 2026-10-10 实测的真响应）。 */
const FIXTURE_MODELS = {
  data: [
    {
      id: 'google/gemini-3-pro-image',
      name: 'Google: Gemini 3 Pro Image',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image', 'text'] },
      supports_streaming: true,
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K', '2K'] },
        aspect_ratio: { type: 'enum', values: ['16:9', '1:1', '9:16'] },
        n: { type: 'range', min: 1, max: 4 },
        input_references: { type: 'range', min: 0, max: 14 },
        output_format: { type: 'enum', values: ['png', 'jpeg', 'webp'] },
      },
    },
    {
      id: 'openai/gpt-image-2.5-flare',
      name: 'OpenAI: GPT Image 2.5 Flare',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image'] },
      supports_streaming: false,
      supported_parameters: {
        aspect_ratio: { type: 'enum', values: ['1:1', '3:2'] },
        n: { type: 'range', min: 1, max: 10 },
        quality: { type: 'enum', values: ['auto', 'low', 'medium', 'high'] },
        input_references: { type: 'range', min: 0, max: 16 },
      },
    },
    {
      // 极简模型：什么参数都不声明 —— 用来验「key 缺失 = 不支持」不会把面板搞崩。
      id: 'acme/bare-v1',
      name: 'Acme: Bare V1',
      architecture: { input_modalities: ['text'], output_modalities: ['image'] },
      supported_parameters: {},
    },
    {
      // 矢量化模型：`output_format` 只收 svg，且参考图上限只有 1 张。
      // 用来验**值级**裁剪（`png` 越界不发）与超量参考图的截断。
      id: 'acme/vector-only',
      name: 'Acme: Vector Only',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image'] },
      supported_parameters: {
        n: { type: 'range', min: 1, max: 6 },
        input_references: { type: 'range', min: 0, max: 1 },
        output_format: { type: 'enum', values: ['svg'] },
      },
    },
    {
      // 改图专用模型：参考图**必填**（min 1）。面板据此在本地拦住空提交。
      id: 'acme/ref-required',
      name: 'Acme: Ref Required',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image'] },
      supported_parameters: {
        n: { type: 'range', min: 1, max: 1 },
        input_references: { type: 'range', min: 1, max: 1 },
      },
    },
    {
      // 声明了 `input_references` 但区间是 0/0 —— 上游真有这种（`ming-image-0.1-design`），
      // 语义是「**明确不接受**」而不是「没限制」。面板要当纯文生图处理。
      id: 'acme/refs-zero',
      name: 'Acme: Refs Zero',
      architecture: { input_modalities: ['text'], output_modalities: ['image'] },
      supported_parameters: {
        n: { type: 'range', min: 1, max: 2 },
        input_references: { type: 'range', min: 0, max: 0 },
      },
    },
    {
      // 目录里有它、但**一个 endpoint 都没有**（照抄真机的 meta/muse-image）——
      // 必须被可用性探测剔掉，否则用户选中它只会换回一次失败、报价还是空的。
      id: 'meta/muse-image',
      name: 'Meta: Muse Image',
      architecture: { input_modalities: ['text'], output_modalities: ['image'] },
      supported_parameters: {},
    },
    {
      // **声明得最全**的模型：10 个模型级参数键里占了 9 个（真机最多也就是这样）。
      // 专供「模型驱动参数行」的自检：面板必须把这些字段一个不少地渲染出来，
      // 而 `extra` 通路必须把它们一个不少地送进请求体。
      // `size` / `seed` 用 `{type:'boolean'}` 是**真机形状**（实测就长这样）——
      // 它表示「支持这个字段」，不是「值是布尔」。
      id: 'acme/rich-v1',
      name: 'Acme: Rich V1',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image'] },
      supports_streaming: true,
      supported_parameters: {
        aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
        resolution: { type: 'enum', values: ['1K', '2K'] },
        size: { type: 'boolean' },
        n: { type: 'range', min: 1, max: 4 },
        quality: { type: 'enum', values: ['low', 'medium', 'high'] },
        output_format: { type: 'enum', values: ['png', 'jpeg'] },
        background: { type: 'enum', values: ['auto', 'transparent', 'opaque'] },
        output_compression: { type: 'range', min: 0, max: 100 },
        seed: { type: 'boolean' },
        input_references: { type: 'range', min: 0, max: 8 },
      },
    },
    {
      // 参考图声明到 **20 张**（照抄真机的 `tencent/hy-image-v3.5-preview`）。
      // 官方 OpenAPI 的 `input_references.maxItems` 是 **16** —— 模型级上限网关不校验、
      // 全局 maxItems 校验。所以面板必须按 min(20, 16) = 16 收敛，否则第 17 张
      // 会让整次请求 400（全有或全无：不给钱，但白等一次）。
      id: 'acme/refs-many',
      name: 'Acme: Refs Many',
      architecture: { input_modalities: ['image', 'text'], output_modalities: ['image'] },
      supported_parameters: {
        n: { type: 'range', min: 1, max: 1 },
        input_references: { type: 'range', min: 0, max: 20 },
      },
    },
  ],
}

/** 一个 Acme provider 的 endpoint 记录（新增 fixture 共用）。 */
function acmeEndpoint(parameters, pricing) {
  return {
    provider_name: 'Acme',
    provider_slug: 'acme',
    supported_parameters: parameters,
    allowed_passthrough_parameters: [],
    pricing,
    supports_streaming: false,
  }
}

/**
 * 假上游的 endpoints，**按模型 id 路由**（含两种定价形态：按张带档位、按 token）。
 *
 * 必须路由而不是「谁来都给同一份」：可用性探测正是靠「该模型有没有 endpoint」
 * 来判断的，一律给同一份就永远测不出 `meta/muse-image` 这种死条目。
 */
const FIXTURE_ENDPOINTS_BY_MODEL = {
  'google/gemini-3-pro-image': {
  id: 'google/gemini-3-pro-image',
  endpoints: [
    {
      provider_name: 'Black Forest Labs',
      provider_slug: 'black-forest-labs',
      supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K'] } },
      allowed_passthrough_parameters: ['safety_tolerance'],
      pricing: [
        { billable: 'output_image', unit: 'image', cost_usd: 0.041, variant: '768' },
        { billable: 'output_image', unit: 'image', cost_usd: 0.048, variant: '1k' },
        { billable: 'output_image', unit: 'image', cost_usd: 0.07, variant: '2k' },
      ],
    },
    {
      provider_name: 'Google AI Studio',
      provider_slug: 'google-ai-studio/global',
      supported_parameters: {
        resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
        aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] },
        input_references: { type: 'range', min: 0, max: 14 },
      },
      allowed_passthrough_parameters: ['cachedContent'],
      pricing: [
        { billable: 'input_image', unit: 'token', cost_usd: 0.000002 },
        { billable: 'output_image', unit: 'token', cost_usd: 0.00012 },
      ],
    },
  ],
  },
  'openai/gpt-image-2.5-flare': {
    id: 'openai/gpt-image-2.5-flare',
    endpoints: [
      {
        provider_name: 'OpenAI',
        provider_slug: 'openai',
        supported_parameters: {
          aspect_ratio: { type: 'enum', values: ['1:1', '3:2'] },
          n: { type: 'range', min: 1, max: 10 },
          quality: { type: 'enum', values: ['auto', 'low', 'medium', 'high'] },
          input_references: { type: 'range', min: 0, max: 16 },
        },
        allowed_passthrough_parameters: ['moderation'],
        pricing: [{ billable: 'output_image', unit: 'token', cost_usd: 0.00003 }],
        supports_streaming: true,
      },
    ],
  },
  'acme/bare-v1': {
    id: 'acme/bare-v1',
    endpoints: [acmeEndpoint({}, [{ billable: 'output_image', unit: 'image', cost_usd: 0.02 }])],
  },
  'acme/vector-only': {
    id: 'acme/vector-only',
    endpoints: [
      acmeEndpoint(
        FIXTURE_MODELS.data.find((model) => model.id === 'acme/vector-only').supported_parameters,
        [{ billable: 'output_image', unit: 'image', cost_usd: 0.035 }],
      ),
    ],
  },
  'acme/ref-required': {
    id: 'acme/ref-required',
    endpoints: [
      acmeEndpoint(
        FIXTURE_MODELS.data.find((model) => model.id === 'acme/ref-required').supported_parameters,
        [],
      ),
    ],
  },
  'acme/refs-zero': {
    id: 'acme/refs-zero',
    endpoints: [
      acmeEndpoint(
        FIXTURE_MODELS.data.find((model) => model.id === 'acme/refs-zero').supported_parameters,
        [{ billable: 'output_image', unit: 'image', cost_usd: 0.02 }],
      ),
    ],
  },
  // 目录里有、**通道一个都没有** —— 可用性探测必须把它剔掉。
  'meta/muse-image': { id: 'meta/muse-image', endpoints: [] },
  'acme/rich-v1': {
    id: 'acme/rich-v1',
    endpoints: [
      {
        ...acmeEndpoint(
          FIXTURE_MODELS.data.find((model) => model.id === 'acme/rich-v1').supported_parameters,
          [{ billable: 'output_image', unit: 'image', cost_usd: 0.05 }],
        ),
        supports_streaming: true,
        allowed_passthrough_parameters: ['moderation'],
      },
    ],
  },
  'acme/refs-many': {
    id: 'acme/refs-many',
    endpoints: [
      acmeEndpoint(
        FIXTURE_MODELS.data.find((model) => model.id === 'acme/refs-many').supported_parameters,
        [{ billable: 'output_image', unit: 'image', cost_usd: 0.06 }],
      ),
    ],
  },
}

/** 真 fetch 的引用：本地假上游（阶段 6 那一组）要真的走 socket。 */
const realFetch = globalThis.fetch

/** 装假上游。必须在任何路由调用之前完成 —— 宿主侧是在调用时读全局 `fetch`。 */
globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  const method = String(init.method ?? 'GET').toUpperCase()

  // 环回地址放行给真 fetch：阶段 6 要验「端点路径 / 鉴权头」是否正确，
  // 那只有真的走一遍 HTTP 才作数。
  if (href.includes('127.0.0.1:') || href.includes('localhost:')) return realFetch(url, init)

  upstream.calls.push({
    url: href,
    method,
    headers: init.headers ?? {},
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  })

  const respond = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

  if (method === 'GET' && href.endsWith('/images/models')) return respond(FIXTURE_MODELS)
  if (method === 'GET' && href.endsWith('/endpoints')) {
    // 按模型 id 路由：可用性探测就靠「这个模型有没有 endpoint」判断死活，
    // 一律回同一份就永远测不出 `meta/muse-image` 这种死条目。
    const match = /\/images\/models\/([^/]+\/[^/]+)\/endpoints$/.exec(href)
    const record = match === null ? undefined : FIXTURE_ENDPOINTS_BY_MODEL[match[1]]
    if (record === undefined) return respond({ error: { message: 'Resource not found', code: 404 } }, 404)
    return respond(record)
  }

  if (method === 'POST' && href.endsWith('/images')) {
    if (upstream.mode === 'http-error') {
      return new Response(upstream.errorText, { status: upstream.errorStatus, headers: { 'content-type': 'application/json' } })
    }
    if (upstream.mode === 'hang') {
      return await new Promise((_resolve, reject) => {
        const signal = init.signal
        if (signal === undefined) return
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (signal.aborted) fail()
        else signal.addEventListener('abort', fail)
      })
    }
    return respond(upstream.payload)
  }

  throw new Error(`假上游没有这条路由：${method} ${href}`)
}

// ------------------------------------------------------------ 载入两半边

const plugin = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)

// 浏览器半边：与 render-check 同款的最小 DOM stub（CSS Module 注入守卫要用）。
const injectedStyles = []
globalThis.document = {
  baseURI: 'http://127.0.0.1:19387/',
  head: { children: [], appendChild(node) { this.children.push(node); injectedStyles.push(node) } },
  createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      attributes: {},
      textContent: '',
      setAttribute(name, value) { this.attributes[name] = String(value) },
      getAttribute(name) { return this.attributes[name] ?? null },
    }
  },
  querySelector(selector) {
    const match = /^style\[data-plugin-css=(.*)\]$/u.exec(selector)
    if (match === null) return null
    const wanted = JSON.parse(match[1])
    return injectedStyles.find((style) => style.attributes['data-plugin-css'] === wanted) ?? null
  },
}

let loaded = null
globalThis.window = { __ModuleLoader__: { load(record) { loaded = record } } }
new Function('window', 'document', readFileSync(path.join(root, 'lib', 'client.js'), 'utf8'))(
  globalThis.window,
  globalThis.document,
)
const client = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`客户端 bundle 运行期请求了未提供的平台模块 "${id}"`)
})

// ============================================================ 1. 契约

console.log('\n--- 1. 两半边的契约 ---')

checkEqual(plugin.name, 'dsh-imagegen-panel', '宿主半边导出 name')
check(Array.isArray(plugin.inject) && plugin.inject.includes('webServer'), "宿主半边 inject 声明了 'webServer'")
check(typeof plugin.apply === 'function', '宿主半边导出 apply')

const API = plugin.API
checkEqual(API.config, '/dsh-imagegen/config', 'API.config 路径')
checkEqual(API.models, '/dsh-imagegen/models', 'API.models 路径')
checkEqual(API.history, '/dsh-imagegen/history', 'API.history 路径')
checkEqual(API.generate, '/dsh-imagegen/generate', 'API.generate 路径')
checkEqual(API.health, '/dsh-imagegen/health', 'API.health 路径')
checkEqual(API.logs, '/dsh-imagegen/logs', 'API.logs 路径（宿主日志：桌面版没有可见控制台，日志必须在面板里看得到）')
checkEqual(API.draft, '/dsh-imagegen/draft', 'API.draft 路径（面板草稿：跨重启保留「写了还没生成」的提示词）')
checkEqual(API.open, '/dsh-imagegen/open', 'API.open 路径（结果行「打开」+ 历史图右键菜单：用系统默认程序打开本地原图）')

// 客户端打的路径必须与宿主挂的路径**字面一致** —— 这类插件最常见的静默故障就是
// 一边改了路径、另一边没改，界面只表现为「点了没反应」。
//
// 方向是单向的：客户端用到的每条路由宿主都必须有；宿主可以多挂几条纯诊断路由
// （比如 /health），客户端不调用它们。
const ROUTES = client.ROUTES
const hostOnlyRoutes = Object.keys(API).filter((key) => !(key in ROUTES))
for (const key of Object.keys(ROUTES)) {
  check(API[key] !== undefined, `宿主也挂了客户端用到的 ROUTES.${key}`)
  checkEqual(`/${ROUTES[key]}`, API[key], `客户端 ROUTES.${key} 解析后等于宿主 API.${key}`)
}
check(hostOnlyRoutes.length > 0, `宿主额外挂了纯诊断路由：${hostOnlyRoutes.join(', ')}`)

// 回归断言：prefix 路由**不能带尾斜杠**。
// webServer 的匹配规则是 `pathname === prefix || pathname.startsWith(prefix + '/')`，
// 带尾斜杠就变成要求路径里出现 `//` → `/image/<id>` 永远匹配不上，落到 SPA 兜底回 404。
// （2026-10-10 真机上就是这么炸的：面板里图全裂。）
check(!API.image.endsWith('/'), `prefix 路由不带尾斜杠（实际 ${JSON.stringify(API.image)}）`)
checkEqual(client.apiPath(ROUTES.config), '/dsh-imagegen/config', 'apiPath 在根挂载点下解析正确')
globalThis.document.baseURI = 'https://host/app/my-dsh/'
checkEqual(client.apiPath(ROUTES.config), '/app/my-dsh/dsh-imagegen/config', 'apiPath 尊重反代前缀（不写死根绝对路径）')
globalThis.document.baseURI = 'http://127.0.0.1:19387/'

// ============================================================ 2. 挂载

console.log('\n--- 2. apply() 挂载 ---')

const first = mountRoutes(plugin)
checkEqual(first.routes.length, 12, 'apply() 挂了 12 条路由')
checkEqual(first.routes.filter((route) => route.kind === 'exact').length, 11, '11 条 exact 路由（config/models/capabilities/generate/history/save/open/preset/health/logs/draft）')
checkEqual(first.routes.filter((route) => route.kind === 'prefix').length, 1, '1 条 prefix 路由（/dsh-imagegen/image）')
checkEqual(first.effects.length, 1, 'apply() 通过 ctx.effect 注册了清理')

// 退化路径：webServer 不可用时 apply() 不能抛（抛错会把整个 web 启动带下水）。
// 这一段会故意触发 apply 里的 console.warn，先把 warn 静音，免得自检输出里混进
// 一段看着像失败的堆栈。
const realWarn = console.warn
console.warn = () => {}
let threw = false
try {
  plugin.apply({ inject: () => { throw new Error('webServer 缺失') } })
} catch {
  threw = true
}
console.warn = realWarn
check(!threw, '注入失败时 apply() 退化为记日志而不是抛出')

// ============================================================ 3. 首次读配置

console.log('\n--- 3. 首次读配置（文件不存在） ---')

const firstRead = await call(first.routes, API.config, { method: 'GET' })
checkEqual(firstRead.status, 200, 'GET /config 返回 200')
const firstBody = firstRead.json()
checkEqual(firstBody.ok, true, 'GET /config ok=true')
checkEqual(firstBody.config.hasKey, false, '首次 hasKey=false')
checkEqual(firstBody.config.keyHint, '', '首次 keyHint 为空')
checkEqual(firstBody.config.protocol, 'openrouter', '默认协议 openrouter')
checkEqual(firstBody.config.baseUrl, 'https://openrouter.ai/api/v1', '默认 Base URL')
check(!existsSync(path.join(tempRoot, 'config.json')), '只读不写：首次 GET 不会凭空造出配置文件')

// 字段清单一致性：宿主下发的字段 = 客户端 PanelConfig 的字段。
const clientFields = Object.keys(client.DEFAULT_CONFIG).sort().join(',')
const hostFields = Object.keys(firstBody.config).sort().join(',')
checkEqual(hostFields, clientFields, '宿主下发的配置字段与客户端 PanelConfig 完全一致')

// ============================================================ 4. 写配置

console.log('\n--- 4. 写配置（PUT） ---')

// 假 Key 拆成两段拼接：仓库里不再以完整字面量出现形似密钥的串，降低被自动化密钥扫描标记的概率（运行时仍是同一字符串，测试语义不变）。
const PLAIN_KEY = 'sk-or-v1-' + '0123456789abcdef' + '0123456789abcdef'
const putRes = await call(first.routes, API.config, {
  method: 'PUT',
  body: {
    config: {
      protocol: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      model: 'openai/gpt-image-1',
      autoSaveDir: 'C:\\Users\\you\\.dsh-imagegen\\out\\',
      extraJson: '{ "quality": "high" }',
      timeoutSec: 240,
      outputFormat: 'webp',
    },
    apiKey: PLAIN_KEY,
  },
})
checkEqual(putRes.status, 200, 'PUT /config 返回 200')
const putBody = putRes.json()
checkEqual(putBody.ok, true, 'PUT /config ok=true')
checkEqual(putBody.config.hasKey, true, 'PUT 后 hasKey=true')
checkEqual(putBody.config.model, 'openai/gpt-image-1', 'PUT 后模型已更新')
checkEqual(putBody.config.timeoutSec, 240, 'PUT 后超时已更新')
checkEqual(putBody.config.outputFormat, 'webp', 'PUT 后输出格式已更新')
checkEqual(putBody.config.baseUrl, 'https://openrouter.ai/api/v1', 'PUT 时顺手去掉 Base URL 末尾斜杠')

// ---- 负面验收：响应里绝不能出现明文 Key ----
checkNoPlainKey(putRes.body, PLAIN_KEY, 'PUT 响应不含明文 Key')
checkContains(putBody.config.keyHint, '••••••••', 'PUT 响应只回掩码')
checkContains(putBody.config.keyHint, PLAIN_KEY.slice(-4), '掩码保留了尾 4 位（让用户能对上号）')
check(!putBody.config.keyHint.includes(PLAIN_KEY.slice(6, -4)), '掩码里没有中间那段（复原不出明文）')

const getAfterPut = await call(first.routes, API.config, { method: 'GET' })
checkNoPlainKey(getAfterPut.body, PLAIN_KEY, 'GET 响应不含明文 Key')
checkEqual(getAfterPut.json().config.hasKey, true, 'GET 看到 hasKey=true')
checkEqual(getAfterPut.json().config.keyHint, putBody.config.keyHint, 'GET 与 PUT 的掩码一致')

// ---- 落盘：磁盘上必须有明文（这是宿主侧唯一允许出现明文的地方）----
const configFile = path.join(tempRoot, 'config.json')
check(existsSync(configFile), '配置文件已落盘 config.json')
const onDisk = JSON.parse(readFileSync(configFile, 'utf8'))
checkEqual(onDisk.apiKey, PLAIN_KEY, '磁盘上确实存了明文 Key（宿主侧唯一允许处）')
checkEqual(onDisk.version, 1, '落盘文件带 version')
checkEqual(onDisk.model, 'openai/gpt-image-1', '落盘文件带最新字段')
check(typeof onDisk.updatedAt === 'string' && onDisk.updatedAt.length > 0, '落盘文件带 updatedAt')

// ============================================================ 5. 模拟重启

console.log('\n--- 5. 模拟重启（重新 apply，只靠磁盘） ---')

const second = mountRoutes(plugin)
const afterRestart = await call(second.routes, API.config, { method: 'GET' })
checkEqual(afterRestart.json().config.hasKey, true, '重启后 hasKey 仍然是 true')
checkEqual(afterRestart.json().config.keyHint, putBody.config.keyHint, '重启后掩码不变')
checkEqual(afterRestart.json().config.model, 'openai/gpt-image-1', '重启后模型不变')
checkEqual(afterRestart.json().config.timeoutSec, 240, '重启后超时不变')

// ---- 不改 Key 的保存：plainKey 为空串 = 保持现状 ----
const keepRes = await call(second.routes, API.config, {
  method: 'PUT',
  body: { config: { model: 'google/gemini-3-pro-image' }, apiKey: '' },
})
checkEqual(keepRes.json().config.hasKey, true, '不传新 Key 时旧 Key 保持')
checkEqual(keepRes.json().config.keyHint, putBody.config.keyHint, '不传新 Key 时掩码不变')
checkEqual(keepRes.json().config.model, 'google/gemini-3-pro-image', '不传新 Key 时其余字段照样更新')

// ---- 清除 Key ----
const clearRes = await call(second.routes, API.config, {
  method: 'PUT',
  body: { config: {}, clearKey: true },
})
checkEqual(clearRes.json().config.hasKey, false, 'clearKey=true 时 Key 被清除')
checkEqual(JSON.parse(readFileSync(configFile, 'utf8')).apiKey, '', '清除后磁盘上的 Key 是空串')

// ============================================================ 6. 输入校验

console.log('\n--- 6. PUT 校验（非法输入必须被拒） ---')

const rejections = [
  ['bad-protocol', { config: { protocol: 'midjourney' } }],
  ['bad-base-url', { config: { baseUrl: 'not a url' } }],
  ['bad-base-url', { config: { baseUrl: 'ftp://example.com' } }],
  ['bad-base-url', { config: { baseUrl: '' } }],
  ['bad-model', { config: { model: '   ' } }],
  ['bad-extra-json', { config: { extraJson: '{ not json' } }],
  ['bad-extra-json', { config: { extraJson: '[1,2,3]' } }],
  ['bad-timeout', { config: { timeoutSec: 0 } }],
  ['bad-timeout', { config: { timeoutSec: 99999 } }],
  ['bad-timeout', { config: { timeoutSec: '180' } }],
  ['bad-output-format', { config: { outputFormat: 'gif' } }],
  ['bad-config', { config: 'nope' }],
]

for (const [code, body] of rejections) {
  const res = await call(second.routes, API.config, { method: 'PUT', body })
  const json = res.json()
  checkEqual(res.status, 400, `非法输入被拒：${JSON.stringify(body.config).slice(0, 40)}`)
  checkEqual(json.code, code, `  拒绝码是 ${code}`)
  check(typeof json.message === 'string' && json.message !== '', `  拒绝时带可展示的 message`)
}

// 读不出来的请求体
const noBody = await call(second.routes, API.config, { method: 'PUT' })
checkEqual(noBody.status, 400, '空请求体 → 400')
checkEqual(noBody.json().code, 'bad-request', '空请求体的拒绝码是 bad-request')

// ============================================================ 7. 方法守卫

console.log('\n--- 7. 方法与路径守卫 ---')

const methodCases = [
  [API.config, { method: 'POST' }, 405],
  [API.models, { method: 'PUT' }, 405],
  [API.history, { method: 'DELETE' }, 405],
  [API.generate, { method: 'GET' }, 405],
  [API.health, { method: 'POST' }, 405],
  [API.draft, { method: 'POST' }, 405],
  [API.draft, { method: 'DELETE' }, 405],
]
for (const [routePath, options, status] of methodCases) {
  const res = await call(second.routes, routePath, options)
  checkEqual(res.status, status, `${options.method} ${routePath} → ${status}`)
}

// ============================================================ 8. loopback 围栏

console.log('\n--- 8. loopback 围栏 ---')

const remote = await call(second.routes, API.config, { method: 'GET', remoteAddress: '10.0.0.5' })
checkEqual(remote.status, 403, '非环回来源 → 403')
checkEqual(remote.json().code, 'forbidden', '非环回来源的拒绝码是 forbidden')

const crossSite = await call(second.routes, API.config, {
  method: 'GET',
  headers: { origin: 'https://evil.example.com' },
})
checkEqual(crossSite.status, 403, '跨站 Origin → 403')

const crossFetchSite = await call(second.routes, API.config, {
  method: 'GET',
  headers: { 'sec-fetch-site': 'cross-site' },
})
checkEqual(crossFetchSite.status, 403, "sec-fetch-site: cross-site → 403")

const sameOrigin = await call(second.routes, API.config, {
  method: 'GET',
  headers: { origin: 'http://127.0.0.1:19387' },
})
checkEqual(sameOrigin.status, 200, '同源 Origin 放行')

// 草稿里有用户写的东西（提示词），同样只给本机 —— 上面三条判据对它是同一套。
const remoteDraft = await call(second.routes, API.draft, { method: 'GET', remoteAddress: '10.0.0.5' })
checkEqual(remoteDraft.status, 403, '非环回来源读草稿 → 403')

// ============================================================ 9. 模型目录与能力

console.log('\n--- 9. models / capabilities / history / health ---')

const modelsRes = await call(second.routes, API.models, { method: 'GET' })
const modelsBody = modelsRes.json()
checkEqual(modelsRes.status, 200, 'GET /models 返回 200')
// 目录里 6 个，其中 `meta/muse-image` 一个 endpoint 都没有 → 必须被剔掉。
checkEqual(modelsBody.models.length, FIXTURE_MODELS.data.length - 1, '模型数量 = 上游条数 − 没有通道的条目')
checkEqual(modelsBody.models.some((model) => model.id === 'meta/muse-image'), false, 'endpoints 为空的模型不出现在列表里')
checkContains(modelsBody.source, '/images/models', '响应里带上游出处（便于排查）')

const gemini = modelsBody.models.find((model) => model.id === 'google/gemini-3-pro-image')
checkEqual(gemini.supportsReferences, true, 'input_references.max > 0 → supportsReferences=true')
checkEqual(gemini.options.aspectRatio.join('/'), '16:9/1:1/9:16', '比例候选值来自上游 enum（不是硬编码）')
checkEqual(gemini.options.resolution.join('/'), '1K/2K', '分辨率候选值来自上游 enum')
checkEqual(gemini.options.count.join('/'), '1/2/3/4', '张数候选值来自上游 range 展开')
checkEqual(gemini.options.quality.length, 0, '该模型没声明 quality → 候选为空（key 缺失 = 不支持）')
checkEqual(gemini.options.outputFormat.join('/'), 'png/jpeg/webp', '输出格式候选值来自上游 output_format 枚举（不是硬编码）')
checkEqual(gemini.references.max, 14, '参考图上限来自 input_references.max（不是写死的 4）')
checkEqual(gemini.references.min, 0, '参考图非必填 → min=0')
check(gemini.caps.includes('图生图'), '能力标签里有「图生图」')
checkEqual(gemini.price, '', '模型列表接口不含定价 → price 留空（不编数据）')

const vectorOnly = modelsBody.models.find((model) => model.id === 'acme/vector-only')
checkEqual(vectorOnly.options.outputFormat.join('/'), 'svg', '只收 svg 的模型：候选值就是 svg')
checkEqual(vectorOnly.references.max, 1, '参考图上限 1 张的模型：references.max=1')
checkEqual(vectorOnly.options.quality.length, 0, '没声明 quality → 候选为空')
checkEqual(vectorOnly.options.aspectRatio.length, 0, '没声明 aspect_ratio → 候选为空')

const refRequired = modelsBody.models.find((model) => model.id === 'acme/ref-required')
checkEqual(refRequired.references.min, 1, '改图专用模型：references.min=1（面板据此本地拦截空提交）')
check(refRequired.caps.includes('改图必填底图'), `必填底图的模型带专用标签：${refRequired.caps.join('/')}`)

const bare = modelsBody.models.find((model) => model.id === 'acme/bare-v1')
checkEqual(bare.options.aspectRatio.length, 0, '什么参数都不声明的模型：候选为空，不崩')
checkEqual(bare.supportsReferences, false, '极简模型不支持参考图')
check(bare.caps.includes('仅文生图'), '极简模型的能力标签是「仅文生图」')

const capsRes = await call(second.routes, API.capabilities, {
  method: 'GET',
  url: `${API.capabilities}?model=google/gemini-3-pro-image&resolution=1k`,
})
checkEqual(capsRes.status, 200, 'GET /capabilities 返回 200')
const caps = capsRes.json().capabilities
checkEqual(caps.price, '$0.048/张（1k）', '按张定价：匹配当前分辨率档位')
checkEqual(caps.providers.join('/'), 'Black Forest Labs/Google AI Studio', '合并了两个 provider')
checkEqual(caps.passthrough.join('/'), 'safety_tolerance/cachedContent', '透传字段取并集')
checkEqual(caps.providerOptions.map((item) => item.slug).join('/'), 'black-forest-labs/google-ai-studio/global', 'provider.options 的键 = 各 provider 的 slug（带区域后缀也要照实带出）')
checkEqual(caps.providerOptions[0].params.join('/'), 'safety_tolerance', '每个 slug 带自己那份可透传参数')
checkEqual(caps.available, true, '有 endpoint → available=true')
checkEqual(caps.references.max, 14, '参考图张数取交集：只有第二个 provider 声明 → 用它那份')
checkEqual(caps.options.resolution.join('/'), '1K/2K/4K', '跨 provider 的参数取并集（不是取交集）')
checkEqual(caps.options.aspectRatio.join('/'), '16:9/1:1', '只有第二个 provider 声明的比例也能合并进来')

const capsNoRes = await call(second.routes, API.capabilities, {
  method: 'GET',
  url: `${API.capabilities}?model=google/gemini-3-pro-image`,
})
checkEqual(capsNoRes.json().capabilities.price, '$0.041/张（768）', '不给分辨率时取最便宜那档（报价宁低不虚高）')

const capsDead = await call(second.routes, API.capabilities, {
  method: 'GET',
  url: `${API.capabilities}?model=meta/muse-image`,
})
checkEqual(capsDead.json().capabilities.available, false, '没有 endpoint 的模型：available=false（面板据此拦住生成）')
checkEqual(capsDead.json().capabilities.references.max, 0, '死条目参考图上限为 0')

const capsNoModel = await call(second.routes, API.capabilities, { method: 'GET' })
checkEqual(capsNoModel.status, 400, 'capabilities 缺 model → 400')

// 可用性探测的开关：关掉之后死条目会回来（证明「剔掉」确实是探测做的，不是别的副作用）。
process.env.DSH_IMAGEGEN_SKIP_AVAILABILITY = '1'
const noProbe = await call(second.routes, API.models, { method: 'GET' })
checkEqual(noProbe.json().models.length, FIXTURE_MODELS.data.length, '关掉可用性探测 → 目录原样返回（含死条目）')
process.env.DSH_IMAGEGEN_SKIP_AVAILABILITY = '0'

// 模型目录缓存：10 分钟内不再打上游（`/generate` 每次都要用它做字段裁剪）。
// 注意基线：之前 TTL=0 时缓存从不填充，所以第一次调用必然要打上游，之后才走缓存。
process.env.DSH_IMAGEGEN_MODELS_TTL_MS = '60000'
const callsBeforeCache = upstream.calls.filter((item) => item.url.endsWith('/images/models')).length
await call(second.routes, API.models, { method: 'GET' })
await call(second.routes, API.models, { method: 'GET' })
await call(second.routes, API.models, { method: 'GET' })
const callsAfterCache = upstream.calls.filter((item) => item.url.endsWith('/images/models')).length
checkEqual(callsAfterCache - callsBeforeCache, 1, '模型目录走缓存：连续三次 /models 只打上游一次')
process.env.DSH_IMAGEGEN_MODELS_TTL_MS = '0'

const historyRes = await call(second.routes, API.history, { method: 'GET' })
checkEqual(historyRes.status, 200, 'GET /history 返回 200')
check(Array.isArray(historyRes.json().images), 'history.images 是数组')
checkEqual(historyRes.json().images.length, 0, '还没出图时历史为空')

const healthRes = await call(second.routes, API.health, { method: 'GET' })
const health = healthRes.json()
checkEqual(healthRes.status, 200, 'GET /health 返回 200')
checkEqual(health.plugin, 'dsh-imagegen-panel', 'health 报告插件名')
checkEqual(health.home, tempRoot, 'health 里的存储目录 = DSH_IMAGEGEN_HOME（自检没碰老板的真目录）')
checkEqual(health.configPath, configFile, 'health 里的配置文件路径正确')
checkEqual(health.images, 0, 'health 报告 0 张图')
checkEqual(health.logFile, path.join(tempRoot, 'logs', path.basename(health.logFile)), 'health 里的日志文件落在临时目录（自检不写老板的真日志）')

// ---- 宿主日志：老板的「日志到底在哪」 ----
//
// 背景（2026-10-10 实测）：桌面版 DSH **没有可见的宿主控制台** ——
// `%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 是空目录，界面上也没有「控制台」入口。
// 于是「查看日志」必须能在面板里看到，这条路由就是它的后端。
const logsRes = await call(second.routes, API.logs, { method: 'GET' })
checkEqual(logsRes.status, 200, 'GET /logs 返回 200')
const logsBody = logsRes.json()
check(Array.isArray(logsBody.entries), '/logs 的 entries 是数组')
check(typeof logsBody.file === 'string' && logsBody.file.endsWith('.log'), `/logs 回日志文件路径：${logsBody.file}`)
checkEqual(logsBody.dir, path.join(tempRoot, 'logs'), '日志目录跟着 DSH_IMAGEGEN_HOME（自检不碰老板的真目录）')
check(logsBody.entries.length > 0, `插件挂载时已经写了日志（${logsBody.entries.length} 条）`)
check(
  logsBody.entries.every((entry) => typeof entry.at === 'string' && entry.at !== '' && typeof entry.text === 'string' && entry.text !== ''),
  '每条日志都有时间与正文',
)
check(logsBody.entries.some((entry) => entry.text.includes('已挂载')), '能看到「已挂载 N 条路由」这条启动日志')

// 日志是异步追加的：冲刷之后再断言文件，才验的是「真的写进去了」而不是「入队了」。
await plugin.flushHostLogs()
check(existsSync(logsBody.file), `日志同时落盘：${logsBody.file}`)
check(readFileSync(logsBody.file, 'utf8').includes('已挂载'), '落盘文件里能看到启动那条（进程重启后还查得到）')
checkEqual((await call(second.routes, API.logs, { method: 'POST' })).status, 405, 'POST /logs → 405')
const logsRemote = await call(second.routes, API.logs, { method: 'GET', remoteAddress: '10.0.0.5' })
checkEqual(logsRemote.status, 403, '非环回读日志 → 403（日志里有本机路径）')

const logsText = await call(second.routes, API.logs, { method: 'GET', url: `${API.logs}?format=text` })
checkEqual(logsText.status, 200, '?format=text 返回 200')
check(logsText.body.includes('[info]'), '纯文本形态带级别标记（可直接下载存档）')
check(
  String(logsText.headers?.['content-disposition'] ?? '').includes('attachment'),
  '纯文本形态按附件回（点一下就能存成文件）',
)

const logsCleared = await call(second.routes, API.logs, { method: 'DELETE' })
checkEqual(logsCleared.status, 200, 'DELETE /logs 清内存缓冲')
checkEqual((await call(second.routes, API.logs, { method: 'GET' })).json().entries.length, 1, '清完之后只剩「已清空」这一条（磁盘文件不动）')

// ============================================================ 10. 真出图（假上游）

console.log('\n--- 10. 真出图（假上游，不花真钱） ---')

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const IMAGE_KEY = 'sk-or-v1-hostcheck-' + '0000000000000000cafe'
const indexFile = path.join(tempRoot, 'index.json')
const readIndex = () => (existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : [])
/** 自动保存目录也放在临时目录里 —— 自检**绝不往老板的工作区写图**。 */
const AUTO_SAVE_DIR = path.join(tempRoot, 'autosave')

/** 走真路由配好 Key / base / 超时 / 额外参数 / 自动保存目录。 */
async function configureForGenerate(patch = {}) {
  return call(second.routes, API.config, {
    method: 'PUT',
    body: {
      config: {
        protocol: 'openrouter',
        baseUrl: OPENROUTER_BASE,
        timeoutSec: 60,
        outputFormat: 'png',
        autoSaveDir: AUTO_SAVE_DIR,
        extraJson: '{ "provider": { "sort": "price" } }',
        ...patch,
      },
      apiKey: IMAGE_KEY,
    },
  })
}

/** 发一次生成。 */
async function generate(request) {
  return call(second.routes, API.generate, {
    method: 'POST',
    body: { config: { model: '客户端那份配置会被忽略' }, request },
  })
}

const png = pngBytes(1536, 864)
upstream.mode = 'json'
upstream.payload = {
  created: 1,
  data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }],
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0.0391 },
}

await configureForGenerate()
const callsBeforeGenerate = upstream.calls.length
const genRes = await generate({
  prompt: '一只柴犬',
  model: 'google/gemini-3-pro-image',
  aspectRatio: '16:9',
  resolution: '1K',
  count: 1,
  quality: '高',
  references: [],
  // 一次给两个额外字段，其中一个该模型**不声明**（`background`）——
  // 正好验证「面板值照记、实发字段里没有它」这条分叉（见下面的断言）。
  extra: { output_format: 'png', background: 'opaque' },
})
const gen = genRes.json()

checkEqual(genRes.status, 200, 'POST /generate 返回 200')
checkEqual(gen.ok, true, 'generate ok=true')

const upstreamCall = upstream.calls.slice(callsBeforeGenerate)
  .find((item) => item.method === 'POST' && item.url.endsWith('/images'))
check(upstreamCall !== undefined, '确实打了上游 POST /images')
checkEqual(upstreamCall.url, `${OPENROUTER_BASE}/images`, '上游 URL = {base}/images')
checkEqual(upstreamCall.headers.authorization, `Bearer ${IMAGE_KEY}`, 'Key 走 Authorization 头（浏览器永远看不到它）')
checkEqual(upstreamCall.body.model, 'google/gemini-3-pro-image', '请求体带 model')
checkEqual(upstreamCall.body.prompt, '一只柴犬', '请求体带 prompt')
checkEqual(upstreamCall.body.n, 1, '请求体带 n')
checkEqual(upstreamCall.body.aspect_ratio, '16:9', '请求体带 aspect_ratio')
checkEqual(upstreamCall.body.resolution, '1K', '请求体带 resolution')
checkEqual(upstreamCall.body.output_format, 'png', '模型声明了 output_format → 发上去')
checkEqual(upstreamCall.body.quality, undefined, '模型没声明 quality → 一个字段都不发（key 缺失 = 不支持）')
checkEqual(upstreamCall.body.provider.sort, 'price', '额外参数原样合并进请求体')
checkEqual(upstreamCall.body.input_references, undefined, '没有参考图时不发 input_references')
checkEqual(upstreamCall.body.model, 'google/gemini-3-pro-image', '请求体里的 model 来自 request，不是客户端那份 config')

checkEqual(gen.image.imageUrl, `dsh-imagegen/image/${gen.image.id}`, '返回的 imageUrl 是相对路径（客户端按挂载点解析）')
checkEqual(gen.image.size, '1536 × 864', '尺寸是从 PNG 文件头**量**出来的，不是按比例估的')
checkEqual(gen.image.cost, 0.0391, 'usage.cost 透传到界面')
checkEqual(gen.image.aspectRatio, '16:9', '比例回填')
checkEqual(gen.count, 1, 'count=1')

// 宿主日志：这次生成留下了能复查的记录（面板里的「查看日志」读的就是它）。
const afterGenLogs = await call(second.routes, API.logs, { method: 'GET' })
const genLogText = afterGenLogs.json().entries.map((entry) => entry.text).join('\n')
check(genLogText.includes('出图成功'), '出图成功后日志里有「出图成功」')
check(genLogText.includes('实际发送'), '日志里记了「实际发送了哪些字段」—— 排查时的第一手材料')
check(!genLogText.includes(IMAGE_KEY), '日志里**没有**明文 Key（headers 从不进日志，另有正则兜底）')

const indexAfterGenerate = readIndex()
checkEqual(indexAfterGenerate.length, 1, '索引里多了 1 条')
checkEqual(indexAfterGenerate[0].id, gen.image.id, '索引里的 id 与响应一致')
check(readFileSync(indexAfterGenerate[0].savedPath).equals(png), '磁盘上的字节与上游给的完全一致')
check(indexAfterGenerate[0].savedPath.startsWith(path.join(tempRoot, 'out')), '图落在 out/ 目录里')

const historyAfter = await call(second.routes, API.history, { method: 'GET' })
checkEqual(historyAfter.json().images.length, 1, '历史里能读到刚生成的图')
checkEqual(historyAfter.json().images[0].imageUrl, `dsh-imagegen/image/${gen.image.id}`, '历史条目也带 imageUrl')

// ---- 2026-10-11：历史要留下「当时用了什么」 ----
// 面板上的两件事全靠它：点历史图回填参数（`params`）、结果行显示模型与参数（`sentFields`）。
const firstEntry = readIndex()[0]
checkEqual(firstEntry.model, 'google/gemini-3-pro-image', '索引里记下了**当时的模型**')
checkEqual(firstEntry.params.aspectRatio, '16:9', '参数快照带比例（回填参数区用）')
checkEqual(firstEntry.params.resolution, '1K', '参数快照带分辨率')
checkEqual(firstEntry.params.count, 1, '参数快照带张数')
checkEqual(firstEntry.params.quality, '高', '参数快照存的是**面板原值**（中文「高」，不是归一化后的 high）')
checkEqual(firstEntry.params.extra.output_format, 'png', '参数快照带模型驱动表单那些额外字段')
checkEqual(firstEntry.params.extra.background, 'opaque', '参数快照记的是**面板原值** —— 哪怕这个字段该模型根本不认')
checkEqual(firstEntry.sentFields.background, undefined, '实发字段里没有 background（该模型不声明）—— 两份值的分叉正是「以为设上了」的证据')
checkEqual(firstEntry.referenceCount, 0, '记下了参考图张数（data URL 本身不落盘）')
checkEqual(firstEntry.batchCount, 1, '记下了这一批实际落盘几张')
checkEqual(firstEntry.sentFields.aspect_ratio, '16:9', '实发字段里有 aspect_ratio')
checkEqual(firstEntry.sentFields.n, '1', '实发字段里有 n')
checkEqual(firstEntry.sentFields.output_format, 'png', '实发字段里有配置兜底出来的 output_format（面板上没这一项，也如实记）')
checkEqual(firstEntry.sentFields.provider, '{"sort":"price"}', '「额外参数」的透传对象也在实发字段里')
checkEqual(firstEntry.sentFields.quality, undefined, '模型没声明 quality → 实发字段里也不该有它（两者会打架时以实发为准）')
checkEqual(firstEntry.sentFields.input_references, undefined, '实发字段里不存参考图 data URL（只记张数）')
checkEqual(firstEntry.sentFields.model, undefined, '实发字段里不重复存 model（它有自己的列）')
checkEqual(firstEntry.sentFields.prompt, undefined, '实发字段里不重复存 prompt（它有自己的列）')

const historyFirst = historyAfter.json().images[0]
checkEqual(historyFirst.model, 'google/gemini-3-pro-image', '历史响应里带 model —— 结果行要显示「这张是哪个模型生的」')
checkEqual(historyFirst.params.aspectRatio, '16:9', '历史响应里带参数快照 —— 点历史图回填靠它')
checkEqual(historyFirst.sentFields.aspect_ratio, '16:9', '历史响应里带实发字段')
checkEqual(historyFirst.referenceCount, 0, '历史响应里带参考图张数')

const imageRes = await call(second.routes, API.image, { method: 'GET', url: `${API.image}/${gen.image.id}` })
checkEqual(imageRes.status, 200, 'GET /image/<id> 返回 200')
checkEqual(imageRes.headers['content-type'], 'image/png', '按媒体类型回 content-type')
checkEqual(imageRes.headers['cache-control'], 'private, max-age=31536000, immutable', '图片可长期缓存（文件名带时间戳，内容不变）')
check(Buffer.isBuffer(imageRes.body) && imageRes.body.equals(png), '回给浏览器的字节与落盘一致')

const imageMissing = await call(second.routes, API.image, { method: 'GET', url: `${API.image}/does-not-exist` })
checkEqual(imageMissing.status, 404, '未知图片 id → 404')

// ---- 阶段 5：自动另存到工作区目录（A8 后半句） ----
const autoSaveFile = path.join(AUTO_SAVE_DIR, indexAfterGenerate[0].fileName)
check(existsSync(autoSaveFile), '出图后自动另存了一份到「自动保存目录」')
checkEqual(gen.image.autoSavedPath, autoSaveFile, '生成响应里带上工作区那份的路径')
checkEqual(historyAfter.json().images[0].autoSavedPath, autoSaveFile, '历史条目也带 autoSavedPath')
check(readFileSync(autoSaveFile).equals(png), '另存的那份与 out/ 里的字节完全一致')
checkEqual(readIndex()[0].autoSavedPath, autoSaveFile, '索引里记下了 autoSavedPath')

// ---- 阶段 5：手动「保存」 ----
const saveRes = await call(second.routes, API.save, { method: 'POST', body: { id: gen.image.id } })
checkEqual(saveRes.status, 200, 'POST /save 返回 200')
checkEqual(saveRes.json().savedPath, autoSaveFile, '不传 target 时落到配置里的自动保存目录')

const pickedDir = path.join(tempRoot, 'picked')
const saveToRes = await call(second.routes, API.save, { method: 'POST', body: { id: gen.image.id, target: pickedDir } })
checkEqual(saveToRes.json().savedPath, path.join(pickedDir, indexAfterGenerate[0].fileName), '传 target 时落到指定目录')
check(existsSync(path.join(pickedDir, indexAfterGenerate[0].fileName)), '指定目录里的文件确实存在')

checkEqual((await call(second.routes, API.save, { method: 'POST', body: {} })).status, 400, '/save 缺 id → 400')
checkEqual((await call(second.routes, API.save, { method: 'POST', body: { id: 'nope' } })).status, 404, '/save 未知 id → 404')
checkEqual((await call(second.routes, API.save, { method: 'GET' })).status, 405, 'GET /save → 405')

// ---- 2026-10-14：用系统默认程序打开原图（结果行「打开」+ 历史图右键菜单）----
// 「打开」只能由宿主做（浏览器起不来老板的看图工具），所以这里测的是宿主这一侧的
// 契约：校验、错误分支的响应形状、以及交给 Explorer 的目标怎么编码。
// 「真的弹出看图器」那一步离线自检不碰（会弹老板的窗口），由 live-check 与人工确认。
checkEqual((await call(second.routes, API.open, { method: 'POST', body: { id: gen.image.id }, remoteAddress: '10.0.0.9' })).status, 403, '/open 非本机请求 → 403')
checkEqual((await call(second.routes, API.open, { method: 'GET' })).status, 405, 'GET /open → 405')
checkEqual((await call(second.routes, API.open, { method: 'POST', body: {} })).status, 400, '/open 缺 id → 400')
checkEqual((await call(second.routes, API.open, { method: 'POST', body: { id: 'nope' } })).status, 404, '/open 未知 id → 404')

// 「索引还在、文件没了」是常态化的一种状态（老板清过 out/）：必须是人话，不能是 ENOENT。
const openTarget = indexAfterGenerate[0].savedPath
const openTargetBak = `${openTarget}.bak-open-check`
renameSync(openTarget, openTargetBak)
const openMissing = await call(second.routes, API.open, { method: 'POST', body: { id: gen.image.id } })
renameSync(openTargetBak, openTarget)
checkEqual(openMissing.status, 410, '/open 文件已被删 → 410（不是 500）')
checkContains(openMissing.json().message, '不在磁盘上', '/open 缺文件时明说文件已经不在了')
check(!existsSync(openTargetBak), '/open 的缺文件检查没有留下临时文件')

// 成功分支：**干跑**（DSH_IMAGEGEN_OPEN_DRY_RUN=1 只跳过「碰桌面」那一步），
// 验的是校验通过之后的响应形状 —— 面板要靠 path 写提示。
process.env.DSH_IMAGEGEN_OPEN_DRY_RUN = '1'
const openOk = await call(second.routes, API.open, { method: 'POST', body: { id: gen.image.id } })
delete process.env.DSH_IMAGEGEN_OPEN_DRY_RUN
checkEqual(openOk.status, 200, 'POST /open 返回 200')
checkEqual(openOk.json().ok, true, '/open 响应 ok=true')
checkEqual(openOk.json().path, openTarget, '/open 回的是那张图的绝对路径（面板拿它写提示）')

// 安全不变式：**不接受调用方给的路径** —— 目标只能来自索引里那条记录的 savedPath。
// 哪天有人加了「body.path 优先」的分支，这里会立刻红。
process.env.DSH_IMAGEGEN_OPEN_DRY_RUN = '1'
const openInjected = await call(second.routes, API.open, {
  method: 'POST',
  body: { id: gen.image.id, path: 'C:\\Windows\\System32\\calc.exe', savedPath: 'C:\\Windows\\System32\\calc.exe' },
})
delete process.env.DSH_IMAGEGEN_OPEN_DRY_RUN
checkEqual(openInjected.status, 200, '请求体里塞 path/savedPath 时仍返回 200（只认 id）')
checkEqual(openInjected.json().path, openTarget, '打开的目标始终是索引里的 savedPath —— body 里给的路径被忽略')

// 交给 Explorer 的目标怎么编码 —— 这个功能里唯一「写错了不报错、只会安静地打开
// 另一个东西」的地方。三条都是 DSH 自带实现里写明的坑：
//   1. Explorer 解析自己的命令行、在逗号和等号处切字段 → 这两个字符必须转义；
//   2. Explorer 拒绝文件 URI 里编码过的非 ASCII（会掉头去开「文档」）→ 要还原成字面量；
//   3. 空格照常编码（这是 Explorer 认的）。
checkEqual(plugin.explorerTarget('C:\\out\\a,b=c.png'), 'file:///C:/out/a%2Cb%3Dc.png', '逗号与等号被转义（Explorer 不会切字段）')
checkEqual(plugin.explorerTarget('C:\\out\\天津.png'), 'file:///C:/out/天津.png', '非 ASCII 保持字面量（Explorer 拒绝编码过的）')
checkEqual(plugin.explorerTarget('C:\\out\\my shot.png'), 'file:///C:/out/my%20shot.png', '空格照常编码')

// 自动另存失败**不能**把出图判成失败：图已经在 out/ 里了。
const badAutoSaveDir = path.join(tempRoot, 'bad<dir>name')
await configureForGenerate({ autoSaveDir: badAutoSaveDir })
upstream.payload = { created: 1, data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.01 } }
const noAutoSave = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(noAutoSave.status, 200, '自动保存目录不可用时出图仍然成功（图仍在 out/）')
checkEqual(noAutoSave.json().image.autoSavedPath, undefined, '另存失败时不编一个 autoSavedPath')
await configureForGenerate()

// ---- 质量归一化：中文「高」→ 上游认的 `high` ----
upstream.mode = 'json'
const qualityCallMark = upstream.calls.length
await generate({
  prompt: 'x',
  model: 'openai/gpt-image-2.5-flare',
  aspectRatio: '1:1',
  resolution: '',
  count: 1,
  quality: '高',
  references: [],
})
const qualityCall = upstream.calls.slice(qualityCallMark).find((item) => item.method === 'POST')
checkEqual(qualityCall.body.quality, 'high', '中文质量「高」被归一化成 high（否则上游会 400）')
checkEqual(qualityCall.body.resolution, undefined, '该模型没声明 resolution → 不发')
checkEqual(qualityCall.body.n, 1, '张数照发')

// ---- 参考图：data URL → input_references ----
const refCallMark = upstream.calls.length
await generate({
  prompt: 'x',
  model: 'google/gemini-3-pro-image',
  aspectRatio: '16:9',
  resolution: '1K',
  count: 1,
  quality: '',
  references: ['data:image/png;base64,AAAA'],
})
const refCall = upstream.calls.slice(refCallMark).find((item) => item.method === 'POST')
checkEqual(refCall.body.input_references?.[0]?.type, 'image_url', '参考图按 input_references[{type:image_url}] 发')
checkEqual(refCall.body.input_references?.[0]?.image_url?.url, 'data:image/png;base64,AAAA', '参考图是 data URL 原样透传')
checkEqual(refCall.body.quality, undefined, '空质量不发')

// ---- 不支持参考图的模型：裁掉并如实报告 ----
const noRefModelMark = upstream.calls.length
const noRefRes = await generate({
  prompt: 'x',
  model: 'acme/bare-v1',
  aspectRatio: '16:9',
  resolution: '1K',
  count: 3,
  quality: '高',
  references: ['data:image/png;base64,AAAA'],
})
const noRefCall = upstream.calls.slice(noRefModelMark).find((item) => item.method === 'POST')
checkEqual(noRefCall.body.input_references, undefined, '模型不支持参考图 → 不发这个字段')
checkEqual(noRefCall.body.aspect_ratio, undefined, '模型没声明比例 → 不发')
check(noRefRes.json().dropped.length >= 3, `被裁掉的字段如实回报：${JSON.stringify(noRefRes.json().dropped)}`)

// ---- 值级裁剪：模型声明了字段，但取值不在它的枚举里 → 也不发 ----
// 上游网关只校验全局 schema（png/jpeg/webp/svg 都放行），不看每个模型自己的枚举，
// 越界值会**透传给 provider**（被忽略或换回 502）。所以这一层只能我们自己把关。
const vectorMark = upstream.calls.length
const vectorRes = await generate({
  prompt: 'x',
  model: 'acme/vector-only',
  aspectRatio: '',
  resolution: '',
  count: 1,
  quality: '',
  references: [],
})
const vectorCall = upstream.calls.slice(vectorMark).find((item) => item.method === 'POST')
checkEqual(vectorCall.body.output_format, undefined, '只收 svg 的模型收到配置里的 png → 不发这个字段')
check(vectorRes.json().dropped.some((item) => item.startsWith('output_format')), `越界的 output_format 如实回报：${JSON.stringify(vectorRes.json().dropped)}`)

// 配置改成 svg 后必须发出去（证明不是「一律不发」，而是按枚举判断）。
const svgSaved = await call(second.routes, API.config, {
  method: 'PUT',
  body: { config: { outputFormat: 'svg' } },
})
const vectorMark2 = upstream.calls.length
await generate({ prompt: 'x', model: 'acme/vector-only', aspectRatio: '', resolution: '', count: 1, quality: '', references: [] })
const vectorCall2 = upstream.calls.slice(vectorMark2).find((item) => item.method === 'POST')
checkEqual(svgSaved.status, 200, 'PUT 接受 svg（矢量模型的唯一合法格式）')
checkEqual(vectorCall2.body.output_format, 'svg', '配置值在模型枚举内 → 照发')
await call(second.routes, API.config, { method: 'PUT', body: { config: { outputFormat: 'png' } } })

// ---- 参考图超量：截断到模型上限并如实回报（而不是整次被上游拒掉） ----
const clipMark = upstream.calls.length
const clipRes = await generate({
  prompt: 'x',
  model: 'acme/vector-only',
  aspectRatio: '',
  resolution: '',
  count: 1,
  quality: '',
  references: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB', 'data:image/png;base64,CCCC'],
})
const clipCall = upstream.calls.slice(clipMark).find((item) => item.method === 'POST')
checkEqual(clipCall.body.input_references.length, 1, '模型上限 1 张 → 只发前 1 张（面板固定 4 张也没关系）')
check(clipRes.json().dropped.some((item) => item.includes('最多 1 张')), `截断原因如实回报：${JSON.stringify(clipRes.json().dropped)}`)

// ---- 区间 0/0 的模型：那是「明确不接受参考图」，不是「没限制」 ----
const zeroMark = upstream.calls.length
const zeroRes = await generate({
  prompt: 'x',
  model: 'acme/refs-zero',
  aspectRatio: '',
  resolution: '',
  count: 1,
  quality: '',
  references: ['data:image/png;base64,AAAA'],
})
const zeroCall = upstream.calls.slice(zeroMark).find((item) => item.method === 'POST')
checkEqual(zeroCall.body.input_references, undefined, 'input_references 区间 0/0 → 一张都不发')
check(zeroRes.json().dropped.some((item) => item.includes('不接受参考图')), `如实回报：${JSON.stringify(zeroRes.json().dropped)}`)

// ---- 值级裁剪：质量档不在模型枚举内 ----
const qualityMark = upstream.calls.length
const qualityBad = await generate({
  prompt: 'x',
  model: 'openai/gpt-image-2.5-flare',
  aspectRatio: '1:1',
  resolution: '',
  count: 1,
  quality: '极高',
  references: [],
})
const qualityBadCall = upstream.calls.slice(qualityMark).find((item) => item.method === 'POST')
checkEqual(qualityBadCall.body.quality, undefined, '「极高」→ xhigh 不在该模型枚举内 → 不发')
check(qualityBad.json().dropped.some((item) => item.startsWith('quality')), `越界的质量档如实回报：${JSON.stringify(qualityBad.json().dropped)}`)
checkEqual(qualityBadCall.body.aspect_ratio, '1:1', '同一次请求里合法的字段照发')

// ---- 模型驱动参数行：`extra` 通路的端到端（面板选的每个字段都要真的到上游） ----
//
// 界面按所选模型的 `supported_parameters` 渲染参数行，收集到的非核心字段走
// `request.extra`。这一段验的是**它真的进了请求体**，而且该裁的一个都没漏。
await configureForGenerate()
const richMark = upstream.calls.length
const richRes = await generate({
  prompt: '全字段',
  model: 'acme/rich-v1',
  aspectRatio: '16:9',
  resolution: '2K',
  count: 2,
  quality: '高',
  references: [],
  extra: {
    output_format: 'jpeg',
    background: 'transparent',
    output_compression: '80',
    seed: '12345',
    size: '',
    stream: 'true',
  },
})
const richCall = upstream.calls.slice(richMark).find((item) => item.method === 'POST')
checkEqual(richRes.status, 200, '带 extra 的生成成功')
checkEqual(richCall.body.output_format, 'jpeg', 'extra.output_format 进了请求体（覆盖配置里的 png）')
checkEqual(richCall.body.background, 'transparent', 'extra.background 进了请求体')
checkEqual(richCall.body.output_compression, 80, 'extra.output_compression 作为**整数**发送')
checkEqual(richCall.body.seed, 12345, 'seed 声明形状是 boolean，值仍然按整数发（不是布尔！）')
checkEqual(richCall.body.stream, true, 'stream 开关按**布尔**发送')
checkEqual(richCall.body.size, undefined, 'extra 里的空串 = 用户没填 → 不发这个字段')
checkEqual(richCall.body.aspect_ratio, '16:9', '核心字段照旧')
checkEqual(richCall.body.quality, 'high', '中文「高」仍然归一化成 high')

// 关掉的开关不发：`stream:false` 与「没有这个字段」语义等价，少发一个少一处被挑刺。
const richOffMark = upstream.calls.length
await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '1:1', resolution: '1K', count: 1, quality: '',
  references: [], extra: { stream: 'false' },
})
const richOffCall = upstream.calls.slice(richOffMark).find((item) => item.method === 'POST')
checkEqual(richOffCall.body.stream, undefined, 'stream=false 不发这个字段（与缺省等价）')

// `output_compression` 的合法下限是 0 —— 不能套用「张数」那套把下限硬提到 1。
const zeroCompMark = upstream.calls.length
await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '1:1', resolution: '1K', count: 1, quality: '',
  references: [], extra: { output_compression: '0' },
})
const zeroCompCall = upstream.calls.slice(zeroCompMark).find((item) => item.method === 'POST')
checkEqual(zeroCompCall.body.output_compression, 0, 'output_compression=0 原样发送（下限就是 0）')

// 超区间 → 收敛到该模型声明的上限，并如实回报。
const overCompMark = upstream.calls.length
const overComp = await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '1:1', resolution: '1K', count: 1, quality: '',
  references: [], extra: { output_compression: '150' },
})
const overCompCall = upstream.calls.slice(overCompMark).find((item) => item.method === 'POST')
checkEqual(overCompCall.body.output_compression, 100, 'output_compression=150 收敛到 100')
check(overComp.json().dropped.some((item) => item.startsWith('output_compression')), '收敛如实记入 dropped')

// 该模型没声明的字段：不发 + 回报（模型级枚举网关不校验，只能我们自己拦）。
const undeclaredMark = upstream.calls.length
const undeclared = await generate({
  prompt: 'x', model: 'acme/vector-only', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { background: 'transparent', quality: 'high' },
})
const undeclaredCall = upstream.calls.slice(undeclaredMark).find((item) => item.method === 'POST')
checkEqual(undeclaredCall.body.background, undefined, '该模型没声明 background → 不发')
check(undeclared.json().dropped.includes('background'), `未声明的字段如实回报：${JSON.stringify(undeclared.json().dropped)}`)

// 声明了、但取值不在该模型的枚举里：同样不发（实测网关只校验全局枚举，不看模型自己的）。
const badEnumMark = upstream.calls.length
const badEnum = await generate({
  prompt: 'x', model: 'acme/vector-only', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { output_format: 'png' },
})
const badEnumCall = upstream.calls.slice(badEnumMark).find((item) => item.method === 'POST')
checkEqual(badEnumCall.body.output_format, undefined, 'extra 里的越界枚举值也不发')
check(badEnum.json().dropped.some((item) => item.startsWith('output_format')), '越界枚举如实回报')

// `size` 的描述符是 `{type:'boolean'}` —— **没有值域**。`allowsValue()` 对非 enum
// 一律放行，所以形状校验只能另外做：官方口径是「档位（2K）或像素（2048x2048）」。
const sizeOkMark = upstream.calls.length
await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { size: '2048x2048' },
})
const sizeOkCall = upstream.calls.slice(sizeOkMark).find((item) => item.method === 'POST')
checkEqual(sizeOkCall.body.size, '2048x2048', 'size 写像素值 → 原样发送')

const sizeTierMark = upstream.calls.length
await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { size: '2K' },
})
const sizeTierCall = upstream.calls.slice(sizeTierMark).find((item) => item.method === 'POST')
checkEqual(sizeTierCall.body.size, '2K', 'size 写档位 → 原样发送')

const sizeBadMark = upstream.calls.length
const sizeBad = await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { size: '大一点' },
})
const sizeBadCall = upstream.calls.slice(sizeBadMark).find((item) => item.method === 'POST')
checkEqual(sizeBadCall.body.size, undefined, 'size 形状不对 → 不发（上游描述符没值域，只能本地拦）')
check(sizeBad.json().dropped.some((item) => item.startsWith('size')), 'size 形状不对如实回报')
checkContains(sizeBad.json().dropped.join('\n'), '2048x2048', '回报里给出正确写法')

// ---- 「额外参数」JSON 覆盖面板字段：覆盖照旧生效，但必须**说出来** ----
//
// 为什么这条重要：那段 JSON 是最后无条件合并的、优先级最高，而本机默认配置里就写着
// `output_compression: 90` 与 `background: "opaque"` —— 那两个字段原来没有界面、
// 现在有了。不说的话用户会在面板上选 80、实际发 90，属于典型的「以为设上了」。
await configureForGenerate({ extraJson: '{ "output_compression": 55, "background": "opaque", "provider": { "sort": "price" } }' })
const overrideMark = upstream.calls.length
const overridden = await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { output_compression: '80', background: 'transparent' },
})
const overrideCall = upstream.calls.slice(overrideMark).find((item) => item.method === 'POST')
checkEqual(overrideCall.body.output_compression, 55, '「额外参数」优先级更高（面板选 80，实发 55）')
checkEqual(overrideCall.body.background, 'opaque', 'background 同样被「额外参数」覆盖')
check(overrideCall.body.provider !== undefined, '「额外参数」里那些面板没有的键照旧生效（provider 路由）')
const overrideBody = overridden.json()
checkEqual((overrideBody.overridden ?? []).join(','), 'output_compression,background', '被覆盖的字段如实列进 overridden')
checkContains((overrideBody.diagnostics ?? []).join('\n'), '被「额外参数」覆盖', '诊断行里点明是「额外参数」覆盖的（不是无声无息）')

// 反过来：面板字段与「额外参数」不冲突时，overridden 必须是空的。
await configureForGenerate()
const noOverrideMark = upstream.calls.length
const noOverride = await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { output_compression: '80' },
})
const noOverrideCall = upstream.calls.slice(noOverrideMark).find((item) => item.method === 'POST')
checkEqual(noOverrideCall.body.output_compression, 80, '不冲突时面板值生效')
checkEqual((noOverride.json().overridden ?? []).length, 0, '不冲突时 overridden 为空（不误报）')

// 白名单：请求体是前端来的，不能顺手塞路由字段或覆盖身份字段。
const smuggleMark = upstream.calls.length
await generate({
  prompt: 'x', model: 'acme/rich-v1', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: [], extra: { provider: '{"only":["evil"]}', model: 'evil/model', prompt: '被改掉的提示词', user: 'trace-me' },
})
const smuggleCall = upstream.calls.slice(smuggleMark).find((item) => item.method === 'POST')
checkEqual(smuggleCall.body.model, 'acme/rich-v1', 'extra 改不掉 model')
checkEqual(smuggleCall.body.prompt, 'x', 'extra 改不掉 prompt')
checkEqual(smuggleCall.body.provider.only, undefined, 'extra 里塞不进 provider（路由权不给浏览器）')

// ---- 参考图：模型声明 20 张 vs 网关全局 maxItems 16 ----
const manyRefs = Array.from({ length: 20 }, (_item, index) => `data:image/png;base64,AAAA${index}`)
const manyMark = upstream.calls.length
const many = await generate({
  prompt: 'x', model: 'acme/refs-many', aspectRatio: '', resolution: '', count: 1, quality: '',
  references: manyRefs,
})
const manyCall = upstream.calls.slice(manyMark).find((item) => item.method === 'POST')
checkEqual(manyCall.body.input_references.length, 16, '声明 20 张的模型也只发 16 张（网关全局 maxItems）')
check(many.json().dropped.some((item) => item.startsWith('input_references')), '被截断的参考图如实回报')

const manyCaps = (await call(second.routes, API.capabilities, {
  method: 'GET',
  url: `${API.capabilities}?model=${encodeURIComponent('acme/refs-many')}`,
})).json().capabilities
checkEqual(manyCaps.references.max, 16, '/capabilities 的参考图上限已按全局 16 收敛')
checkEqual(manyCaps.referencesDeclaredMax, 20, '同时回报模型自己声明的 20（好让界面解释差额）')
checkEqual(manyCaps.parameters.find((field) => field.name === 'input_references'), undefined, '参考图不是参数行里的普通字段（由参考图槽承载）')

// ---- `/capabilities` 的参数表：界面就是按它渲染的 ----
const richCaps = (await call(second.routes, API.capabilities, {
  method: 'GET',
  url: `${API.capabilities}?model=${encodeURIComponent('acme/rich-v1')}`,
})).json().capabilities
const fieldOf = (name) => richCaps.parameters.find((field) => field.name === name)
checkEqual(richCaps.parameters.map((field) => field.name).join(','), 'aspect_ratio,resolution,size,n,quality,output_format,background,output_compression,seed,stream', '参数表只列该模型声明的字段（+stream），顺序稳定')
checkEqual(fieldOf('resolution').control, 'select', 'enum 描述符 → 下拉')
checkEqual(fieldOf('resolution').values.join('/'), '1K/2K', '下拉候选值来自该模型自己的枚举')
checkEqual(fieldOf('n').control, 'count', 'range 描述符 + 张数语义 → 张数控件')
checkEqual(fieldOf('n').values.join('/'), '1/2/3/4', '张数候选值来自该模型的区间')
checkEqual(fieldOf('output_compression').control, 'number', 'output_compression → 数值控件')
checkEqual(`${fieldOf('output_compression').min}-${fieldOf('output_compression').max}`, '0-100', '数值控件带上该模型声明的区间')
checkEqual(fieldOf('size').control, 'text', '`size` 声明形状是 boolean → 退回自由文本（不假装知道候选值）')
checkEqual(fieldOf('size').valueType, 'string', '`size` 的值类型是字符串，不是布尔')
checkEqual(fieldOf('seed').valueType, 'integer', '`seed` 的值类型是整数，不是布尔')
checkEqual(fieldOf('seed').clearable, true, 'seed 可留空（留空 = 每次随机，不能默认填死）')
checkEqual(fieldOf('seed').default, '', 'seed 默认留空')
checkEqual(fieldOf('background').default, 'auto', 'background 默认 auto')
checkEqual(fieldOf('stream').control, 'toggle', 'supports_streaming → 开关字段')
checkEqual(fieldOf('stream').group, 'advanced', 'stream 归入「高级」')
checkEqual(richCaps.parameters.filter((field) => field.group === 'advanced').map((field) => field.name).join(','), 'output_compression,seed,stream', '高级分组正好是这三项')

// 极简模型：一个字段都不声明 → 参数表为空（界面退回固定四项，且什么都不发）。
const bareCaps = (await call(second.routes, API.capabilities, {
  method: 'GET',
  url: `${API.capabilities}?model=${encodeURIComponent('acme/bare-v1')}`,
})).json().capabilities
checkEqual(bareCaps.parameters.length, 0, '什么都不声明的模型 → 参数表为空')
checkEqual(bareCaps.supportsStreaming, false, '没有 supports_streaming → 不出现流式开关')

// ---- n > 1：全部落盘、全部进索引，返回第一张 + count ----
upstream.payload = {
  created: 1,
  data: [
    { b64_json: png.toString('base64'), media_type: 'image/png' },
    { b64_json: jpegBytes(1024, 1024).toString('base64'), media_type: 'image/jpeg' },
    { b64_json: webpBytes(800, 600).toString('base64'), media_type: 'image/webp' },
  ],
  usage: { cost: 0.12 },
}
const indexBeforeMulti = readIndex().length
const multiRes = await generate({
  prompt: '三张',
  model: 'google/gemini-3-pro-image',
  aspectRatio: '16:9',
  resolution: '1K',
  count: 3,
  quality: '',
  references: [],
})
const multi = multiRes.json()
checkEqual(multiRes.status, 200, 'n=3 也能出图')
checkEqual(multi.count, 3, 'count=3')
checkEqual(multi.images.length, 3, 'images 数组里有 3 张')
checkEqual(multi.image.id, multi.images[0].id, '返回的第一张 = images[0]')
checkEqual(readIndex().length, indexBeforeMulti + 3, '三张全部进索引')
checkEqual(multi.images[1].size, '1024 × 1024', 'JPEG 尺寸也是量出来的')
checkEqual(multi.images[2].size, '800 × 600', 'WebP 尺寸也是量出来的')
checkEqual(multi.images[1].imageUrl !== multi.images[0].imageUrl, true, '三张各有各的 id')

// ---- 上游报错：原文透传 + 不落盘 ----
upstream.mode = 'http-error'
upstream.errorStatus = 402
upstream.errorText = JSON.stringify({ error: { message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', code: 402 } })
const indexBeforeFail = readIndex().length
const failRes = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(failRes.status, 402, '上游 402 → 状态码原样透传')
checkEqual(failRes.json().ok, false, '失败时 ok=false')
checkEqual(failRes.json().code, 'upstream', '失败 code=upstream')
checkContains(failRes.json().message, 'Insufficient credits', '上游原文不做美化转述')
checkEqual(readIndex().length, indexBeforeFail, '失败不落盘（没有文件、没有索引）')

// ---- 失败响应里的 diagnostics：这就是「报错看不全」的正解 ----
//
// 面板原来只有上游那一句话；现在宿主把「我实际发了哪些字段、日志文件在哪」一并回。
const failBody = failRes.json()
check(Array.isArray(failBody.diagnostics) && failBody.diagnostics.length > 0, '失败响应带 diagnostics')
checkContains(failBody.diagnostics.join('\n'), '实际发送', 'diagnostics 说明实际发送的字段')
checkContains(failBody.diagnostics.join('\n'), '宿主日志文件', 'diagnostics 直接给出日志文件路径（不用再去找「控制台」）')
check(!JSON.stringify(failBody.diagnostics).includes(IMAGE_KEY), 'diagnostics 里没有明文 Key')

const failLogs = await call(second.routes, API.logs, { method: 'GET' })
const failLogText = failLogs.json().entries.map((entry) => entry.text).join('\n')
check(failLogText.includes('上游拒绝'), '上游拒绝这件事写进了宿主日志')
check(failLogText.includes('Insufficient credits'), '上游原话在日志里留档（面板关了也查得到）')

upstream.errorStatus = 500
upstream.errorText = 'upstream exploded'
const textFail = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(textFail.status, 500, '非 JSON 的上游错误也透传状态码')
checkContains(textFail.json().message, 'upstream exploded', '非 JSON 的错误原文也带出来')

// ---- 400 的 ZodError：`error.message` 本身是转义 JSON，必须翻成人话 ----
// 实测形状：{"success":false,"error":{"name":"ZodError","message":"[{…},{…}]"}}，
// 而且**没有** code 字段（不像 401/402 的 {error:{message,code}}）。
upstream.errorStatus = 400
upstream.errorText = JSON.stringify({
  success: false,
  error: {
    name: 'ZodError',
    message: JSON.stringify([
      { origin: 'string', code: 'too_small', minimum: 1, path: ['prompt'], message: 'Too small: expected string to have >=1 characters' },
      { origin: 'number', code: 'too_small', minimum: 1, path: ['n'], message: 'Too small: expected number to be >=1' },
    ]),
  },
})
const zodFail = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(zodFail.status, 400, '上游 400 原样透传状态码')
checkContains(zodFail.json().message, 'prompt 必须 ≥ 1', 'ZodError 翻成人话：字段 + 约束')
checkContains(zodFail.json().message, 'n 必须 ≥ 1', '一次报出的多条问题全都要带上')
check(!zodFail.json().message.includes('"origin"'), '不再把转义 JSON 原样丢给用户')

// 解不开的 ZodError 退回原文（绝不吞掉上游信息）。
upstream.errorText = JSON.stringify({ error: { name: 'ZodError', message: 'not json at all' } })
const zodRaw = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkContains(zodRaw.json().message, 'not json at all', '解不开时退回上游原文')

// 400 但不是 ZodError（老形状）也要照旧透传。
upstream.errorText = JSON.stringify({ error: { message: 'Invalid request parameters', code: 400 } })
const plain400 = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkContains(plain400.json().message, 'Invalid request parameters', '非 ZodError 的 400 一个字都不改')

upstream.mode = 'json'
upstream.payload = { created: 1, data: [], usage: { cost: 0 } }
const emptyRes = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(emptyRes.json().ok, false, '上游返回里没有图片 → 明确失败')
checkContains(emptyRes.json().message, '没有图片数据', '说清是「没有图片数据」而不是假装成功')

// ---- 取消：客户端断开 → 宿主把上游请求也 abort 掉 ----
upstream.mode = 'hang'
const cancelReq = makeReq({
  method: 'POST',
  url: API.generate,
  body: { request: { prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] } },
})
const cancelRes = makeRes()
const pending = routeOf(second.routes, API.generate).handler(cancelReq, cancelRes)
await delayMs(30)
cancelReq.emit('close')
await pending
checkEqual(cancelRes.status, 499, '客户端断开 → 499（并且上游请求被 abort，不会白跑）')

// ---- 超时：真的等满配置里的秒数（校验规则下限是 5 秒） ----
await configureForGenerate({ timeoutSec: 5 })
upstream.mode = 'hang'
const timeoutStart = Date.now()
const timeoutRes = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(timeoutRes.status, 504, '上游超时 → 504')
checkContains(timeoutRes.json().message, '超时', '超时文案说明可调大超时')
check(Date.now() - timeoutStart >= 4500, `确实等满了超时时间（实测 ${Date.now() - timeoutStart}ms）`)
upstream.mode = 'json'

// ---- 没配 Key / 协议没接：都要给出人话 ----
await call(second.routes, API.config, { method: 'PUT', body: { config: {}, clearKey: true } })
const noKeyRes = await generate({ prompt: 'x', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(noKeyRes.status, 400, '没配 Key → 400')
checkEqual(noKeyRes.json().code, 'no-key', '没配 Key 的 code 是 no-key')
checkContains(noKeyRes.json().message, '连接配置', '提示去哪里配')

const emptyPromptRes = await generate({ prompt: '   ', model: 'google/gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(emptyPromptRes.json().code, 'empty-prompt', '空提示词被拒')

// 没配 Key 时，任何协议都在调上游之前就被拦下（协议适配在阶段 6 那一组里验）。
await call(second.routes, API.config, { method: 'PUT', body: { config: { protocol: 'gemini' }, apiKey: '' } })
const noKeyOtherProtocol = await generate({ prompt: 'x', model: 'x', aspectRatio: '16:9', resolution: '1K', count: 1, quality: '', references: [] })
checkEqual(noKeyOtherProtocol.status, 400, '非 OpenRouter 协议没配 Key → 也是 400（不是 501）')
checkEqual(noKeyOtherProtocol.json().code, 'no-key', '拒绝码是 no-key')

// ============================================================ 11. 其他协议（阶段 6）

console.log('\n--- 11. 其他协议：openai / gemini / custom（本地假上游，走真 HTTP） ---')

/**
 * 一个真的本地 HTTP 服务，冒充三家上游。
 *
 * 为什么不用 `globalThis.fetch` 桩：那三家的**端点路径与鉴权头**正是要验的东西，
 * 走真 socket 才能连 URL 拼错、头名写错一起抓到。上面那个 fetch 桩负责拦 OpenRouter，
 * 这里给 127.0.0.1 放行到真 fetch。
 */
const mockRequests = []
const mockServer = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => { chunks.push(chunk) })
  req.on('end', () => {
    let body
    try { body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined } catch { body = undefined }
    mockRequests.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body })

    const b64 = pngBytes(1024, 1024).toString('base64')
    const send = (payload) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const url = req.url ?? ''
    if (url.endsWith('/images/generations')) return send({ created: 1, data: [{ b64_json: b64 }] })
    if (url.includes(':generateContent')) {
      return send({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }] })
    }
    if (url.endsWith('/images')) return send({ created: 1, data: [{ b64_json: b64 }] })
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `mock 没有这条路由：${req.method} ${url}` } }))
  })
})
await new Promise((resolve) => { mockServer.listen(0, '127.0.0.1', resolve) })
const MOCK_ORIGIN = `http://127.0.0.1:${mockServer.address().port}`
console.log(`      本地假上游：${MOCK_ORIGIN}`)

/** 切到某个协议并配好 Key。 */
async function configureProtocol(protocol, baseUrl) {
  return call(second.routes, API.config, {
    method: 'PUT',
    body: {
      config: { protocol, baseUrl, timeoutSec: 60, autoSaveDir: AUTO_SAVE_DIR },
      apiKey: IMAGE_KEY,
    },
  })
}

/** 数一下某个路径被调了几次。 */
function mockCallsTo(suffix) {
  return mockRequests.filter((item) => item.url.endsWith(suffix) || item.url.includes(suffix))
}

// ---- OpenAI 兼容 ----
mockRequests.length = 0
await configureProtocol('openai', `${MOCK_ORIGIN}/v1`)
const openaiRes = await generate({
  prompt: '一只猫',
  model: 'gpt-image-1',
  aspectRatio: '3:2',
  resolution: '1K',
  count: 2,
  quality: '高',
  references: [],
})
checkEqual(openaiRes.status, 200, 'openai 协议：出图成功')
const openaiCall = mockCallsTo('/images/generations')[0]
check(openaiCall !== undefined, 'openai 协议：打的是 /v1/images/generations（不是 OpenRouter 的 /images）')
checkEqual(openaiCall.headers.authorization, `Bearer ${IMAGE_KEY}`, 'openai 协议：Bearer 鉴权头')
checkEqual(openaiCall.body.model, 'gpt-image-1', 'openai 协议：body 带 model')
checkEqual(openaiCall.body.prompt, '一只猫', 'openai 协议：body 带 prompt')
checkEqual(openaiCall.body.n, 2, 'openai 协议：张数走 n')
checkEqual(openaiCall.body.size, '1536x1024', 'openai 协议：3:2 映射成 1536x1024')
checkEqual(openaiCall.body.quality, 'high', 'openai 协议：中文「高」→ high')
checkEqual(openaiCall.body.response_format, 'b64_json', 'openai 协议：明确要 b64_json')
checkEqual(openaiRes.json().count, 1, 'openai 协议：mock 只回一张 → count=1（以响应为准，不按请求猜）')
checkEqual(openaiRes.json().image.size, '1024 × 1024', 'openai 协议：尺寸仍然是从文件头量的')

// ---- Gemini ----
mockRequests.length = 0
await configureProtocol('gemini', `${MOCK_ORIGIN}/v1beta`)
const geminiRes = await generate({
  prompt: '一只狗',
  model: 'gemini-3-pro-image',
  aspectRatio: '16:9',
  resolution: '1K',
  count: 1,
  quality: '高',
  references: ['data:image/png;base64,QUJD'],
})
checkEqual(geminiRes.status, 200, 'gemini 协议：出图成功')
const geminiCall = mockCallsTo(':generateContent')[0]
check(geminiCall !== undefined, 'gemini 协议：打的是 /v1beta/models/<model>:generateContent')
checkEqual(geminiCall.url, '/v1beta/models/gemini-3-pro-image:generateContent', 'gemini 协议：URL 里带模型 id 与 :generateContent')
checkEqual(geminiCall.headers['x-goog-api-key'], IMAGE_KEY, 'gemini 协议：走 x-goog-api-key 头（不是 Bearer）')
checkEqual(geminiCall.headers.authorization, undefined, 'gemini 协议：不发 Authorization')
checkEqual(geminiCall.body.contents?.[0]?.parts?.[0]?.text, '一只狗', 'gemini 协议：提示词进 contents[].parts[].text')
checkEqual(geminiCall.body.contents?.[0]?.parts?.[1]?.inline_data?.mime_type, 'image/png', 'gemini 协议：参考图进 inline_data')
checkEqual(geminiCall.body.contents?.[0]?.parts?.[1]?.inline_data?.data, 'QUJD', 'gemini 协议：参考图的 base64 原样带上')
checkEqual(geminiCall.body.generationConfig?.responseModalities?.join('/'), 'IMAGE', 'gemini 协议：responseModalities=[IMAGE]')
check(geminiRes.json().dropped.some((item) => item.startsWith('aspect_ratio')), 'gemini 协议：不支持的比例参数被如实裁掉')
checkEqual(geminiRes.json().image.size, '1024 × 1024', 'gemini 协议：从 candidates[].inlineData 里取到图并量出尺寸')

// ---- 自定义（原样透传） ----
mockRequests.length = 0
await configureProtocol('custom', `${MOCK_ORIGIN}/v1`)
const customRes = await generate({
  prompt: '一张海报',
  model: 'my-local-model',
  aspectRatio: '1:1',
  resolution: '1K',
  count: 1,
  quality: '',
  references: [],
})
checkEqual(customRes.status, 200, 'custom 协议：出图成功')
const customCall = mockCallsTo('/images')[0]
check(customCall !== undefined, 'custom 协议：打的是 {base}/images')
checkEqual(customCall.body.model, 'my-local-model', 'custom 协议：body 带 model')
checkEqual(customCall.body.aspect_ratio, '1:1', 'custom 协议：没有能力表时仍发核心字段（交给上游校验）')
checkEqual(customCall.body.prompt, '一张海报', 'custom 协议：body 带 prompt')

// ---- 没有能力表的协议：/models 如实说清楚 ----
const openaiModels = await call(second.routes, API.models, { method: 'GET' })
checkEqual(openaiModels.status, 200, '非 OpenRouter 协议：/models 返回 200（不是 501）')
checkEqual(openaiModels.json().models.length, 0, '非 OpenRouter 协议：不编模型列表')
checkContains(openaiModels.json().note ?? '', '手动填写模型 id', '并告诉用户该怎么填模型')
const openaiCaps = await call(second.routes, API.capabilities, { method: 'GET', url: `${API.capabilities}?model=x` })
checkEqual(openaiCaps.status, 501, '非 OpenRouter 协议：/capabilities 明确回 501（没有能力表接口）')

await configureForGenerate()
mockServer.close()

// ============================================================ 12. 优化模板

console.log('\n--- 12. 读 prompt-forge 的「文生图优化」模板 ---')

/** prompt-forge 在 profile 里那一行的样子（只留我们用得到的字段）。 */
const forgeRow = {
  entry: { id: 'include:prompt-forge', name: 'dsh-prompt-forge' },
  inherited: {},
  override: {
    enabled: true,
    provider: 'openrouter-customer',
    model: 'deepseek/deepseek-v4.1-flash',
    presets: [
      { id: 'coding', name: '编码任务', system: '编码用的 system' },
      { id: 'preset-mv1tlq6g', name: '文生图优化', system: '文生图用的 system 文本' },
    ],
  },
}

/**
 * `settings.describe()` 那条路 —— 真机上更可能的形状：
 * 一个「命名空间描述符」数组，值挂在 `value` 上。深度搜索不认字段名，只认 presets。
 */
const settingsDescribeShape = [
  { ns: 'llm', value: { provider: 'ofox', model: 'x' } },
  {
    ns: 'include:prompt-forge',
    schema: { properties: { presets: {}, activePresetId: {} } },
    value: {
      enabled: true,
      provider: 'openrouter-customer',
      model: 'deepseek/deepseek-v4.1-flash',
      presets: [
        { id: 'coding', name: '编码任务', system: '编码用的 system' },
        { id: 'preset-mv1tlq6g', name: '文生图优化', system: '文生图用的 system 文本' },
      ],
    },
  },
]

// 首选来源：settings.describe()。
const withSettings = mountRoutes(plugin, { settings: { describe: () => settingsDescribeShape } })
const presetOk = await call(withSettings.routes, API.preset, { method: 'GET' })
checkEqual(presetOk.status, 200, 'GET /preset 返回 200（走 settings.describe）')
checkEqual(presetOk.json().system, '文生图用的 system 文本', '回的是「文生图优化」那段 system')
checkEqual(presetOk.json().name, '文生图优化', '带回模板名')
checkEqual(presetOk.json().model, 'deepseek/deepseek-v4.1-flash', '带回它当前用的模型（我们复用它，不自己挑）')
checkEqual(presetOk.json().provider, 'openrouter-customer', '带回渠道')
checkEqual(presetOk.json().optimizeRoute, '/api/dsh-prompt-forge/optimize', '告诉前端该打哪条路由')
check((await call(withSettings.routes, API.preset, { method: 'POST' })).status === 405, 'POST /preset → 405')

// 退化路径：没有 settings 时用 configEditor.configuration()（旧的嵌套形状）。
const withForge = mountRoutes(plugin, { configEditor: { configuration: () => [forgeRow] } })
checkEqual((await call(withForge.routes, API.preset, { method: 'GET' })).json().system, '文生图用的 system 文本', '没有 settings 时退回 configEditor 也能找到')

// 深度搜索不许被别的 presets 带跑偏（agent preset 那种同名键）。
const withNoise = mountRoutes(plugin, {
  settings: {
    describe: () => [
      { ns: 'agent-presets', value: { presets: [{ id: 'a', name: '代码审查', system: 'agent 的 system' }] } },
      ...settingsDescribeShape,
    ],
  },
})
checkEqual((await call(withNoise.routes, API.preset, { method: 'GET' })).json().name, '文生图优化', '别的 presets 数组不会把它带偏')

// 模板名带后缀 → 包含匹配。
const withV2 = mountRoutes(plugin, {
  settings: {
    describe: () => [{
      ns: 'include:prompt-forge',
      value: { model: 'm', presets: [{ id: 'x', name: '文生图优化 v2', system: 'v2 的 system' }] },
    }],
  },
})
checkEqual((await call(withV2.routes, API.preset, { method: 'GET' })).json().system, 'v2 的 system', '模板名带后缀也能匹配（包含匹配）')

// 扫到了配置但没有这个模板 → 404 + 列出可用名。
const noPreset = mountRoutes(plugin, {
  settings: {
    describe: () => [{
      ns: 'include:prompt-forge',
      value: { presets: [{ id: 'a', name: '编码任务', system: 'x' }] },
    }],
  },
})
const noPresetRes = await call(noPreset.routes, API.preset, { method: 'GET', url: `${API.preset}?patch=none` })
checkEqual(noPresetRes.status, 404, '没有这个模板 → 404')
checkEqual(noPresetRes.json().code, 'preset-missing', 'code=preset-missing')
checkContains(noPresetRes.json().message, '编码任务', '把现有模板名列出来（好让用户知道该改成什么）')
checkContains(noPresetRes.json().message, '扫到 1 处', '并说明扫了几处模板配置（诊断用）')

// 两个服务都没有 → 501（不假装成功）。注意：还要把 patch 兜底也掐掉才算「都没有」。
const noService = mountRoutes(plugin, {})
const noServiceRes = await call(noService.routes, API.preset, { method: 'GET', url: `${API.preset}?patch=none` })
check([501, 404].includes(noServiceRes.status), `宿主两个配置服务都没有 → 501 或 404（实际 ${noServiceRes.status}）`)
check(noServiceRes.json().code === 'no-config-editor' || noServiceRes.json().code === 'preset-missing', 'code 说得清是哪种失败')

// 兜底：服务都读不到时，直接读 profile patch（真机上就是靠它救回来的）。
const patchFile = path.join(tempRoot, 'fake-cordis.patch.yml')
writeFileSync(patchFile, [
  '  - id: prompt-forge',
  '    name: dsh-prompt-forge',
  '    config:',
  '      enabled: true',
  '      provider: openrouter-customer',
  '      model: deepseek/deepseek-v4.1-flash',
  '      mainSystemPrompt: |-',
  '        通用的 system',
  '      presets:',
  '        - id: coding',
  '          name: 编码任务',
  '          system: |-',
  '            编码用的 system',
  '        - id: preset-mv1tlq6g',
  '          name: 文生图优化',
  '          system: >-',
  '            角色：专业文生图提示词优化专家',
  '',
  '            你是一名资深的 AI 图像生成提示词工程师。',
  '  - id: other',
  '    name: "@deepseek-ai/other"',
  '    config:',
  '      presets:',
  '        - id: z',
  '          name: 别的模板',
  '          system: |-',
  '            不该被选中',
].join('\n'), 'utf8')
const withPatch = mountRoutes(plugin, {})
const patchRes = await call(withPatch.routes, API.preset, { method: 'GET', url: `${API.preset}?patch=${encodeURIComponent(patchFile)}` })
checkEqual(patchRes.status, 200, '服务读不到时，兜底读 patch 文件也能找到')
checkEqual(patchRes.json().name, '文生图优化', '兜底拿到的是「文生图优化」')
checkContains(patchRes.json().system, '你是一名资深的 AI 图像生成提示词工程师', '折叠式（>-）块标量被正确还原')
check(!patchRes.json().system.includes('不该被选中'), '只抠 prompt-forge 那一行，别的行不串味')
checkEqual(patchRes.json().model, 'deepseek/deepseek-v4.1-flash', '兜底也带出模型')

// `?debug=1`：回结构速写，不回长文本（真机排错用）。
const debugRes = await call(withSettings.routes, API.preset, { method: 'GET', url: `${API.preset}?debug=1` })
checkEqual(debugRes.status, 200, 'GET /preset?debug=1 返回 200')
check(Array.isArray(debugRes.json().debug), 'debug 里列出每个来源')
checkContains(JSON.stringify(debugRes.json().debug), 'include:prompt-forge', '速写里能看到命名空间')
check(!JSON.stringify(debugRes.json().debug).includes('文生图用的 system 文本'), '速写**不**回长文本（system 正文不出现）')

// 它只在 loopback 上开口。
const presetRemote = await call(withForge.routes, API.preset, { method: 'GET', remoteAddress: '10.0.0.9' })
checkEqual(presetRemote.status, 403, '非环回来源 → 403')

// ============================================================ 13. 损坏文件

console.log('\n--- 13. 配置文件损坏时的退化 ---')

writeFileSync(configFile, '{ this is not json', 'utf8')
const corruptRead = await call(second.routes, API.config, { method: 'GET' })
checkEqual(corruptRead.status, 200, '文件损坏时 GET /config 仍返回 200（面板不该被一个坏文件卡死）')
checkEqual(corruptRead.json().config.hasKey, false, '文件损坏时退回默认配置')
check(
  readdirSync(tempRoot).some((name) => name.startsWith('config.json.corrupt-')),
  '损坏的原文件被改名备份（不销毁用户数据）',
)

// ============================================================ 14. 面板草稿
//
// 老板的两条要求里有一条必须在宿主侧落地：**「上次写了提示词但没生成」要留到下次进面板**。
// 模块作用域撑不过一次重启，所以草稿得落盘。这一节验的就是那条链：
// 读得到 / 写得进 / 宽松收敛 / 坏文件不致命 / 围栏还在。

console.log('\n--- 14. 面板草稿（/draft）与「当时用了什么」的降级 ---')

const draftFile = path.join(tempRoot, 'draft.json')

const draftEmpty = await call(second.routes, API.draft, { method: 'GET' })
checkEqual(draftEmpty.status, 200, 'GET /draft 返回 200')
checkEqual(draftEmpty.json().draft, null, '还没有草稿时回 `draft: null`（不是拿空对象冒充「有草稿」）')
checkEqual(draftEmpty.json().path, draftFile, '/draft 回草稿文件路径（真机排查时用）')

const draftPut = await call(second.routes, API.draft, {
  method: 'PUT',
  body: {
    draft: {
      prompt: '一只戴帽子的猫，坐在窗台上',
      params: { aspectRatio: '4:5', resolution: '2K', count: '3', quality: 'medium' },
      extra: { background: 'transparent' },
      lastGeneratedPrompt: '上一张成功生成用的提示词',
    },
  },
})
checkEqual(draftPut.status, 200, 'PUT /draft 返回 200')
check(draftPut.json().draft.updatedAt > 0, 'PUT 回的是**服务端盖了时间戳**的那份')
checkEqual(draftPut.json().draft.prompt, '一只戴帽子的猫，坐在窗台上', 'PUT 回的草稿就是落盘后的那份')
check(existsSync(draftFile), '草稿真的落在磁盘上（跨重启就靠它）')
check(!existsSync(`${draftFile}.tmp`), '原子写不留 .tmp 残渣')

const draftRead = await call(second.routes, API.draft, { method: 'GET' })
checkEqual(draftRead.json().draft.prompt, '一只戴帽子的猫，坐在窗台上', '草稿读得回来')
checkEqual(draftRead.json().draft.params.aspectRatio, '4:5', '参数快照里的比例存得住')
checkEqual(draftRead.json().draft.params.count, '3', '参数快照里的张数存得住（字符串原样）')
checkEqual(draftRead.json().draft.extra.background, 'transparent', '模型驱动表单那些额外字段也存得住')
checkEqual(
  draftRead.json().draft.lastGeneratedPrompt,
  '上一张成功生成用的提示词',
  '「最后一次成功生成用的提示词」存得住 —— 进面板时判「草稿生成过没有」就靠它',
)
// 这份文件里**不该**有参考图：几 MB 的 data URL 会把这颗小 JSON 变成垃圾场。
check(!readFileSync(draftFile, 'utf8').includes('data:image'), '草稿文件里没有参考图的 data URL')

// 宽松收敛：手改坏的文件 / 前端给的怪类型都不该让面板起不来。
const draftBad = await call(second.routes, API.draft, {
  method: 'PUT',
  body: {
    draft: {
      prompt: 12345,
      params: { count: 42 },
      extra: { seed: 7, bad: null },
      lastGeneratedPrompt: ['不是字符串'],
    },
  },
})
checkEqual(draftBad.status, 200, 'PUT /draft 收到乱七八糟的类型也回 200（宽松收敛）')
checkEqual(draftBad.json().draft.prompt, '', '非字符串提示词收敛成空串')
checkEqual(draftBad.json().draft.params.count, '42', '数字张数收敛成字符串')
checkEqual(draftBad.json().draft.params.aspectRatio, '', '缺失的比例收敛成空串')
checkEqual(draftBad.json().draft.extra.seed, '7', '数字额外字段收敛成字符串')
checkEqual(draftBad.json().draft.extra.bad, undefined, 'null 取值的字段被丢掉')
checkEqual(draftBad.json().draft.lastGeneratedPrompt, '', '数组不是字符串 → 收敛成空串')

const draftHuge = await call(second.routes, API.draft, {
  method: 'PUT',
  body: { draft: { prompt: 'x'.repeat(30000) } },
})
checkEqual(draftHuge.json().draft.prompt.length, 20000, '超长提示词按上限截断（20000），不写爆这颗小 JSON')
const draftOversize = await call(second.routes, API.draft, {
  method: 'PUT',
  body: { draft: { prompt: 'y'.repeat(300000) } },
})
checkEqual(draftOversize.status, 400, '请求体超过 256 KB → 400（有个明确上限，不是随便写）')

writeFileSync(draftFile, '{ 这不是 JSON', 'utf8')
const draftCorrupt = await call(second.routes, API.draft, { method: 'GET' })
checkEqual(draftCorrupt.status, 200, '草稿文件损坏时 GET /draft 仍返回 200')
checkEqual(draftCorrupt.json().draft, null, '损坏的草稿按「没有草稿」处理 —— 面板不该被一个坏文件卡死')
const healthDraft = await call(second.routes, API.health, { method: 'GET' })
checkEqual(healthDraft.json().draftPath, draftFile, '/health 里能查到草稿文件路径（真机验收用）')
checkEqual(healthDraft.json().hasDraft, false, '草稿损坏后 /health 报 hasDraft=false')

// ---- 客户端那边的草稿接口：请求形状与解析也要对上（键名最容易两半边写岔） ----
const realFetchForDraft = globalThis.fetch
const draftCalls = []
globalThis.fetch = async (url, init) => {
  draftCalls.push({ url: String(url), init })
  // 第一次回一份草稿、第二次回「还没有草稿」——把两条分支都走一遍。
  const draft = draftCalls.length === 1
    ? {
        prompt: '客户端的草稿',
        params: { aspectRatio: '16:9', resolution: '1K', count: '2', quality: 'high' },
        extra: { background: 'auto' },
        lastGeneratedPrompt: '客户端的上一句',
        updatedAt: 123,
      }
    : null
  return { status: 200, ok: true, json: async () => ({ ok: true, draft }) }
}
const draftBackend = client.createHttpBackend()
const loadedDraft = await draftBackend.loadDraft()
checkEqual(draftCalls[0].url, '/dsh-imagegen/draft', '客户端 loadDraft 打的就是 /dsh-imagegen/draft')
checkEqual(loadedDraft?.params.count, '2', '客户端把草稿解析成 PanelDraft（参数原样）')
checkEqual(loadedDraft?.extra.background, 'auto', '客户端解析草稿里的额外字段')
checkEqual(loadedDraft?.lastGeneratedPrompt, '客户端的上一句', '客户端解析草稿里的 lastGeneratedPrompt')

const loadedNoDraft = await draftBackend.loadDraft()
checkEqual(loadedNoDraft, undefined, '宿主回 `draft: null` 时客户端给 undefined（= 还没有草稿）')

const savedDraft = await draftBackend.saveDraft({
  prompt: '写进去的提示词',
  params: { aspectRatio: '1:1', resolution: '2K', count: '3', quality: 'low' },
  extra: { seed: '42' },
  lastGeneratedPrompt: '',
  updatedAt: 0,
})
checkEqual(draftCalls[2].init?.method, 'PUT', '客户端 saveDraft 用 PUT')
checkEqual(draftCalls[2].init?.headers?.['content-type'], 'application/json', 'saveDraft 带 JSON content-type')
checkEqual(JSON.parse(draftCalls[2].init.body).draft.prompt, '写进去的提示词', 'saveDraft 的请求体形状是 { draft: … }')
checkEqual(savedDraft, true, 'saveDraft 写成功返回 true')

globalThis.fetch = async () => ({
  status: 500,
  ok: false,
  json: async () => ({ ok: false, code: 'write-failed', message: '草稿落盘失败：磁盘满了' }),
})
const savedFailed = await draftBackend.saveDraft({
  prompt: 'x',
  params: { aspectRatio: '', resolution: '', count: '1', quality: '' },
  extra: {},
  lastGeneratedPrompt: '',
  updatedAt: 0,
})
checkEqual(savedFailed, false, 'saveDraft 失败时返回 false 而**不抛**（草稿丢一份不该打断正在打字的人）')
globalThis.fetch = realFetchForDraft

// ---- 客户端那边的「打开」接口：路径、方法、请求体形状都要对上 ----
// 面板上「打开」的接线是 `onOpen → backend.openImage(id)`；这里验的是最后那一跳
// （路径/方法/键名两半边写岔的话，界面上只会表现为「点了没反应」）。
const realFetchForOpen = globalThis.fetch
const openCalls = []
globalThis.fetch = async (url, init) => {
  openCalls.push({ url: String(url), init })
  return { status: 200, ok: true, json: async () => ({ ok: true, path: 'C:\\out\\x.png' }) }
}
const openBackend = client.createHttpBackend()
const openedPath = await openBackend.openImage('gen-1')
checkEqual(openCalls[0].url, '/dsh-imagegen/open', '客户端 openImage 打的就是 /dsh-imagegen/open')
checkEqual(openCalls[0].init?.method, 'POST', 'openImage 用 POST（它要让宿主去动桌面，不该是 GET）')
checkEqual(openCalls[0].init?.headers?.['content-type'], 'application/json', 'openImage 带 JSON content-type')
checkEqual(JSON.parse(openCalls[0].init.body).id, 'gen-1', 'openImage 的请求体就是 { id }')
checkEqual(openedPath, 'C:\\out\\x.png', 'openImage 把宿主的 path 回给面板（提示里要写清是哪个文件）')
globalThis.fetch = realFetchForOpen

// ---- 升级前的老索引条目：缺字段要如实缺，不许伪造 ----
const legacyIndex = readIndex()
legacyIndex.push({
  id: 'legacy-1',
  savedPath: path.join(tempRoot, 'out', 'legacy.png'),
  fileName: 'legacy.png',
  mediaType: 'image/png',
  bytes: 1,
  size: '',
  seconds: 3,
  prompt: '升级前生成的一张',
  aspectRatio: '1:1',
  resolution: '1K',
  model: 'old/model',
  createdAt: Date.now(),
})
writeFileSync(indexFile, JSON.stringify(legacyIndex, null, 2), 'utf8')
const legacyHistory = await call(second.routes, API.history, { method: 'GET' })
const legacyEntry = legacyHistory.json().images.find((item) => item.id === 'legacy-1')
check(legacyEntry !== undefined, '升级前的老条目照样读得出来（不因为缺字段被丢掉）')
checkEqual(legacyEntry.model, 'old/model', '老条目的模型照样回给前端')
checkEqual(legacyEntry.params, undefined, '老条目没有参数快照时**不伪造**一个空的（界面显示「未记录」）')
checkEqual(legacyEntry.sentFields, undefined, '老条目没有实发字段时也不伪造')

// ---- 结果行的中文标签必须覆盖宿主声明的每个字段 ----
// 少了哪个，界面上就会冒出一个英文键名（结果行显示的是**任意**历史图的参数，
// 拿不到当前模型的参数表，所以标签只能是一份与模型无关的对照表）。
const labelsSource = readFileSync(path.join(root, 'src', 'client', 'labels.ts'), 'utf8')
const labelKeys = new Set([...labelsSource.matchAll(/^\s{2}([a-z_]+):\s*'/gmu)].map((match) => match[1]))
for (const field of plugin.FIELD_SPECS) {
  check(labelKeys.has(field.name), `客户端有「${field.label}」的中文标签（${field.name}）`)
}
check(labelKeys.has('stream'), '客户端也给 stream 准备了中文标签（它不在 FIELD_SPECS 里）')

// ============================================================ 15. 卸载

console.log('\n--- 15. 卸载 ---')

for (const dispose of second.effects) dispose()
check(second.routes.every((route) => route.removed === true), '卸载时 12 条路由全部被释放')
check(second.effects.length === 1, '一次 apply 只注册一个 effect')

// ------------------------------------------------------------------ 收尾

if (failures.length === 0) {
  rmSync(tempRoot, { recursive: true, force: true })
} else {
  console.error(`\n临时目录保留以便排查：${tempRoot}`)
}

console.log(`\n${total - failures.length}/${total} passed`)
if (failures.length > 0) {
  console.error('\n失败项：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
