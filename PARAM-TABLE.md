# 逐模型参数配置表（人读版）

> **数据快照**：`stage-param-matrix/matrix.json` —— 探测于 **2026-10-11T00:52:30Z**，源 `https://openrouter.ai/api/v1`（公开只读接口，无需 Key，未花一分钱）
> **规模**：目录 **59** 个模型 · 有可服务通道 **58** 个（`meta/muse-image` 的 `/endpoints` 返回 `[]`，选中必失败）
> **官方口径**：<https://openrouter.ai/docs/guides/overview/multimodal/image-generation>（正文要抓 `.md` 后缀那份，页面本身是 JS 渲染的）
> **同族文档**：机器可读原始表 `PARAM-MATRIX.md`（脚本生成，**勿手改**）· 端点/鉴权/错误码/定价细节 `OPENROUTER-IMAGE-API.md`
> 本表每个数字都能在 `matrix.json` 里用 `ConvertFrom-Json` 复算出来。

> ✅ **面板侧已改造完并跑过全量自检**（2026-10-11）：模型驱动参数行与 `extra` 通路已端到端接通，
> `host-check` **406/406**、`render-check` **166/166**、`upstream-check`（真上游，59 个模型全量核对）**53/53**。
> 数据层结论（`matrix.json` + 官方文档）与实现结论此时一致；再往后改动以代码为准。

**先记住三句话：**

1. `POST /images` 的 `required` 只有 **`model` + `prompt`**，其余全是可选。
2. 网关**只**校验全局 schema（`output_format` 只要是 png/jpeg/webp/svg 就放行、`quality` 只要是全局 6 档就放行），**不看**每个模型自己的枚举 / 上限 / 必填 —— 越界值会原样透传给 provider，被**静默忽略**或换回一次 **502**（502 不计费）。所以「按本表裁剪」是**客户端自己的责任**。
3. `supported_parameters` 里 **key 缺失 = 该模型不支持这个字段**。发过去不是被忽略，就是换回一次错误。

---

## 1. 字段规格总表

12 行 = **10 个模型级参数键** + `stream` + 全局项（`provider.*` / `user` / `session_id` / `trace`）。

| 字段 | 官方类型 | 描述符形状（实测） | 取值语义 | 建议展示 | 面板控件形态 | 注意事项 |
|---|---|---|---|---|---|---|
| `input_references` | array | `range(min..max)`，**12 种组合**（57/59 声明） | 参考图数组；元素 `{"type":"image_url","image_url":{"url":"…"}}`，https URL 与 base64 data URL 都收 | ✅ 必展示（图生图唯一入口） | **不是一行下拉**：参考图槽 + 张数计数 + 上限/必填提示 | `min ≥ 1` 的 5 个模型**必填**；上限从 0 到 20 不等；**没有** `mask` / `negative_prompt` / `strength` → 不支持局部重绘 |
| `aspect_ratio` | string | `enum(…)`，**13 种组合**（56/59） | 归一化比例串；`auto` = 让 provider 自己选 | ✅（该模型声明了才显示） | 下拉「比例」 | 不是人人都有 `auto`；全局有 26 个值，但**每个模型只收自己那几档** |
| `n` | integer | `range(1..max)`，**4 种区间**（55/59） | 张数**上限**；provider 可以返回比 n 更少 | ✅ | 下拉「张数」 | krea 三兄弟**不声明** `n` → 不能选张数；27 个模型是 `1..1`（只能出 1 张） |
| `resolution` | string | `enum(…)`，**7 种组合**（23/59） | 归一化档位 `512` / `768` / `1K` / `1.5K` / `2K` / `4K`；具体像素由 provider 换算 | ✅（有才显示） | 下拉「分辨率」 | **35/58 个可服务模型没有这个字段**；ming 两兄弟连它带比例都没有（见 §4.1） |
| `output_format` | string | `enum(…)`，**5 种组合**（14/59） | `png` / `jpeg` / `webp` / `svg`（`svg` 仅矢量化模型） | ✅ | 每模型下拉（模型驱动表单，候选值就是该模型的枚举）；配置弹层的「输出格式」退为默认值 | 6 个向量模型**只收** `svg`；`riverflow-v2.5-fast` **只收** `jpeg`；不声明 = 用 provider 默认；宿主侧 `input.extra` 里的 `output_format` **优先于**配置值（`openrouter.ts` `buildImageRequest()`） |
| `seed` | **integer** | `{type:"boolean"}`（14 个模型全是这一种） | 整数随机种子；「尽量」复现，**不保证** | ✅（高级） | 数字输入框（boolean 无值域 → 前端**不编**上下限） | ⚠️ **`boolean` 描述符 ≠ 布尔值**；默认留空 = 每次随机，填死会让每次出图都一样 |
| `background` | string | `enum(…)`，**2 种组合**（10/59） | `auto` / `transparent` / `opaque` | ✅（仅这 10 个） | 下拉（模型驱动表单，候选值 = 该模型枚举） | `transparent` 要求输出格式是 `png`/`webp`，否则被忽略；10 个里有 2 个**还不支持** `transparent` |
| `quality` | string | `enum(…)`，**3 种组合**（9/59） | 全局 6 档 `auto` / `low` / `medium` / `high` / `xhigh` / `max`；**模型只收自己声明的** | ✅ | 下拉「质量」 | `grok-imagine-image-2.0` 只有 `low`/`medium`；官方指南表格只写了 4 档，OpenAPI 里有 6 档 |
| `output_compression` | integer | `range(0..100)`（8 个模型完全同形） | 0–100；仅 `jpeg`/`webp` 生效，`png` 忽略 | ✅（高级） | 数字输入框（模型驱动表单；描述符是 `range` 时按区间收敛） | 8/59 且**全是 OpenAI 系**；留空 = 用上游默认 |
| `size` | **string** | `{type:"boolean"}`（3 个模型） | 档位 `"2K"` 或像素 `"2048x2048"`；**给像素时它是权威值** | ✅（该模型声明了才显示） | 文本框（描述符不是 enum → **没有候选值可给**，只能手填） | ⚠️ **`boolean` 描述符 ≠ 布尔值**；同时给不匹配的 `resolution`/`aspect_ratio` → **400**；因为描述符不是 enum，**任何非空字符串都会被放行**（客户端做不了值级校验） |
| `stream` | boolean | **不在 `supported_parameters` 内** —— 由模型 / endpoint 顶层的 `supports_streaming` 单独表达 | `true` = SSE 流式返回部分图 | 按 `supports_streaming` 展示（本次实测 **8/59**，全是 OpenAI 系） | 开关（`parameters` 里带 `stream` 时才出现；只在「开」时发 `true`） | 它是**全局合法字段**：不支持的模型会忽略它并返回缓冲响应，**不会 400** |
| `provider.*` / `user` / `session_id` / `trace`（以及必填的 `model` / `prompt`） | object / string[] / string / boolean 等 | **不在 `supported_parameters` 内** —— 对**任何**模型都合法 | 路由偏好（`only` / `order` / `ignore` / `sort` / `allow_fallbacks` / `options`）、终端用户标识、观测分组、追踪 | 建议只暴露 `provider.sort` 与 `provider.options[slug]` | 配置的「额外参数」JSON 文本框 + 逐模型 provider 模板（见 §5） | ⚠️「额外参数」在 `buildImageRequest()` 里是**最后无条件合并**的，会**绕过**键级与值级裁剪；而请求体里的 `extra` 走 `EXTRA_FIELDS` 白名单（= 10 个模型级键 + `stream`，见 `index.ts`），**`provider` / `user` / `session_id` / `trace` 塞不进去** —— 想传路由参数只能走这条 JSON |

### ⚠️ 最容易搞错的一条：`boolean` 描述符 ≠ 布尔值

官方对 `{type:"boolean"}` 的定义原文是「**Supported (present) or unsupported (absent)**」—— 它只回答「**这个字段被不被支持**」，**不描述值的类型**。

| 字段 | 描述符 | 真实值类型 | 真实取值 | 依据 |
|---|---|---|---|---|
| `seed` | `{type:"boolean"}` | **integer** | 任意整数 | 官方 Request Parameters 表：`seed` = integer，Seed for deterministic generation |
| `size` | `{type:"boolean"}` | **string** | `"2K"` 或 `"2048x2048"` | 官方 Request Parameters 表：`size` = string，便捷写法，档位或显式像素 |

**推论：**

- 看到 `boolean` 就发 `true` / `false` 是错的。
- 「`boolean` 没有候选值，所以做不了控件」也过于保守：值类型去官方参数表查，控件形态（下拉 / 数字框 / 文本框）由本地字段规格补。
- 在 59 个模型的 `supported_parameters` 里，**`boolean` 描述符只出现在 `seed`(14) 与 `size`(3) 两个键上** —— 其余 8 个键全部是 `enum` 或 `range`。
---

## 2. 各模型取值差异（按参数分组）

数据全部来自 `matrix.json` 的 `rows[].params`（模型级 = 各 endpoint 的**并集**）。表内 `|` 已转义为 `\|`。

### 2.1 `aspect_ratio` —— 56 个模型，13 种组合

| 该模型接受的比例（白名单） | 个数 | 代表模型 |
|---|---:|---|
| `auto` `1:1` `4:3` `3:4` `16:9` `9:16` | 12 | `recraft/recraft-v3`、`recraft/recraft-v4.1`（recraft 全系 12 个） |
| `auto` `1:1` `4:3` `3:4` `3:2` `2:3` `16:9` `9:16` `21:9` | 8 | `black-forest-labs/flux.2-pro`、`sourceful/riverflow-v2-pro` |
| `1:1` `1:4` `1:8` `2:3` `3:2` `3:4` `4:1` `4:3` `4:5` `5:4` `8:1` `9:16` `16:9` `21:9`（14 值，**无 auto**） | 4 | `google/gemini-nano-banana-2.1`、`google/gemini-3.1-flash-image` |
| `auto` `1:1` `3:2` `2:3` `4:3` `3:4` `16:9` `9:16` `21:9` | 4 | `openai/gpt-image-2`、`openai/gpt-5.4-image-2` |
| `auto` `1:1` `4:3` `3:4` `16:9` `9:16` `3:2` `2:3` | 4 | `microsoft/mai-image-2.5`、`microsoft/mai-image-2.6` |
| `auto` `1:1` `1:2` `2:1` `2:3` `3:2` `3:4` `4:3` `4:5` `5:4` `9:16` `16:9` `9:19.5` `19.5:9` `9:20` `20:9` `9:21` `21:9`（18 值） | 4 | `bytedance-seed/seedream-4.5`、`bytedance-seed/seedream-5-0-pro` |
| `auto` `1:1` `2:1` `1:2` `3:2` `2:3` `4:3` `3:4` `5:4` `4:5` `16:9` `9:16` | 4 | `recraft/recraft-v4-styles`（styles 四兄弟） |
| `auto` `1:1` `3:2` `2:3`（最窄的 4 个） | 4 | `openai/gpt-image-1`、`openai/gpt-5-image` |
| `1:1` `2:3` `3:2` `3:4` `4:3` `4:5` `5:4` `9:16` `16:9` `21:9` | 3 | `google/gemini-3-pro-image`、`google/gemini-2.5-flash-image` |
| `1:1` `4:3` `3:2` `16:9` `4:5` `2:3` `9:16` | 3 | `krea/krea-2-large`（krea 三兄弟） |
| `1:1` `1:2` `1:4` `2:1` `2:3` `3:2` `3:4` `4:1` `4:3` `4:5` `5:4` `9:16` `16:9` | 3 | `qwen/qwen-image-3`、`tencent/hy-image-v3.5-preview` |
| `auto` `1:1` `3:4` `4:3` `9:16` `16:9` `2:3` `3:2` `9:19.5` `19.5:9` `9:20` `20:9` `1:2` `2:1` | 2 | `x-ai/grok-imagine-image-2.0`、`x-ai/grok-imagine-image-quality` |
| `auto` `21:9` `2:1` `16:9` `3:2` `7:5` `4:3` `5:4` `1:1` `4:5` `3:4` `5:7` `2:3` `9:16` `1:2` `9:21`（16 值，**唯一含 7:5 / 5:7**） | 1 | `black-forest-labs/flux-3-image` |

合计 12+8+4+4+4+4+4+4+3+3+3+2+1 = **56** ✓（另 2 个模型没有该字段：`inclusionai/ming-image-0.1-design`、`-design-layer`）

### 2.2 `resolution` —— 23 个模型，7 种组合

| 该模型接受的档位 | 个数 | 代表模型 |
|---|---:|---|
| `1K` `2K` `4K` | 7 | `google/gemini-nano-banana-2.1`、`bytedance-seed/seedream-4.5` |
| `1K` `2K` | 7 | `qwen/qwen-image-3`、`x-ai/grok-imagine-image-2.0` |
| `1K`（只有一档） | 4 | `krea/krea-2-large`（三兄弟）、`google/gemini-3.1-flash-lite-image` |
| `512` `1K` `2K` `4K` | 2 | `google/gemini-3.1-flash-image`、`google/gemini-3.1-flash-image-preview` |
| `768` `1K` `1.5K` `2K` `4K` | 1 | `black-forest-labs/flux-3-image` |
| `1K` `1.5K` `2K` `4K` | 1 | `tencent/hy-image-v3.5-preview` |
| `2K` `4K`（**没有 1K**） | 1 | `bytedance-seed/seedream-5-0-lite` |

合计 7+7+4+2+1+1+1 = **23** ✓（35 个可服务模型没有该字段）

### 2.3 `n` —— 55 个模型，4 种区间

| 区间 | 个数 | 含义 / 代表模型 |
|---|---:|---|
| `1..1` | 27 | **只能出 1 张**：`google/gemini-nano-banana-2.1`、`black-forest-labs/flux.2-pro` |
| `1..6` | 18 | `recraft/recraft-v3`、`qwen/qwen-image-3` |
| `1..10` | 9 | `openai/gpt-image-1`、`bytedance-seed/seedream-4.5` |
| `1..4` | 1 | `bytedance-seed/seedream-5-0-lite` |
| **不声明** | 4 | `krea/krea-2-large` / `-medium` / `-medium-turbo`（可服务）+ `meta/muse-image`（无通道） |

### 2.4 `output_format` —— 14 个模型，5 种组合

| 该模型接受的格式 | 个数 | 代表模型 |
|---|---:|---|
| `svg`（**只收 svg**） | 6 | `recraft/recraft-v4-vector`、`recraft/recraft-v4.1-pro-vector`、`recraft/recraft-v4-styles-vector` 等 6 个向量模型 |
| `png` `jpeg` | 4 | `black-forest-labs/flux.2-pro` / `-max` / `-flex` / `-klein-4b` |
| `png` `jpeg` `webp` | 2 | `inclusionai/ming-image-0.1-design`、`sourceful/riverflow-v2.5-pro` |
| `jpeg`（**只收 jpeg**） | 1 | `sourceful/riverflow-v2.5-fast` |
| `png` `webp`（**没有 jpeg**） | 1 | `inclusionai/ming-image-0.1-design-layer` |

### 2.5 `quality` —— 9 个模型，3 种组合

| 该模型接受的质量档 | 个数 | 代表模型 |
|---|---:|---|
| `auto` `low` `medium` `high` | 6 | `openai/gpt-image-1`、`openai/gpt-image-2`、`openai/gpt-5-image` |
| `auto` `low` `medium` `high` `xhigh` `max` | 2 | `openai/gpt-image-2.5-sunburst`、`openai/gpt-image-2.5-flare` |
| `low` `medium`（**没有 auto/high**） | 1 | `x-ai/grok-imagine-image-2.0` |

### 2.6 `background` —— 10 个模型，2 种组合

| 该模型接受的背景值 | 个数 | 代表模型 |
|---|---:|---|
| `auto` `transparent` `opaque` | 8 | `openai/gpt-image-1`、`openai/gpt-5-image`、`sourceful/riverflow-v2.5-pro` |
| `auto` `opaque`（**不支持 transparent**） | 2 | `openai/gpt-image-2`、`openai/gpt-5.4-image-2` |

→ 全站只有这 10 个模型能设背景，其中能真正出**透明背景**的是 8 个；另外 `transparent` 还要求输出格式是 `png`/`webp`（官方口径）。

### 2.7 `output_compression` —— 8 个模型，全同形

`range(0..100)`，8 个模型：`openai/gpt-image-1`、`-mini`、`gpt-image-2`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-5.4-image-2`、`gpt-5-image`、`gpt-5-image-mini` —— **全是 OpenAI 系**。

### 2.8 `seed` —— 14 个模型，全同形 `{type:"boolean"}`

`tencent/hy-image-v3.5-preview`、`bytedance-seed/seedream-4.5`、`seedream-5-0-flash` / `-lite` / `-pro`、`qwen/qwen-image-3` / `-pro`、`krea/krea-2-large` / `-medium` / `-medium-turbo`、`black-forest-labs/flux.2-pro` / `-max` / `-flex` / `-klein-4b`。

### 2.9 `size` —— 3 个模型，全同形 `{type:"boolean"}`

`tencent/hy-image-v3.5-preview`、`inclusionai/ming-image-0.1-design`、`inclusionai/ming-image-0.1-design-layer`。

→ 只有 `tencent` 同时有 `resolution` + `aspect_ratio` + `size`（三条路都能走，且**不能混用**：给像素 `size` 时再给不匹配的 `resolution`/`aspect_ratio` 就是 400）；ming 两个模型**只有 `size`**（见 §4.1）。
---

## 3. 图生图（`input_references`）专章

### 3.1 只有一条路：`POST /images` + `input_references`

OpenRouter **没有独立的改图端点**，也没有独立的编辑文档页。图生图就是给生图端点多带一个数组：

```json
{
  "model": "openai/gpt-image-1",
  "prompt": "make this scene look like a watercolor painting",
  "input_references": [
    { "type": "image_url", "image_url": { "url": "https://example.com/photo.jpg" } }
  ]
}
```

| 事实 | 说明 |
|---|---|
| 元素形状 | `{"type":"image_url","image_url":{"url":"…"}}`，两个键都必填 |
| URL 形式 | **https URL 与 base64 data URL 都支持**（官方原文：Reference images can be HTTP(S) URLs or base64 data URLs） |
| 全局上限 | OpenAPI 写 `maxItems: 16` |
| **不存在的字段** | `mask`、`negative_prompt`、`strength`、顶层 `steps` —— **OpenRouter 图像 API 不支持局部重绘 / inpainting**，也没有强度、负向提示词这类旋钮。面板不要做这些控件 |
| OpenAI 的 `/images/edits` | 在 OpenRouter 上是 **404**；multipart 上传那一套在这里不存在 |
| 张数与提示词 | 只传参考图、`prompt` 写一个 `.` 也能过（`prompt` 只要求 ≥1 字符），但官方示例都带指令文本 |

### 3.2 额度总览（58 个可服务模型的实测分布）

| 类别 | 模型数 | 说明 |
|---|---:|---|
| **必填底图**（`min ≥ 1`） | **5** | 不给参考图 = **非法请求**，面板必须自己拦住 |
| 支持图生图（`max ≥ 1`） | **56** | 占 58 个可服务模型的 97% |
| 上限 **= 1 张** | **17** | 多给一张就超界（其中 1 个同时还是必填） |
| 完全不支持参考图（`max = 0`） | **2** | 参考图槽应禁用 |
| 上限 **> 4** | **31** | 旧版面板写死 4 张的写法会误伤另外 27 个 |
| 上限最大值 | **20** | `tencent/hy-image-v3.5-preview` |
| 区间种类 | **12** | 见 §3.6 |

### 3.3 必填底图的 5 个模型（不给就 502）

| 模型 | 区间 | 说明 |
|---|---|---|
| `inclusionai/ming-image-0.1-design-layer` | `1..1` | **恰好 1 张**，多一张少一张都不行 |
| `recraft/recraft-v4-styles` | `1..10` | 至少 1 张（改图专用） |
| `recraft/recraft-v4-styles-pro` | `1..10` | 至少 1 张 |
| `recraft/recraft-v4-styles-vector` | `1..10` | 至少 1 张 |
| `recraft/recraft-v4-styles-pro-vector` | `1..10` | 至少 1 张 |

→ 面板行为：参考图槽显示「必填 · 至少 N 张」、生成按钮禁用并说明原因，宿主侧再兜一层。

### 3.4 上限 = 1 张的 17 个模型

`0..1` 这 16 个：

`microsoft/mai-image-2.5`、`microsoft/mai-image-2.5-pro`、`krea/krea-2-large`、`krea/krea-2-medium`、`krea/krea-2-medium-turbo`、`recraft/recraft-v3`、`recraft/recraft-v4`、`recraft/recraft-v4-pro`、`recraft/recraft-v4-vector`、`recraft/recraft-v4-pro-vector`、`recraft/recraft-v4.1`、`recraft/recraft-v4.1-pro`、`recraft/recraft-v4.1-utility`、`recraft/recraft-v4.1-utility-pro`、`recraft/recraft-v4.1-vector`、`recraft/recraft-v4.1-pro-vector`

`1..1` 这 1 个：

`inclusionai/ming-image-0.1-design-layer`（**同时是必填**，即唯一额度被钉死的模型）

→ 16+1 = **17**。这 17 个里 recraft 占 12 个、krea 占 3 个。

### 3.5 完全不支持参考图的 2 个模型（语义其实不同）

| 模型 | 实际情况 | 语义 |
|---|---|---|
| `inclusionai/ming-image-0.1-design` | **显式声明** `range(0..0)` | 「我明确不收参考图」 |
| `recraft/recraft-v4.1-flash` | **根本不声明** `input_references` 键（整个模型只有 `aspect_ratio` + `n`，是 58 个里参数最少的） | 「我没有这个能力」 |

两者在 `matrix.json` 里都表现为 `0..0`（脚本对「未声明」也回落到 `{min:0,max:0}`），面板表现一致：禁用参考图槽。但**排查时要分清** —— 前者上游确实回了这个键，后者是脚本补的默认值。

### 3.6 12 种区间全表

| 区间 | 模型数 | 代表模型 | 备注 |
|---|---:|---|---|
| `0..1` | 16 | `recraft/recraft-v4-pro`、`krea/krea-2-large` | 多给一张就超界 |
| `0..14` | 10 | `google/gemini-nano-banana-2.1`、`bytedance-seed/seedream-4.5` | gemini / seedream 主力档 |
| `0..16` | 8 | `openai/gpt-image-1`、`openai/gpt-image-2` | 与官方全局 `maxItems: 16` 一致 |
| `0..4` | 5 | `qwen/qwen-image-3`、`black-forest-labs/flux.2-klein-4b` | 写死 4 张刚好卡住 |
| `1..10` | 4 | `recraft/recraft-v4-styles` 四兄弟 | **必填** ≥1 |
| `0..8` | 3 | `black-forest-labs/flux.2-pro` / `-max` / `-flex` | |
| `0..10` | 3 | `black-forest-labs/flux-3-image`、`sourceful/riverflow-v2.5-pro` / `v2-pro` | |
| `0..3` | 3 | `x-ai/grok-imagine-image-2.0`、`-quality`、`google/gemini-2.5-flash-image` | **上限 3**，不是 4 |
| `0..0` | 2 | `inclusionai/ming-image-0.1-design`、`recraft/recraft-v4.1-flash` | 见 §3.5 |
| `0..5` | 2 | `microsoft/mai-image-2.6`、`-2.6-flash` | |
| `1..1` | 1 | `inclusionai/ming-image-0.1-design-layer` | **必填**，恰好 1 张 |
| `0..20` | 1 | `tencent/hy-image-v3.5-preview` | ⚠️ 见下方冲突 |

合计 16+10+8+5+4+3+3+3+2+2+1+1 = **58** ✓

> ⚠️ **一处未解的矛盾**：`tencent/hy-image-v3.5-preview` 声明的上限是 **20**，而官方 OpenAPI 给 `input_references` 写的是 `maxItems: 16`。两者哪个为准**未核实**（没敢真发 20 张去撞）。面板侧已按保守做法落地：`Composer.tsx` 的 `GLOBAL_MAX_REFERENCES = 16`，`referenceLimit()` 返回 `min(模型声明的 max, 16)`。

### 3.7 上限 > 4 的 31 个模型（按区间）

| 区间 | 模型数 | 模型 |
|---|---:|---|
| `0..20` | 1 | `tencent/hy-image-v3.5-preview` |
| `0..16` | 8 | `openai/gpt-image-1`、`-mini`、`gpt-image-2`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-5.4-image-2`、`gpt-5-image`、`gpt-5-image-mini` |
| `0..14` | 10 | `google/gemini-nano-banana-2.1`、`google/gemini-3.1-flash-lite-image`、`google/gemini-3.1-flash-image`、`-preview`、`google/gemini-3-pro-image`、`-preview`、`bytedance-seed/seedream-4.5`、`seedream-5-0-flash`、`-lite`、`-pro` |
| `0..10` | 3 | `black-forest-labs/flux-3-image`、`sourceful/riverflow-v2.5-pro`、`sourceful/riverflow-v2-pro` |
| `1..10` | 4 | `recraft/recraft-v4-styles`、`-pro`、`-vector`、`-pro-vector` |
| `0..8` | 3 | `black-forest-labs/flux.2-pro`、`-max`、`-flex` |
| `0..5` | 2 | `microsoft/mai-image-2.6`、`-2.6-flash` |

合计 1+8+10+3+4+3+2 = **31** ✓

### 3.8 体积与 `413` 风险（这条比张数更容易踩）

| 环节 | 实测 / 代码事实 |
|---|---|
| 浏览器读图 | **已做下采样 + 总量预算**（`Composer.tsx` `prepareReference()`，2026-10-11 定稿）：长边 ≤ `MAX_REFERENCE_EDGE`（**2048 px**）、单张 ≤ `MAX_REFERENCE_BYTES`（**4 MB**）、**本次全部参考图合计 ≤ `MAX_REFERENCES_TOTAL_CHARS`（20 M 字符 ≈ 20 MB）**；PNG 保持 PNG（可能有透明通道），其余转 JPEG（逐档试 2048/0.92 → 2048/0.78 → 1440/0.7 → 1024/0.62，取第一个装得下的）；解码 / 编码任何一步失败都**原样返回**，不丢用户的图 |
| base64 膨胀 | ≈ **+33%**（4/3）。一张 8 MB 的手机原图 → 约 10.7 MB 的 data URL |
| 宿主路由上限 | `/dsh-imagegen/generate` 的请求体上限是 **32 MB**（`src/index.ts` L88 `GENERATE_BODY_BYTES`；配置类接口才是 1 MB） |
| 换算 | 20 MB 的参考图预算 + 提示词 + JSON 包装 → 离 32 MB 上限留了 1/3 余量 |
| 本地就会先炸 | 超过 32 MB 时 `readJsonBody()` 直接返回 `undefined`。**已修**：`/generate` 的 400 文案现在直接点名「多半是参考图太大（base64 会膨胀约 4/3）」，不再把人引去查 JSON |
| 上游 `413` | 官方只定义了 `413 Payload Too Large` 这个错误码，**没有给出阈值 → 未核实** |
| 典型翻车（下采样之后仍可能） | **已修**：原来单张 4 MB × 16 张 = 64 MB 照样超；现在按总量 20 MB 卡住，加图时按「剩余预算」压缩，装不下就**明确拒绝并说明理由**（不再静默 return） |

**当前实现**（`Composer.tsx`，2026-10-11 定稿）：

1. ✅ **已做**：长边缩到 ≤ 2048 px（多数 provider 内部也会缩到 1K/2K，传原始像素纯属浪费），且**只对超限的图动手**，小图一个字节都不改。
2. ✅ **已做**：PNG 保 PNG（可能带透明通道），其余转 JPEG，逐档降质量 / 缩边直到装得下。
3. ✅ **已做**：**总量预算** 20 M 字符；参考图槽的第二行直接显示用量（`2.1 MB/20.0 MB`），预算耗尽时加号槽位禁用并说明原因。
4. ✅ **已做**：加图时角标变「已缩小」、`title` 里给「4096×4096 → 2048×2048」；被拒时给一句人话（原来这些全是静默 `return`）。
5. ⬜ **未做**：「原图提交」的开关（目前是自动决定）—— 参考图是「引导」而不是最终产物，2048 长边够用；真需要原图保真的场景（局部细节复刻）目前没有入口。

### 3.9 客户端必须自己做的 5 件事（上游一件都不管）

| # | 责任 | 现状 |
|---|---|---|
| 1 | 上限按该模型的 `input_references.max` 裁剪，超出的不发 | ✅ 面板已按模型上限动态（兜底值 4 张只在拿不到模型信息时用） |
| 2 | `min ≥ 1` 的 5 个模型必须拦住（不给底图 = 非法请求） | ✅ 已有 |
| 3 | `max = 0` 的 2 个模型禁用参考图槽 | ✅ 已有 |
| 4 | **体积下采样** | ✅ 已做（长边 ≤2048 px / 单张 ≤4 MB，见 §3.8）；⚠️ **总量预算仍缺** |
| 5 | 不做 mask / 局部重绘入口（上游没有这些字段） | ✅ 本来就没有 |
---

## 4. 两个「异常模型」单列

### 4.1 `inclusionai/ming-image-0.1-design` 与 `-design-layer` —— 没有任何常规尺寸控件

| 项 | `ming-image-0.1-design` | `ming-image-0.1-design-layer` |
|---|---|---|
| 全部参数键 | `output_format`、`n`、`input_references`、`size` | `output_format`、`n`、`input_references`、`size` |
| `aspect_ratio` | ❌ **没有** | ❌ **没有** |
| `resolution` | ❌ **没有** | ❌ **没有** |
| `size` | `{type:"boolean"}`（只标了「支持」，**没有候选值**） | 同左 |
| `n` | `1..1`（只能出 1 张） | `1..1` |
| `input_references` | `0..0`（不收参考图） | **`1..1`（必填，恰好 1 张）** |
| `output_format` | `png` `jpeg` `webp` | `png` `webp`（**没有 jpeg**） |
| provider | NovitaAI | NovitaAI |

**结论**：这两个是 58 个可服务模型里**唯二**既没有 `aspect_ratio` 也没有 `resolution` 的模型 —— 面板的分辨率 / 比例下拉对它们是**空的**。唯一还能控制尺寸的是 `size`，但它只有 boolean 声明（**没有枚举可依**）→ 面板只能给一个**空文本框**让用户手填；又因为描述符不是 `enum`，`allowsValue()` 会放行**任何非空字符串**，客户端做不了值级校验。也就是说这两个模型的输出尺寸**要么靠提示词描述，要么靠用户自己填对 `size` 的写法**，属于已知功能盲区。

顺带一提：`-design-layer` 是「必填底图 + 无尺寸控件」的双重特例，唯一额度被钉死在「恰好 1 张参考图」。

### 4.2 `krea/krea-2-large` / `-medium` / `-medium-turbo` —— 不能选张数

| 项 | 三个 krea 模型（完全同形） |
|---|---|
| 全部参数键 | `resolution`、`aspect_ratio`、`input_references`、`seed` —— **没有 `n`** |
| `n` | ❌ **不声明** → 面板不能给张数下拉，一次只能出 1 张 |
| `resolution` | 只有 `1K` 一档 |
| `aspect_ratio` | 7 种：`1:1` `4:3` `3:2` `16:9` `4:5` `2:3` `9:16`（**无 auto**） |
| `input_references` | `0..1`（最多 1 张） |
| `seed` | `{type:"boolean"}` |
| provider | Krea，可透传 8 个私有参数（见 §5） |
| 定价 | `pricing: []` —— 上游未公布，面板算不出价 |

**注意**：全 59 个模型里不声明 `n` 的只有 4 个 —— 这 3 个 krea，加上无服务通道的 `meta/muse-image`。所以「不能选张数」在**可服务模型里就是 krea 这三兄弟**的专属情况。

---

## 5. `provider.options` 逐模型表

`provider.options` 是个对象，**key = 该 endpoint 的 `provider_slug`**（官方口径用 `provider_tag`），value 里只能放该 endpoint `allowed_passthrough_parameters` 列出的键。

**四条硬规矩：**

1. **slug 带区域 / variant 后缀，且同族不一致。** 官方文档示例里写死的 `provider.options["black-forest-labs"]` **只对 `flux.2-pro` 与 `flux.2-klein-4b` 成立** —— 对 `flux.2-max` / `flux.2-flex` 是**错的**，那两个必须用 `black-forest-labs/us-3`。
2. 只能从 `/images/models/<id>/endpoints` 的 `provider_slug` 动态取，**不能手写常量**。
3. 58 个可服务模型里 **45 个**有可透传参数，**13 个没有**（下表未列出的即属此类：`tencent/hy-image-v3.5-preview`、`bytedance-seed/*` 4 个、`x-ai/grok-imagine-image-*` 2 个、`qwen/qwen-image-3` 2 个、`microsoft/mai-image-2.5` 2 个、`inclusionai/ming-image-0.1-design*` 2 个）。
4. **4 个模型有 2 个 endpoint**，其中 3 个跨 provider（AI Studio + Vertex），1 个（`gemini-3-pro-image-preview`）是同 provider 的两个变体 —— 它们各有 2 个 slug，见下表。
| 模型 | `provider.options` 的 key（=`provider_slug`） | 可透传参数 |
|---|---|---|
| `google/gemini-nano-banana-2.1` | `google-ai-studio` | cachedContent |
| `black-forest-labs/flux-3-image` | `black-forest-labs` | safety_tolerance |
| `recraft/recraft-v4.1-flash` | `recraft` | controls |
| `openai/gpt-image-2.5-sunburst` | `openai` | moderation |
| `openai/gpt-image-2.5-flare` | `openai` | moderation |
| `microsoft/mai-image-2.6` | `azure` | web_grounding |
| `microsoft/mai-image-2.6-flash` | `azure` | web_grounding |
| `recraft/recraft-v4-styles-pro` | `recraft` | style_id、style_match、controls、random_seed |
| `recraft/recraft-v4-styles-vector` | `recraft` | style_id、style_match、controls、random_seed |
| `recraft/recraft-v4-styles-pro-vector` | `recraft` | style_id、style_match、controls、random_seed |
| `recraft/recraft-v4-styles` | `recraft` | style_id、style_match、controls、random_seed |
| `krea/krea-2-large` | `krea` | image_style_references、moodboards、styles、creativity、intensity、complexity、movement、strength |
| `krea/krea-2-medium` | `krea` | image_style_references、moodboards、styles、creativity、intensity、complexity、movement、strength |
| `krea/krea-2-medium-turbo` | `krea` | image_style_references、moodboards、styles、creativity、intensity、complexity、movement、strength |
| `google/gemini-3.1-flash-lite-image` | `google-vertex/global` | cachedContent |
| `google/gemini-3.1-flash-lite-image` | `google-ai-studio` | cachedContent |
| `openai/gpt-image-2` | `openai` | moderation |
| `openai/gpt-image-1-mini` | `openai` | moderation |
| `openai/gpt-image-1` | `openai` | moderation |
| `google/gemini-3.1-flash-image` | `google-ai-studio` | cachedContent |
| `google/gemini-3.1-flash-image` | `google-vertex/global` | cachedContent |
| `google/gemini-3-pro-image` | `google-ai-studio/global` | cachedContent |
| `google/gemini-3-pro-image` | `google-vertex/global` | cachedContent |
| `sourceful/riverflow-v2.5-pro` | `sourceful` | font_inputs |
| `sourceful/riverflow-v2.5-fast` | `sourceful` | font_inputs |
| `recraft/recraft-v4.1-pro-vector` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4.1-vector` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4.1-utility-pro` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4.1-utility` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4.1-pro` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4.1` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4-pro-vector` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4-vector` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4-pro` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v4` | `recraft` | style、controls、text_layout |
| `recraft/recraft-v3` | `recraft` | style、controls、text_layout |
| `openai/gpt-5.4-image-2` | `openai` | moderation |
| `google/gemini-3.1-flash-image-preview` | `google-ai-studio` | cachedContent |
| `sourceful/riverflow-v2-pro` | `sourceful` | font_inputs |
| `sourceful/riverflow-v2-fast` | `sourceful` | font_inputs |
| `black-forest-labs/flux.2-klein-4b` | `black-forest-labs` | steps、guidance、safety_tolerance |
| `black-forest-labs/flux.2-max` | `black-forest-labs/us-3` | steps、guidance、safety_tolerance |
| `black-forest-labs/flux.2-flex` | `black-forest-labs/us-3` | steps、guidance、safety_tolerance |
| `black-forest-labs/flux.2-pro` | `black-forest-labs` | steps、guidance、safety_tolerance |
| `google/gemini-3-pro-image-preview` | `google-ai-studio/global/flex` | cachedContent |
| `google/gemini-3-pro-image-preview` | `google-ai-studio/global` | cachedContent |
| `openai/gpt-5-image-mini` | `openai` | moderation |
| `openai/gpt-5-image` | `openai` | moderation |
| `google/gemini-2.5-flash-image` | `google-vertex/global` | cachedContent |

合计 **49** 条（覆盖 **45** 个模型；含 4 个双 endpoint 模型各 2 条）。

---

## 6. 未核实项 / 已知缺口 / 本次核对新发现

### 6.1 未核实的（标注出来，不编）

| # | 事项 | 状态 |
|---|---|---|
| 1 | 逐模型的流式支持 | `matrix.json` **没有记录** `supports_streaming` 这个字段（生成脚本没抓）→ 无法从快照追溯。本表 §1 里的「8/59」是 2026-10-11 **快照之外**又直接探了一次 `/images/models` 得到的（8 个全是 OpenAI 系），**不是** matrix.json 的内容 |
| 2 | `size` 的合法取值 | **未核实**。上游只给 `{type:"boolean"}`，没有任何枚举；官方说「档位或像素」。`tencent` 认哪些档位、ming 两兄弟认不认像素写法，都没试过 |
| 3 | 上游 `413` 的阈值 | **未核实**。官方只定义了这个错误码，没给大小上限 |
| 4 | `tencent` 的 `0..20` vs 官方 `maxItems: 16` | **未核实**哪个为准（没真发 20 张去撞） |
| 5 | `openrouter/auto`、`openrouter/auto-beta` | 不在本表内（它们只在 `GET /models?output_modalities=image` 的 61 个里，不在 `/images/models` 的 59 个里），详见 `OPENROUTER-IMAGE-API.md` §6 |

### 6.2 本次核对新发现（背景事实里没提到的）

| # | 发现 | 影响 / 建议 |
|---|---|---|
| 1 | ~~**`PARAM-MATRIX.md` §3 的表格是坏的**~~ ✅ **已修** | 原来单元格里直接塞 `enum(1K\|2K\|4K)` 这种裸竖线、未转义 → 那张 11 列的逐模型表在渲染器里会错列。已给 `scripts/param-matrix.mjs` 加 `cell()` 转义（`\|`），并顺手补了 `supports_streaming` 列与 `referencesEffective`（= `min(声明,16)`）字段 |
| 2 | **「模型级 ≠ endpoint 级」全量实测只发生 1 处** | `google/gemini-3-pro-image` 的 Vertex endpoint 只认 `1K`/`2K`，模型级并集给的是 `1K`/`2K`/`4K` → 面板会显示 4K；路由落到 Vertex 且用户选 4K 就是一次越界透传。其余 58 个模型的模型级与 endpoint 级完全一致 |
| 3 | ~~**「只有 1 个模型是多 provider」不准确**~~ ✅ **已更正** | 实测 **4 个**模型各有 2 个 endpoint：`google/gemini-3.1-flash-lite-image`、`google/gemini-3.1-flash-image`、`google/gemini-3-pro-image`（跨 AI Studio + Vertex），以及 `google/gemini-3-pro-image-preview`（同 provider 两变体）。其中**只有 `gemini-3-pro-image` 的能力真有差异**。`OPENROUTER-IMAGE-API.md` §14 已改 |
| 4 | **模型驱动表单 + `extra` 通路已端到端接通** | 完整一条链：`openrouter.ts` 的 `FIELD_SPECS` / `parametersFrom()`（9 个字段 + `stream`）→ `parseImageModels()` / `parseCapabilities()` 下发 `parameters` → 客户端 `toParameters()` → `Composer.tsx` 按 `parameters` 渲染 → `ImageGenPanel.tsx` 把 `extra` 并进 `backend.generate()` → 宿主 `EXTRA_FIELDS` 白名单 → `buildImageRequest()` 键级 / 值级裁剪。**已跑全量自检**：`host-check` 406/406、`render-check` 166/166、`upstream-check` 53/53 |
| 4a | ↳ 残留（有意为之） | `extra` 白名单只收 10 个模型级键 + `stream`，**`provider` / `user` / `session_id` / `trace` 塞不进去** —— 请求体来自浏览器，不能让它改路由。想传 `provider.*` 只能走配置里那段「额外参数」JSON，而那段是**最后无条件合并、不做裁剪**的。`size` 的**形状校验**已补（`^(512\|768\|1K\|1.5K\|2K\|4K\|\d{2,5}x\d{2,5})$`，宿主侧） |
| 4b | ↳ 已补的自检 | 「`Composer` 收集的每个 `extra` 键都真的出现在最终请求体里」已断言（`host-check` §10 的 `acme/rich-v1` 一组）：`output_format` 覆盖配置、`seed` 按整数发、`stream` 按布尔发、`output_compression=0` 不被改成 1、空串不发、越界不发、白名单拦 `provider` |
| 5 | ~~参考图超大时报错与真实原因对不上号~~ ✅ **已修** | 宿主 `/generate` 的请求体上限 **32 MB**（`GENERATE_BODY_BYTES`）。现在 400 文案直接点名「多半是参考图太大（base64 会膨胀约 4/3）」；客户端另有 20 M 字符的**总预算**，加图时按剩余预算压缩、装不下就明确拒绝并说明理由 |
| 6 | **`transparent` 的实际可达性是 8/10，不是 10/10** | `background` 的 10 个模型里，`openai/gpt-image-2` 与 `openai/gpt-5.4-image-2` 的枚举**只有 `auto`/`opaque`**。**已在实现里体现**：候选值一律来自该模型自己的枚举，所以这两个模型的下拉里根本不会出现 `transparent` —— 不是靠统一的「背景三档」硬塞 |
| 7 | **`boolean` 描述符 ≠ 布尔值（实测只有 `seed` / `size` 两个键）** | `seed` 的值是**整数**（面板：数字输入，默认留空 = 每次随机）、`size` 的值是**字符串**（面板：自由文本 + 形状校验）。`upstream-check` 第 6 节对真上游 59 个模型断言了这条 |
| 8 | **`stream` 不在 `supported_parameters` 里** | 它由顶层 `supports_streaming` 表达（实测 **8/59** 支持，全是 OpenAI 系）。宿主必须单独传一路 `supportsStreaming`，否则这个开关会被「模型没声明」裁掉、永远发不出去（已修） |
| 9 | **`tencent/hy-image-v3.5-preview` 声明 20 张 vs 官方 `maxItems: 16`** | 两者冲突，**以全局 16 为准**（模型级枚举网关不校验，全局 `maxItems` 校验）。已落 `GLOBAL_MAX_REFERENCES = 16` + `referencesDeclaredMax`，界面显式解释差额 |
| 10 | **「额外参数」JSON 会静默盖掉面板上看得见的字段**（真机验收才发现的） | 那段 JSON 在 `buildImageRequest()` 里是**最后无条件合并**、优先级最高。本机默认配置写着 `output_compression: 90` 与 `background: "opaque"` —— 这两个字段原来没有界面、现在有了 → **面板选 80、实际发 90**。已修：宿主回报 `overridden[]`（诊断行 + 日志 + 成功响应），客户端在**生成之前**就在参数区警示是哪几个字段被覆盖。**优先级没动**（配置是用户显式写的） |
| 11 | **验收必须在重启后的真机上做** | 第一次重启后 `live-check` 50/50 全过，但那个数字**完全没覆盖新能力** —— 第 10 条正是加了真机断言才暴露出来的。`live-check` 已补第 7 节（真机参数表逐字段核对）与第 8 节（`extra` 通路端到端：用**不存在的模型 id** 骗上游回错，真打上游但**零计费**） |
| 12 | **写自检前先问「这条请求会不会真花钱」** | 差点用一个 `n: 11` 的请求去骗 400 —— 但宿主会先在本地 `Math.min(10, …)` 夹住，请求会**正常出图并真的计费**。免费骗错的正解是发一个不存在的模型 id |

---

**维护约定**：本文件是**人读的解释层**，可以手改；承载事实的 `stage-param-matrix/matrix.json` 与 `PARAM-MATRIX.md` 由 `node scripts/param-matrix.mjs` 生成，**不要手改**。数据重新探测后，本表里的数字需要跟着复核。