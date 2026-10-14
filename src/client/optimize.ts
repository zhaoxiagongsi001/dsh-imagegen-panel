/**
 * 「优化提示词」的浏览器侧实现。
 *
 * 分两步，都不经过我们自己的宿主：
 *  1. `GET /dsh-imagegen/preset` —— 从宿主拿 prompt-forge 的「文生图优化」system 文本；
 *  2. `POST /api/dsh-prompt-forge/optimize` —— **直接打 prompt-forge 自己的路由**，
 *     它是同源 + loopback 围栏的 SSE 接口，跟它自家 UI 走的是同一条路。
 *
 * 为什么不把第 2 步也放到我们宿主：宿主不知道自己的监听端口，绕一圈反而要引入
 * 端口发现；而浏览器本来就在那个 origin 上，还能顺手把流式增量直接渲染出来。
 * 这样 prompt-forge 的渠道、模型、温度全都照旧生效，我们一行 LLM 逻辑都不用抄。
 */
import { apiPath } from './api.ts'

/** 宿主回给我们的模板信息。 */
export interface ForgePresetInfo {
  name: string
  system: string
  provider: string
  model: string
}

/** prompt-forge 的 SSE 帧（只声明我们用得到的字段）。 */
type OptimizeEvent =
  | { type: 'start'; provider?: string; model?: string }
  | { type: 'delta'; text?: string }
  | { type: 'done'; text?: string; aborted?: boolean }
  | { type: 'error'; code?: string; message?: string }

/** 拿模板文本失败时抛这个，`message` 直接可展示。 */
export class OptimizeError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'OptimizeError'
    this.code = code
  }
}

/**
 * 读 prompt-forge 的「文生图优化」模板。
 * @param signal - 取消在飞请求。
 * @returns 模板文本与它当前用的渠道/模型。
 */
export async function fetchForgePreset(signal?: AbortSignal): Promise<ForgePresetInfo> {
  let response: Response
  try {
    response = await fetch(apiPath('dsh-imagegen/preset'), signal === undefined ? {} : { signal })
  } catch (error) {
    throw new OptimizeError(`连不上宿主：${error instanceof Error ? error.message : String(error)}`, 'offline')
  }

  let body: Record<string, unknown>
  try {
    body = await response.json() as Record<string, unknown>
  } catch {
    throw new OptimizeError(`宿主回了非 JSON（HTTP ${response.status}）`, 'bad-shape')
  }

  if (!response.ok) {
    const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`
    throw new OptimizeError(message, typeof body.code === 'string' ? body.code : 'preset-failed')
  }
  const system = typeof body.system === 'string' ? body.system : ''
  if (system.trim() === '') throw new OptimizeError('宿主给的模板文本是空的', 'empty-preset')

  return {
    name: typeof body.name === 'string' ? body.name : '文生图优化',
    system,
    provider: typeof body.provider === 'string' ? body.provider : '',
    model: typeof body.model === 'string' ? body.model : '',
  }
}

/**
 * 追加在模板末尾的输出约束。
 *
 * **为什么必须有它**：老板那个「文生图优化」模板是**推理型**的（163 行、带自检清单），
 * 末尾没有 prompt-forge 内置三个模板都带的 OUTPUT_ONLY 那句。实测（2026-10-10）：
 * 不加这句，模型会回「1. 优化思路… 2. 最终提示词…」两段，直接塞进输入框没法用；
 * 加上之后是干净的一段（169 字，2.6 秒）。
 *
 * 我们**不改他的模板** —— 他在 prompt-forge 自己的界面里可能就想看推理过程 ——
 * 只在这一跳的 system 末尾补一句。
 */
const OUTPUT_ONLY = '只输出改写后的提示词本身。不要解释你做了什么，不要加标题、前言、说明、Markdown 代码块包裹，也不要加「优化后的提示词：」这类标签。'

/**
 * 调 prompt-forge 跑一次优化。
 *
 * SSE 帧格式是 `data: <json>` + 空行分隔（CRLF 也容忍），与它的客户端一致。
 * @param text - 待优化的草稿。
 * @param system - {@link fetchForgePreset} 拿到的模板文本。
 * @param onDelta - 每收到一段增量就回调一次（用来流式写进输入框）。
 * @param signal - 取消在飞请求。
 * @returns 完整结果文本。
 */
export async function optimizePrompt(
  text: string,
  system: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(apiPath('api/dsh-prompt-forge/optimize'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ text, system: `${system}\n\n${OUTPUT_ONLY}` }),
      ...signal === undefined ? {} : { signal },
    })
  } catch (error) {
    if (signal?.aborted === true) throw new OptimizeError('已取消', 'aborted')
    throw new OptimizeError(`连不上 prompt-forge：${error instanceof Error ? error.message : String(error)}`, 'offline')
  }

  if (!response.ok) {
    // 它拒绝时回的是 JSON（loopback 围栏、草稿为空、太长、enabled:false…），把原话带出来。
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json() as Record<string, unknown>
      if (typeof body.message === 'string' && body.message !== '') message = body.message
    } catch {
      // 保持 HTTP 状态码文案。
    }
    throw new OptimizeError(message, `forge-http-${response.status}`)
  }
  if (response.body === null) throw new OptimizeError('prompt-forge 没有返回流', 'no-body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assembled = ''
  let failure: OptimizeError | undefined
  let done = false

  const handleFrame = (payload: string): void => {
    let event: OptimizeEvent
    try {
      event = JSON.parse(payload) as OptimizeEvent
    } catch {
      return
    }
    if (event.type === 'delta' && typeof event.text === 'string') {
      assembled += event.text
      onDelta(event.text)
      return
    }
    if (event.type === 'done') {
      if (typeof event.text === 'string' && event.text !== '') assembled = event.text
      done = true
      return
    }
    if (event.type === 'error') {
      failure = new OptimizeError(event.message ?? 'prompt-forge 报了错', event.code ?? 'forge-error')
    }
  }

  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/u)
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split(/\r?\n/u)) {
        if (line.startsWith('data:')) handleFrame(line.slice(5).trim())
      }
    }
    if (failure !== undefined || done) break
  }

  if (failure !== undefined) throw failure
  if (assembled.trim() === '') throw new OptimizeError('prompt-forge 返回了空结果', 'empty-result')
  return assembled
}
