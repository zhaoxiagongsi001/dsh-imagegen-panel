# 逐模型参数配置表（真上游生成，勿手改）

> 生成时间：2026-10-11T01:11:33.909Z　数据源：`https://openrouter.ai/api/v1`（公开只读接口，无需 Key）
> 模型 **59** 个 · 有可服务通道 **58** 个

**读法**：`enum(a|b|c)` = 枚举白名单；`range(min..max)` = 闭区间整数；`boolean` = 上游只标了「支持」
（`seed` / `stream` 这类就是 boolean 声明，值类型见下面的字段规格表）。**键缺失 = 该模型不支持这个字段**，
发过去不是被忽略就是换回一次 502。

## 1. 字段出现频次（谁在声明什么）

| 字段 | 声明该字段的模型数 | 覆盖面 |
|---|---:|---:|
| `input_references` | 57 | 97% |
| `aspect_ratio` | 56 | 95% |
| `n` | 55 | 93% |
| `resolution` | 23 | 39% |
| `output_format` | 14 | 24% |
| `seed` | 14 | 24% |
| `background` | 10 | 17% |
| `quality` | 9 | 15% |
| `output_compression` | 8 | 14% |
| `size` | 3 | 5% |

## 2. 图生图（`input_references`）专项 —— 最容易出错的地方

OpenRouter **没有独立的改图端点**：图生图 = `POST /images` + `input_references`。
元素形状 `{"type":"image_url","image_url":{"url":"<https URL 或 data URL>"}}`，
URL 与 base64 data URL 都收。**没有** `mask` / `negative_prompt` / `strength`，所以不支持局部重绘。

| 类别 | 模型数 | 说明 |
|---|---:|---|
| **必填底图**（`min ≥ 1`） | 5 | 不给参考图就是**非法请求**，面板必须先拦住 |
| 支持图生图（`max ≥ 1`） | 56 | |
| 上限 **= 1 张** | 17 | 多给一张就超界 |
| 完全不支持参考图 | 2 | 参考图槽应禁用 |

### 2.1 逐模型参考图额度（全部可服务模型）

> **「声明」是模型自己报的数，「可发」才是真能发出去的张数。** 两者差在网关的全局
> `maxItems: 16` —— 模型级枚举网关不校验，全局 `maxItems` 校验。`tencent/hy-image-v3.5-preview`
> 声明 20 张，实际发 17 张就是一次 400（失败不计费，但白等一次）。

| 模型 | 最少 | 声明最多 | **可发最多** | 备注 |
|---|---:|---:|---:|---|
| `google/gemini-nano-banana-2.1` | 0 | 14 | 14 |  |
| `tencent/hy-image-v3.5-preview` | 0 | 20 | 16 | 声明 20 张，被网关全局上限压到 16 |
| `bytedance-seed/seedream-5-0-flash` | 0 | 14 | 14 |  |
| `black-forest-labs/flux-3-image` | 0 | 10 | 10 |  |
| `inclusionai/ming-image-0.1-design-layer` | 1 | 1 | 1 | **必填 · 恰好 1 张** |
| `recraft/recraft-v4.1-flash` | 0 | 0 | 0 | 不支持参考图 |
| `inclusionai/ming-image-0.1-design` | 0 | 0 | 0 | 不支持参考图 |
| `openai/gpt-image-2.5-sunburst` | 0 | 16 | 16 |  |
| `openai/gpt-image-2.5-flare` | 0 | 16 | 16 |  |
| `microsoft/mai-image-2.6` | 0 | 5 | 5 |  |
| `microsoft/mai-image-2.6-flash` | 0 | 5 | 5 |  |
| `recraft/recraft-v4-styles-pro` | 1 | 10 | 10 | **必填 · 恰好 1 张** |
| `recraft/recraft-v4-styles-vector` | 1 | 10 | 10 | **必填 · 恰好 1 张** |
| `recraft/recraft-v4-styles-pro-vector` | 1 | 10 | 10 | **必填 · 恰好 1 张** |
| `recraft/recraft-v4-styles` | 1 | 10 | 10 | **必填 · 恰好 1 张** |
| `bytedance-seed/seedream-5-0-lite` | 0 | 14 | 14 |  |
| `bytedance-seed/seedream-5-0-pro` | 0 | 14 | 14 |  |
| `x-ai/grok-imagine-image-2.0` | 0 | 3 | 3 |  |
| `qwen/qwen-image-3-pro` | 0 | 4 | 4 |  |
| `qwen/qwen-image-3` | 0 | 4 | 4 |  |
| `microsoft/mai-image-2.5-pro` | 0 | 1 | 1 | 最多 1 张 |
| `krea/krea-2-large` | 0 | 1 | 1 | 最多 1 张 |
| `krea/krea-2-medium` | 0 | 1 | 1 | 最多 1 张 |
| `krea/krea-2-medium-turbo` | 0 | 1 | 1 | 最多 1 张 |
| `google/gemini-3.1-flash-lite-image` | 0 | 14 | 14 |  |
| `openai/gpt-image-2` | 0 | 16 | 16 |  |
| `openai/gpt-image-1-mini` | 0 | 16 | 16 |  |
| `openai/gpt-image-1` | 0 | 16 | 16 |  |
| `google/gemini-3.1-flash-image` | 0 | 14 | 14 |  |
| `google/gemini-3-pro-image` | 0 | 14 | 14 |  |
| `sourceful/riverflow-v2.5-pro` | 0 | 10 | 10 |  |
| `sourceful/riverflow-v2.5-fast` | 0 | 4 | 4 |  |
| `microsoft/mai-image-2.5` | 0 | 1 | 1 | 最多 1 张 |
| `x-ai/grok-imagine-image-quality` | 0 | 3 | 3 |  |
| `recraft/recraft-v4.1-pro-vector` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4.1-vector` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4.1-utility-pro` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4.1-utility` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4.1-pro` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4.1` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4-pro-vector` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4-vector` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4-pro` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v4` | 0 | 1 | 1 | 最多 1 张 |
| `recraft/recraft-v3` | 0 | 1 | 1 | 最多 1 张 |
| `openai/gpt-5.4-image-2` | 0 | 16 | 16 |  |
| `google/gemini-3.1-flash-image-preview` | 0 | 14 | 14 |  |
| `sourceful/riverflow-v2-pro` | 0 | 10 | 10 |  |
| `sourceful/riverflow-v2-fast` | 0 | 4 | 4 |  |
| `black-forest-labs/flux.2-klein-4b` | 0 | 4 | 4 |  |
| `bytedance-seed/seedream-4.5` | 0 | 14 | 14 |  |
| `black-forest-labs/flux.2-max` | 0 | 8 | 8 |  |
| `black-forest-labs/flux.2-flex` | 0 | 8 | 8 |  |
| `black-forest-labs/flux.2-pro` | 0 | 8 | 8 |  |
| `google/gemini-3-pro-image-preview` | 0 | 14 | 14 |  |
| `openai/gpt-5-image-mini` | 0 | 16 | 16 |  |
| `openai/gpt-5-image` | 0 | 16 | 16 |  |
| `google/gemini-2.5-flash-image` | 0 | 3 | 3 |  |

## 3. 逐模型完整参数表

| 模型 | `input_references` | `aspect_ratio` | `n` | `resolution` | `output_format` | `seed` | `background` | `quality` | `output_compression` | `size` | 流式 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `google/gemini-nano-banana-2.1` | range(0..14) | enum(1:1\|1:4\|1:8\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|8:1\|9:16\|16:9\|21:9) | range(1..1) | enum(1K\|2K\|4K) | — | — | — | — | — | — | — |
| `tencent/hy-image-v3.5-preview` | range(0..20) | enum(1:1\|1:2\|1:4\|2:1\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|9:16\|16:9) | range(1..1) | enum(1K\|1.5K\|2K\|4K) | — | boolean | — | — | — | boolean | — |
| `bytedance-seed/seedream-5-0-flash` | range(0..14) | enum(1:1\|1:2\|2:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|9:19.5\|19.5:9\|9:20\|20:9\|9:21\|21:9\|auto) | range(1..1) | enum(1K\|2K) | — | boolean | — | — | — | — | — |
| `black-forest-labs/flux-3-image` | range(0..10) | enum(21:9\|2:1\|16:9\|3:2\|7:5\|4:3\|5:4\|1:1\|4:5\|3:4\|5:7\|2:3\|9:16\|1:2\|9:21\|auto) | range(1..1) | enum(768\|1K\|1.5K\|2K\|4K) | — | — | — | — | — | — | — |
| `inclusionai/ming-image-0.1-design-layer` | range(1..1) | — | range(1..1) | — | enum(png\|webp) | — | — | — | — | boolean | — |
| `recraft/recraft-v4.1-flash` | — | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `inclusionai/ming-image-0.1-design` | range(0..0) | — | range(1..1) | — | enum(png\|jpeg\|webp) | — | — | — | — | boolean | — |
| `openai/gpt-image-2.5-sunburst` | range(0..16) | enum(1:1\|3:2\|2:3\|4:3\|3:4\|16:9\|9:16\|21:9\|auto) | range(1..10) | — | — | — | enum(auto\|transparent\|opaque) | enum(auto\|low\|medium\|high\|xhigh\|max) | range(0..100) | — | ✔ |
| `openai/gpt-image-2.5-flare` | range(0..16) | enum(1:1\|3:2\|2:3\|4:3\|3:4\|16:9\|9:16\|21:9\|auto) | range(1..10) | — | — | — | enum(auto\|transparent\|opaque) | enum(auto\|low\|medium\|high\|xhigh\|max) | range(0..100) | — | ✔ |
| `microsoft/mai-image-2.6` | range(0..5) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|3:2\|2:3\|auto) | range(1..1) | — | — | — | — | — | — | — | — |
| `microsoft/mai-image-2.6-flash` | range(0..5) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|3:2\|2:3\|auto) | range(1..1) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4-styles-pro` | range(1..10) | enum(1:1\|2:1\|1:2\|3:2\|2:3\|4:3\|3:4\|5:4\|4:5\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4-styles-vector` | range(1..10) | enum(1:1\|2:1\|1:2\|3:2\|2:3\|4:3\|3:4\|5:4\|4:5\|16:9\|9:16\|auto) | range(1..6) | — | enum(svg) | — | — | — | — | — | — |
| `recraft/recraft-v4-styles-pro-vector` | range(1..10) | enum(1:1\|2:1\|1:2\|3:2\|2:3\|4:3\|3:4\|5:4\|4:5\|16:9\|9:16\|auto) | range(1..6) | — | enum(svg) | — | — | — | — | — | — |
| `recraft/recraft-v4-styles` | range(1..10) | enum(1:1\|2:1\|1:2\|3:2\|2:3\|4:3\|3:4\|5:4\|4:5\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `bytedance-seed/seedream-5-0-lite` | range(0..14) | enum(1:1\|1:2\|2:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|9:19.5\|19.5:9\|9:20\|20:9\|9:21\|21:9\|auto) | range(1..4) | enum(2K\|4K) | — | boolean | — | — | — | — | — |
| `bytedance-seed/seedream-5-0-pro` | range(0..14) | enum(1:1\|1:2\|2:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|9:19.5\|19.5:9\|9:20\|20:9\|9:21\|21:9\|auto) | range(1..1) | enum(1K\|2K) | — | boolean | — | — | — | — | — |
| `x-ai/grok-imagine-image-2.0` | range(0..3) | enum(1:1\|3:4\|4:3\|9:16\|16:9\|2:3\|3:2\|9:19.5\|19.5:9\|9:20\|20:9\|1:2\|2:1\|auto) | range(1..1) | enum(1K\|2K) | — | — | — | enum(low\|medium) | — | — | — |
| `qwen/qwen-image-3-pro` | range(0..4) | enum(1:1\|1:2\|1:4\|2:1\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|9:16\|16:9) | range(1..6) | enum(1K\|2K) | — | boolean | — | — | — | — | — |
| `qwen/qwen-image-3` | range(0..4) | enum(1:1\|1:2\|1:4\|2:1\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|9:16\|16:9) | range(1..6) | enum(1K\|2K) | — | boolean | — | — | — | — | — |
| `microsoft/mai-image-2.5-pro` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|3:2\|2:3\|auto) | range(1..1) | — | — | — | — | — | — | — | — |
| `krea/krea-2-large` | range(0..1) | enum(1:1\|4:3\|3:2\|16:9\|4:5\|2:3\|9:16) | — | enum(1K) | — | boolean | — | — | — | — | — |
| `krea/krea-2-medium` | range(0..1) | enum(1:1\|4:3\|3:2\|16:9\|4:5\|2:3\|9:16) | — | enum(1K) | — | boolean | — | — | — | — | — |
| `krea/krea-2-medium-turbo` | range(0..1) | enum(1:1\|4:3\|3:2\|16:9\|4:5\|2:3\|9:16) | — | enum(1K) | — | boolean | — | — | — | — | — |
| `google/gemini-3.1-flash-lite-image` | range(0..14) | enum(1:1\|1:4\|1:8\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|8:1\|9:16\|16:9\|21:9) | range(1..1) | enum(1K) | — | — | — | — | — | — | — |
| `openai/gpt-image-2` | range(0..16) | enum(1:1\|3:2\|2:3\|4:3\|3:4\|16:9\|9:16\|21:9\|auto) | range(1..10) | — | — | — | enum(auto\|opaque) | enum(auto\|low\|medium\|high) | range(0..100) | — | ✔ |
| `openai/gpt-image-1-mini` | range(0..16) | enum(1:1\|3:2\|2:3\|auto) | range(1..10) | — | — | — | enum(auto\|transparent\|opaque) | enum(auto\|low\|medium\|high) | range(0..100) | — | ✔ |
| `openai/gpt-image-1` | range(0..16) | enum(1:1\|3:2\|2:3\|auto) | range(1..10) | — | — | — | enum(auto\|transparent\|opaque) | enum(auto\|low\|medium\|high) | range(0..100) | — | ✔ |
| `google/gemini-3.1-flash-image` | range(0..14) | enum(1:1\|1:4\|1:8\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|8:1\|9:16\|16:9\|21:9) | range(1..1) | enum(512\|1K\|2K\|4K) | — | — | — | — | — | — | — |
| `google/gemini-3-pro-image` | range(0..14) | enum(1:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|21:9) | range(1..1) | enum(1K\|2K\|4K) | — | — | — | — | — | — | — |
| `sourceful/riverflow-v2.5-pro` | range(0..10) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | enum(1K\|2K\|4K) | enum(png\|jpeg\|webp) | — | enum(auto\|transparent\|opaque) | — | — | — | — |
| `sourceful/riverflow-v2.5-fast` | range(0..4) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | enum(1K\|2K) | enum(jpeg) | — | enum(auto\|transparent\|opaque) | — | — | — | — |
| `microsoft/mai-image-2.5` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|3:2\|2:3\|auto) | range(1..1) | — | — | — | — | — | — | — | — |
| `x-ai/grok-imagine-image-quality` | range(0..3) | enum(1:1\|3:4\|4:3\|9:16\|16:9\|2:3\|3:2\|9:19.5\|19.5:9\|9:20\|20:9\|1:2\|2:1\|auto) | range(1..1) | enum(1K\|2K) | — | — | — | — | — | — | — |
| `recraft/recraft-v4.1-pro-vector` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | enum(svg) | — | — | — | — | — | — |
| `recraft/recraft-v4.1-vector` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | enum(svg) | — | — | — | — | — | — |
| `recraft/recraft-v4.1-utility-pro` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4.1-utility` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4.1-pro` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4.1` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4-pro-vector` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | enum(svg) | — | — | — | — | — | — |
| `recraft/recraft-v4-vector` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | enum(svg) | — | — | — | — | — | — |
| `recraft/recraft-v4-pro` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v4` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `recraft/recraft-v3` | range(0..1) | enum(1:1\|4:3\|3:4\|16:9\|9:16\|auto) | range(1..6) | — | — | — | — | — | — | — | — |
| `openai/gpt-5.4-image-2` | range(0..16) | enum(1:1\|3:2\|2:3\|4:3\|3:4\|16:9\|9:16\|21:9\|auto) | range(1..10) | — | — | — | enum(auto\|opaque) | enum(auto\|low\|medium\|high) | range(0..100) | — | ✔ |
| `google/gemini-3.1-flash-image-preview` | range(0..14) | enum(1:1\|1:4\|1:8\|2:3\|3:2\|3:4\|4:1\|4:3\|4:5\|5:4\|8:1\|9:16\|16:9\|21:9) | range(1..1) | enum(512\|1K\|2K\|4K) | — | — | — | — | — | — | — |
| `sourceful/riverflow-v2-pro` | range(0..10) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | enum(1K\|2K\|4K) | — | — | — | — | — | — | — |
| `sourceful/riverflow-v2-fast` | range(0..4) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | enum(1K\|2K\|4K) | — | — | — | — | — | — | — |
| `black-forest-labs/flux.2-klein-4b` | range(0..4) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | — | enum(png\|jpeg) | boolean | — | — | — | — | — |
| `bytedance-seed/seedream-4.5` | range(0..14) | enum(1:1\|1:2\|2:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|9:19.5\|19.5:9\|9:20\|20:9\|9:21\|21:9\|auto) | range(1..10) | enum(1K\|2K\|4K) | — | boolean | — | — | — | — | — |
| `black-forest-labs/flux.2-max` | range(0..8) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | — | enum(png\|jpeg) | boolean | — | — | — | — | — |
| `black-forest-labs/flux.2-flex` | range(0..8) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | — | enum(png\|jpeg) | boolean | — | — | — | — | — |
| `black-forest-labs/flux.2-pro` | range(0..8) | enum(1:1\|4:3\|3:4\|3:2\|2:3\|16:9\|9:16\|21:9\|auto) | range(1..1) | — | enum(png\|jpeg) | boolean | — | — | — | — | — |
| `google/gemini-3-pro-image-preview` | range(0..14) | enum(1:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|21:9) | range(1..1) | enum(1K\|2K\|4K) | — | — | — | — | — | — | — |
| `openai/gpt-5-image-mini` | range(0..16) | enum(1:1\|3:2\|2:3\|auto) | range(1..10) | — | — | — | enum(auto\|transparent\|opaque) | enum(auto\|low\|medium\|high) | range(0..100) | — | ✔ |
| `openai/gpt-5-image` | range(0..16) | enum(1:1\|3:2\|2:3\|auto) | range(1..10) | — | — | — | enum(auto\|transparent\|opaque) | enum(auto\|low\|medium\|high) | range(0..100) | — | ✔ |
| `google/gemini-2.5-flash-image` | range(0..3) | enum(1:1\|2:3\|3:2\|3:4\|4:3\|4:5\|5:4\|9:16\|16:9\|21:9) | range(1..1) | — | — | — | — | — | — | — | — |

## 4. 无服务通道的模型（选中必失败，列表阶段就该过滤）

- `meta/muse-image`

## 5. `provider.options` 的键（逐模型）

官方文档示例写死的 `black-forest-labs` **只对 `flux.2-pro` 成立**：同族 slug 带区域/variant 后缀且互不相同。
只能按 `/endpoints` 返回的 `provider_slug`（官方口径是 `provider_tag`）动态取。

| 模型 | `provider.options` 的键 | 可透传参数 |
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

