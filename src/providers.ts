/**
 * 协议适配层（阶段 6）。
 *
 * 四种协议各自的**端点、鉴权头、请求体形状、响应形状**都不一样，但面板只认一件事：
 * 「给我一段提示词，还我一张图」。所以这里把差异全部收敛到两个纯函数：
 *
 *   `planGeneration()`  面板参数 → { URL, 请求头, 请求体, 响应形状 }
 *   `parseProviderResponse()`  上游响应 → { 图片, 花费 }
 *
 * | 协议 | 出图端点 | 鉴权 | 响应 |
 * |---|---|---|---|
 * | `openrouter` | `POST {base}/images` | `Authorization: Bearer` | `data[].b64_json` |
 * | `openai` | `POST {base}/images/generations` | `Authorization: Bearer` | `data[].b64_json` |
 * | `gemini` | `POST {base}/models/{model}:generateContent` | `x-goog-api-key` | `candidates[].content.parts[].inlineData` |
 * | `custom` | `POST {base}/images`（原样透传） | `Authorization: Bearer` | `data[].b64_json`（兼容 `images[].b64`） |
 *
 * **能力表只有 OpenRouter 有**（它的 `supported_parameters` 是权威的）。其他协议下
 * `params` 传 undefined，`buildImageRequest` 就退化成「只发核心字段 + 额外参数」——
 * 这是刻意的：没有能力表就不要假装知道模型支持什么。
 */
import { buildImageRequest, joinUrl, normalizeQuality, type GenerateInput, type ParsedGeneration, type SupportedParameters } from './openrouter.ts'

/** 生图协议。 */
export type Protocol = 'openrouter' | 'openai' | 'gemini' | 'custom'

/** 一次生成需要的配置面。 */
export interface ProviderSettings {
  protocol: Protocol
  baseUrl: string
  outputFormat: string
  extraJson: string
  /**
   * 该模型是否有原生流式通道（顶层 `supports_streaming`）。
   *
   * 单独一路的原因：`stream` **不在** `supported_parameters` 里，
   * 光看参数表会把它当成「模型没声明」裁掉 —— 那个开关就永远发不出去。
   * undefined = 未知（不裁剪也不放行，按不支持处理）。
   */
  supportsStreaming?: boolean
}

/** 一次生成的执行计划。 */
export interface GenerationPlan {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: Record<string, unknown>
  /** 响应形状：`openai` = `data[].b64_json`；`gemini` = `candidates[].content.parts[].inlineData`。 */
  shape: 'openai' | 'gemini'
  /** 被裁掉/不支持的字段（如实回报给用户）。 */
  dropped: string[]
  /**
   * 被配置里那段「额外参数」JSON **覆盖掉**的字段名。
   *
   * 与 `dropped` 相反：这些字段发出去了，但值不是面板上显示的那个。
   * 不单独回报的话，「我明明选了 80、实际发了 90」就永远查不出来。
   */
  overridden: string[]
}

/** Bearer 头。 */
function bearer(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${apiKey}` }
}

/** 合并「额外参数」到请求体（不许覆盖 model/prompt）。 */
function mergeExtra(body: Record<string, unknown>, extraJson: string): void {
  if (extraJson.trim() === '') return
  try {
    const parsed: unknown = JSON.parse(extraJson)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === 'model' || key === 'prompt') continue
      body[key] = value
    }
  } catch {
    // 配置写入时已校验过 JSON；这里静默跳过。
  }
}

/**
 * 把面板的比例映射成 OpenAI 的 `size`。
 *
 * OpenAI 只认几个固定尺寸（`1024x1024` / `1536x1024` / `1024x1536` / `auto`），
 * 拿不到对应关系时给 `auto` 让上游自己决定，而不是编一个尺寸发上去。
 * @param aspectRatio - 面板选的比例。
 * @returns OpenAI 的 size 值；空串表示不发这个字段。
 */
export function sizeForOpenAI(aspectRatio: string): string {
  switch (aspectRatio) {
    case '1:1': return '1024x1024'
    case '3:2':
    case '16:9':
    case '4:3':
    case '5:4':
    case '21:9': return '1536x1024'
    case '2:3':
    case '9:16':
    case '3:4':
    case '4:5':
    case '9:21': return '1024x1536'
    default: return 'auto'
  }
}

/** 从 data URL 里取 base64 与媒体类型。 */
function splitDataUrl(value: string): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/su.exec(value)
  if (match === null) return undefined
  const data = match[2]!
  // 参考图一律是 base64（Composer 用 FileReader.readAsDataURL 读的）。
  return { mediaType: match[1]!, data: data.includes(';base64,') ? data.split(';base64,').pop()! : data }
}

/**
 * Gemini 的 `generateContent` 计划。
 *
 * 与另外三种协议差别最大：提示词进 `contents[].parts[].text`，参考图进
 * `parts[].inline_data`，张数走 `generationConfig.candidateCount`。
 * @param input - 本次生成参数。
 * @param settings - 协议与配置。
 * @param apiKey - 明文 Key（只在这里拼进请求头）。
 * @returns 执行计划。
 */
function geminiPlan(input: GenerateInput, settings: ProviderSettings, apiKey: string): GenerationPlan {
  const parts: Record<string, unknown>[] = [{ text: input.prompt }]
  const dropped: string[] = []

  for (const reference of input.references) {
    const split = splitDataUrl(reference)
    if (split === undefined) {
      dropped.push('input_references（不是 data URL，Gemini 只吃 inline_data）')
      continue
    }
    parts.push({ inline_data: { mime_type: split.mediaType, data: split.data } })
  }

  const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] }
  if (input.count > 1) generationConfig.candidateCount = input.count
  // Gemini 没有 resolution / aspect_ratio / quality 这套参数名。
  if (input.aspectRatio !== '') dropped.push('aspect_ratio（Gemini 不支持）')
  if (input.resolution !== '') dropped.push('resolution（Gemini 不支持）')
  if (input.quality.trim() !== '') dropped.push('quality（Gemini 不支持）')

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig,
  }
  mergeExtra(body, settings.extraJson)

  return {
    url: joinUrl(settings.baseUrl, `/models/${input.model}:generateContent`),
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-goog-api-key': apiKey },
    body,
    shape: 'gemini',
    dropped,
    // gemini / openai 这两条路自己组装请求体，没有「面板字段」可被覆盖。
    overridden: [],
  }
}

/** OpenAI 兼容协议的 `images/generations` 计划。 */
function openaiPlan(input: GenerateInput, settings: ProviderSettings, apiKey: string): GenerationPlan {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    response_format: 'b64_json',
  }
  const dropped: string[] = []

  if (input.count > 1) body.n = input.count

  const size = sizeForOpenAI(input.aspectRatio)
  if (size !== '') body.size = size

  const quality = normalizeQuality(input.quality)
  if (quality !== '') body.quality = quality

  if (input.references.length > 0) {
    // OpenAI 的图生图走另一个端点（`/images/edits`，multipart 上传），本阶段不做。
    dropped.push('input_references（OpenAI 图生图走 /images/edits，本版未接）')
  }
  if (input.resolution !== '') dropped.push('resolution（OpenAI 用 size，不用分辨率档位）')

  mergeExtra(body, settings.extraJson)

  return {
    url: joinUrl(settings.baseUrl, '/images/generations'),
    method: 'POST',
    headers: bearer(apiKey),
    body,
    shape: 'openai',
    dropped,
    overridden: [],
  }
}

/**
 * 组装一次生成的执行计划。
 * @param input - 面板参数。
 * @param settings - 协议与配置（Base URL / 输出格式 / 额外参数）。
 * @param apiKey - 明文 Key。
 * @param params - 该模型的 `supported_parameters`（**只有 OpenRouter 有**，其余传 undefined）。
 * @returns 执行计划。
 */
export function planGeneration(
  input: GenerateInput,
  settings: ProviderSettings,
  apiKey: string,
  params: SupportedParameters | undefined,
): GenerationPlan {
  if (settings.protocol === 'gemini') return geminiPlan(input, settings, apiKey)
  if (settings.protocol === 'openai') return openaiPlan(input, settings, apiKey)

  // openrouter 与 custom 共用 `POST {base}/images`：
  // 前者按能力表裁剪字段，后者没有能力表（用户自建网关），就只发核心字段 + 额外参数。
  const built = buildImageRequest(input, {
    params: settings.protocol === 'openrouter' ? params : undefined,
    outputFormat: settings.outputFormat,
    extraJson: settings.extraJson,
    ...settings.supportsStreaming === undefined ? {} : { supportsStreaming: settings.supportsStreaming },
  })
  return {
    url: joinUrl(settings.baseUrl, '/images'),
    method: 'POST',
    headers: bearer(apiKey),
    body: built.body,
    shape: 'openai',
    dropped: built.dropped,
    overridden: built.overridden,
  }
}

/**
 * 解析 Gemini 的 `generateContent` 响应。
 *
 * 兼容 camelCase（`inlineData`，官方 REST 返回这个）与 snake_case（`inline_data`）。
 * @param payload - 上游 JSON。
 * @returns 图片数组（Gemini 不给单价，所以 cost 恒为 undefined）。
 */
export function parseGeminiGeneration(payload: unknown): ParsedGeneration {
  const out: ParsedGeneration = { images: [] }
  if (typeof payload !== 'object' || payload === null) return out
  const source = payload as Record<string, unknown>
  const candidates = Array.isArray(source.candidates) ? source.candidates : []

  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const content = (candidate as Record<string, unknown>).content
    if (typeof content !== 'object' || content === null) continue
    const parts = (content as Record<string, unknown>).parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (typeof part !== 'object' || part === null) continue
      const record = part as Record<string, unknown>
      const inline = record.inlineData ?? record.inline_data
      if (typeof inline !== 'object' || inline === null) continue
      const image = inline as Record<string, unknown>
      const data = typeof image.data === 'string' ? image.data : ''
      if (data === '') continue
      const mediaType = typeof image.mimeType === 'string'
        ? image.mimeType
        : typeof image.mime_type === 'string' ? image.mime_type : 'image/png'
      out.images.push({ b64: data, mediaType })
    }
  }
  return out
}

/**
 * 按形状解析响应。
 * @param shape - 计划里声明的响应形状。
 * @param payload - 上游 JSON。
 * @param parseOpenAI - OpenAI 系（`data[].b64_json`）的解析器。
 * @returns 图片与花费。
 */
export function parseProviderResponse(
  shape: GenerationPlan['shape'],
  payload: unknown,
  parseOpenAI: (payload: unknown) => ParsedGeneration,
): ParsedGeneration {
  return shape === 'gemini' ? parseGeminiGeneration(payload) : parseOpenAI(payload)
}
