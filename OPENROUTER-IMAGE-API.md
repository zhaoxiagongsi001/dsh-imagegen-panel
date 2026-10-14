# OpenRouter 生图接口 · 权威参考（2026-10-10 实测）

> 核实方法：官方 OpenAPI 规范（`https://openrouter.ai/docs/openapi/openapi.yaml`，1.97 MB）
> + 官方指南页 `docs/guides/overview/multimodal/image-generation`
> + 对 `openrouter.ai/api/v1` 的**真实探测**（模型目录 / 逐 endpoint 定价 / 鉴权与错误形状）。
> 本文只写**验证过**的事实；与旧文档表格冲突处，以 OpenAPI 为准并已标注。

---

## 1. 端点全景（只有 3 个）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/v1/images/models` | **公开** | 59 个生图模型 + `architecture` / `supported_parameters` / `supports_streaming` / `endpoints` 链接。**不含定价** |
| GET | `/api/v1/images/models/{author}/{slug}/endpoints` | **公开** | 每 provider 的**权威**能力 + `pricing` + `allowed_passthrough_parameters` |
| POST | `/api/v1/images` | **要 Key** | 生成 |

**不存在的路径（实测 404，别猜）**：

- `GET /images` → 404（只有 POST）
- `POST /images/generations` → 404 ← **OpenAI 的别名，OpenRouter 没有**。协议选成 `openai` 但 Base URL 填 OpenRouter 会直接 404
- `GET /images/models/openai/gpt-image-1` → 404（**必须带 `/endpoints` 后缀**）

**鉴权实测**：

| 请求 | 结果 |
|---|---|
| `GET /images/models`（无 Key） | 200 |
| `POST /images`（无 Key） | 401 `{"error":{"message":"No cookie auth credentials found","code":401}}` |
| `POST /images`（假 Key） | 401 `{"error":{"message":"User not found.","code":401}}` |

错误体统一是 `{"error":{"message":…,"code":…}}`。规范里 **没有** `HTTP-Referer` / `X-Title`（grep 0 命中），不需要发。

---

## 2. `POST /images` 请求体（OpenAPI `ImageGenerationRequest`）

`required` 只有 **`model` + `prompt`**（`prompt` minLength 1）。其余全是可选。

| 字段 | 类型 | 取值 |
|---|---|---|
| `model` | string | 模型 slug，如 `bytedance-seed/seedream-4.5` |
| `prompt` | string | ≥1 字符 |
| `n` | integer | 1–10（provider 可返回更少；单图 provider 拒绝 `n>1`） |
| `resolution` | string | `512` `768` `1K` `1.5K` `2K` `4K` |
| `aspect_ratio` | string | 26 值：`1:1` `1:2` `1:4` `1:8` `2:1` `2:3` `2.35:1` `3:2` `3:4` `4:1` `4:3` `4:5` `5:2` `5:4` `5:7` `7:5` `8:1` `9:16` `16:9` `9:19.5` `19.5:9` `9:20` `20:9` `9:21` `21:9` `auto` |
| `size` | string | 便捷写法：档位（`"2K"`）或像素（`"2048x2048"`）。**给像素时同时带 `resolution`/`aspect_ratio` 且不匹配 → 400** |
| `quality` | string | `auto` `low` `medium` `high` **`xhigh`** **`max`**（← 官方表格只写了前 4 档，OpenAPI 有 6 档） |
| `output_format` | string | `png` `jpeg` `webp` `svg`（svg 仅矢量化模型；SVG 以 UTF-8 base64 放进 `b64_json`） |
| `background` | string | `auto` `transparent` `opaque`（`transparent` 要求 png/webp） |
| `output_compression` | integer | 0–100（webp/jpeg；png 忽略） |
| `seed` | integer | 有则尽量确定；**不保证**所有 provider 都确定 |
| `stream` | boolean | SSE 部分图。**只有原生支持流式的 provider 真支持（目前 = OpenAI 系）**，其余忽略该标志返回缓冲响应 |
| `input_references` | array | **maxItems 16**；元素 `{"type":"image_url","image_url":{"url":"<URL 或 data URL>"}}` |
| `user` | string | ≤256，终端用户标识；**不会原样发给 provider**（折成哈希） |
| `session_id` | string | ≤256，可观测分组；**永不发给 provider**。也可走 `x-session-id` 头，body 优先 |
| `provider` | object | 路由偏好，见下 |
| `trace` | object | `TraceConfig` |

**`provider` 子字段**：`only[]` / `order[]` / `ignore[]` / `sort`（`price` `throughput` `latency` 或对象）/ `allow_fallbacks` / `options{}`（按 provider slug 传私有参数，只认 `/endpoints` 里的 `allowed_passthrough_parameters`）。

> **slug 带区域后缀**：实测 `google/gemini-3-pro-image` 的 `provider_slug` / `provider_tag` 是
> `google-ai-studio/global`、`google-vertex/global`，而官方示例写的是 `google-ai-studio`。
> 填 `only`/`order` 时**照抄 `/endpoints` 返回的 slug**，官方文档说以 `provider_tag` 为基准。

---

## 3. 响应

```json
{
  "created": 1748372400,
  "data": [ { "b64_json": "<base64>", "media_type": "image/png" } ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 4175, "total_tokens": 4175, "cost": 0.04 }
}
```

- `created` + `data` 必给；`data[].b64_json` 必有；`media_type` **可能缺省**（判不出格式时）。非 PNG 时要靠它拿真实 MIME。
- `usage` 可选，里面可能有 `cost`、`cost_details`、`is_byok`、`completion_tokens_details.image_tokens`。

界面可用的媒体类型：`image/png` `image/jpeg` `image/webp` `image/svg+xml`。

### SSE 事件（`stream: true`）—— 共 4 类，不是 3 类

| `type` | 负载 | 说明 |
|---|---|---|
| `image_generation.partial_image` | `b64_json`、`partial_image_index`（0 起） | 中间预览图 |
| `image_generation.text_chunk` | `text`、`phase`(`content`\|`reasoning`\|`draft`) | **官方指南没写这一类**：文本型产物（如 SVG）的片段 |
| `image_generation.completed` | `b64_json`、`created`、`media_type?`、`usage` | 成图 |
| `error` | `error{message, code?, param?, type?}` | 流中途失败 |

终止符：`data: [DONE]`。

---

## 4. 计费

- **全有或全无**：完成 → 按 endpoint 定价全额计；失败/取消 → **不计费**，返回 `502` 而不是半成品。
- 流式**部分预览图不计费**；流中断 = 失败 = 不计费。
- 客户端断开后上游可能仍渲染完并向 OpenRouter 计费，但客户端只会看到「完整结果」或「错误」两种。

---

## 5. 错误码（`POST /images` 定义全集）

`400` 参数非法 · `401` 缺/错 Key · `402` **余额不足** · `403` 权限不足 · `404` 资源不存在 · `413` 载荷过大 · `429` 限流 · `500` 服务端错 · `502` 上游失败（不计费）

---

## 6. 模型目录口径 —— 最容易踩的坑（实测）

| 取法 | 返回数 | 是否含纯生图模型 |
|---|---|---|
| `GET /models`（无参） | **458** | ❌ **不含** |
| `GET /models?output_modalities=image` | **61** | ✅ |
| `GET /images/models` | **59** | ✅ |

- 实测：`bytedance-seed/seedream-4.5`、`black-forest-labs/flux.2-pro`、`openai/gpt-image-1/2`、`recraft/recraft-v3` 在**无参 `/models` 里全部不出现**（`false`）。
- 无参 `/models` 里能看到的图片输出模型只有 **12** 个 —— 全是 `output_modalities` 含 `text` 的图文双出 chat 模型（如 `google/gemini-2.5-flash-image`）。
- **结论：客户端下载 `/models` 再自己 filter，会漏掉 59 个里的 47 个。** 必须走 `/images/models` 或显式带 `?output_modalities=image`。
- `/images/models`（59）比 `?output_modalities=image`（61）少 2 个：`openrouter/auto`、`openrouter/auto-beta`（定价 `-1`，动态）。用 `/images/models` 就选不到这两个自动路由。

`/images/models` 单条结构（`ImageModelListItem`）：

```json
{ "id": "...", "name": "...", "description": "...", "created": 1692901234,
  "architecture": { "input_modalities": ["text","image"], "output_modalities": ["image"] },
  "supported_parameters": { "resolution": {"type":"enum","values":["1K","2K","4K"]}, "seed": {"type":"boolean"} },
  "supports_streaming": false, "endpoints": "/api/v1/images/models/<id>/endpoints" }
```

`supported_parameters` 是**能力描述符**：`{type:'enum',values:[…]}` / `{type:'range',min,max}` / `{type:'boolean'}`；**key 缺失 = 不支持**。

---

## 7. 定价结构（实测全量扫描 59 个模型）

`pricing` 是**数组**，元素 `{billable, unit, cost_usd, variant?}`。实测取值分布：

| 维度 | 实测出现过的值 |
|---|---|
| `unit` | `token`（54 条）、`image`（58）、`megapixel`（5）、`request`（4） |
| `billable` | `output_image`（76）、`input_image`（28）、`input_text`（9）、`input_reference`（6）、`input_font`（2） |
| `variant` | `1k` `1.5k` `2k` `4k` `768` `high_resolution` `low_1k` `low_2k` `medium_1k` `medium_2k` |

典型样例：

| 模型 | 原始 pricing |
|---|---|
| `bytedance-seed/seedream-4.5` | `output_image / image / $0.04`（另有 `input_image / image / $0`） |
| `qwen/qwen-image-3` | `input_image $0.003/张`；`output_image $0.03/张`（`1k`、`2k` 两档同价） |
| `black-forest-labs/flux.2-pro` | `output_image / **megapixel** / $0.03` |
| `x-ai/grok-imagine-image-2.0` | `input_image $0.01/张`；`output_image`：`low_1k $0.04`、`low_2k $0.06`、`medium_1k $0.06`、`medium_2k $0.08` |
| `openai/gpt-image-2` | `input_image $0.000008/token`、`input_text $0.000005/token`、`output_image $0.00003/token` |
| `sourceful/riverflow-v2-pro` | 含 `input_font $0.03/张` 与 4K 出图 `$0.33/张` |
| `recraft/recraft-v4-styles*`（4 个） | `input_reference / **request** / $0.005` |
| `krea/krea-2-*`（3 个） | `pricing: []` ← 上游未公布定价 |
| `meta/muse-image` | **`endpoints: []`** ← 目录里有，但没有可服务的 endpoint，调用必失败 |

---

## 8. 面板配置建议

| 配置项 | 建议值 | 理由 |
|---|---|---|
| `protocol` | `openrouter` | 唯一有权威能力表的协议 |
| `baseUrl` | `https://openrouter.ai/api/v1` | 端点就挂在 `/images` 下 |
| `outputFormat` | `png` | 但注意：Gemini 系（`gemini-3*-image`）**不声明** `output_format`，会被如实裁掉 |
| `timeoutSec` | 180 起，4K/高质量建议 300 | 官方样例 `gpt-image-2` + `quality:high` + 16:9 实测 **94 s** |
| `extraJson` | `{"provider":{"sort":"price"}}` 为**通用安全值** | `provider` 是路由层字段，对全部模型合法 |

**默认 `extraJson` 与新默认模型不匹配（现存问题）**：`src/client/defaults.ts` 的
`{"background":"opaque","output_compression":90,"provider":{"sort":"price"}}` 里，前两个字段
对 `google/gemini-3-pro-image` 和真机在用的 `google/gemini-nano-banana-2.1` 都**不在**
`supported_parameters` 里（这两款只有 `resolution / aspect_ratio / n / input_references`）。
而 `buildImageRequest()` 的 `extraJson` 是**最后无条件合并**的，不经过能力裁剪 ——
字段会照发，被上游静默忽略。规范原文：*"Ignored for png and by providers without a compression knob"*。
不会 400，但用户以为设上了。

**推荐默认模型**（按「定价直观 + 能力齐全」排）：

| 模型 | 出图价 | 分辨率 | 参考图 | n |
|---|---|---|---|---|
| `qwen/qwen-image-3` | $0.03/张 | 1K / 2K | ≤4 | ≤6 |
| `bytedance-seed/seedream-4.5` | $0.04/张 | 1K / 2K / 4K | ≤14 | ≤10 |
| `black-forest-labs/flux.2-pro` | $0.03/百万像素 | 1:1…21:9 | ≤8 | 1 |
| `recraft/recraft-v4.1` | $0.035/张 | 5 种比例 | ≤1 | ≤6 |

---

## 9. 本轮发现的问题（`src/openrouter.ts`，按影响排序）

### ① `priceFrom()` 把「输入价」当「出图价」显示 —— 10/59 个模型价格错

`perImage` 分支只按 `unit === 'image'` 过滤，**没有把 `billable === 'output_image'` 算进去**，
于是 `input_image` / `input_font` 这类更便宜的行会被当成出图价挑出来（甚至优先于正确的出图价）：

| 模型 | 面板显示 | 实际 |
|---|---|---|
| `x-ai/grok-imagine-image-2.0` | `$0.010/张` | $0.04–$0.08/张（variant 名不匹配 → 退「挑最便宜」→ 抓到 `input_image`） |
| `bytedance-seed/seedream-5-0-pro` | `$0.0030/张` | 抓到 `input_image`，不是出图价 |
| `qwen/qwen-image-3`（未选分辨率时） | `$0.0030/张` | 出图 $0.03/张 |
| `sourceful/riverflow-v2-pro`（未选分辨率时） | `$0.030/张` | 抓到 `input_font`；4K 出图实为 **$0.33/张** |

最小修法：`perImage` 过滤条件加 `entry.billable === 'output_image'`。

### ② `unit: 'megapixel'` 落进 token 分支 → 单位标错（4 个 flux 模型）

`flux.2-pro` / `flux.2-max` / `flux.2-flex` / `flux.2-klein-4b` 的定价是**每百万像素**，
面板显示成 `$0.030/token（出图）`。实际应是 `$0.03/百万像素`（≈ 一张 1024×1024）。

最小修法：token 分支加 `entry.unit === 'token'` 条件；另加 `megapixel` 分支输出 `/百万像素`。

### ③ `variant` 命名带质量前缀 → 匹配不上，误差可达 2 倍

`grok-imagine-image-*` 用 `low_1k` / `medium_2k`，而代码按 `variant.toLowerCase() === resolution.toLowerCase()`
匹配（`1k` / `2k`），永远匹配不上，只能退化成「挑最便宜」。选 2K + medium 时实为 $0.08，报价 $0.04。

### ④ `extraJson` 绕过能力裁剪（见第 8 节）

### ⑤ 其余小缺口

- 4 个模型**算不出价**（`krea-2-*` 上游 `pricing: []`、`meta/muse-image` 无 endpoint）—— 界面会显示空价，建议显式提示「上游未公布定价」而不是留白。
- `parseCapabilities()` 收集的是 `provider_name`（"Google AI Studio"），**没暴露 slug**，用户无法直接照抄填 `provider.only` / `order`；而 slug 带区域后缀（`google-ai-studio/global`），必须由接口给出。
- 目录来自 `/images/models`，因此 `openrouter/auto`、`openrouter/auto-beta` 两个自动路由模型**选不到**（走 `?output_modalities=image` 才有）。
- `stream: true` 目前只有 OpenAI 系真支持；面板即使显示「流式」chip，对 Gemini/Seedream 等也只是被忽略。SSE 的 `text_chunk`（SVG 类）事件尚未处理。

---

# 第二部分：改图（image-to-image）与逐模型参数核对（2026-10-10 二次核实）

## 10. 「改图」在 OpenRouter 上只有一条路

**官方没有独立的编辑端点，也没有独立的编辑文档页**（文档索引里搜不到 image-editing 页面）。
改图 = 生图端点 + `input_references`：

```
POST /api/v1/images
{ "model": "...", "prompt": "改成水彩风格",
  "input_references": [ { "type": "image_url", "image_url": { "url": "<https URL 或 data:image/png;base64,...>" } } ] }
```

| 事实 | 说明 |
|---|---|
| 元素 schema | `ContentPartImage`，`{type:"image_url", image_url:{url}}`，两者都必填（与插件实现一致 ✅） |
| 参考图来源 | **HTTP(S) URL 或 base64 data URL 都行** |
| 全局上限 | `maxItems: 16` |
| **没有**的字段 | `mask`、`negative_prompt`、`strength`、`steps`（顶层）—— **OpenRouter 图像 API 不支持 mask/inpainting 局部重绘**，无对应配置 |
| OpenAI 的 `/images/edits` | OpenRouter 上 **404**，multipart 上传那套在这儿不存在 |
| provider 私有参数 | 只能走 `provider.options[<provider_slug>]`，且必须是该 endpoint `allowed_passthrough_parameters` 里列出的键 |

只传参考图、不写提示词也行（`prompt` 只要求 ≥1 字符，写个 `.` 即可），但官方示例都带指令文本。

### 各模型参考图约束（实测全量）

| 类别 | 模型数 | 说明 |
|---|---|---|
| **参考图必填**（`min ≥ 1`） | **5** | `inclusionai/ming-image-0.1-design-layer`（必须 1 张）、`recraft/recraft-v4-styles` / `-pro` / `-vector` / `-pro-vector`（必须 ≥1，≤10 张） |
| 上限 **< 4**（面板写死 4 张会超发） | **21** | 其中 **15 个只允许 1 张**：`recraft-v3` / `recraft-v4` / `-pro` / `-vector` / `-pro-vector` / `recraft-v4.1` / `-pro` / `-utility` / `-utility-pro` / `-vector` / `-pro-vector`、`krea-2-large` / `-medium` / `-medium-turbo`、`microsoft/mai-image-2.5` / `-2.5-pro`；另 `x-ai/grok-imagine-image-2.0`、`grok-imagine-image-quality`、`google/gemini-2.5-flash-image` 各家 ≤3 |
| 上限 ≥ 4 | 36 | gemini 系 14、OpenAI 系 16、seedream 系 14、qwen 4、flux.2-pro/max/flex 8、tencent 20 等 |
| 完全不支持参考图 | 2 | `recraft/recraft-v4.1-flash`、`meta/muse-image`（后者还 0 endpoint） |

## 11. 网关到底校验什么（实测更正）

`POST /images` 用 **Zod** 校验，**一次报出全部违规字段**，错误体与 401/402 **形状不同**：

```json
{"success":false,"error":{"name":"ZodError","message":"[\n {\n \"origin\":\"string\",\n \"code\":\"too_small\",\n \"minimum\":1,\n \"path\":[\"prompt\"],\n \"message\":\"Too small: expected string to have >=1 characters\"\n },\n …\n]"}}
```

注意：`error.message` **本身是一段 JSON 字符串**，要二次 `JSON.parse` 才能拿到字段级信息；且**没有 `code` 字段**（不像 401 的 `{"error":{"message":…,"code":401}}`）。

实测结论：

| 校验层次 | 是否校验 | 证据（全部带 `n:0` 保险，未出图、未计费） |
|---|---|---|
| 全局枚举 `output_format` / `quality` / `aspect_ratio` / `resolution` | ✅ 校验 | 发 `output_format:"bogus"` → `output_format → invalid_value`；`quality:"ultra"`、`aspect_ratio:"99:1"`、`resolution:"9K"` 同样 |
| 全局范围 `n`（1–10）、`prompt`（≥1 字符） | ✅ 校验 | `n:0` → `too_small`；`n:11` → `too_big`；`prompt:""` → `too_small` |
| **各模型自己的 `supported_parameters` 枚举** | ❌ **不校验** | 给 `recraft/recraft-v4-vector` 发 `output_format:"png"`（该模型只声明 `["svg"]`）、给 `x-ai/grok-imagine-image-2.0` 发 `quality:"xhigh"`（该模型只声明 `["low","medium"]`）→ Zod **只报 `n`，对这两个字段一字未提** |

**推论（重要）**：模型级枚举/上限/必填**不会**被网关拦下，越界值会**透传给上游 provider** ——
要么被静默忽略（拿到非预期的格式或质量），要么上游报错（→ `502`，全额不计费）。
所以「按 `supported_parameters` 裁剪字段」这件事只能由客户端负责。

## 12. 逐模型参数核对结论

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 端点 / 鉴权 / 请求体字段名 | ✅ 正确 | `POST {base}/images` + `Bearer` + `{model,prompt,n,resolution,aspect_ratio,quality,output_format,input_references}` |
| 2 | **键级裁剪**（模型没声明的字段不发） | ✅ 正确 | 59 个模型的 `supported_parameters` 键集合都能被 `supports()` 正确处理；45 个模型不声明 `output_format`、50 个不声明 `quality` → 会被裁掉 |
| 3 | `input_references` 元素形状 | ✅ 与官方 `ContentPartImage` 一致 | `{type:'image_url', image_url:{url}}` |
| 4 | `n` 上限 | ✅ 正确 | `rangeValues(spec, 10)` 用 `Math.min(cap, spec.max)` → 逐模型取到真实上限（1/4/6/10），切模型时 `snapParams` 会把越界值收敛到第一个候选 |
| 5 | `quality` / `aspect_ratio` / `resolution` / `count` 值级收敛 | ✅ 正确 | `snapParams()`（`ImageGenPanel.tsx` L59）在能力回来时按模型候选值收敛 |
| 6 | **`output_format` 值级收敛** | ❌ **缺失** | `snapParams` 只处理 `aspectRatio/resolution/count/quality` 四项；`output_format` 来自宿主配置（`PanelConfig.outputFormat`），**不参与收敛**，只要模型声明了该键就原样发送 → **7 个模型收到不在其枚举内的值**：6 个向量模型只收 `svg`（`recraft-v4-vector`、`-pro-vector`、`-styles-vector`、`-styles-pro-vector`、`recraft-v4.1-vector`、`-pro-vector`），`sourceful/riverflow-v2.5-fast` 只收 `jpeg` |
| 7 | **`output_format` 可选项** | ❌ **选不出 `svg`** | `src/client/types.ts` L33 限定 `'png' \| 'jpeg' \| 'webp'` → 6 个向量模型在面板里**根本无法正确使用** |
| 8 | **参考图数量上限** | ❌ 写死 4 张 | `Composer.tsx` L16 `MAX_REFERENCES = 4`；实测 **21 个模型上限 < 4**（15 个只允许 1 张）→ 会超发 |
| 9 | **参考图「必填」** | ❌ 未处理 | 5 个模型 `input_references.min ≥ 1`；`supportsReferences()` 只看 `max > 0`，把它们当普通图生图 → 不给参考图就是非法请求 |
| 10 | **`size` 参数** | ❌ 从不发送 | `tencent/hy-image-v3.5-preview` 声明 `size`；`inclusionai/ming-image-0.1-design` / `-design-layer` **只有 `size`、没有 `resolution`** → 这两个模型在面板里没有任何尺寸控制（分辨率下拉为空） |
| 11 | **`meta/muse-image`** | ❌ 不该出现在模型表里 | 目录中有它，但 `/endpoints` 返回 **`endpoints: []`** → 选中必失败，应在列表阶段过滤掉 |
| 12 | **provider.options 的 key** | ❌ 未暴露 slug | 见第 13 节 |
| 13 | 400 错误展示 | ⚠️ 原始 JSON 直出 | `describeUpstreamError()` 把 ZodError 的 `message` 当普通字符串展示 → 用户在界面上看到的是一坨转义 JSON；且 400 没有 `code` 字段，与 401/402 不是同一形状 |
| 14 | 参考图体积 | ⚠️ 无压缩无上限 | `readAsDataUrl()` 是裸的 `FileReader.readAsDataURL`，不缩放不压缩；4 张大图（如 10 MB 各一张）→ base64 后请求体可达数十 MB，撞 `413 Payload Too Large` |
| 15 | `stream` | ✅ 安全（未发送） | 面板没有下发 `stream`；若将来加，注意只有 OpenAI 系真支持 |

## 13. `provider.options` 的 key = provider **slug**，且同族不同（实测）

官方文档示例写的是 `provider.options["black-forest-labs"]` —— 那只对 `flux.2-pro` 成立。实测：

| 模型 | `provider.options` 必须用的 key | 可透传参数 |
|---|---|---|
| `black-forest-labs/flux.2-pro` | `black-forest-labs` | steps, guidance, safety_tolerance |
| `black-forest-labs/flux.2-max` / `flux.2-flex` | **`black-forest-labs/us-3`** | steps, guidance, safety_tolerance |
| `black-forest-labs/flux-3-image` | `black-forest-labs` | safety_tolerance |
| `google/gemini-nano-banana-2.1` | `google-ai-studio` | cachedContent |
| `google/gemini-3.1-flash-image` | `google-ai-studio` | cachedContent |
| `google/gemini-3-pro-image` | **`google-ai-studio/global`** | cachedContent |
| `google/gemini-3-pro-image-preview` | **`google-ai-studio/global/flex`** | cachedContent |
| `google/gemini-2.5-flash-image` / `gemini-3.1-flash-lite-image` | `google-vertex/global` | cachedContent |
| `openai/*`（8 个） | `openai` | moderation |
| `recraft/recraft-v4-styles*` | `recraft` | style_id, style_match, controls, random_seed |
| `recraft/*`（其余 12 个） | `recraft` | style, controls, text_layout |
| `krea/krea-2-*` | `krea` | image_style_references, moodboards, styles, creativity, intensity, complexity, movement, strength |
| `sourceful/riverflow-v2*` | `sourceful` | font_inputs |
| `microsoft/mai-image-2.6*` | `azure` | web_grounding |

共 45/59 个模型有可透传参数。**key 带区域/variant 后缀且同族不一致**，必须按 `/endpoints`
返回的 `provider_slug`（官方口径是 `provider_tag`）动态取；面板 `parseCapabilities()` 目前
只收集了参数**名**（`passthrough`），没带 slug，用户无法照抄拼出 `provider.options`。

## 14. `POST /images` 的 `provider` 路由字段（合法值）

`{ "only": [...], "order": [...], "ignore": [...], "sort": "price" | "throughput" | "latency" | {…}, "allow_fallbacks": bool, "options": { "<slug>": {…} } }`

实测（2026-10-11 复核）**4 个模型是多 endpoint**：54 个只有 1 个 endpoint，1 个（`meta/muse-image`）是 0 个。

| 模型 | 两个 endpoint | 能力是否相同 |
|---|---|---|
| `google/gemini-3-pro-image` | `google-ai-studio/global` + `google-vertex/global` | ❌ **不同**（唯一一处） |
| `google/gemini-3.1-flash-image` | `google-ai-studio` + `google-vertex/global` | ✅ 相同 |
| `google/gemini-3.1-flash-lite-image` | `google-vertex/global` + `google-ai-studio` | ✅ 相同 |
| `google/gemini-3-pro-image-preview` | `google-ai-studio/global/flex` + `google-ai-studio/global` | ✅ 相同（同 provider 两变体） |

只有 `google/gemini-3-pro-image` 的**两个 endpoint 能力不同**：

| provider | resolution | aspect_ratio | n | input_references |
|---|---|---|---|---|
| `google-ai-studio/global` | 1K / 2K / **4K**（3 值） | 10 种 | 1 | 0–14 |
| `google-vertex/global` | 1K / 2K（2 值） | 10 种 | 1 | 0–14 |

模型级把两者**取并集**（`unionSpec`）→ 面板会显示 `4K` 可选；但如果路由落到 Vertex，`4K` 就超出该 endpoint 的枚举（网关不校验 → 透传上游）。这是 59 个模型里唯一一处「模型级 ≠ endpoint 级」。

> 旧版本这里写的是「只有 1 个模型是多 provider」—— 那是 2026-10-10 只看了 `providers.length` 的唯一性得出的结论，本次逐模型数了 `endpoints.length` 才纠正过来。**其余 3 个多 endpoint 模型的并集与交集都和单 endpoint 一致，所以对参数行没有影响。**

---

# 第三部分：修复与验证（2026-10-10 晚）

## 15. 第 9 节那些问题的处置

| # | 问题 | 处置 | 落点 |
|---|---|---|---|
| 1 | `output_format` 值级越界（7 个模型） | ✅ **两级防线**：客户端提示 + 宿主按枚举裁剪（不在枚举里就不发，如实记入 `dropped`） | `openrouter.ts` `buildImageRequest()`、`ConfigModal.tsx`、`Composer.tsx` |
| 2 | 下拉里没有 `svg` | ✅ 补上（`png/jpeg/webp/svg`） | `config-store.ts`、`types.ts`、`ConfigModal.tsx` |
| 3 | 参考图上限写死 4 张 | ✅ 改为按模型 `input_references.max`；面板槽位、计数、历史右键的 `atLimit` 全部跟随；宿主侧再截断一次（超出部分不发并回报） | `Composer.tsx` `referenceLimit()`、`ImageGenPanel.tsx`、`openrouter.ts` |
| 4 | 参考图「必填」未处理 | ✅ `min ≥ 1` 的模型：参考图槽显示「必填 · 至少 N 张」、生成按钮禁用并说明原因，宿主侧另有兜底 | `Composer.tsx` `referencesRequired()`、`ImageGenPanel.tsx` |
| 5 | `size` 参数从不发送 | ⬜ **未改**（`ming-image-*` 目前在面板里没有尺寸控制；它们的 `size` 只是 `{type:'boolean'}`，没有取值语义可依） | — |
| 6 | `meta/muse-image` 混在列表里 | ✅ 新增**可用性探测**：拉目录后并发（6 路、单条 8s、失败即放行）逐个探 `/endpoints`，`endpoints: []` 的剔掉；结果跟目录一起缓存 10 分钟。可用 `DSH_IMAGEGEN_SKIP_AVAILABILITY=1` 关掉 | `openrouter.ts` `dropUnservedModels()` |
| 7 | `provider.options` 的 slug 没暴露 | ✅ `/capabilities` 返回 `providerOptions[{slug,name,params}]`；配置弹层按接口返回的 slug 列出可透传参数，并给「复制模板」按钮（值留 `null`，不编推荐值） | `openrouter.ts` `parseCapabilities()`、`ConfigModal.tsx` |
| 8 | 400 的 ZodError 是一坨转义 JSON | ✅ 二次解析并翻成人话（`prompt 必须 ≥ 1` / `n 必须 ≤ 10`…）；解不开就退回原文，绝不吞信息 | `openrouter.ts` `describeUpstreamError()` |
| 附 | `input_references: {min:0,max:0}` 被当成「没限制」 | ✅ 归零处理（实测 `ming-image-0.1-design` 是这种形状）—— **这条是写全模型扫描时才发现的新问题** | `openrouter.ts` |

## 16. 验证结果（2026-10-10 18:0x）

| 关卡 | 范围 | 结果 |
|---|---|---|
| `host-check.mjs` | 离线 / 假上游 / 真路由 | **329/329**（原 295，新增 34 条） |
| `render-check.mjs` | 离线 / 浏览器半边渲染 | **114/114**（原 98，新增 16 条） |
| `upstream-check.mjs` | **真上游**公开接口，不花钱 | **44/44**（原 32） |
| `live-check.mjs` | 真机（需重启 DSH 加载新构建） | ⏳ 待重启后跑 |

`upstream-check` 第 4 节是本轮新增的**全模型参数正确性扫描**：拿面板出厂默认（16:9 / 1K / 3 张 / 中文「高」/ `output_format=png` / 4 张参考图）跑全部 **59 个真实模型**，逐个核对
「发出去的每个字段都在该模型自己声明的枚举 / 区间内」——实测 **0 越界**；
同时确认「没有这层防护会有 **7 个模型**收到它们不认的 `output_format`」，证明这条防护不是摆设。

第 5 节拿真上游验可用性探测：**59 → 58**，被剔掉的恰好是 `meta/muse-image`（再单独拉一次它的 `/endpoints` 确认是 `[]`），
耗时 **3.0 s**（生产环境带 10 分钟缓存）；关掉开关后回到 59，证明差额确实是探测造成的。

---

# 第四部分：逐模型参数配置表与「按模型变形」的参数行（2026-10-11）

## 16. 全部模型只用到 10 个参数键

2026-10-10 对 `/images/models` 与逐个 `/endpoints` 做全量扫描：`supported_parameters` 里
**一共只出现过 10 个键**。

| 字段 | 声明该字段的模型数 / 59 | 描述符形状（实测出现的全部） |
|---|---:|---|
| `input_references` | 57 | `range`，12 种区间（`0..0` 到 `0..20`，另有 `1..1`、`1..10`） |
| `aspect_ratio` | 56 | `enum`，13 种组合（4 值 ~ 18 值） |
| `n` | 55 | `range`，4 种（`1..1` / `1..4` / `1..6` / `1..10`） |
| `resolution` | 23 | `enum`，7 种组合（只到 `1K` 的 5 个、到 `4K` 的若干） |
| `output_format` | 14 | `enum`，5 种组合（`svg` 单值 7 个、`png\|jpeg` 5 个、`png\|jpeg\|webp` 3 个…） |
| `seed` | 14 | **`boolean`** |
| `background` | 10 | `enum`，2 种（`auto\|transparent\|opaque` 9 个、`auto\|opaque` 3 个） |
| `quality` | 9 | `enum`，3 种（4 档 7 个、6 档 2 个、`low\|medium` 2 个） |
| `output_compression` | 8 | `range(0..100)` |
| `size` | 3 | **`boolean`** |

**没有第 11 个键。** 上游增加新键时，`upstream-check.mjs` 第 6 节会失败并点名 ——
那是个信号，应当往 `src/openrouter.ts` 的 `FIELD_SPECS` 里补一条规格。

### 最容易搞错的一条：`boolean` 描述符 ≠ 布尔值

官方口径写得很清楚：`boolean`（"Supported (present) or unsupported (absent)"）只表示
**这个字段被支持**，而**不是**它的值是布尔。实测这 10 个键里只有两个用 `boolean`：

| 字段 | 描述符 | 真实值类型 | 面板控件 |
|---|---|---|---|
| `seed` | `{type:'boolean'}` | **整数** | 数字输入，**默认留空**（填死会让每次出图都一样） |
| `size` | `{type:'boolean'}` | **字符串**（`"2K"` 或 `"2048x2048"`） | 自由文本 + 形状校验 |

把这两个按布尔渲染是很容易犯的错 —— 界面上会出现一个「种子 ☑」开关，而它该是个输入框。

### `stream` 不在这 10 个键里

`stream` 由模型/endpoint **顶层的 `supports_streaming`** 表达（实测 8/59 支持，全是 OpenAI 系）。
所以宿主侧要单独传一路 `supportsStreaming`，否则 `stream` 会被「模型没声明」这条规矩裁掉，
那个开关就永远发不出去。`pipeline` 里已经修掉这个坑，`host-check` 有断言。

## 17. 字段规格表（`FIELD_SPECS`）：描述符只给值域，控件与值类型要自己定

`supported_parameters` 给的是**取值来源**（枚举值 / 区间 / 是否支持），不给「该用什么控件」。
所以 `src/openrouter.ts` 里有一张本地规格表，与上游描述符合并后才成为界面参数表：

| 字段 | 中文标签 | 控件 | 值类型 | 分组 | 可留空 | 默认 | 关键约束 |
|---|---|---|---|---|---|---|---|
| `aspect_ratio` | 比例 | 下拉 | string | 输出 | 否 | `1:1` | 候选值只来自该模型的枚举（有的没有 `auto`） |
| `resolution` | 分辨率 | 下拉 | string | 输出 | 否 | `1K` | 同上；36/59 个模型不声明这个字段 |
| `size` | 尺寸 | 文本 | string | 输出 | **是** | 空 | **形状校验**：`^(512\|768\|1K\|1.5K\|2K\|4K\|\d{2,5}x\d{2,5})$` |
| `n` | 张数 | 张数 | integer | 输出 | 否 | `1` | 区间来自该模型；`1..1` 的模型只能出 1 张 |
| `quality` | 质量 | 下拉 | string | 输出 | 否 | `auto` | 每个模型只收自己那几档（有的只有 `low\|medium`） |
| `output_format` | 输出格式 | 下拉 | string | 输出 | 否 | `png` | 矢量模型只收 `svg`、`riverflow-v2.5-fast` 只收 `jpeg` |
| `background` | 背景 | 下拉 | string | 输出 | 否 | `auto` | `transparent` **要求**输出格式是 `png`/`webp`（字段间约束，界面上会拦） |
| `output_compression` | 压缩 | 数字 | integer | 高级 | **是** | 空 | `range(0..100)`；**下限是 0**，不能套用张数那套把下限硬提到 1 |
| `seed` | 随机种子 | 数字 | integer | 高级 | **是** | 空 | 描述符是 `boolean`（没有值域）→ 不编上下限 |
| `stream` | 流式预览 | 开关 | boolean | 高级 | 否 | 关 | 只有 `supports_streaming` 时才出现；**只在开的时候发**（`false` 与缺省等价） |

不在表里、也没有上游声明的字段：面板**不显示、也绝不发送**。

## 18. 图生图（`input_references`）专项

官方口径与实测都在第二部分，这里只记**本轮新发现的三条**。

### 18.1 模型声明 20 张，网关只收 16 张 —— 实测确认的真实冲突

| 来源 | 说的上限 |
|---|---|
| `tencent/hy-image-v3.5-preview` 的 `input_references` | `{min:0, max:20}` |
| 官方 OpenAPI `ImageGenerationRequest.input_references` | **`maxItems: 16`** |

模型级枚举**网关不校验**（越界值透传 provider），但全局 `maxItems` **是校验的**
（400 ZodError；全有或全无计费 —— 不给钱，但白等一次）。

所以真正能发的张数是 `min(模型声明, 16)`。已落地三处：
- 宿主 `referencesFrom()` 一律按 `GLOBAL_MAX_REFERENCES = 16` 收敛；
- `/capabilities` 额外回一个 `referencesDeclaredMax`（原始声明值），界面据此解释差额；
- 客户端 `referenceLimit()` 再收敛一次（纵深防御）。

界面上的文案：`可多张 · 图生图（0/16）· 2.1 MB/20.0 MB（该模型声明 20 张，接口全局上限 16 张）`。

### 18.2 体积的第一道墙在**本地**，不在上游

宿主 `/generate` 的请求体上限是 **32 MB**（`src/index.ts` 的 `GENERATE_BODY_BYTES`）。
超了只会回一句「请求体不是合法 JSON，或超过了大小上限」—— 那句提示会把人引去查 JSON，
而真实原因是图片太大。而**单张上限卡不住总量**：4 MB × 16 张 = 64 MB，照样超。

已落地：
- 客户端 `prepareReference()` 按需下采样：长边 ≤ 2048、单张 ≤ 4 MB；
- 总量预算 `MAX_REFERENCES_TOTAL_CHARS = 20 M 字符`（≈20 MB，留足 JSON 与 base64 的 4/3 膨胀）；
  添加时会按「剩余预算」压缩，装不下就明确拒绝并说明理由，**不再静默 return**；
- 处理过的图在角标上标「已缩小」，说明写进 `title`（不能让用户以为发的是原图）；
- 缩图任何一步失败都**原样返回原图** —— 宁可让上游报错，也不能丢用户的图；
- `/generate` 的 400 文案现在直接点名「多半是参考图太大」。

### 18.3 参考图区间的完整分布（可服务模型 58 个）

| 类别 | 数量 | 说明 |
|---|---:|---|
| 必填底图（`min ≥ 1`） | **5** | `ming-image-0.1-design-layer`（1..1）、`recraft-v4-styles` 四兄弟（1..10） |
| 上限 = 1 张 | **17** | 多给一张就超界 |
| 完全不支持 | **2** | `recraft/recraft-v4.1-flash`（根本不声明该键）、`inclusionai/ming-image-0.1-design`（显式 `0..0`） |
| 上限 > 4 | 31 | |
| 声明上限最大 | 20 | `tencent/hy-image-v3.5-preview`（实际收 16） |

> 「不声明该键」与「显式声明 `0..0`」在上游是两件事，但对面板是同一个结论：**不支持参考图**。
> 两种形状都要当 0 处理（`inclusionai/ming-image-0.1-design` 就是显式 `0..0` 那种）。

## 19. 逐模型参数配置表（交付物）

| 文件 | 内容 | 生成方式 |
|---|---|---|
| `PARAM-MATRIX.md` | 原始矩阵：字段频次、图生图全表、**逐模型 11 列完整参数表**（含流式列）、无通道模型、逐模型 `provider.options` | `node scripts/param-matrix.mjs`（**自动生成，勿手改**） |
| `stage-param-matrix/matrix.json` | 同上的机器可读版（含 `references` / `referencesEffective` / `supportsStreaming` / `providerOptions`） | 同上 |
| `PARAM-TABLE.md` | 给人看的《逐模型参数配置表》：字段规格总表 12 行、按参数分组的取值差异、图生图专章、异常模型单列 | 手工撰写（数据全部可追溯到 matrix.json） |

## 20. 本轮验证结果（2026-10-11）

| 关卡 | 范围 | 结果 |
|---|---|---|
| `host-check.mjs` | 离线 / 假上游 / 真路由 | **413/413**（原 358，新增 55） |
| `render-check.mjs` | 离线 / 浏览器半边渲染 | **170/170**（原 133，新增 37） |
| `upstream-check.mjs` | **真上游**公开接口，不花钱 | **53/53**（原 44，新增 9） |
| `live-check.mjs` | 真机（重启后） | 第一次重启后 **50/50**；新增第 7/8 节（真机参数表 + `extra` 通路端到端）待第二次重启 |

新增断言的重点：

- `extra` 通路端到端：面板收集的每个字段都真的出现在最终请求体里；
- `seed` 按**整数**发、`stream` 按**布尔**发、`output_compression=0` 不被改成 1；
- 没声明的字段、越界的枚举值、`size` 形状不对的字符串 —— 一律不发且如实回报；
- 请求体 `extra` 里的白名单：塞不进 `provider`，也改不掉 `model` / `prompt`；
- 声明 20 张的模型只发 16 张；`/capabilities` 同时回声明值与收敛值；
- 参数表逐字段与上游描述符一致（真上游 59 个模型全量核对，0 不一致）；
- 被「额外参数」覆盖的字段如实回报（见 20.1）。

### 20.1 真机验收发现的第 8 个问题：「额外参数」会静默盖掉面板上看得见的字段

**这一类问题只有跑真机才能发现** —— 离线自检全绿、真机 50/50 全过，都没覆盖到它。

| 事实 | 说明 |
|---|---|
| `extraJson`（配置弹层的「额外参数」）在 `buildImageRequest()` 里**最后无条件合并** | 优先级最高，这是原设计（用户显式写的优先），本轮**不动** |
| 本机默认配置写着 `output_compression: 90`、`background: "opaque"` | 这两个字段**原来没有界面** —— 那时这么写没问题 |
| 现在它们有了界面（8 个模型声明 `output_compression`、10 个声明 `background`） | 结果：**面板上选 80，实际发 90** |

这正是本次改造要消灭的「以为设上了」，只是换了个来源。修法是**让覆盖可见**，而不是改优先级：

- 宿主：`buildImageRequest()` 返回 `overridden[]`；`/generate` 的诊断行、宿主日志、成功响应各带一份；
- 客户端：`ImageGenPanel` 解析 `config.extraJson`，在**生成之前**就在参数区警示
  「『连接配置 → 额外参数』里写死了 压缩、背景，它会覆盖面板上选的值」。

> **给后来者**：凡是「配置级 + 请求级」两层同名的设计，都必须有一条「谁覆盖了谁」的回报。
> 给某个字段加界面时，要回头查配置里有没有同名残留 —— 否则用户看到的是控件，发出去的是另一个值。

