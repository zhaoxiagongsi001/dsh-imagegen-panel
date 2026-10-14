/**
 * 宿主路由的 HTTP 小工具。
 *
 * 三个函数，全部照抄 `dsh-prompt-forge/src/index.ts`（同版本、已跑通）的写法 ——
 * 包括那个 loopback 围栏：本插件的路由会读写老板的 API Key，只允许本机浏览器访问。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 一次请求体的大小上限。配置是几十个字段的小 JSON，1 MB 已经非常宽松。 */
export const MAX_BODY_BYTES = 1024 * 1024

/**
 * 一个 JSON 响应。
 *
 * 调用方一律返回 200/4xx/5xx 加上 `{ ok: boolean }` 标记，让前端只读一处语义，
 * 不必在业务代码里散落 HTTP 状态码判断。
 * @param res - 响应对象。
 * @param status - HTTP 状态码。
 * @param body - 可序列化的响应体（**绝不能含明文 Key**）。
 */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

/**
 * 只允许本机浏览器访问。
 *
 * 三条独立判据，任何一条不满足就拒绝：
 *   1. 对端地址必须是环回（`127.0.0.1` / `::1`）；
 *   2. `Host` 头必须解析成环回主机名（挡住 DNS 重绑定）；
 *   3. `Origin` 若存在，必须与 `Host` 同源 —— 别的网页即便能连到本机端口，
 *      也读不到我们的响应。
 * @param req - 请求。
 * @returns 是否放行。
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false

  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') {
    return false
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return false

  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * 读一个 JSON 请求体。
 * @param req - 请求。
 * @param maxBytes - 超过即放弃（默认 {@link MAX_BODY_BYTES}）。
 * @returns 解析出的对象；读不出/超限/不是对象时返回 undefined。
 */
export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) return undefined
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 统一的 403 文案（loopback 围栏拦下时）。 */
export function forbiddenBody(): { ok: false; code: string; message: string } {
  return { ok: false, code: 'forbidden', message: '这些接口只接受本机同源请求' }
}

/** 统一的 405 文案。 */
export function methodBody(method: string | undefined): { ok: false; code: string; message: string } {
  return { ok: false, code: 'method-not-allowed', message: `不支持的方法：${method ?? '未知'}` }
}

/** 统一的 400 文案（请求体读不出来时）。 */
export function badRequestBody(): { ok: false; code: string; message: string } {
  return { ok: false, code: 'bad-request', message: '请求体不是合法 JSON，或超过了大小上限' }
}
