/**
 * dsh-imagegen-panel —— 宿主半边（host half）。
 *
 * 阶段 4 的职责：**真出图**。Key 只在宿主进程里出现，浏览器只拿到图片 id 与路径。
 *
 * 挂的路由（全部 loopback-only，见 `src/http.ts` 的围栏）：
 *
 * | 路径 | 方法 | 作用 |
 * |---|---|---|
 * | `/dsh-imagegen/config`       | GET | 回配置：**只有 `hasKey` + 掩码 `keyHint`，明文永不下发** |
 * | `/dsh-imagegen/config`       | PUT | 收配置（明文 Key 只在这一跳里）→ 校验 → 落盘 → 只回掩码 |
 * | `/dsh-imagegen/models`       | GET | 代理 `GET {base}/images/models`（公开接口，无需 Key） |
 * | `/dsh-imagegen/capabilities` | GET | 代理 `GET {base}/images/models/<id>/endpoints`：权威能力 + 定价 |
 * | `/dsh-imagegen/generate`     | POST | 宿主发 `POST {base}/images`（绕开 CORS，Key 不进浏览器） |
 * | `/dsh-imagegen/history`      | GET | 读索引（最新在前） |
 * | `/dsh-imagegen/open`         | POST | 用**系统默认程序**打开某张图的本地原图（结果行「打开」/ 历史图右键菜单） |
 * | `/dsh-imagegen/image/<id>`   | GET | **prefix** 路由：把落盘的图喂给浏览器 |
 * | `/dsh-imagegen/health`       | GET | 自查：路由是否挂上、配置在哪、Key 有没有、存了几张 |
 * | `/dsh-imagegen/logs`        | GET | 宿主侧日志（面板里的「查看日志」抽屉）；`?format=text` 直接下载 |
 * | `/dsh-imagegen/logs`        | DELETE | 只清内存缓冲（磁盘上的日志文件保留 —— 那是排查记录） |
 * | `/dsh-imagegen/draft`       | GET | 面板草稿（提示词/参数/上次成功生成用的提示词）；没有草稿文件时 `draft: null` |
 * | `/dsh-imagegen/draft`       | PUT | 收草稿 → 宽松收敛 → 原子落盘 → 回落盘后的草稿 |
 *
 * 存储：`~/.dsh/dsh-imagegen-panel/`（`config.json` + `index.json` + `draft.json` + `out/` + `logs/`）。
 *
 * 失败策略：**apply 绝不抛错**。插件从 apply 抛出会让 cordis fiber 进 FAILED，
 * 连带整个 web 启动一起挂掉 —— 一个配错的生图插件不该让老板的 GUI 起不来。
 * 挂不上路由就退化成「面板报『宿主路由不可用』」，其余功能照常。
 */
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
// 注意：这里的相对 import 必须写成**单行** —— scripts/build.mjs 的宿主打包器
// 逐行扫描 `import … from '…'` 来找依赖图，多行 import 不会被内联（构建还会"成功"，
// 只在运行时报模块找不到）。这是那个手写 bundler 的一个真实约束，别改回去。
import { configFilePath, imagegenHome, imageOutDir, publicConfig, readConfig, validatePatch, writeConfig } from './config-store.ts'
import { coercePanelDraft, draftFilePath, readPanelDraft, writePanelDraft } from './draft-store.ts'
import { badRequestBody, forbiddenBody, isLoopbackRequest, methodBody, readJsonBody, writeJson } from './http.ts'
import { copyImageTo, findImage, patchIndexEntry, readImageBytes, readImageIndex, saveGeneratedImage, toClientImage, type StoredParams } from './image-store.ts'
import { parseGeneration, getImageModels, getModelCapabilities, postGeneration, FIELD_SPECS, STREAM_FIELD, type GenerateInput, type SupportedParameters } from './openrouter.ts'
import { clearLogBuffer, flushLogs, hostLog, logCount, logDir, logFilePath, logsAsText, recentLogs } from './log-store.ts'
import { explorerTarget, openWithDefaultApp } from './open-file.ts'
import { parseProviderResponse, planGeneration } from './providers.ts'
import { FORGE_PRESET_NAME, collectConfigSources, collectPatchSources, defaultPatchPaths, findForgePreset, outlineOf } from './forge.ts'

/** 插件名。Cordis 用它做日志与去重标识。 */
export const name = 'dsh-imagegen-panel'

/** 没有 web carrier 就没有这条管道 —— 它是唯一硬依赖。 */
export const inject = ['webServer']

/**
 * 路由表。
 *
 * 导出它是为了让 `scripts/host-check.mjs` 能对「客户端实际打的路径」与
 * 「宿主实际挂的路径」做一次字面比对 —— 两边写死同一个字符串是这类插件
 * 最常见的静默故障（路由挂了，前端 404，界面只表现为「没反应」）。
 */
export const API = {
  config: '/dsh-imagegen/config',
  models: '/dsh-imagegen/models',
  capabilities: '/dsh-imagegen/capabilities',
  generate: '/dsh-imagegen/generate',
  history: '/dsh-imagegen/history',
  save: '/dsh-imagegen/save',
  /**
   * 用系统默认程序打开某张图的**本地原图**。
   *
   * 「打开」只能由宿主做：浏览器最多下载或新开一个标签页，起不来老板的看图工具。
   * 只认索引里的 id（不接受任意路径），所以这条路由开不了索引之外的文件。
   */
  open: '/dsh-imagegen/open',
  /**
   * 读 prompt-forge 的「文生图优化」模板文本。
   *
   * 面板上的「优化提示词」按钮要拿这段 system 文本去调 prompt-forge 自己的
   * `POST /api/dsh-prompt-forge/optimize`（那条路由要求调用方传 system）。
   */
  preset: '/dsh-imagegen/preset',
  health: '/dsh-imagegen/health',
  /**
   * 宿主侧日志。
   *
   * 存在的理由：桌面版 DSH **没有可见的宿主控制台**（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\`
   * 是空目录，界面上也没有「控制台」入口）。把日志塞进一个打不开的终端等于没写 ——
   * 这条路由 + 面板里的抽屉才是老板真能看到日志的地方，另外日志同时落盘到
   * `~/.dsh/dsh-imagegen-panel/logs/host-<日期>.log`，多个进程/重启后也查得到。
   */
  logs: '/dsh-imagegen/logs',
  /**
   * 面板草稿（提示词 / 参数）。
   *
   * 存在理由：面板状态只在一次 DSH 运行里活着，重启就回到初始值 —— 于是
   * 「上次写了没生成，这次进来要留着」这条规则无从判断。这条路由把草稿
   * （连同「最后一次成功生成用的提示词」）落到 `<数据目录>/draft.json`。
   */
  draft: '/dsh-imagegen/draft',
  /**
   * **prefix** 路由：后面接 `/` + 图片 id。
   *
   * ⚠️ 注册时**绝不能带尾斜杠**：webServer 的 prefix 匹配规则是
   * `pathname === prefix || pathname.startsWith(prefix + '/')` ——
   * 写成 `/dsh-imagegen/image/` 就变成要求路径里出现 `//`，于是
   * `/dsh-imagegen/image/<id>` 永远匹配不上，请求落到 SPA 兜底并回 404。
   * （2026-10-10 实测踩到：面板里图全裂、`/image/<id>` 回 404 且 content-type 为空。）
   */
  image: '/dsh-imagegen/image',
} as const

/** 生成请求体的上限：参考图是 data URL，几 MB 很正常（配置 PUT 用 http.ts 的 1 MB）。 */
const GENERATE_BODY_BYTES = 32 * 1024 * 1024

/**
 * 草稿请求体的上限。
 *
 * 草稿就是一句提示词 + 一小组参数，正常情况下几 KB。给到 256 KB 是为了让「提示词
 * 特别长」这种合法情况不至于被当成坏请求拒掉 —— 但它仍是个明确的上限，
 * 免得面板侧出 bug 时把整块内存写进这个小 JSON。
 */
const DRAFT_BODY_BYTES = 256 * 1024

/** 一条路由（`ctx.webServer.register` 的入参）。 */
interface RouteSpec {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** 我们用到的那一小部分 webServer 服务面。 */
interface WebServerFace {
  register(route: RouteSpec): () => void
}

/** `ctx.inject(['webServer'], …)` 给的子上下文。 */
interface HostScopeLike {
  webServer: WebServerFace
  /** 注册一个可逆副作用；返回的清理函数在卸载/热重载时被调用。第二个参数是诊断用标签。 */
  effect(callback: () => (() => void) | void, label?: string): unknown
}

/** 宿主上下文里我们用到的那一部分（结构化声明，省掉一个类型依赖）。 */
interface HostContextLike {
  inject(names: string[], callback: (scope: HostScopeLike) => void): unknown
}

/**
 * 日志前缀现在由 `src/log-store.ts` 的 `hostLog()` 统一拼。
 *
 * 原来这里有一个 `const LOG`，改成 hostLog 之后就没用了 —— 留着会让人以为
 * 「还有别的路径在打日志」，那正是这次要消灭的歧义。
 */

/**
 * 登记一条路由，失败只记日志。
 *
 * 重复注册同一个 (kind, path) 会抛 —— 热重载没清干净、或别的插件占了同一个
 * 路径时，我们要的是「少一条路由」，不是「apply 抛出 → GUI 起不来」。
 * @param disposers - 收集清理函数。
 * @param webServer - webServer 服务面。
 * @param route - 路由定义。
 * @param label - 出错时打印的标识。
 */
function safeRegister(
  disposers: Array<() => void>,
  webServer: WebServerFace,
  route: RouteSpec,
  label: string,
): void {
  try {
    disposers.push(webServer.register(route))
  } catch (error) {
    hostLog('warn', `路由 ${label} 挂载失败：`, error)
  }
}

/** 请求路径（去掉 query）。 */
function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://dsh.invalid').pathname
  } catch {
    return req.url ?? '/'
  }
}

/** 一句可展示的失败。 */
function failure(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message }
}

// ------------------------------------------------------------------ 处理器

/** `GET /dsh-imagegen/config` —— 回配置（无明文 Key）。 */
async function handleConfigRead(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }
  const current = await readConfig()
  writeJson(res, 200, {
    ok: true,
    config: publicConfig(current.settings, current.apiKey),
  })
}

/** `PUT /dsh-imagegen/config` —— 收配置、落盘、只回掩码。 */
async function handleConfigWrite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'PUT') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const body = await readJsonBody(req)
  if (body === undefined) {
    writeJson(res, 400, badRequestBody())
    return
  }

  const validated = validatePatch(body.config)
  if (!validated.ok) {
    writeJson(res, 400, failure(validated.code, validated.message))
    return
  }

  // Key 的三态：换（body.apiKey 非空）、清（clearKey）、不动（都不给）。
  const current = await readConfig()
  let apiKey = current.apiKey
  if (body.clearKey === true) apiKey = ''
  if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') apiKey = body.apiKey.trim()

  const settings = { ...current.settings, ...validated.patch }

  try {
    await writeConfig(settings, apiKey)
  } catch (error) {
    // 落盘失败必须让用户知道 —— 否则「保存成功」的提示会变成谎言。
    writeJson(res, 500, failure('write-failed', `配置落盘失败：${error instanceof Error ? error.message : String(error)}`))
    return
  }

  writeJson(res, 200, { ok: true, config: publicConfig(settings, apiKey) })
}

/**
 * `GET /dsh-imagegen/models` —— 代理上游模型目录。
 *
 * 这个上游接口是**公开**的（实测：不带 Key 也 200），所以面板在填 Key 之前就能
 * 看到有哪些模型、各自支持什么参数 —— 这正好符合「先挑模型再配 Key」的实际顺序。
 */
async function handleModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const current = await readConfig()
  if (current.settings.protocol !== 'openrouter') {
    // 其他协议**没有**等价的能力表（OpenAI 的 `/models` 把聊天模型也混在一起，
    // Gemini 的模型列表也没有图像参数声明）。这里不猜、不编，直接说清楚 ——
    // 面板会把这句 note 显示出来，用户就知道该手填模型 id。
    writeJson(res, 200, {
      ok: true,
      models: [],
      note: `「${current.settings.protocol}」协议没有图像模型能力表，请在「连接配置」里手动填写模型 id`,
    })
    return
  }

  const force = (req.url ?? '').includes('refresh=1')
  try {
    const { models } = await getImageModels(current.settings.baseUrl, undefined, force)
    writeJson(res, 200, { ok: true, source: `${current.settings.baseUrl}/images/models`, models })
  } catch (error) {
    writeJson(res, 502, failure('upstream', `拉模型列表失败：${error instanceof Error ? error.message : String(error)}`))
  }
}

/** `GET /dsh-imagegen/capabilities?model=<id>&resolution=<tier>` —— 权威能力与定价。 */
async function handleCapabilities(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const model = url.searchParams.get('model') ?? ''
  const resolution = url.searchParams.get('resolution') ?? undefined
  if (model.trim() === '') {
    writeJson(res, 400, failure('bad-model', '缺少 model 参数'))
    return
  }

  const current = await readConfig()
  if (current.settings.protocol !== 'openrouter') {
    // 能力表只有 OpenRouter 有。其他协议回 501，客户端会静默忽略（面板退回
    // 「用模型列表里那份候选值」或直接保持当前值）—— 不编一份假能力表。
    writeJson(res, 501, failure('capabilities-unsupported', `「${current.settings.protocol}」协议没有能力表接口`))
    return
  }

  try {
    const capabilities = await getModelCapabilities(current.settings.baseUrl, model.trim(), resolution)
    writeJson(res, 200, { ok: true, capabilities })
  } catch (error) {
    writeJson(res, 502, failure('upstream', `拉模型能力失败：${error instanceof Error ? error.message : String(error)}`))
  }
}

/** `GET /dsh-imagegen/history` —— 读索引。 */
async function handleHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }
  const index = await readImageIndex()
  writeJson(res, 200, { ok: true, images: index.map(toClientImage) })
}

/** `GET /dsh-imagegen/image/<id>` —— 把落盘的图喂给浏览器。 */
async function handleImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const path = pathnameOf(req)
  // 前缀不带尾斜杠，所以先剥掉分隔用的 `/` 才是 id。
  const id = decodeURIComponent(path.slice(API.image.length).replace(/^\/+/u, ''))
  if (id === '') {
    writeJson(res, 400, failure('bad-id', '缺少图片 id'))
    return
  }

  const entry = await findImage(id)
  if (entry === undefined) {
    writeJson(res, 404, failure('not-found', `索引里没有这张图：${id}`))
    return
  }
  const bytes = await readImageBytes(entry)
  if (bytes === undefined) {
    writeJson(res, 404, failure('file-missing', `索引里有记录但文件不在了：${entry.savedPath}`))
    return
  }

  res.writeHead(200, {
    'content-type': entry.mediaType,
    'content-length': String(bytes.length),
    // 文件名带时间戳、内容不会变，可以长期缓存。
    'cache-control': 'private, max-age=31536000, immutable',
    'referrer-policy': 'no-referrer',
  })
  res.end(req.method === 'HEAD' ? undefined : bytes)
}

/**
 * 允许从请求体 `request.extra` 里透传到上游的字段白名单。
 *
 * 就是字段规格表那几项（`aspect_ratio` / `resolution` / `size` / `n` / `quality` /
 * `output_format` / `background` / `output_compression` / `seed`）+ `stream`。
 * 白名单是**必须的**：请求体是前端来的，没有它就能顺手塞 `provider` 或覆盖
 * `model` / `prompt` —— 那等于把路由权交给了浏览器。
 */
const EXTRA_FIELDS = new Set<string>([...FIELD_SPECS.map((item) => item.name), STREAM_FIELD.name])

/** 解析并校验一次生成请求。 */
function readGenerateInput(body: Record<string, unknown>): { ok: true; input: GenerateInput } | { ok: false; code: string; message: string } {
  const request = typeof body.request === 'object' && body.request !== null ? body.request as Record<string, unknown> : {}
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
  if (prompt === '') return { ok: false, code: 'empty-prompt', message: '提示词是空的' }

  const model = typeof request.model === 'string' ? request.model.trim() : ''
  if (model === '') return { ok: false, code: 'bad-model', message: '没有选模型' }

  const rawCount = typeof request.count === 'number' && Number.isFinite(request.count) ? Math.round(request.count) : 1
  const count = Math.min(10, Math.max(1, rawCount))

  const references = Array.isArray(request.references)
    ? request.references.filter((item): item is string => typeof item === 'string' && item.startsWith('data:'))
    : []

  // 模型驱动表单收集的其它字段（`background` / `seed` / `size` / `stream` …）。
  // 只收字符串，且**只在这个白名单里收** —— 请求体是前端来的，不能让它顺手把
  // `model` / `prompt` / `provider` 这类身份与路由字段塞进来。
  const extra: Record<string, string> = {}
  if (typeof request.extra === 'object' && request.extra !== null) {
    for (const [key, value] of Object.entries(request.extra as Record<string, unknown>)) {
      if (!EXTRA_FIELDS.has(key)) continue
      if (typeof value === 'string') extra[key] = value
      else if (typeof value === 'number' && Number.isFinite(value)) extra[key] = String(value)
      else if (typeof value === 'boolean') extra[key] = String(value)
    }
  }

  return {
    ok: true,
    input: {
      prompt,
      model,
      aspectRatio: typeof request.aspectRatio === 'string' ? request.aspectRatio : '',
      resolution: typeof request.resolution === 'string' ? request.resolution : '',
      count,
      quality: typeof request.quality === 'string' ? request.quality : '',
      references,
      ...Object.keys(extra).length === 0 ? {} : { extra },
    },
  }
}

/**
 * 把要发给上游的请求体压成一行可读摘要。
 *
 * 这是「看不全」问题的核心补丁：老板看到的只有上游那句 `HTTP 400 …`，
 * 看不到我们**到底发了什么**。摘要里：
 *  - 短标量原样列出（`aspect_ratio="16:9"`）；
 *  - 长字符串只留长度（参考图的 data URL 有几十万字符，正文既没用又危险）；
 *  - 数组/对象只留形状。
 *
 * **绝不包含 headers** —— 那里面有 `Authorization: Bearer <明文 Key>`。
 * @param body - `planGeneration` 造出来的请求体。
 * @returns 形如 `model="…" · prompt="…" · aspect_ratio="16:9"` 的一行。
 */
function summarizeBody(body: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      parts.push(value.length <= 60 ? `${key}=${JSON.stringify(value)}` : `${key}=<${value.length} 字符>`)
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${JSON.stringify(value)}`)
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length} 项]`)
    } else if (typeof value === 'object') {
      parts.push(`${key}={${Object.keys(value as Record<string, unknown>).join(',')}}`)
    }
  }
  return parts.join(' · ')
}

/**
 * 从**实发请求体**里取出「这张图到底是用什么参数生出来的」。
 *
 * 为什么不用面板值：面板值可能被配置里那段「额外参数」JSON 覆盖（本机默认配置里就写着
 * `output_compression: 90`），也可能因为该模型不声明而被裁掉。历史记录上显示面板值
 * 就等于在骗人 —— 老板要的是「当时用的参数」，那就是这一份。
 *
 * 排除三个字段：
 *  - `model` / `prompt` —— 它们各自有专门的列，不混进参数里；
 *  - `input_references` —— 参考图是几 MB 的 data URL，只记张数（见 `referenceCount`）。
 * @param body - `planGeneration` 造出来的请求体。
 * @returns 键 = 请求体字段名，值已字符串化（长值截断，`provider` 这类对象存紧凑 JSON）。
 */
function collectSentFields(body: Record<string, unknown>): Record<string, string> {
  const skip = new Set(['model', 'prompt', 'input_references'])
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    if (skip.has(key)) continue
    if (typeof value === 'string') {
      out[key] = value.length <= 120 ? value : `${value.slice(0, 120)}…`
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value)
      continue
    }
    if (value === null || typeof value !== 'object') continue
    const text = JSON.stringify(value) ?? ''
    out[key] = text.length <= 120 ? text : `${text.slice(0, 120)}…`
  }
  return out
}

/**
 * `POST /dsh-imagegen/generate` —— 真出图。
 *
 * 配置**一律以磁盘为准**（不采信请求体里那份）：Key、Base URL、超时、输出格式、
 * 额外参数都从宿主侧读，前端那份只是它自己的显示状态。这样即使面板上开着一份
 * 过期配置，也不会拿旧参数去发请求。
 */
async function handleGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const body = await readJsonBody(req, GENERATE_BODY_BYTES)
  if (body === undefined) {
    // 这条路由的 400 有**一个特别常见的原因**：参考图的 base64 把请求体撑爆了。
    // 通用的「不是合法 JSON，或超过了大小上限」会把人引去查 JSON —— 这句直接点名。
    writeJson(res, 400, failure(
      'bad-request',
      `请求体读不出来：不是合法 JSON，或超过了 ${Math.round(GENERATE_BODY_BYTES / (1024 * 1024))} MB 上限`
      + '。绝大多数情况是参考图太大（参考图以 base64 随请求体发送，体积会膨胀约 4/3）——'
      + '先移除一两张，或换小一点的图再试。',
    ))
    return
  }

  const parsedInput = readGenerateInput(body)
  if (!parsedInput.ok) {
    writeJson(res, 400, failure(parsedInput.code, parsedInput.message))
    return
  }
  const input = parsedInput.input

  const current = await readConfig()
  if (current.apiKey === '') {
    writeJson(res, 400, failure('no-key', '还没配置 API Key —— 打开「连接配置」填一把再生成'))
    return
  }

  // 该模型声明了哪些参数：key 缺失 = 不支持，一个都不发。
  // **只有 OpenRouter 有能力表**；其他协议下 params 保持 undefined，适配层就只发核心字段。
  let params: SupportedParameters | undefined
  let supportsStreaming: boolean | undefined
  if (current.settings.protocol === 'openrouter') {
    try {
      const models = await getImageModels(current.settings.baseUrl)
      params = models.params.get(input.model)
      // `stream` 不在 `supported_parameters` 里 —— 它在目录条目的顶层
      // `supports_streaming` 上，得从模型列表里单独取一次。
      supportsStreaming = models.models.find((item) => item.id === input.model)?.supportsStreaming
    } catch (error) {
      // 拉不到模型目录不致命：退化成「只发核心字段，交给上游校验」。
      hostLog('warn', '拉模型目录失败，本次生成不做字段裁剪：', error)
      params = undefined
    }
  }

  const plan = planGeneration(input, {
    protocol: current.settings.protocol,
    baseUrl: current.settings.baseUrl,
    outputFormat: current.settings.outputFormat,
    extraJson: current.settings.extraJson,
    ...supportsStreaming === undefined ? {} : { supportsStreaming },
  }, current.apiKey, params)

  /**
   * 「这次生成用了什么」，两套值分开存：
   *  - {@link paramSnapshot}：**面板上**的取值 → 点历史记录时回填参数区用它；
   *  - {@link collectSentFields} 的结果：**真正发出去**的字段 → 结果行显示用（含配置覆盖）。
   * 两者都进索引，所以同一张图既能「还原我的设置」，也能如实说「实际发了什么」。
   */
  const paramSnapshot: StoredParams = {
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    count: input.count,
    quality: input.quality,
    extra: input.extra ?? {},
  }
  const sentFieldMap = collectSentFields(plan.body)

  /**
   * 本次生成的诊断行。
   *
   * 跟着失败响应一起回给面板 —— 这就是「看不全」的正解：面板不再只有上游那一句话，
   * 而是把「我当时发了什么、裁掉了什么、日志在哪」一并摊开。所有行都**不含明文 Key、
   * 不含参考图 data URL 正文**（只记张数与字节数，整个字符串会过 log-store 的脱敏网）。
   */
  const diagnostics: string[] = []
  const refBytes = input.references.reduce((sum, item) => sum + item.length, 0)

  // 取消与超时合成一个信号：客户端断开（面板上点「取消」）与上游太慢是两件事，
  // 用 timedOut 标记区分，报错文案才说得清。
  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = Math.max(5, current.settings.timeoutSec) * 1000
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  req.on('close', () => { controller.abort() })

  diagnostics.push(`模型：${input.model}（协议 ${current.settings.protocol}）`)
  diagnostics.push(
    `参数：比例 ${input.aspectRatio || '默认'} · 分辨率 ${input.resolution || '默认'} · `
    + `张数 ${input.count} · 质量 ${input.quality || '默认'} · 输出格式 ${current.settings.outputFormat}`,
  )
  diagnostics.push(`参考图：${input.references.length} 张${refBytes > 0 ? `（共 ${refBytes} 字符 data URL，日志只记长度）` : ''}`)
  diagnostics.push(`上游地址：POST ${plan.url}`)

  const sentFields = summarizeBody(plan.body)
  diagnostics.push(`实际发送：${sentFields === '' ? '（空请求体）' : sentFields}`)
  if (plan.dropped.length > 0) diagnostics.push(`被裁掉（该模型不支持）：${plan.dropped.join('、')}`)
  // 「发出去了、但不是我选的那个值」——配置里那段「额外参数」JSON 会覆盖同名字段。
  // 不单独说一句的话，用户看着面板上的 80、实际发的是 90，永远查不出来。
  if (plan.overridden.length > 0) {
    diagnostics.push(`被「额外参数」覆盖（连接配置里那段 JSON 优先级更高）：${plan.overridden.join('、')}`)
  }
  diagnostics.push(`宿主日志文件：${logFilePath()}`)

  hostLog('info', `生成开始：${input.model} · ${input.aspectRatio || '默认比例'} · ${input.resolution || '默认分辨率'} · ${input.count} 张 · 参考图 ${input.references.length} 张`)
  hostLog('info', `实际发送：${sentFields === '' ? '（空请求体）' : sentFields}`)
  if (plan.dropped.length > 0) hostLog('warn', `本次生成裁掉了不支持的字段：${plan.dropped.join('、')}`)
  if (plan.overridden.length > 0) hostLog('warn', `这些字段被「额外参数」覆盖了：${plan.overridden.join('、')}`)

  try {
    const outcome = await postGeneration({
      url: plan.url,
      headers: plan.headers,
      body: plan.body,
      parse: (payload) => parseProviderResponse(plan.shape, payload, parseGeneration),
      signal: controller.signal,
      timedOut: () => timedOut,
    })

    if (outcome.kind === 'aborted') {
      // 客户端已经走了，写不写都行；写一个明确的结局便于 curl/日志排查。
      hostLog('info', '本次生成被取消（客户端断开或点了「取消」）')
      writeJson(res, 499, { ...failure('aborted', '已取消'), diagnostics })
      return
    }
    if (outcome.kind === 'timeout') {
      hostLog('error', `上游超时（${current.settings.timeoutSec}s）：${outcome.message}`)
      writeJson(res, 504, { ...failure('timeout', outcome.message), diagnostics })
      return
    }
    if (outcome.kind === 'error') {
      // 上游拒绝：把它的原话写进宿主日志 —— 面板上那句是同一份文本，但日志能留档。
      hostLog('error', `上游拒绝（HTTP ${outcome.status}）：${outcome.message}`)
      writeJson(
        res,
        outcome.status >= 400 && outcome.status < 600 ? outcome.status : 502,
        { ...failure('upstream', outcome.message), diagnostics },
      )
      return
    }

    // 落盘：n>1 时全部写进 out/ 与索引，返回第一张给面板（多图浏览是阶段 5）。
    const saved = []
    for (const [index, image] of outcome.parsed.images.entries()) {
      saved.push(await saveGeneratedImage({
        b64: image.b64,
        mediaType: image.mediaType,
        model: input.model,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        seconds: outcome.elapsedSec,
        ...outcome.parsed.cost === undefined ? {} : { cost: outcome.parsed.cost },
        sequence: index,
        params: paramSnapshot,
        sentFields: sentFieldMap,
        referenceCount: input.references.length,
        batchCount: outcome.parsed.images.length,
      }))
    }

    // 自动另存一份到工作区目录（A8 的后半句）。**失败不致命**：图已经在 out/ 里了，
    // 自动另存只是多一份方便找；这里绝不因为「另一个目录写不进去」就把出图判成失败。
    const autoSaveDir = current.settings.autoSaveDir
    if (autoSaveDir.trim() !== '') {
      for (const entry of saved) {
        try {
          const path = await copyImageTo(entry, autoSaveDir)
          if (path !== entry.savedPath) await patchIndexEntry(entry.id, { autoSavedPath: path })
        } catch (error) {
          hostLog('warn', `自动另存到 ${autoSaveDir} 失败（图仍在 out/）：`, error)
        }
      }
    }

    // 重新读一次索引：自动另存刚写进去的 autoSavedPath 要回给前端。
    const byId = new Map((await readImageIndex()).map((entry) => [entry.id, entry]))
    const result = saved.map((entry) => toClientImage(byId.get(entry.id) ?? entry))

    const cost = outcome.parsed.cost
    hostLog(
      'info',
      `出图成功：${result.length} 张 · 首张 id=${result[0]?.id ?? '—'} · 耗时 ${outcome.elapsedSec}s`
      + `${cost === undefined ? '' : ` · 费用 $${cost.toFixed(4)}`}`,
    )

    writeJson(res, 200, {
      ok: true,
      image: result[0]!,
      images: result,
      count: result.length,
      dropped: plan.dropped,
      overridden: plan.overridden,
      elapsedSec: outcome.elapsedSec,
      diagnostics,
    })
  } catch (error) {
    hostLog('error', '出图过程抛出异常：', error)
    writeJson(res, 500, {
      ...failure('generate-failed', `出图失败：${error instanceof Error ? error.message : String(error)}`),
      diagnostics,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `POST /dsh-imagegen/save` —— 手动保存一份到指定目录。
 *
 * 面板上的「保存」按钮走这里：默认落到配置里的「自动保存目录」，也可以带 `target` 指定。
 * 刻意只接受**目录**而不是完整路径：让宿主决定文件名，避免用户给一个没有扩展名的路径
 * 之后自己都认不出是什么格式。
 */
async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const body = await readJsonBody(req)
  if (body === undefined) {
    writeJson(res, 400, badRequestBody())
    return
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (id === '') {
    writeJson(res, 400, failure('bad-id', '缺少图片 id'))
    return
  }
  const entry = await findImage(id)
  if (entry === undefined) {
    writeJson(res, 404, failure('not-found', `索引里没有这张图：${id}`))
    return
  }

  const current = await readConfig()
  const target = typeof body.target === 'string' && body.target.trim() !== ''
    ? body.target.trim()
    : current.settings.autoSaveDir
  if (target.trim() === '') {
    writeJson(res, 400, failure('no-target', '没有指定目标目录，配置里的「自动保存目录」也是空的'))
    return
  }

  try {
    const savedPath = await copyImageTo(entry, target)
    await patchIndexEntry(id, { autoSavedPath: savedPath })
    writeJson(res, 200, { ok: true, savedPath })
  } catch (error) {
    writeJson(res, 500, failure('save-failed', `保存失败：${error instanceof Error ? error.message : String(error)}`))
  }
}

/**
 * `POST /dsh-imagegen/open` —— 用系统默认程序打开某张图的**本地原图**。
 *
 * 面板结果行的「打开」按钮与历史图的右键菜单共用这条路由。为什么不在浏览器里开：
 * 浏览器只能下载或新开标签页，没法让老板的看图工具起来 —— 真正的「打开」必须由宿主
 * 交给桌面 shell（是 Explorer 而不是自己解析关联，理由见 `src/open-file.ts`）。
 *
 * 只认索引里的 id，所以这条路由开不了索引之外的文件；这比「传一个路径参数」少一整类
 * 攻击面（本机任何网页都打得通 loopback 端口，见 `src/http.ts` 的围栏）。
 */
async function handleOpen(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const body = await readJsonBody(req)
  if (body === undefined) {
    writeJson(res, 400, badRequestBody())
    return
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (id === '') {
    writeJson(res, 400, failure('bad-id', '缺少图片 id'))
    return
  }
  const entry = await findImage(id)
  if (entry === undefined) {
    writeJson(res, 404, failure('not-found', `索引里没有这张图：${id}`))
    return
  }

  // 升级前的索引条目只有 id/fileName、没有 savedPath。不先判类型的话，下面那句 stat
  // 会以 ERR_INVALID_ARG_TYPE 失败，最后被归成「文件已经不在磁盘上了：undefined」——
  // 道理上没错，但看不出真正的原因。
  if (typeof entry.savedPath !== 'string' || entry.savedPath === '') {
    writeJson(res, 410, failure('no-local-path', `这条记录没有本地路径（升级前的索引条目）：${id}`))
    return
  }

  // 「索引还在、文件没了」是常态化的一种状态（老板清过 out/、或手工删过图）。
  // 必须给人话，而不是把 ENOENT 原样端出去。
  try {
    const info = await stat(entry.savedPath)
    if (!info.isFile()) {
      writeJson(res, 410, failure('not-a-file', `这张图的路径不是文件：${entry.savedPath}`))
      return
    }
  } catch {
    writeJson(res, 410, failure('file-missing', `这张图的文件已经不在磁盘上了：${entry.savedPath}`))
    return
  }

  try {
    const outcome = await openWithDefaultApp(entry.savedPath)
    // 干跑（只给自检用）也要在日志里留下痕迹 —— 否则「日志说已打开、屏幕上什么都没
    // 发生」就成了一个查不出来的怪事。
    hostLog('info', outcome === 'dry-run'
      ? `（干跑）没有真的打开：${entry.savedPath}`
      : `已用系统默认程序打开：${entry.savedPath}`)
    writeJson(res, 200, { ok: true, path: entry.savedPath })
  } catch (error) {
    hostLog('error', `打开失败：${entry.savedPath}`, error)
    writeJson(res, 500, failure('open-failed', `打开失败：${error instanceof Error ? error.message : String(error)}`))
  }
}

/**
 * `GET/PUT /dsh-imagegen/draft` —— 面板草稿。
 *
 * 与 `/config` 分开是刻意的：配置是**用户显式保存**的（还带明文 Key），草稿是
 * 边打字边自动落的。混在一个文件里，一次「保存配置」就可能顺手把草稿区覆盖成
 * 半截状态 —— 而且 Key 与草稿的读写频率、失败容忍度都完全不同。
 *
 * 语义：
 *  - `GET`：回草稿（没有文件时 `draft: null`），另回一次文件路径便于排查；
 *  - `PUT`：收 `{ draft: {...} }`，宽松收敛后原子落盘，回**落盘后**的草稿（含新时间戳）。
 *
 * 落盘失败必须回 500：草稿悄悄丢会让老板以为「我写的还在」，下次进面板发现没了。
 */
async function handleDraft(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }

  if (req.method === 'GET') {
    const draft = await readPanelDraft()
    writeJson(res, 200, { ok: true, draft: draft ?? null, path: draftFilePath() })
    return
  }
  if (req.method !== 'PUT') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const body = await readJsonBody(req, DRAFT_BODY_BYTES)
  if (body === undefined) {
    writeJson(res, 400, badRequestBody())
    return
  }

  try {
    const saved = await writePanelDraft(coercePanelDraft(body.draft))
    writeJson(res, 200, { ok: true, draft: saved, path: draftFilePath() })
  } catch (error) {
    hostLog('warn', '草稿落盘失败：', error)
    writeJson(res, 500, failure('write-failed', `草稿落盘失败：${error instanceof Error ? error.message : String(error)}`))
  }
}

/**
 * `GET /dsh-imagegen/preset` —— 回 prompt-forge 的「文生图优化」模板文本。
 *
 * 只读、不带任何参数：模板名在 `src/forge.ts` 里写死（老板拍板：对生图插件来说
 * 就是固定用这一个）。失败时把「为什么读不到」说清楚 —— 这个按钮依赖另一个插件，
 * 静默失败最难查。
 * @param ctx - 插件上下文（要 `ctx.get('configEditor')`）。
 * @param req - HTTP 请求。
 * @param res - HTTP 响应。
 */
async function handlePreset(ctx: { get(name: string): unknown }, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  /**
   * `?patch=<file.yml>` 覆盖兜底用的 patch 文件；`?patch=none` 表示**不读 patch**
   * （自检要能在一个没有真实 profile 的环境里验「服务读不到」那条路）。
   * 只接受 `.yml` 结尾的路径：这条路由虽然是 loopback-only，也没必要让它能读任意文件。
   */
  const query = new URL(req.url ?? '/', 'http://dsh.invalid')
  const patchParam = query.searchParams.get('patch')
  const patchPaths = patchParam === null
    ? undefined
    : patchParam.trim() === '' || patchParam.trim() === 'none'
      ? []
      : patchParam.trim().endsWith('.yml') ? [patchParam.trim()] : undefined

  // `?debug=1`：把各个配置来源的**结构速写**回出来（只回键名/类型/长度，不回长文本）。
  // 这个按钮依赖另一个插件的配置，真机出问题时最怕「改代码 → 重启 → 再猜」的循环。
  if ((req.url ?? '').includes('debug=1')) {
    const sources = [...collectConfigSources(ctx), ...collectPatchSources(patchPaths ?? defaultPatchPaths())]
    writeJson(res, 200, {
      ok: true,
      debug: sources.length === 0
        ? '一个配置来源都读不到（settings / configEditor / patch 文件都没有）'
        : sources.map((source) => ({ name: source.name, outline: outlineOf(source.value) })),
    })
    return
  }

  const result = findForgePreset(ctx, undefined, patchPaths)
  if (result.kind === 'no-service') {
    writeJson(res, 501, failure('no-config-editor', '宿主没有可读配置的服务（settings / configEditor / patch 文件都没有），读不到 prompt-forge 的模板'))
    return
  }
  if (result.kind === 'no-preset') {
    const tail = result.available.length > 0
      ? `（扫到 ${result.scanned} 处模板配置，现有模板：${result.available.join('、')}）`
      : `（扫到 ${result.scanned} 处模板配置，没有一处带这个模板；加 ?debug=1 可看宿主回了什么结构）`
    writeJson(res, 404, failure('preset-missing', `没找到名为「${FORGE_PRESET_NAME}」的模板${tail}`))
    return
  }

  writeJson(res, 200, {
    ok: true,
    name: result.preset.name,
    system: result.preset.system,
    provider: result.provider,
    model: result.model,
    /** 前端要打的那条路由（prompt-forge 自己的，同源）。 */
    optimizeRoute: '/api/dsh-prompt-forge/optimize',
  })
}

/**
 * `GET /dsh-imagegen/logs` —— 宿主侧日志。
 *
 * 两个用途：
 *  - 面板里的「查看日志」抽屉（默认 JSON：`{ ok, entries, file, dir, count }`）；
 *  - `?format=text` 把整份日志当附件下载下来 —— 要贴给别人看或者存档时最省事。
 *
 * `DELETE` 只清**内存缓冲**：磁盘上那份是排查记录，不该被一次误点抹掉。
 */
async function handleLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }

  if (req.method === 'DELETE') {
    clearLogBuffer()
    hostLog('info', '内存里的日志缓冲已清空（磁盘上的日志文件保留）')
    writeJson(res, 200, { ok: true, cleared: true })
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }

  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const asked = Number(url.searchParams.get('limit') ?? '')
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(400, Math.round(asked)) : 200
  const file = logFilePath()

  if (url.searchParams.get('format') === 'text') {
    const text = logsAsText(limit)
    const fileName = file.split(/[\\/]/u).pop() ?? 'host.log'
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    })
    res.end(text === '' ? '（宿主日志为空：插件加载后还没有写过任何一条）\n' : `${text}\n`)
    return
  }

  writeJson(res, 200, {
    ok: true,
    entries: recentLogs(limit),
    file,
    dir: logDir(),
    count: logCount(),
  })
}

/**
 * 等宿主日志落盘排空。
 *
 * 日志是**异步追加**的（一条日志不该拖慢一次出图），所以「刚写完就去看文件」可能
 * 还看不到最后几条。自检要断言文件内容、将来要做「关闭前冲刷」时都调它。
 * 只用 `export function` 而不是 `export { … } from`：宿主打包器是手写的，
 * 只认本文件里的声明。
 */
export async function flushHostLogs(): Promise<void> {
  await flushLogs()
}

/** `GET /dsh-imagegen/health` —— 自查用。 */
async function handleHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, forbiddenBody())
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, methodBody(req.method))
    return
  }
  const current = await readConfig()
  const index = await readImageIndex()
  const draft = await readPanelDraft()
  writeJson(res, 200, {
    ok: true,
    plugin: name,
    home: imagegenHome(),
    configPath: configFilePath(),
    outDir: imageOutDir(),
    configExists: current.existed,
    hasKey: current.apiKey !== '',
    protocol: current.settings.protocol,
    model: current.settings.model,
    images: index.length,
    logFile: logFilePath(),
    logLines: logCount(),
    // 草稿：真机验收要能确认「落盘的草稿」和面板上看到的一致（重启前后都能查）。
    draftPath: draftFilePath(),
    hasDraft: draft !== undefined,
    draftUpdatedAt: draft?.updatedAt ?? 0,
  })
}

// -------------------------------------------------------------------- 挂载

/**
 * `config` 一个路径要同时吃 GET 与 PUT。
 *
 * `webServer.register` 的键是 (kind, path)，同一个路径只能登记一次 ——
 * 所以按方法分派这件事必须发生在处理器内部，而不是靠挂两条同路径的路由
 * （那会抛「duplicate route」）。
 */
async function handleConfigWriteRead(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'PUT') return handleConfigWrite(req, res)
  return handleConfigRead(req, res)
}

/**
 * 宿主半边的挂载点。
 * @param ctx - 宿主插件上下文；这里只用到 `webServer`。
 */
export function apply(ctx: HostContextLike): void {
  try {
    ctx.inject(['webServer'], (sctx) => {
      // 同一个 try/catch 要放进回调里：依赖已就绪时回调是同步跑的，但 cordis 也
      // 可能在依赖稍后才满足时异步调用它 —— 那时外层的 try 已经退栈了。
      try {
        sctx.effect(() => {
          const disposers: Array<() => void> = []
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.config, handler: handleConfigWriteRead }, 'config')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.models, handler: handleModels }, 'models')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.capabilities, handler: handleCapabilities }, 'capabilities')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.generate, handler: handleGenerate }, 'generate')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.history, handler: handleHistory }, 'history')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.save, handler: handleSave }, 'save')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.open, handler: handleOpen }, 'open')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.preset, handler: (req, res) => handlePreset(sctx, req, res) }, 'preset')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.health, handler: handleHealth }, 'health')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.logs, handler: handleLogs }, 'logs')
          safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.draft, handler: handleDraft }, 'draft')
          safeRegister(disposers, sctx.webServer, { kind: 'prefix', path: API.image, handler: handleImage }, 'image')

          hostLog('info', `已挂载 ${disposers.length} 条路由，数据目录 ${imagegenHome()}，日志目录 ${logDir()}`)

          // 卸载时反序释放（后挂的先撤），与登记顺序对称。
          return () => {
            for (const dispose of disposers.reverse()) {
              try {
                dispose()
              } catch (error) {
                hostLog('warn', '路由卸载失败：', error)
              }
            }
          }
        }, 'dsh-imagegen-panel: routes')
      } catch (error) {
        hostLog('warn', 'webServer 路由挂载失败，面板将提示「宿主路由不可用」：', error)
      }
    })
  } catch (error) {
    hostLog('warn', '无法注入 webServer：', error)
  }
}

/**
 * 导出给 `scripts/host-check.mjs`。
 *
 * 交给 Explorer 的目标怎么编码，是这个功能里唯一「写错了也不报错、只会安静地打开
 * 另一个东西」的部分（逗号、等号、非 ASCII 三个坑），所以它必须能被离线断言。
 */
export { explorerTarget }
