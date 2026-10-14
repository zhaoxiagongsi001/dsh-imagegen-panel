/**
 * 把**真实的插件 UI**渲染成一个自包含的预览页，供人在浏览器里直接看。
 *
 * 用途：本插件的界面只会在 DSH 的 Web GUI 里出现，而那只 GUI 老板随时在用
 * （或最小化着）。拿它当测试台既慢又打扰。这个脚本用与生产**完全相同的代码路径**
 * （打包后的 `lib/client.js`、同一份 CSS Module 输出、同一批 DSH design token）
 * 离屏渲染出 HTML，于是「改 → 看」不再需要动 DSH。
 *
 * 产物：`preview/panel.html`（单文件、零依赖、双击即开）
 * 用法：node scripts/preview.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REF = path.join(root, '.ref', 'out')

/** 与 render-check 同款依赖解析：本包不建 node_modules。 */
function requireFrom(specifier) {
  // 本机开发布局：同版本的样板插件与本包目录并排（可用 DSH_SAMPLE_ROOT 覆盖）。
  const samples = process.env.DSH_SAMPLE_ROOT || path.join(root, '..', 'dsh-prompt-forge')
  for (const base of [samples, root]) {
    const anchor = path.join(base, 'package.json')
    if (!existsSync(anchor)) continue
    try {
      return createRequire(anchor)(specifier)
    } catch { /* 试下一个 */ }
  }
  throw new Error(`找不到 ${specifier}`)
}

const React = requireFrom('react')
const ReactDOMServer = requireFrom('react-dom/server')

// ------------------------------------------- CSS Module 注入需要的最小 DOM

const injectedStyles = []
globalThis.document = {
  head: { children: [], appendChild(node) { this.children.push(node); injectedStyles.push(node) } },
  createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      attributes: {},
      textContent: '',
      setAttribute(name, value) { this.attributes[name] = String(value) },
      getAttribute(name) { return this.attributes[name] ?? null },
    }
  },
  querySelector(selector) {
    const match = /^style\[data-plugin-css=(.*)\]$/u.exec(selector)
    if (match === null) return null
    const wanted = JSON.parse(match[1])
    return injectedStyles.find((style) => style.attributes['data-plugin-css'] === wanted) ?? null
  },
}

// ------------------------------------------------------------- 载入 bundle

let loaded = null
globalThis.window = { __ModuleLoader__: { load(record) { loaded = record } } }

const bundleSource = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
new Function('window', 'document', bundleSource)(globalThis.window, globalThis.document)
if (loaded === null) throw new Error('bundle 没有自注册到 window.__ModuleLoader__')

const api = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`运行期请求了未提供的平台模块 "${id}"`)
})

const h = React.createElement
const render = (element) => ReactDOMServer.renderToStaticMarkup(element)

// ------------------------------------------------------------------ 假数据

const model = {
  id: 'google/gemini-3-pro-image',
  caps: ['图生图', '1:1…21:9'],
  price: '$0.039/张',
  supportsReferences: true,
  // 参考图区间是硬字段：`ConfigModal` 会读 `references.min/max` 来写「参考图最多 N 张」
  // 与必填提示，缺了它预览脚本会直接抛（2026-10-10 补）。
  references: { min: 0, max: 4 },
  options: {
    aspectRatio: ['16:9', '1:1', '9:16', '4:3', '3:4', '3:2', '2:3', 'auto'],
    resolution: ['1K', '512', '768', '1.5K', '2K'],
    count: ['1', '2', '3', '4'],
    quality: ['高', '自动', '中', '低'],
    outputFormat: ['png', 'jpeg', 'webp'],
  },
  // 该模型声明的参数（2026-10-11 起界面按它渲染，不再是固定四个下拉）。
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['16:9', '1:1', '9:16', '4:3', '3:4', '3:2', '2:3'], clearable: false, default: '16:9', hint: '取值就是该模型声明的那些。' },
    { name: 'resolution', label: '分辨率', control: 'select', valueType: 'string', group: 'output', values: ['1K', '2K', '4K'], clearable: false, default: '1K', hint: '标准化档位，具体像素由 provider 换算。' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1'], min: 1, max: 1, clearable: false, default: '1', hint: '上游可以返回比 n 更少的张数。' },
  ],
  supportsStreaming: false,
}

/** 同一块面板、另一个模型：参数行应当**完全不同**（对照用）。 */
const modelFull = {
  id: 'openai/gpt-image-2.5-sunburst',
  caps: ['图生图', '6 档质量'],
  price: '$0.041/张',
  supportsReferences: true,
  references: { min: 0, max: 10 },
  options: {
    aspectRatio: ['1:1', '16:9'],
    resolution: [],
    count: ['1', '2', '3', '4'],
    quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    outputFormat: ['png', 'jpeg', 'webp'],
  },
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto'], clearable: false, default: 'auto', hint: '' },
    { name: 'size', label: '尺寸', control: 'text', valueType: 'string', group: 'output', clearable: true, default: '', hint: '档位或像素' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1', '2', '3', '4'], min: 1, max: 4, clearable: false, default: '1', hint: '' },
    { name: 'quality', label: '质量', control: 'select', valueType: 'string', group: 'output', values: ['auto', 'low', 'medium', 'high'], clearable: false, default: 'auto', hint: '每个模型只收自己声明的那几档' },
    { name: 'output_format', label: '输出格式', control: 'select', valueType: 'string', group: 'output', values: ['png', 'jpeg', 'webp'], clearable: false, default: 'png', hint: '' },
    { name: 'background', label: '背景', control: 'select', valueType: 'string', group: 'output', values: ['auto', 'transparent', 'opaque'], clearable: false, default: 'auto', hint: 'transparent 要求 png/webp' },
    { name: 'output_compression', label: '压缩', control: 'number', valueType: 'integer', group: 'advanced', min: 0, max: 100, clearable: true, default: '', hint: '' },
    { name: 'seed', label: '随机种子', control: 'number', valueType: 'integer', group: 'advanced', clearable: true, default: '', hint: '留空 = 每次随机' },
    { name: 'stream', label: '流式预览', control: 'toggle', valueType: 'boolean', group: 'advanced', clearable: false, default: 'false', hint: '' },
  ],
  supportsStreaming: true,
}

/** 只收 svg、上限 1 张参考图的矢量化模型（第三个对照）。 */
const modelVector = {
  id: 'recraft/recraft-v4-vector',
  caps: ['图生图', '矢量化'],
  price: '$0.035/张',
  supportsReferences: true,
  references: { min: 0, max: 1 },
  options: { aspectRatio: ['1:1'], resolution: [], count: ['1'], quality: [], outputFormat: ['svg'] },
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['1:1', '4:3', '3:4', '16:9', '9:16', 'auto'], clearable: false, default: '1:1', hint: '' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1', '2', '3', '4', '5', '6'], min: 1, max: 6, clearable: false, default: '1', hint: '' },
    { name: 'output_format', label: '输出格式', control: 'select', valueType: 'string', group: 'output', values: ['svg'], clearable: false, default: 'svg', hint: '矢量模型只收 svg' },
  ],
  supportsStreaming: false,
}

const params = { aspectRatio: '16:9', resolution: '1K', count: '1', quality: '高' }

const image = {
  id: 'gen-1',
  art: 'a',
  size: '1536 × 864',
  cost: 0.0391,
  seconds: 37,
  prompt: '一只戴耳机的柴犬坐在窗边，午后阳光斜射进来，胶片质感，浅景深，暖色调',
  aspectRatio: '16:9',
  resolution: '1K',
  createdAt: Date.UTC(2026, 9, 9, 13, 14),
  savedPath: 'D:\\DSH\\.dsh-imagegen\\out\\2026-10-09_2114_gemini-3-pro-image.png',
}

const history = ['a', 'b', 'c', 'd', 'e', 'f', 'b', 'c'].map((art, index) => ({
  ...image,
  id: `seed-${index}`,
  art,
  cost: [0.0391, 0.0412, 0.0388, 0.0405, 0.0399, 0.0421, 0.0377, 0.0403][index],
}))

/**
 * 「真图」状态用的一张内联 SVG（data URL）。
 *
 * 用 SVG 而不是真 PNG：预览页是**单文件**，塞一张真照片会让它涨到几 MB；
 * 而这里要证明的只是「有 imageUrl 时走 <img> 这条路」。
 */
const REAL_IMAGE_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864">'
  + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
  + '<stop offset="0" stop-color="#f6b73c"/><stop offset="1" stop-color="#5b8def"/></linearGradient></defs>'
  + '<rect width="1536" height="864" fill="url(#g)"/>'
  + '<circle cx="1180" cy="250" r="130" fill="#fff" opacity="0.55"/>'
  + '<text x="70" y="470" font-family="sans-serif" font-size="86" fill="#fff" opacity="0.92">真图占位（1536 × 864）</text>'
  + '<text x="70" y="570" font-family="sans-serif" font-size="44" fill="#fff" opacity="0.75">阶段 4 起由 OpenRouter 返回 b64_json 落盘</text>'
  + '</svg>',
)

const realImage = {
  ...image,
  id: 'gen-real',
  imageUrl: REAL_IMAGE_URL,
  size: '1536 × 864',
  count: 3,
  cost: 0.1173,
}

const noop = () => {}

/**
 * 一张「新记录」：模型、参数快照、实发字段、参考图张数都齐（2026-10-11 起索引里就有）。
 *
 * 刻意让**面板值**与**实发值**不一致（面板 medium、实发 high，背景面板 auto、实发
 * opaque）—— 那正是配置里那段「额外参数」覆盖面板值的样子。结果行显示实发值，
 * 面板值只有在点这张图回填参数时才用得上。
 */
const imageFacts = {
  ...image,
  model: 'google/gemini-3-pro-image',
  params: {
    aspectRatio: '16:9',
    resolution: '1K',
    count: 1,
    quality: 'medium',
    extra: { background: 'auto', output_compression: '80' },
  },
  sentFields: {
    aspect_ratio: '16:9',
    resolution: '1K',
    quality: 'high',
    n: '1',
    output_format: 'png',
    background: 'opaque',
    output_compression: '90',
    provider: '{"sort":"price"}',
  },
  referenceCount: 0,
}

/** 另一张：来自**另一个模型**（用来演示「与设置区不同」）。 */
const imageOtherModel = {
  ...imageFacts,
  id: 'gen-old-model',
  model: 'openai/gpt-image-2.5-flare',
  sentFields: { aspect_ratio: '1:1', resolution: '2K', n: '1', provider: '{"sort":"price"}' },
  params: { aspectRatio: '1:1', resolution: '2K', count: 1, quality: 'medium', extra: {} },
  referenceCount: 2,
}

/** 升级前的记录：只有模型，没有参数快照、没有实发字段。 */
const imageLegacy = {
  ...image,
  id: 'gen-legacy',
  model: 'old/model',
  params: undefined,
  sentFields: undefined,
}

const stageBase = {
  preview: undefined,
  elapsedSec: 0,
  onCancel: noop, onRetry: noop, onViewLog: noop, onSave: noop, onSaveAs: noop,
  onCopy: noop, onOpen: noop, onRegenerate: noop, history: [], onSelectHistory: noop, onClearHistory: noop,
}

const composerBase = {
  prompt: image.prompt,
  onPromptChange: noop,
  references: [],
  onAddReference: noop,
  onRemoveReference: noop,
  params,
  onParamChange: noop,
  model,
  parameters: model.parameters,
  running: false,
  notConfigured: false,
  onGenerate: noop,
  onCancel: noop,
  onOpenModelPicker: noop,
  lastSeconds: 94,
}

const config = {
  protocol: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: true,
  keyHint: 'sk-or-v1-••••••••4f2a',
  model: model.id,
  autoSaveDir: 'D:\\DSH\\.dsh-imagegen\\out\\',
  extraJson: '{\n  "background": "opaque",\n  "output_compression": 90,\n  "provider": { "sort": "price" }\n}',
  timeoutSec: 180,
  outputFormat: 'png',
}

// -------------------------------------------------------------- 各状态拼装

/**
 * 真实插件面板的「已配置」版式。
 *
 * `ImageGenPanel` 的配置状态来自它自己的模块作用域，外部注入不了，所以这里
 * 用它自己的两个子组件拼出同样的 `.panel / .head / .body2` 结构 ——
 * 类名与布局都取自同一次构建，视觉等价。
 */
function configuredPanel(stageProps, composerPatch = {}, modelLabel = model.id) {
  const composer = render(h(api.Composer, { ...composerBase, ...composerPatch }))
  const stage = render(h(api.ResultStage, { ...stageBase, ...stageProps }))
  return `
    <div class="panel_panel">
      <header class="panel_head">
        <div class="panel_headText">
          <div class="panel_title">生图</div>
          <div class="panel_sub">提示词 / 参考图 → 生成 → 面板内预览 · 保存 · 历史</div>
        </div>
        <div class="panel_headActions">
          <button class="panel_chip" type="button">模型 <b>${modelLabel}</b></button>
          <button class="panel_btn" type="button">连接配置</button>
        </div>
      </header>
      <div class="panel_body2">${composer}${stage}</div>
    </div>`
}

/**
 * 「看不全」修复前 vs 修复后要对照的那段报错。
 *
 * 修复前面板只显示上游那一句；现在宿主会把诊断行一起回 —— 这就是老板要的「全」。
 */
const LONG_ERROR_DETAIL = [
  'HTTP 400',
  'OpenAI output_compression requires output_format "jpeg" or "webp" on this endpoint.',
  '(code: upstream)',
  '',
  '本次请求的实际参数：',
  '· 模型：openai/gpt-image-2.5-flare（协议 openrouter）',
  '· 参数：比例 16:9 · 分辨率 1K · 张数 1 · 质量 auto · 输出格式 png',
  '· 参考图：0 张',
  '· 上游地址：POST https://openrouter.ai/api/v1/images',
  '· 实际发送：model="openai/gpt-image-2.5-flare" · prompt=<118 字符> · aspect_ratio="16:9" · output_compression=90',
  '· 被裁掉（该模型不支持）：output_format',
  '· 宿主日志文件：C:\\Users\\you\\.dsh\\dsh-imagegen-panel\\logs\\host-2026-10-10.log',
].join('\n')

/** 日志抽屉的样例数据（形状与 `/dsh-imagegen/logs` 一致）。 */
const LOG_SAMPLE = {
  entries: [
    { seq: 6, at: '2026-10-10 18:42:06', level: 'error', text: '上游拒绝（HTTP 400）：OpenAI output_compression requires output_format "jpeg" or "webp" on this endpoint.' },
    { seq: 5, at: '2026-10-10 18:42:04', level: 'info', text: '实际发送：model="openai/gpt-image-2.5-flare" · prompt=<118 字符> · aspect_ratio="16:9" · resolution="1K" · n=1 · output_compression=90' },
    { seq: 4, at: '2026-10-10 18:42:04', level: 'warn', text: '本次生成裁掉了不支持的字段：output_format（不在该模型的枚举里）' },
    { seq: 3, at: '2026-10-10 18:42:04', level: 'info', text: '生成开始：openai/gpt-image-2.5-flare · 16:9 · 1K · 1 张 · 参考图 0 张' },
    { seq: 2, at: '2026-10-10 18:41:02', level: 'info', text: '出图成功：1 张 · 首张 id=img-1759… · 耗时 21s · 费用 $0.0400' },
    { seq: 1, at: '2026-10-10 18:40:31', level: 'info', text: '已挂载 10 条路由，数据目录 C:\\Users\\you\\.dsh\\dsh-imagegen-panel，日志目录 C:\\Users\\you\\.dsh\\dsh-imagegen-panel\\logs' },
  ],
  file: 'C:\\Users\\you\\.dsh\\dsh-imagegen-panel\\logs\\host-2026-10-10.log',
  dir: 'C:\\Users\\you\\.dsh\\dsh-imagegen-panel\\logs',
  count: 6,
}

const STATES = [
  {
    id: 'unconfigured',
    title: '① 未配置（首帧就是这一屏）',
    note: '真实 ImageGenPanel 的首次渲染 —— 配置还没回来时按「未配置」渲染完整骨架，不闪空白。生成按钮禁用，提示词与参数仍可编辑。',
    html: render(h(api.ImageGenPanel)),
  },
  {
    id: 'done',
    title: '② 已出图（主交付版式）',
    note:
      '结果条三行：①「已自动保存到 …」+ 时间·比例·分辨率·耗时；②**这张图当时用的模型与参数**'
      + '（老板截图里红线标出的位置）；③四个操作按钮。右上角是 OpenRouter 返回的 usage.cost。'
      + '参数显示的是**实际发给上游**的值（质量 high、背景 opaque），而不是面板上的值 —— 配置里那段「额外参数」覆盖过面板，显示面板值等于骗人。',
    html: configuredPanel(
      { run: { kind: 'done', image: imageFacts }, preview: imageFacts, history: [imageFacts, ...history], currentModel: model.id },
    ),
  },
  {
    id: 'real',
    title: '②b 真图（阶段 4：真上游出图）',
    note: '有 imageUrl 时舞台与历史缩略图都渲染 <img>（不再是占位插画）；尺寸角标是从图片文件头量出来的真实像素，n>1 时额外显示张数。本页用内联 SVG 充当真图。',
    html: configuredPanel({
      run: { kind: 'done', image: realImage },
      preview: realImage,
      history: [realImage, ...history],
    }),
  },
  {
    id: 'history-apply',
    title: '②c 点历史记录：提示词与参数搬回工作区（本次新增）',
    note:
      '点下面历史里的任一张，提示词自动放回输入框、参数自动回到参数区（这张写的是 16:9 / 1K / medium），'
      + '图推上舞台；**设置区的模型不动**——所以「这张是哪个模型生的」由结果行第二行如实交代。'
      + '这张与设置区同模型，因此不加任何提示。',
    html: configuredPanel(
      { run: { kind: 'idle' }, preview: imageFacts, history: [imageFacts, ...history], currentModel: model.id },
      { prompt: imageFacts.prompt, params: { aspectRatio: '16:9', resolution: '1K', count: '1', quality: 'medium' }, extra: { background: 'auto', output_compression: '80' } },
      model.id,
    ),
  },
  {
    id: 'history-apply-diff',
    title: '②d 历史图来自另一个模型（本次新增）',
    note:
      '同一块面板、设置区仍是 google/gemini-3-pro-image，但舞台上这张是 openai/gpt-image-2.5-flare 生的：'
      + '结果行的模型 chip 高亮成警告色并标「与设置区不同」，tooltip 里写明两边分别是什么。'
      + '参数回填时，**当前模型不认的取值不会被写进去**（会顶掉下拉框），而是弹一条「N 项与当前模型不符、没有写入」的提示。',
    html: configuredPanel(
      { run: { kind: 'idle' }, preview: imageOtherModel, history: [imageOtherModel, ...history], currentModel: model.id },
      { prompt: imageOtherModel.prompt, params: { aspectRatio: '1:1', resolution: '2K', count: '1', quality: 'medium' }, extra: {} },
      model.id,
    ),
  },
  {
    id: 'history-legacy',
    title: '②e 升级前的记录（本次新增）',
    note: '2026-10-11 之前生成的那批图没有参数快照与实发字段：结果行明说「参数未记录」，而不是留一片空白让人猜。点它只会带回提示词，参数区一动不动。',
    html: configuredPanel({ run: { kind: 'idle' }, preview: imageLegacy, history: [imageLegacy, ...history], currentModel: model.id }),
  },
  {
    id: 'empty',
    title: '③ 空态',
    note: '已配置但还没生成过。',
    html: configuredPanel({ run: { kind: 'idle' }, preview: undefined, history: [] }),
  },
  {
    id: 'entry-empty',
    title: '③c 进面板的初始态：上次生成成功 → 空面板（本次新增）',
    note:
      '老板要求：首次进入生图插件时，如果上一次是成功生成的，**提示词区与图像展示区都为空**。'
      + '历史里那几张图还在下面，点哪张看哪张 —— 不再自动把最新一张推上舞台（原来那个行为会让人误以为「这就是我现在要接着改的」）。',
    html: configuredPanel({ run: { kind: 'idle' }, preview: undefined, history }, { prompt: '' }),
  },
  {
    id: 'entry-draft',
    title: '③d 进面板的初始态：有没生成过的草稿 → 提示词留着（本次新增）',
    note:
      '在面板里写了提示词但没点生成（或者改过之后没生成）——下次进来这句还在，参数也一起回来。'
      + '判据（提示词 ≠ 最后一次成功生成用的那句）在 `promptForEntry()`，跨 DSH 重启靠宿主 `<数据目录>/draft.json`，自检里有它的用例。',
    html: configuredPanel(
      { run: { kind: 'idle' }, preview: undefined, history },
      { prompt: '赛博朋克风格的天津之眼，夜景，霓虹倒影，电影感，超广角' },
    ),
  },
  {
    id: 'params',
    title: '③b 选不同模型 → 界面显示不同的配置参数（本次改造的核心）',
    note:
      '左栏「参数」区完全由所选模型声明的 supported_parameters 生成：模型没声明的字段不显示、也绝不发送。'
      + '三张图是**同一块面板**、只换了模型 —— 参数行的字段个数、控件形态（下拉/文本/数字/开关）与候选值全都跟着变。'
      + '注意第二张（声明最全的模型）多出「尺寸 / 背景」与「高级」分组的「压缩 / 随机种子 / 流式预览」；'
      + '第三张（矢量化模型）的「输出格式」只有 svg 一个候选。'
      + '每个模型下面那行说明还会列出「该模型不声明：质量」这类被隐藏的字段，免得切过来的人以为界面坏了。',
    html: `
      <div style="display:grid;gap:18px">
        ${[
          { model, note: 'google/gemini-3-pro-image —— 只声明 比例 / 分辨率 / 张数（3 项）' },
          { model: modelFull, note: 'openai/gpt-image-2.5-sunburst —— 声明 9 项，含「高级」分组' },
          { model: modelVector, note: 'recraft/recraft-v4-vector —— 只收 svg，参考图上限 1 张' },
        ].map((item) => `
        <div>
          <div class="caseTitle" style="margin-bottom:8px">${item.note}</div>
          <div class="panel_panel" style="min-height:0">
            <div class="panel_body2" style="grid-template-columns:1fr">
              ${render(h(api.Composer, {
                ...composerBase,
                model: item.model,
                parameters: item.model.parameters,
                // 每个模型给它自己合法的默认值，否则下拉会显示成上一个模型的值。
                params: item.model.id === modelVector.id
                  ? { aspectRatio: '1:1', resolution: '1K', count: '1', quality: '高' }
                  : item.model.id === modelFull.id
                    ? { aspectRatio: '16:9', resolution: '1K', count: '1', quality: 'auto' }
                    : { aspectRatio: '16:9', resolution: '1K', count: '1', quality: '高' },
                extra: item.model.id === modelFull.id ? { output_format: 'png', background: 'auto' } : {},
                ...item.model.id === modelFull.id ? { referenceDeclaredMax: 12 } : {},
              }))}
            </div>
          </div>
        </div>`).join('')}
      </div>`,
  },
  {
    id: 'running',
    title: '④ 生成中',
    note: '主按钮换成「取消」，舞台显示进度与已用时。',
    html: configuredPanel({ run: { kind: 'running', startedAt: Date.now() }, elapsedSec: 37, history }),
  },
  {
    id: 'error',
    title: '⑤ 出错',
    note: '提供商返回的原始报错原样展示（不做美化转述），并说明本次未计费。',
    html: configuredPanel({
      run: {
        kind: 'error',
        message: '生成失败',
        detail: '402 Payment Required\nOpenRouter: insufficient credits for model\n"google/gemini-3-pro-image".\nRequest id: gen-1730…-KQm9',
      },
      history,
    }),
  },
  {
    id: 'error-long',
    title: '⑤b 出错（长报错：能滚动 + 可复制）',
    note: '同一个错误态，但把宿主回的诊断行也贴上来。以前 `.stage` 是 overflow:hidden，下半截直接被裁掉且没有滚动条 —— 这就是「报错看不全」。现在错误态自己滚，卡片放宽到整宽，并多了「复制报错」。',
    html: configuredPanel({
      run: { kind: 'error', message: '生成失败', detail: LONG_ERROR_DETAIL },
      history,
    }),
  },
  {
    id: 'hostlog',
    title: '⑧ 宿主日志抽屉（「查看日志」的去处）',
    note: '桌面版 DSH 没有可见的宿主控制台（进程 stdout 无人接管、%APPDATA% 下的 logs 目录是空的），所以日志必须在面板里能看到。这条抽屉读宿主的日志缓冲，并把落盘文件路径明写出来：「生成时到底发了什么」一目了然。',
    html: render(h(api.LogDrawer, {
      state: { kind: 'ready', data: LOG_SAMPLE },
      copied: false,
      hasContent: true,
      onRefresh: noop,
      onCopy: noop,
      onDownload: noop,
      onClose: noop,
    })),
    // 抽屉本体 860px + 遮罩内边距，得给「宽」这一档才不会贴边被裁。
    framed: 'wide',
  },
  {
    id: 'config',
    title: '⑥ 连接配置弹层',    note: '决策 D6：不做独立设置页，全部配置在这里。API Key 已配置时只显示掩码，明文永不下发到浏览器。',
    html: render(h(api.ConfigModal, {
      config, models: [model, { ...model, id: 'openai/gpt-image-1', caps: ['图生图', '蒙版'], price: '$0.042/张' }, { ...model, id: 'black-forest-labs/flux-1.1-pro', caps: ['仅文生图'], price: '$0.040/张', supportsReferences: false }],
      pulling: false, onPullModels: noop, onSave: noop, onClose: noop,
    })),
    framed: true,
  },
]

// 注：历史右键菜单（HistoryMenu）**故意不放进预览页**。
// 它的菜单与遮罩是 `position: fixed`（要跟着鼠标的视口坐标走，不能被祖先裁剪），
// 而一个单文件预览页里没有 iframe 隔离 —— 它会固定浮在视口 (260,120) 上，
// 挡住它下面每一个用例的截图。菜单本身的渲染有 `scripts/render-check.mjs` 覆盖
// （「已经在参考图里了」「参考图已满」两条提示都断言过），真机上看一眼更直接。

// ------------------------------------------------------------- DSH 主题 token

const tokenFiles = ['base.css', 'tokens.css', 'focus.css']
const missing = tokenFiles.filter((name) => !existsSync(path.join(REF, name)))
if (missing.length > 0) {
  throw new Error(`缺少 token 源：${missing.join(', ')}（先跑 .ref 下的解包脚本）`)
}
const tokens = tokenFiles.map((name) => readFileSync(path.join(REF, name), 'utf8').trim()).join('\n\n')

/** 打包产物在首次求值时注入的 CSS Module。 */
const panelCss = injectedStyles.map((style) => style.textContent).join('\n')

// ------------------------------------------------------------------ 输出

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>dsh-imagegen-panel · 真实 UI 离屏预览</title>
<style>
${tokens}

body { margin: 0; padding: 24px 28px 64px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
       font-family: var(--dsw-font-family); font-size: 14px; line-height: 22px; }
h1 { font-size: 18px; margin: 0 0 4px; }
.lead { color: var(--dsw-alias-label-tertiary); font-size: 13px; margin: 0 0 24px; }
.lead code { font-family: var(--ds-font-family-code); }
.case { margin-bottom: 32px; }
.caseHead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.caseTitle { font-size: 14px; font-weight: 600; }
.caseNote { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.frame { height: 760px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
         overflow: hidden; background: var(--dsw-alias-bg-base); position: relative; }
.frame.narrow { height: 560px; max-width: 900px; }
.frame.wide { height: 700px; max-width: 1100px; }
.frame .panel_panel { height: 100%; }
</style>
<style>
/* ==== 打包产物里的 CSS Module（原样注入，未改写）==== */
${panelCss}
</style>
</head>
<body>
<h1>dsh-imagegen-panel · 真实 UI 离屏预览</h1>
<p class="lead">
  本页由 <code>scripts/preview.mjs</code> 生成：用的是**打包后的 lib/client.js** 与它自己注入的 CSS Module，
  配色/圆角/字体走同一批 DSH design token。改完源码 <code>node scripts/build.mjs &amp;&amp; node scripts/preview.mjs</code> 刷新即可，
  不需要碰运行中的 DSH。
</p>
${STATES.map((state) => `
<div class="case" id="${state.id}">
  <div class="caseHead">
    <span class="caseTitle">${state.title}</span>
    <span class="caseNote">${state.note}</span>
  </div>
  <div class="frame${state.framed === true ? ' narrow' : state.framed === 'wide' ? ' wide' : ''}">${state.html}</div>
</div>`).join('\n')}
</body>
</html>
`

const outDir = path.join(root, 'preview')
mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'panel.html')
writeFileSync(outFile, html, 'utf8')

console.log(`token css   ${(tokens.length / 1024).toFixed(1)} KB`)
console.log(`panel css   ${(panelCss.length / 1024).toFixed(1)} KB`)
console.log(`states      ${STATES.length}`)
console.log(`-> ${outFile}  ${(html.length / 1024).toFixed(1)} KB`)
