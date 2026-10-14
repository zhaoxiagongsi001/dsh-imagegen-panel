/**
 * 面板草稿（阶段 9）。
 *
 * 位置：`<用户主目录>/.dsh/dsh-imagegen-panel/draft.json`
 *
 * 为什么需要它：面板状态原来只活在模块作用域里 —— 切面板能留住，**重启 DSH 就全没了**。
 * 而「首次进入生图插件时，上次生成成功就给我空的、上次写了没生成就留着」这条规则
 * 需要一个跨重启的判据：既要那份没生成的草稿，也要「最后一次成功生成用的是哪句提示词」。
 * 所以落盘三件事：
 *   1. 草稿本体（提示词 + 核心四项参数 + 模型驱动表单那些额外字段）；
 *   2. `lastGeneratedPrompt` —— 最后一次**成功生成**用的提示词；
 *   3. 更新时间。
 *
 * 判「这份草稿是不是未生成的」**不在这里做**：宿主只负责如实存取，
 * 规则（含空串、前后空白怎么算）集中在前端一处，免得两边各有一套「脏」的定义。
 *
 * 三个刻意的决定：
 *  - **宽松收敛**：磁盘文件可能被手改过，一个坏字段不该让面板起不来 ——
 *    非法值退回默认，整体永远返回一份能直接用的草稿。
 *  - **只存文本，不存参考图**：参考图是几 MB 的 data URL，落盘会让这份小 JSON 变成
 *    一块二进制垃圾场；界面上如实显示「参考图 N 张」就够了。
 *  - **原子写**：临时文件 + rename，避免写到一半断电留下半个 JSON。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { imagegenHome } from './config-store.ts'

/** 草稿文件格式版本，供将来迁移用。 */
export const DRAFT_VERSION = 1

/** 提示词的长度上限（面板输入框自己限 4000，这里放宽到 20000 只为兜住手改的文件）。 */
export const MAX_DRAFT_PROMPT = 20000

/** 单个额外字段取值的长度上限。 */
const MAX_DRAFT_VALUE = 200

/** 额外字段最多记多少个（模型的参数表最多 10 项，32 已经非常宽松）。 */
const MAX_DRAFT_EXTRA = 32

/** 草稿里的核心四项参数（键与前端 `ParamState` 一致，值是字符串）。 */
export interface DraftParams {
  aspectRatio: string
  resolution: string
  count: string
  quality: string
}

/** 一份草稿。 */
export interface PanelDraft {
  version: number
  /** 输入框里的提示词（`''` = 空）。 */
  prompt: string
  /** 参数区的当前取值。 */
  params: DraftParams
  /** 模型驱动表单里那些额外字段。 */
  extra: Record<string, string>
  /** 最后一次**成功生成**用的提示词（用来判断 {@link PanelDraft.prompt} 是不是新草稿）。 */
  lastGeneratedPrompt: string
  /** 服务端写入时间（毫秒）。 */
  updatedAt: number
}

/** 草稿文件的绝对路径。 */
export function draftFilePath(): string {
  return path.join(imagegenHome(), 'draft.json')
}

/** 一份空草稿（还没有任何草稿时用它打底）。 */
export function emptyPanelDraft(): PanelDraft {
  return {
    version: DRAFT_VERSION,
    prompt: '',
    params: { aspectRatio: '', resolution: '', count: '1', quality: '' },
    extra: {},
    lastGeneratedPrompt: '',
    updatedAt: 0,
  }
}

/** 一个可用的字符串（非字符串时给兜底）。提示词这类**只认字符串**：数字没有意义。 */
function draftText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * 一个标量 → 字符串。
 *
 * 参数与额外字段走这条：与宿主侧解析生成请求时的口径一致（数字/布尔一律字符串化），
 * 免得「张数 42」这种数字在草稿里被当成坏值丢掉。
 */
function draftScalar(value: unknown, max: number): string {
  if (typeof value === 'string') return value.slice(0, max)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return ''
}

/**
 * 把任意来源（磁盘文件、PUT body）的字段宽松地收敛成一份草稿。
 * @param raw - 未知来源的对象。
 * @returns 完整的草稿（字段缺失时用空值补齐）。
 */
export function coercePanelDraft(raw: unknown): PanelDraft {
  const base = emptyPanelDraft()
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  const rawParams = (typeof source.params === 'object' && source.params !== null ? source.params : {}) as Record<string, unknown>
  const params: DraftParams = {
    aspectRatio: draftScalar(rawParams.aspectRatio, 64),
    resolution: draftScalar(rawParams.resolution, 64),
    count: draftScalar(rawParams.count, 16) === '' ? base.params.count : draftScalar(rawParams.count, 16),
    quality: draftScalar(rawParams.quality, 64),
  }

  const extra: Record<string, string> = {}
  if (typeof source.extra === 'object' && source.extra !== null) {
    for (const [key, value] of Object.entries(source.extra as Record<string, unknown>)) {
      if (Object.keys(extra).length >= MAX_DRAFT_EXTRA) break
      if (key === '' || key.length > 64) continue
      const text = draftScalar(value, MAX_DRAFT_VALUE)
      if (text === '') continue
      extra[key] = text
    }
  }

  return {
    version: DRAFT_VERSION,
    prompt: draftText(source.prompt, MAX_DRAFT_PROMPT),
    params,
    extra,
    // 上限与提示词一致：它本来就是「上一句提示词」。
    lastGeneratedPrompt: draftText(source.lastGeneratedPrompt, MAX_DRAFT_PROMPT),
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
  }
}

/**
 * 读草稿。
 * @returns 草稿；文件不存在或已损坏时返回 `undefined`（调用方按「还没有草稿」处理）。
 */
export async function readPanelDraft(): Promise<PanelDraft | undefined> {
  let text: string
  try {
    text = await readFile(draftFilePath(), 'utf8')
  } catch {
    return undefined
  }
  try {
    return coercePanelDraft(JSON.parse(text))
  } catch {
    return undefined
  }
}

/**
 * 写草稿（原子写：临时文件 + rename）。
 * @param draft - 要落盘的草稿（`updatedAt` 由这里覆盖成当前时间）。
 * @returns 落盘后的草稿（含新的 `updatedAt`）。
 */
export async function writePanelDraft(draft: PanelDraft): Promise<PanelDraft> {
  const next: PanelDraft = { ...coercePanelDraft(draft), version: DRAFT_VERSION, updatedAt: Date.now() }
  const file = draftFilePath()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return next
}
