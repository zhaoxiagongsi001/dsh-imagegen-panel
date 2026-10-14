# `stage-param-matrix/` —— 逐模型参数矩阵快照

## 这是什么

一次**真上游全量探测**的原始快照：把 OpenRouter 图像目录里每个模型的 `supported_parameters`
（以及每个 provider endpoint 的权威参数表、可透传参数）拉下来，存成机器可读的 JSON。

它是「逐模型参数配置表」的**事实底座** —— 人读的解释层在仓库根的
[`../PARAM-TABLE.md`](../PARAM-TABLE.md)，脚本自动生成的原始表在 [`../PARAM-MATRIX.md`](../PARAM-MATRIX.md)，
接口 / 鉴权 / 错误码的协议细节在 [`../OPENROUTER-IMAGE-API.md`](../OPENROUTER-IMAGE-API.md)。

## 文件

| 文件 | 说明 |
|---|---|
| `matrix.json` | 全量快照（唯一产物）。**自动生成，改了会被覆盖** |

## 数据是何时、从哪里探测的

| 项 | 值 |
|---|---|
| `generatedAt` | **2026-10-11T00:52:30.174Z** |
| `base` | `https://openrouter.ai/api/v1` |
| 接口 | `GET /images/models`（模型目录 + 模型级 `supported_parameters`）<br>`GET /images/models/{author}/{slug}/endpoints`（逐 provider 的**权威**参数表 + `allowed_passthrough_parameters`） |
| 鉴权 | **不需要 Key**（两个都是公开只读 GET，探测成本 0） |
| 规模 | 模型 **59** 个 · 有可服务通道 **58** 个 · 无通道 1 个（`meta/muse-image`） |
| 并发 / 超时 | 6 路并发，单条 15 s 超时 |

## 怎么重新生成

```bash
# 在仓库根目录执行

# 生成两份：matrix.json + ../PARAM-MATRIX.md
node scripts/param-matrix.mjs

# 只打印 JSON 到 stdout，不落盘
node scripts/param-matrix.mjs --json

# 换一个上游（默认 https://openrouter.ai/api/v1）
node scripts/param-matrix.mjs --base=https://openrouter.ai/api/v1
```

生成器是 `scripts/param-matrix.mjs`。它**只调公开 GET**，不需要 Key、不花一分钱，随时可重跑。
重跑后 `matrix.json` 与 `PARAM-MATRIX.md` 一并被覆盖，**两份都不要手改**。

## `matrix.json` 结构

### 顶层

| 字段 | 类型 | 含义 |
|---|---|---|
| `generatedAt` | string | 探测时刻（ISO 8601，UTC） |
| `base` | string | 探测用的 Base URL |
| `modelCount` | number | 目录里的模型总数（本快照 **59**） |
| `availableCount` | number | 有可服务通道的模型数（本快照 **58**） |
| `unserved` | string[] | 无通道模型 id（`/endpoints` 返回 `[]`，选中必失败；本快照 = `meta/muse-image`） |
| `rows` | object[] | 逐模型一行，见下 |

### `rows[]` 每一行

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 模型 slug（`author/slug`），请求 `model` 用的就是它 |
| `name` | string | 展示名 |
| `available` | boolean | 有没有可服务通道（`endpointCount > 0`） |
| `endpointCount` | number | endpoint 个数（本快照：54 个模型是 1，4 个 Gemini 模型是 2） |
| `providers` | string[] | 各 endpoint 的 `provider_name`（展示名，不是 slug） |
| `params` | object | **模型级参数表**：key = 请求体字段名，value = 紧凑描述串 |
| `paramCount` | number | `params` 的键数 |
| `references` | object | `input_references` 的**张数硬约束** `{min, max}`（跨 provider 取**交集**） |
| `referencesRequired` | boolean | 等价于 `references.min >= 1`（不给底图就是非法请求） |
| `providerOptions` | object[] | `[{slug, params[]}]` —— `provider.options` 该用的 key 与可透传参数 |
| `error` | string | 拉该模型 `/endpoints` 失败时的错误首行（本快照全部为空） |

### `params` 里的描述串怎么读

| 形态 | 含义 |
|---|---|
| `enum(a\|b\|c)` | 枚举白名单，只能取其中之一 |
| `range(min..max)` | 闭区间整数 |
| `boolean` | **上游只标了「支持这个字段」** —— 它**不是**说值是布尔。见下 |

- **键缺失 = 该模型不支持这个字段**（不是「没有限制」）。发过去会被忽略或换回 502。
- 模型级 = 各 endpoint 的**并集**（`unionSpec`）；`references` 相反，取**交集**（`intersectRange`），
  因为张数上限是硬约束，跨 provider 必须都满足。
- ⚠️ **`boolean` ≠ 布尔值**：本快照里 `boolean` 只出现在 `seed`（整数）与 `size`（字符串，
  如 `"2K"` / `"2048x2048"`）两个键上。值类型要去官方 Request Parameters 表查。

## 已知局限（不是 bug，是这一版没记）

| # | 局限 | 说明 |
|---|---|---|
| 1 | **没有 `supports_streaming`** | 流式支持由模型 / endpoint 顶层的 `supports_streaming` 表达，**不在 `supported_parameters` 里**，本快照没记这个字段 → 想按模型判断「能不能流式」得另外探一次 `/images/models`。建议后续在 `rows[]` 里补 `supportsStreaming` |
| 2 | **「未声明」与「声明 0..0」落成同一个值** | `references` 拿不到声明时回落 `{min:0,max:0}`，所以 `recraft/recraft-v4.1-flash`（压根没有 `input_references` 键）与 `inclusionai/ming-image-0.1-design`（显式声明 `range(0..0)`）在 JSON 里长得一样。要区分得回头查 `params` 里有没有这个键 |
| 3 | **只有模型级与 endpoint 级的并集，没有逐 endpoint 明细** | 想看「某个 provider 单独认什么」得自己调 `/images/models/<id>/endpoints`。全量实测里模型级 ≠ endpoint 级只发生在 `google/gemini-3-pro-image` 一处 |
| 4 | **不含定价** | `pricing` 在 `/endpoints` 响应里但没进快照（报价逻辑另有其人）。要定价得看 `OPENROUTER-IMAGE-API.md` §7 |