/**
 * 宿主侧日志：进程内环形缓冲 + 按天落盘。
 *
 * 为什么需要它：插件跑在 DSH 宿主的**主进程**里，`console.log` 的去处是那个进程的
 * stdout —— 从桌面版 GUI 启动时根本没有人接这根管子。实测（2026-10-10）：
 *
 *  - `%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 存在但是**空的**；
 *  - 全盘没有任何近期 `.log` 文件在增长；
 *  - DSH 侧也没有叫「控制台」的界面（侧栏只有会话/终端，那里看不到宿主进程的 stdout）。
 *
 * 所以旧文案「宿主侧日志在 DSH 控制台」等于让老板去一个不存在的地方找东西。这里把
 * 日志变成两处**能真看到**的东西：面板里的抽屉（读内存缓冲）和磁盘上的文件。
 *
 * 三条纪律：
 *   1. **绝不抛错**。日志本身失败不能让一次出图失败，落盘失败只降级成 console.error。
 *   2. **绝不写明文 Key**。所有文本过一遍 {@link redactSecrets}。
 *   3. **有界**。缓冲 400 条、单条 8 KB，参考图的 data URL 由调用方先摘要再传进来。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { imagegenHome } from './config-store.ts'

/** 日志级别。只分三档：够用来区分「正常」「可疑」「失败」。 */
export type LogLevel = 'info' | 'warn' | 'error'

/** 一条日志（前端抽屉与 `/logs` 路由都回这个形状）。 */
export interface LogEntry {
  /** 进程内递增序号，用于前端判断「有没有新条目」。 */
  seq: number
  /** 本地时间 `2026-10-10 18:42:03`。 */
  at: string
  level: LogLevel
  text: string
}

/** 与 `src/index.ts` 同一个前缀，避免日志里出现两种标识。 */
const LOG = '[dsh-imagegen-panel]'

/** 缓冲上限：一次出图最多写几条，400 条足够覆盖好几轮排查。 */
const MAX_ENTRIES = 400

/** 单条上限：上游返回体可能很长，截断后再进缓冲，避免一份日志吃掉几十 MB。 */
const MAX_TEXT = 8000

/** 环形缓冲（越靠后越新）。 */
const buffer: LogEntry[] = []

/** 递增序号。 */
let seq = 0

/** 落盘链：把并发的 append 串成一条，避免同一文件交叉写。 */
let writeChain: Promise<void> = Promise.resolve()

/** 落盘失败只提示一次（目录被清理时不该刷屏）。 */
let fileFailureReported = false

/**
 * 两位补零。
 *
 * 名字带 `log` 前缀不是啰嗦：`scripts/build.mjs` 把宿主侧的每个模块**拼进同一个
 * 作用域**，顶层重名会直接构建失败（实测 `stamp` / `pad` 与 `image-store.ts` 撞过）。
 */
function logPad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-10-10 18:42:03`（本地时间，老板在 GMT+8，日志要能直接对表）。 */
function logStamp(date: Date): string {
  return `${date.getFullYear()}-${logPad(date.getMonth() + 1)}-${logPad(date.getDate())} `
    + `${logPad(date.getHours())}:${logPad(date.getMinutes())}:${logPad(date.getSeconds())}`
}

/** 日期文件名（按本地时区分天）。 */
function logDateKey(date: Date): string {
  return `${date.getFullYear()}-${logPad(date.getMonth() + 1)}-${logPad(date.getDate())}`
}

/** 日志目录：`~/.dsh/dsh-imagegen-panel/logs/`。 */
export function logDir(): string {
  return path.join(imagegenHome(), 'logs')
}

/**
 * 今天的日志文件绝对路径。
 * @param date - 默认当前时间（测试里可注入）。
 * @returns 绝对路径。
 */
export function logFilePath(date: Date = new Date()): string {
  return path.join(logDir(), `host-${logDateKey(date)}.log`)
}

/**
 * 抹掉文本里的密钥。
 *
 * 调用方本来就不该把 Key 传进来，这里是**最后一道网**：日志会被复制粘贴到别处，
 * 一次疏忽的代价比一句正则大得多。
 * @param text - 原始文本。
 * @returns 掩码后的文本。
 */
export function redactSecrets(text: string): string {
  return text
    // `sk-or-v1-…` / `sk-…`：保留前 6 位便于辨认是哪一把，其余抹掉。
    .replace(/\b(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]{6,}/gu, '$1***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/giu, '$1***')
}

/** 把任意附加信息变成一句可读文本。 */
function describe(extra: unknown): string {
  if (extra === undefined) return ''
  if (extra instanceof Error) {
    const stack = typeof extra.stack === 'string' ? extra.stack.split('\n').slice(0, 3).join(' | ') : ''
    return stack === '' ? extra.message : `${extra.message}（${stack}）`
  }
  if (typeof extra === 'string') return extra
  try {
    return JSON.stringify(extra)
  } catch {
    return String(extra)
  }
}

/**
 * 写一条宿主日志。
 *
 * 三处同时写：内存缓冲（面板抽屉读它）、磁盘文件（关了面板也能查）、
 * 以及原来的 `console`（从终端跑 `dsh` 时行为与改动前一致）。
 * @param level - 级别。
 * @param message - 主文本。
 * @param extra - 附加信息（Error / 对象 / 字符串），会自动展开成一行。
 * @returns 刚写入的那条（`at` 已带时间）。
 */
export function hostLog(level: LogLevel, message: string, extra?: unknown): LogEntry {
  const tail = describe(extra)
  const raw = tail === '' ? message : `${message} ${tail}`
  const text = redactSecrets(raw).slice(0, MAX_TEXT)
  const now = new Date()
  const entry: LogEntry = { seq: ++seq, at: logStamp(now), level, text }

  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)

  // 镜像到 console：终端起 dsh 时仍能实时看到（行为与改造前一致）。
  if (level === 'error') console.error(`[dsh-imagegen-panel] ${text}`)
  else if (level === 'warn') console.warn(`[dsh-imagegen-panel] ${text}`)
  else console.log(`[dsh-imagegen-panel] ${text}`)

  // 落盘：串行追加，失败只报不抛 —— 日志写不进去不该让出图失败。
  const line = `${entry.at} [${level}] ${text}\n`
  const file = logFilePath(now)
  writeChain = writeChain
    .then(async () => {
      await mkdir(logDir(), { recursive: true })
      await appendFile(file, line, 'utf8')
    })
    .catch((error: unknown) => {
      // 数据目录被整体删掉（自检收尾、用户清理）时静默跳过：那已经不是「日志写不进去」，
      // 而是「这份日志本来就没有存在的必要」，报出来只会淹没真正的错误。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      // 其余失败只报一行、只报一次：重复刷栈会把真正的错误淹掉。
      if (!fileFailureReported) {
        fileFailureReported = true
        console.error(`${LOG} 日志落盘失败（${file}）：${error instanceof Error ? error.message : String(error)}`)
      }
    })

  return entry
}

/**
 * 等落盘链排空。
 *
 * 两个用途：自检要断言「文件里真的有内容」；进程退出前也可以调一次，
 * 免得最后几条日志还在异步队列里就没了。
 */
export async function flushLogs(): Promise<void> {
  await writeChain
}

/**
 * 读最近若干条。
 * @param limit - 取最后 N 条（默认 200，上限 {@link MAX_ENTRIES}）。
 * @returns 新的在前。
 */
export function recentLogs(limit = 200): LogEntry[] {
  const size = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)))
  return buffer.slice(-size).reverse()
}

/**
 * 把日志导成纯文本（「下载日志」用）。
 * @param limit - 取最后 N 条。
 * @returns 每行一条，时间正序。
 */
export function logsAsText(limit = MAX_ENTRIES): string {
  const size = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)))
  return buffer.slice(-size).map((entry) => `${entry.at} [${entry.level}] ${entry.text}`).join('\n')
}

/** 缓冲里的条数（health 路由自检用）。 */
export function logCount(): number {
  return buffer.length
}

/** 只清内存缓冲（磁盘文件保留 —— 那是排查记录，不该被一次点击抹掉）。 */
export function clearLogBuffer(): void {
  buffer.length = 0
}
