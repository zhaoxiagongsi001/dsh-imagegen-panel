/**
 * 出图落盘与历史索引（阶段 4）。
 *
 * 目录：`~/.dsh/dsh-imagegen-panel/out/`（图片）+ `index.json`（索引，最新在前）。
 *
 * 两个刻意的决定：
 *  1. **索引与文件分开放**：图片是二进制大块，索引是每次列表都要读的小 JSON。
 *     混在一起会让「打开面板读历史」变成「读一堆图」。
 *  2. **尺寸从字节里量，不猜**：上游只给「1K / 2K」这种档位，不给像素。界面上
 *     `1536 × 864` 这种角标必须是量出来的 —— 按比例估算是编数据，一旦和真图对不上
 *     就是在骗用户。所以这里解析 PNG/JPEG/WebP 的文件头拿真实宽高（约 40 行）。
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { historyIndexPath, imageOutDir } from './config-store.ts'

/** 索引里保留的最大条数（最新的在前）。 */
export const MAX_INDEX_ENTRIES = 200

/**
 * 生成时**面板上**的参数快照。
 *
 * 为什么要把面板值单独存一份（而不是只存实发值）：面板值才是「点这条历史记录时
 * 该把参数区还原成什么样」。实发值里混着配置兜底的 `output_format`、被「额外参数」
 * JSON 覆盖过的同名字段 —— 那是另一件事（见 {@link StoredImage.sentFields}），
 * 拿它回填参数区会让用户看到一个自己从没设过的值。
 *
 * `aspectRatio` / `resolution` 在升级前就有（老条目也有），`quality` / `count` /
 * `extra` 是这次补上的。
 */
export interface StoredParams {
  aspectRatio: string
  resolution: string
  count: number
  quality: string
  /** 模型驱动表单里的其它字段（`background` / `seed` / `output_format` / …），键 = 请求体字段名。 */
  extra: Record<string, string>
}

/** 落盘后的一张图。字段与 `src/client/types.ts` 的 `GeneratedImage` 对齐（多几个宿主内部字段）。 */
export interface StoredImage {
  id: string
  /** 绝对路径（宿主内部用，会下发给前端显示「已自动保存到 …」）。 */
  savedPath: string
  /** 文件名（`out/` 下的相对名）。 */
  fileName: string
  mediaType: string
  bytes: number
  /** 真实像素尺寸串，如 `1536 × 864`；量不出来时为空串。 */
  size: string
  cost?: number
  seconds: number
  prompt: string
  aspectRatio: string
  resolution: string
  model: string
  createdAt: number
  /** 自动另存到工作区目录后的完整路径（`autoSaveDir` 生效时才有）。 */
  autoSavedPath?: string
  /** 生成时面板上的参数（升级前的老条目没有这一项）。 */
  params?: StoredParams
  /**
   * **真正发给上游**的标量字段（键 = 请求体字段名，值已字符串化）。
   *
   * 与 `params` 的差别是刻意的：面板值可能被配置里那段「额外参数」JSON 覆盖，
   * 也可能因为该模型不声明而被裁掉。界面上显示的是这一份 —— 它才是「这张图到底
   * 是用什么参数生出来的」。
   */
  sentFields?: Record<string, string>
  /** 参考图张数（参考图的 data URL 本身不落盘）。 */
  referenceCount?: number
  /** 同一次生成实际落盘的张数（`n > 1` 时大于 1）。 */
  batchCount?: number
}

/** 媒体类型 → 扩展名。 */
function extensionOf(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/svg+xml': return 'svg'
    default: return 'png'
  }
}

/** 模型 id → 文件名里那一段（`google/gemini-3-pro-image` → `gemini-3-pro-image`）。 */
function slugOf(model: string): string {
  const tail = model.split('/').pop() ?? model
  return tail.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 48) || 'image'
}

/** 时间戳 → `2026-10-10_0037`。 */
function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// --------------------------------------------------------- 尺寸（从文件头量）

/** PNG：IHDR 里的宽高（big-endian）。 */
function measurePng(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined
  if (buffer.readUInt32BE(0) !== 0x89504e47) return undefined
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** JPEG：扫到 SOFn 段取宽高。 */
function measureJpeg(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]!
    // 填充字节与无载荷的标记
    if (marker === 0xff) { offset += 1; continue }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue }
    const length = buffer.readUInt16BE(offset + 2)
    const isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

/** WebP：VP8X / VP8L / VP8 三种块各有一套宽高编码。 */
function measureWebp(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 30) return undefined
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return undefined
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16))
    const height = 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16))
    return { width, height }
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  if (chunk === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }
  return undefined
}

/**
 * 从图片字节里量出真实像素尺寸。
 * @param buffer - 文件字节。
 * @returns `1536 × 864`；认不出的格式返回空串（宁可空着，也不要编一个数）。
 */
export function measureSize(buffer: Buffer): string {
  const size = measurePng(buffer) ?? measureJpeg(buffer) ?? measureWebp(buffer)
  if (size === undefined || size.width <= 0 || size.height <= 0) return ''
  return `${size.width} × ${size.height}`
}

// --------------------------------------------------------------- 索引读写

/** 读索引（最新在前）。文件不存在/损坏都返回空数组。 */
export async function readImageIndex(): Promise<StoredImage[]> {
  let text: string
  try {
    text = await readFile(historyIndexPath(), 'utf8')
  } catch {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredImage =>
      typeof item === 'object' && item !== null
      && typeof (item as StoredImage).id === 'string'
      && typeof (item as StoredImage).fileName === 'string')
  } catch {
    return []
  }
}

/** 写索引（原子写：临时文件 + rename）。 */
async function writeImageIndex(entries: StoredImage[]): Promise<void> {
  const file = historyIndexPath()
  const temp = `${file}.tmp`
  await writeFile(temp, `${JSON.stringify(entries.slice(0, MAX_INDEX_ENTRIES), null, 2)}\n`, 'utf8')
  await rename(temp, file)
}

/**
 * 就地更新索引里的一条（用来记 `autoSavedPath` 这类事后才知道的字段）。
 * @param id - 图片 id。
 * @param patch - 要合并进去的字段。
 * @returns 更新后的条目；id 不存在时 undefined。
 */
export async function patchIndexEntry(id: string, patch: Partial<StoredImage>): Promise<StoredImage | undefined> {
  const index = await readImageIndex()
  const at = index.findIndex((entry) => entry.id === id)
  if (at < 0) return undefined
  const next = { ...index[at]!, ...patch }
  index[at] = next
  await writeImageIndex(index)
  return next
}

/** 去掉路径末尾的斜杠（`\` 或 `/`）。 */
function trimTrailingSlash(value: string): string {
  return value.trim().replace(/[\\/]+$/u, '')
}

/**
 * 把已落盘的图再复制一份到指定目录。
 *
 * 两个用途：① 出图后自动另存到工作区目录（A8 的后半句）；
 * ② 面板上「保存」按钮的手动保存。目标目录不存在会自动创建。
 * @param entry - 索引条目。
 * @param directory - 目标目录（不是完整文件路径）。
 * @returns 落地后的完整路径。
 */
export async function copyImageTo(entry: StoredImage, directory: string): Promise<string> {
  const dir = trimTrailingSlash(directory)
  if (dir === '') throw new Error('目标目录为空')

  // 与 out/ 是同一个目录时不必复制 —— 返回原路径，免得把「同一份文件」写成两条记录。
  if (dir.toLowerCase() === trimTrailingSlash(imageOutDir()).toLowerCase()) return entry.savedPath

  const target = `${dir}\\${entry.fileName}`
  await mkdir(dir, { recursive: true })
  await copyFile(entry.savedPath, target)
  return target
}

/** 一次落盘的入参。 */
export interface SaveInput {
  b64: string
  mediaType: string
  model: string
  prompt: string
  aspectRatio: string
  resolution: string
  seconds: number
  cost?: number
  /** 同一次生成的序号，保证同一秒内多张图不重名。 */
  sequence: number
  /** 生成时面板上的参数快照（点历史回填用）。 */
  params?: StoredParams
  /** 实际发给上游的标量字段（界面展示用）。 */
  sentFields?: Record<string, string>
  /** 参考图张数。 */
  referenceCount?: number
  /** 同一次生成实际落盘的张数。 */
  batchCount?: number
}

/**
 * 把一张图写进 `out/` 并更新索引。
 * @param input - 图片与元数据。
 * @returns 索引条目。
 */
export async function saveGeneratedImage(input: SaveInput): Promise<StoredImage> {
  const outDir = imageOutDir()
  await mkdir(outDir, { recursive: true })

  const buffer = Buffer.from(input.b64, 'base64')
  const now = new Date()
  const suffix = input.sequence > 0 ? `_${input.sequence + 1}` : ''
  const fileName = `${stamp(now)}_${slugOf(input.model)}${suffix}.${extensionOf(input.mediaType)}`
  const savedPath = `${outDir}\\${fileName}`
  await writeFile(savedPath, buffer)

  const entry: StoredImage = {
    id: `gen-${now.getTime().toString(36)}-${input.sequence}-${Math.random().toString(36).slice(2, 6)}`,
    savedPath,
    fileName,
    mediaType: input.mediaType,
    bytes: buffer.length,
    size: measureSize(buffer),
    ...input.cost === undefined ? {} : { cost: input.cost },
    seconds: input.seconds,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    model: input.model,
    createdAt: now.getTime(),
    // 参数快照与实发字段：老条目里没有它们，界面按「升级前的记录」降级显示。
    ...input.params === undefined ? {} : { params: input.params },
    ...input.sentFields === undefined ? {} : { sentFields: input.sentFields },
    ...input.referenceCount === undefined ? {} : { referenceCount: input.referenceCount },
    ...input.batchCount === undefined ? {} : { batchCount: input.batchCount },
  }

  const index = await readImageIndex()
  index.unshift(entry)
  await writeImageIndex(index)
  return entry
}

/** 按 id 找一张图。 */
export async function findImage(id: string): Promise<StoredImage | undefined> {
  const index = await readImageIndex()
  return index.find((entry) => entry.id === id)
}

/**
 * 读一张图的字节（给 `GET /image/<id>` 用）。
 * @param entry - 索引条目。
 * @returns 字节；文件已被删掉时返回 undefined。
 */
export async function readImageBytes(entry: StoredImage): Promise<Buffer | undefined> {
  try {
    return await readFile(entry.savedPath)
  } catch {
    return undefined
  }
}

/**
 * 索引条目 → 下发给前端的形状。
 *
 * `imageUrl` 是**相对路径**（不带前导斜杠）：客户端用 `apiPath()` 锚在
 * `document.baseURI` 上解析，反代挂在前缀下也能取到图。
 * @param entry - 索引条目。
 * @returns 前端可直接渲染的对象。
 */
export function toClientImage(entry: StoredImage): Record<string, unknown> {
  return {
    id: entry.id,
    imageUrl: `dsh-imagegen/image/${entry.id}`,
    size: entry.size,
    ...entry.cost === undefined ? {} : { cost: entry.cost },
    seconds: entry.seconds,
    prompt: entry.prompt,
    aspectRatio: entry.aspectRatio,
    resolution: entry.resolution,
    createdAt: entry.createdAt,
    savedPath: entry.savedPath,
    ...entry.autoSavedPath === undefined ? {} : { autoSavedPath: entry.autoSavedPath },
    model: entry.model,
    bytes: entry.bytes,
    // ---- 这次补上的「当时用了什么」：点历史图回填参数、结果行显示模型与参数都要它。
    // 老条目里没有这些键，前端按「升级前的记录」降级（只回填提示词与比例/分辨率）。
    ...entry.params === undefined ? {} : { params: entry.params },
    ...entry.sentFields === undefined ? {} : { sentFields: entry.sentFields },
    ...entry.referenceCount === undefined ? {} : { referenceCount: entry.referenceCount },
    ...entry.batchCount === undefined ? {} : { count: entry.batchCount },
  }
}
