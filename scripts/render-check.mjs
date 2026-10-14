/**
 * 用真实 React 渲染本插件的各个界面，并断言槽位注册参数。
 *
 * 这是 `build.mjs` 之后、`dsh plugin` 之前的一道关：构建只能证明「能打包」，
 * 但一个坏掉的 hook 顺序、一个错位的 prop 契约、一处 CSS Module 接线错误
 * 都能顺利通过打包，最后只表现为真实 GUI 里的一个空白面板 —— 而那只 GUI
 * 老板正在用，不该拿它当测试台。
 *
 * 做法直接沿用 `dsh-prompt-forge/scripts/render-check.mjs`（同版本、已跑通）：
 *   - `react-dom/server` 的 renderToStaticMarkup（无需 jsdom，不需要真实 DOM）；
 *   - 一个最小的 `document` stub，让 CSS Module 的注入守卫能跑；
 *   - 导出的组件直接喂 props 驱动，覆盖各状态。
 *
 * 用法：node scripts/render-check.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * 依赖解析：本包刻意不建 node_modules，react / react-dom 从已验证的样板包里取。
 *
 * 注意不能按文件路径拼 —— `react-dom/server` 是 package exports 的子路径，
 * 必须走 Node 的解析器，所以这里用一个锚点文件建出 require。
 */
const SAMPLES = [
  // 本机开发布局：同版本的样板插件与本包目录并排。公开 clone 直接
  // `npm install`，第二条 root 就会命中，这里只是兜底。
  process.env.DSH_SAMPLE_ROOT || path.join(root, '..', 'dsh-prompt-forge'),
  root,
]

function requireFrom(specifier) {
  const tried = []
  for (const base of SAMPLES) {
    const anchor = path.join(base, 'package.json')
    if (!existsSync(anchor)) { tried.push(`${anchor}（不存在）`); continue }
    try {
      return createRequire(anchor)(specifier)
    } catch (error) {
      tried.push(`${anchor} → ${error?.code ?? error?.message ?? error}`)
    }
  }
  throw new Error(`找不到 ${specifier}。已尝试：\n  ${tried.join('\n  ')}`)
}

const React = requireFrom('react')
const ReactDOMServer = requireFrom('react-dom/server')

// ------------------------------------------------------------------ 断言

const failures = []
let total = 0

function check(ok, label) {
  total += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures.push(label)
}

function checkContains(haystack, needle, label) {
  check(haystack.includes(needle), `${label}  ← 期待包含 ${JSON.stringify(needle)}`)
}

function render(element, label) {
  try {
    return ReactDOMServer.renderToStaticMarkup(element)
  } catch (error) {
    check(false, `${label} 渲染未抛错  ← ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

// ------------------------------------------------- CSS Module 注入需要的 DOM

/** 被 shim 收集到的 <style>，用来观察 CSS 注入是否真的发生。 */
const injectedStyles = []

globalThis.document = {
  head: {
    children: [],
    appendChild(node) { this.children.push(node); injectedStyles.push(node) },
  },
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

// ------------------------------------------------------------ 载入 bundle

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const PACKAGE_NAME = manifest.name

/** 载入的 bundle 记录。 */
let loaded = null

globalThis.window = {
  __ModuleLoader__: {
    load(record) { loaded = record },
  },
}

const bundlePath = path.join(root, 'lib', 'client.js')
const bundleSource = readFileSync(bundlePath, 'utf8')

// bundle 是 classic script（自注册到 window.__ModuleLoader__），所以用间接 eval 跑。
// eslint-disable-next-line no-new-func
new Function('window', 'document', bundleSource)(globalThis.window, globalThis.document)

check(loaded !== null, 'bundle 调用了 window.__ModuleLoader__.load')
check(loaded?.id === PACKAGE_NAME, `bundle id 等于 package.json 的 name（期望 ${PACKAGE_NAME}，实际 ${loaded?.id}）`)

if (loaded === null) {
  console.error('\nbundle 没有自注册，后续检查无法进行')
  process.exit(1)
}

/** 平台种子模块表：本插件只依赖 react。 */
const seeded = { react: React }

const clientExports = loaded.factory((id) => {
  if (seeded[id] !== undefined) return seeded[id]
  throw new Error(`${PACKAGE_NAME}: 运行期请求了未提供的平台模块 "${id}"`)
})

check(typeof clientExports.apply === 'function', '导出 apply')
check(Array.isArray(clientExports.inject), '导出 inject 数组')
check(clientExports.inject?.includes('slots') === true, "inject 声明了 'slots'（技能铁律 3）")
check(clientExports.PANEL_ID === 'imagegen', "PANEL_ID 是 'imagegen'")

// ---------------------------------------------------- apply() 的槽位注册

/** 记录 apply() 注册了哪些槽位。 */
const registrations = []

const stubSlots = {
  register(options, component) {
    registrations.push({ options, component })
    return () => {}
  },
  inject(key, callback) {
    registrations.push({ injected: key })
    return callback()
  },
}

clientExports.apply({ get: (name) => (name === 'slots' ? stubSlots : undefined) })

const sidebar = registrations.find((item) => item.options?.name === 'sidebar.panellist')
const main = registrations.find((item) => item.options?.name === 'main')

check(sidebar !== undefined, '注册了 sidebar.panellist')
check(main !== undefined, '注册了 main')
check(sidebar?.options?.id === 'imagegen', "sidebar.panellist 的 id 是 'imagegen'")
check(sidebar?.options?.order === -1, 'sidebar.panellist 的 order 是 -1（排在「插件」order=0 之上）')
check(typeof sidebar?.options?.label === 'function' && sidebar.options.label() === '生图', "sidebar.panellist 的 label() 返回「生图」")
check(main?.options?.key === 'imagegen', "main 的 key 是 'imagegen'（与侧栏 id 相同 —— 这就是 A1/A2 的接线）")
check(sidebar?.options?.id === main?.options?.key, '侧栏 id 与主区 key 完全一致')

// 退化路径：slots 不可用时 apply() 不能抛（抛错会把整个 web 启动带下水）。
let degradedThrew = false
try {
  clientExports.apply({ get: () => undefined })
} catch {
  degradedThrew = true
}
check(!degradedThrew, 'slots 不可用时 apply() 退化为静默跳过而不是抛出')

// --------------------------------------------------------------- 组件渲染

const h = React.createElement

// 侧栏图标：壳下发 size / active，必须按 size 渲染。
const icon16 = render(h(clientExports.SidebarIcon, { size: 16, active: false }), 'SidebarIcon(16)')
checkContains(icon16, 'width="16"', 'SidebarIcon 用壳下发的 size=16')
checkContains(icon16, 'height="16"', 'SidebarIcon 高度跟随 size')

const icon18 = render(h(clientExports.SidebarIcon, { size: 18, active: true }), 'SidebarIcon(18)')
checkContains(icon18, 'width="18"', 'SidebarIcon 跟随收起态的 size=18')

// 主面板：首帧（配置尚未回来 → 按未配置渲染完整骨架，不是空白）。
const panel = render(h(clientExports.ImageGenPanel), 'ImageGenPanel 首帧')
checkContains(panel, '生图', '面板标题「生图」')
checkContains(panel, '还没配置生图服务', '未配置时显示引导条')
checkContains(panel, '提示词', '渲染出提示词输入区')
checkContains(panel, '参考图', '渲染出参考图槽')
checkContains(panel, '比例', '渲染出比例参数')
checkContains(panel, '分辨率', '渲染出分辨率参数')
checkContains(panel, '张数', '渲染出张数参数')
checkContains(panel, '质量', '渲染出质量参数')
checkContains(panel, '历史记录', '渲染出历史条标题')
checkContains(panel, '还没有图片', '未出图时舞台为空态')
checkContains(panel, '连接配置', '页头有「连接配置」按钮')
// 首帧还没拉到模型目录（`model` 为 undefined）→ 走「没有能力表」那条退化的老路。
checkContains(panel, '官方全局枚举', '没有能力表时如实说明用的是官方全局枚举')
check(panel.includes('disabled'), '未配置时生成按钮为 disabled')
// 首帧的输入框必须是**空的**：这句演示文案原来写死在 `panelStore.prompt` 里，
// 于是每次重启 DSH 进面板都会看到一句自己没写过的话。
// （placeholder 里那句举例保留 —— 那是提示，不是内容。）
const textarea = /<textarea[^>]*>([\s\S]*?)<\/textarea>/u.exec(panel)
check(textarea !== null && textarea[1].trim() === '', '首帧提示词框是空的（不再把演示文案当内容填进去）')

// 进面板的初始态是「提示词按草稿、舞台一律为空」。前者由 promptForEntry 的用例覆盖，
// 后者是结构性的（挂载 effect 里不再自动选中最新历史图）—— 用源码级断言守住它，
// 免得哪天又有人把「历史有图就自动上图」加回来。
const panelSource = readFileSync(path.join(root, 'src', 'client', 'ImageGenPanel.tsx'), 'utf8')
check(!panelSource.includes('seeded[0]'), '没有「首屏自动选中最新一张历史图」那段代码（图像展示区进面板一律为空）')

// Composer：已配置、可生成。
const params = { aspectRatio: '16:9', resolution: '1K', count: '1', quality: '高' }
const model = {
  id: 'google/gemini-3-pro-image',
  caps: ['图生图'],
  price: '$0.039/张',
  supportsReferences: true,
  references: { min: 0, max: 14 },
  options: {
    aspectRatio: ['16:9', '1:1'],
    resolution: ['1K', '2K'],
    count: ['1'],
    quality: ['高'],
    outputFormat: ['png', 'jpeg', 'webp'],
  },
  // 真实形状（2026-10-10 探测）：只有比例 / 分辨率 / 张数 / 参考图四类，
  // **没有** quality、**没有** output_format —— 这正是「按模型变形」要体现的差异。
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['1:1', '4:3', '3:4', '16:9'], clearable: false, default: '1:1', hint: '该模型声明的比例' },
    { name: 'resolution', label: '分辨率', control: 'select', valueType: 'string', group: 'output', values: ['1K', '2K'], clearable: false, default: '1K', hint: '标准化档位' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1'], min: 1, max: 1, clearable: false, default: '1', hint: '上游可以返回更少' },
  ],
  supportsStreaming: false,
}

/** 只收 svg、参考图上限 1 张的矢量化模型（实测形状）。 */
const vectorModel = {
  id: 'recraft/recraft-v4-vector',
  caps: ['图生图'],
  price: '$0.035/张',
  supportsReferences: true,
  references: { min: 0, max: 1 },
  options: { aspectRatio: ['1:1'], resolution: [], count: ['1'], quality: [], outputFormat: ['svg'] },
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['1:1'], clearable: false, default: '1:1', hint: '' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1', '2', '3', '4', '5', '6'], min: 1, max: 6, clearable: false, default: '1', hint: '' },
    { name: 'output_format', label: '输出格式', control: 'select', valueType: 'string', group: 'output', values: ['svg'], clearable: false, default: 'svg', hint: '矢量模型只收 svg' },
  ],
  supportsStreaming: false,
}

/** 改图专用：参考图**必填**（实测 recraft-v4-styles 那四个）。 */
const refRequiredModel = {
  id: 'recraft/recraft-v4-styles',
  caps: ['改图必填底图'],
  price: '$0.035/张',
  supportsReferences: true,
  references: { min: 1, max: 10 },
  options: { aspectRatio: ['1:1'], resolution: [], count: ['1'], quality: [], outputFormat: [] },
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['1:1', '2:1', '1:2'], clearable: false, default: '1:1', hint: '' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1', '2'], min: 1, max: 2, clearable: false, default: '1', hint: '' },
  ],
  supportsStreaming: false,
}

/**
 * 声明得最全的模型（真实形状取 `openai/gpt-image-2.5-sunburst` 那一类）：
 * 十个字段里它声明了八个，用来验证「高级」分组与各控件形态都渲染得出来。
 */
const fullModel = {
  id: 'openai/gpt-image-2.5-sunburst',
  caps: ['图生图', '图像编辑'],
  price: '$0.041/张',
  supportsReferences: true,
  references: { min: 0, max: 10 },
  options: { aspectRatio: ['1:1', '16:9'], resolution: ['1K', '2K'], count: ['1', '2'], quality: ['low', 'medium', 'high'], outputFormat: ['png', 'jpeg', 'webp'] },
  parameters: [
    { name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output', values: ['1:1', '16:9'], clearable: false, default: '1:1', hint: '' },
    { name: 'size', label: '尺寸', control: 'text', valueType: 'string', group: 'output', clearable: true, default: '', hint: '档位或像素' },
    { name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output', values: ['1', '2', '3', '4'], min: 1, max: 4, clearable: false, default: '1', hint: '' },
    { name: 'quality', label: '质量', control: 'select', valueType: 'string', group: 'output', values: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], clearable: false, default: 'auto', hint: '每个模型只收自己声明的那几档' },
    { name: 'output_format', label: '输出格式', control: 'select', valueType: 'string', group: 'output', values: ['png', 'jpeg', 'webp'], clearable: false, default: 'png', hint: '' },
    { name: 'background', label: '背景', control: 'select', valueType: 'string', group: 'output', values: ['auto', 'transparent', 'opaque'], clearable: false, default: 'auto', hint: 'transparent 要求 png/webp' },
    { name: 'output_compression', label: '压缩', control: 'number', valueType: 'integer', group: 'advanced', min: 0, max: 100, clearable: true, default: '', hint: '' },
    { name: 'seed', label: '随机种子', control: 'number', valueType: 'integer', group: 'advanced', clearable: true, default: '', hint: '留空 = 每次随机' },
    { name: 'stream', label: '流式预览', control: 'toggle', valueType: 'boolean', group: 'advanced', clearable: false, default: 'false', hint: '' },
  ],
  supportsStreaming: true,
}

const composerReady = render(h(clientExports.Composer, {
  prompt: '一只柴犬',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model,
  parameters: model.parameters,
  running: false,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: 94,
  onOptimize: () => {},
  optimizing: false,
  canUndo: false,
  onUndo: () => {},
}), 'Composer（可生成）')

checkContains(composerReady, '一只柴犬', 'Composer 回显提示词')
checkContains(composerReady, '优化提示词', '有「优化提示词」按钮')
check(!composerReady.includes('阶段 4 接入 LLM 渠道后启用'), '优化按钮不再是那个死占位')
check(!composerReady.includes('优化中…'), '没在优化时不显示「优化中…」')
check(!composerReady.includes('>撤销<'), '没优化过时不显示「撤销」')

// 优化中：按钮变「优化中…」、输入框只读。
const composerOptimizing = render(h(clientExports.Composer, {
  prompt: '一只柴犬',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model,
  running: false,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: 94,
  onOptimize: () => {},
  optimizing: true,
  canUndo: false,
  onUndo: () => {},
}), 'Composer（优化中）')
checkContains(composerOptimizing, '优化中…', '优化中按钮文案')
checkContains(composerOptimizing, 'readonly', '优化中输入框只读（不能被手改打断流式写入）')
check(!composerReady.includes('readonly'), '不优化时输入框可编辑')

/** 造一个 Composer（只覆盖关心的字段），省得每个用例把 18 个 prop 抄一遍。 */
const composerWith = (overrides) => render(h(clientExports.Composer, {
  prompt: '一只柴犬',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model,
  running: false,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: undefined,
  onOptimize: () => {},
  optimizing: false,
  canUndo: false,
  onUndo: () => {},
  ...overrides,
  // 生产里 `parameters` 由面板从「模型列表 / 能力接口」算好再传下来，
  // `Composer` 自己不认识 `model.parameters`。这里照同一条链路补上，
  // 除非用例显式给了 `parameters`（`[]` 就是「这个协议没有能力表」）。
  parameters: overrides.parameters ?? overrides.model?.parameters ?? model.parameters,
}), `Composer（${overrides.model?.id ?? '默认'}）`)

// 模型驱动：参数行完全由该模型声明的字段决定。
// gemini 那款**不声明** quality / output_format → 这两个下拉不该出现；
// 参考图上限 1 张的 vectorModel → 计数用模型自己的值。
const composerNarrow = composerWith({ model: vectorModel })
checkContains(composerNarrow, '（0/1）', '参考图计数用模型自己的上限（1 张），不是写死的 4')

// 该模型只收 svg：**有参数表时**输出格式就是参数行里的一行下拉，候选值只有 svg ——
// 用户结构上选不出越界值，所以不会出现「配置里那个格式该模型不接受」的警告。
const composerFormat = composerWith({ model: vectorModel, outputFormat: 'png' })
check(!composerFormat.includes('不在该模型的枚举里'), '有参数表时格式由模型枚举决定，不报「配置不符」')

// 没有能力表那条路才会出现「配置里的格式该模型不接受」——那时的候选值来自列表接口。
const noTableVector = { ...vectorModel, parameters: [] }
const composerFormatLegacy = composerWith({ model: noTableVector, parameters: [], outputFormat: 'png' })
checkContains(composerFormatLegacy, '不在该模型的枚举里', '没有能力表且格式不符时照样点明')
const composerFormatOk = composerWith({ model: noTableVector, parameters: [], outputFormat: 'svg' })
check(!composerFormatOk.includes('不在该模型的枚举里'), '格式合法时不报警')

// ---------- 模型驱动参数行：不同模型 → 不同的配置参数 ----------

// ① gemini 款只有比例 / 分辨率 / 张数：没有质量、没有输出格式。
const composerGemini = composerWith({ model })
checkContains(composerGemini, '比例', 'gemini 款渲染「比例」')
checkContains(composerGemini, '分辨率', 'gemini 款渲染「分辨率」')
check(!/>质量</u.test(composerGemini), 'gemini 款不渲染「质量」（它没声明 quality）')
check(!composerGemini.includes('输出格式'), 'gemini 款不渲染「输出格式」')
checkContains(composerGemini, '该模型不声明：质量', '把没声明的参数如实列出来')

// ② 矢量化模型：比例只有 1:1、张数到 6、输出格式只有 svg。
const composerVectorFields = composerWith({ model: vectorModel })
checkContains(composerVectorFields, '<option value="svg"', '矢量化模型的输出格式只有 svg')
checkContains(composerVectorFields, '<option value="6"', '张数上限到 6（该模型 n 的 max）')

// ③ 声明得最全的模型：十个字段里出八个，且分「输出规格 / 高级」两组。
const composerFull = composerWith({ model: fullModel })
checkContains(composerFull, '尺寸', '渲染 `size`（自由文本）')
checkContains(composerFull, '背景', '渲染 `background`')
checkContains(composerFull, '压缩', '渲染 `output_compression`')
checkContains(composerFull, '随机种子', '渲染 `seed`')
checkContains(composerFull, '流式预览', '渲染 `stream`（开关）')
checkContains(composerFull, '高级', '有「高级」分组标题')
checkContains(composerFull, 'role="switch"', '开关用 role=switch 渲染')
checkContains(composerFull, '允许 0 – 100', '数值字段标出该模型声明的区间')
checkContains(composerFull, '留空 = 每次随机', 'seed 标明留空语义')

// ④ 这些参数**必须**只在该模型声明时出现：gemini 款没有 seed / background。
check(!composerGemini.includes('随机种子'), 'gemini 款不渲染 seed')
check(!composerGemini.includes('背景'), 'gemini 款不渲染 background')

// ⑤ 没有能力表的协议（`parameters` 为空）→ 退回固定四项 + 官方全局枚举。
const composerNoTable = composerWith({ model: { ...model, parameters: [] } })
checkContains(composerNoTable, '该协议没有能力表', '没有能力表时如实说明')
checkContains(composerNoTable, '<option value="9:16">9:16</option>', '没有能力表时给官方全局枚举（含 9:16）')
check(!composerNoTable.includes('随机种子'), '没有能力表时不凭空造出 seed 这类字段')

// ⑥ 字段之间的约束：background=transparent 但格式是 jpeg → 必须提醒。
const composerTransparentBad = composerWith({
  model: fullModel,
  extra: { output_format: 'jpeg', background: 'transparent' },
})
checkContains(composerTransparentBad, 'transparent', '背景与格式冲突时点名 transparent')
checkContains(composerTransparentBad, '搭配 png 或 webp', '说清官方要求')
const composerTransparentOk = composerWith({
  model: fullModel,
  extra: { output_format: 'png', background: 'transparent' },
})
check(!composerTransparentOk.includes('搭配 png 或 webp'), '格式是 png 时不报警')

// ⑦ 参数摘要只列实际显示的字段（不再硬写「张数 · 比例 · 分辨率」）。
checkContains(composerGemini, '比例 16:9', '摘要里出现「比例 16:9」')
checkContains(composerFull, '尺寸', '全字段模型的摘要不为空')

// ⑧ 参考图上限被网关全局上限压下来时要解释差额（tencent 声明 20、接口只收 16）。
const composerClamped = composerWith({
  model: { ...fullModel, references: { min: 0, max: 16 } },
  referenceDeclaredMax: 20,
})
checkContains(composerClamped, '该模型声明 20 张，接口全局上限 16 张', '参考图上限被全局收敛时解释差额')
const composerUnclamped = composerWith({ model: fullModel, referenceDeclaredMax: 10 })
check(!composerUnclamped.includes('接口全局上限'), '没有差额时不啰嗦')

// ⑨ 「连接配置 → 额外参数」会覆盖面板上看得见的字段 —— 生成前就得说。
// 宿主侧那段 JSON 是最后无条件合并的，本机默认配置里就写着 output_compression: 90。
const composerOverridden = composerWith({ model: fullModel, overriddenFields: ['压缩', '背景'] })
checkContains(composerOverridden, '覆盖', '被「额外参数」覆盖时给出警示')
checkContains(composerOverridden, '压缩、背景', '点名是哪几个字段被覆盖')
checkContains(composerOverridden, '额外参数', '说清是谁覆盖的（用户才知道去哪改）')
const composerNoOverride = composerWith({ model: fullModel })
check(!composerNoOverride.includes('里写死了'), '没有冲突时不显示这条警示')

// ⑩ 参考图体积：有图时显示用量（它是「为什么加不进下一张」的一个真实原因）。
// 这里给一张 2 MB 字符的假图，断言用量与总预算都显示出来。
const bigReference = [{ id: 'r1', name: 'big.png', dataUrl: `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}` }]
const composerBudget = composerWith({ model: fullModel, references: bigReference })
checkContains(composerBudget, '2.0 MB/20.0 MB', '参考图用量与总预算都显示出来')

// ⑩ 超上限的模型：加号槽位必须禁用并说明原因（不然用户点了没反应，只能自己猜）。
const fullRefs = Array.from({ length: 10 }, (_item, index) => ({
  id: `r${index}`, name: `r${index}.png`, dataUrl: 'data:image/png;base64,AAAA',
}))
const composerAtLimit = composerWith({ model: fullModel, references: fullRefs })
checkContains(composerAtLimit, '最多 10 张', '到上限时加号槽位说明上限')

// ⑪ 图生图：参考图被下采样时要如实标出来（不能让用户以为发的是原图）。
const composerShrunk = composerWith({
  model: fullModel,
  references: [{ id: 'r1', name: 'huge.png', dataUrl: 'data:image/png;base64,AAAA', note: '已自动缩小（4096×4096 → 2048×2048）' }],
})
checkContains(composerShrunk, '已缩小', '下采样过的参考图在角标上标出来')
checkContains(composerShrunk, '4096×4096 → 2048×2048', '缩图说明带原始尺寸（title 里可查）')

// 改图专用模型：不给底图就生成不了，界面上先说清原因。
const composerRefRequired = composerWith({ model: refRequiredModel })
checkContains(composerRefRequired, '必填 · 至少 1 张', '必填底图的模型在参考图槽说明')
checkContains(composerRefRequired, '改图专用', '说清为什么生成按钮不可用')
checkContains(composerRefRequired, 'disabled', '必填底图缺失时生成按钮禁用')
// 断言「带 disabled 的那个 button 就是写着『生成』那个」——只看到 disabled 出现在
// 某处是不够的（别的按钮也可能禁用）。
check(/<button[^>]*disabled[^>]*>[\s\S]{0,600}?生成<\/button>/u.test(composerRefRequired), '禁用的正是「生成」按钮  ← 没找到带 disabled 的生成按钮')

const composerRefSatisfied = composerWith({
  model: refRequiredModel,
  references: [{ id: 'r1', name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }],
})
check(!composerRefSatisfied.includes('改图专用'), '给足了底图就不再提示')
checkContains(composerRefSatisfied, '（1/10）', '给足后计数按模型上限显示')

// 优化完成：出现「撤销」。
const composerUndo = render(h(clientExports.Composer, {
  prompt: '一只戴耳机的柴犬，午后阳光，胶片质感，浅景深，暖色调，窗边',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model,
  running: false,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: 94,
  onOptimize: () => {},
  optimizing: false,
  canUndo: true,
  onUndo: () => {},
}), 'Composer（优化完可撤销）')
checkContains(composerUndo, '撤销', '优化完成后出现「撤销」')

// 空提示词：优化按钮禁用（没东西可优化），并说清原因。
const composerEmpty = render(h(clientExports.Composer, {
  prompt: '   ',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model,
  running: false,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: undefined,
  onOptimize: () => {},
  optimizing: false,
  canUndo: false,
  onUndo: () => {},
}), 'Composer（空提示词）')
checkContains(composerEmpty, '先写点内容再优化', '空提示词时按钮给出原因')
checkContains(composerReady, 'google/gemini-3-pro-image', 'Composer 显示当前模型')
checkContains(composerReady, '上次耗时 94s', 'Composer 显示上次耗时')
// 参数候选值来自模型能力：这里给的是 ['16:9','1:1']，不应出现 9:16。
checkContains(composerReady, '<option value="1:1">1:1</option>', '比例候选值来自模型能力')
check(!composerReady.includes('9:16'), '比例里**没有**硬编码的 9:16（候选值确实由模型驱动）')

// Composer：生成中 → 主按钮换成「取消」。
const composerRunning = render(h(clientExports.Composer, {
  prompt: '一只柴犬',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model,
  running: true,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: 94,
  onOptimize: () => {},
  optimizing: false,
  canUndo: false,
  onUndo: () => {},
}), 'Composer（生成中）')

checkContains(composerRunning, '取消', '生成中时出现「取消」')
check(!composerRunning.includes('>生成<'), '生成中时主按钮不再是「生成」')

// Composer：不支持参考图的模型 → 参考图槽禁用。
const composerNoRef = render(h(clientExports.Composer, {
  prompt: 'x',
  onPromptChange: () => {},
  references: [],
  onAddReference: () => {},
  onRemoveReference: () => {},
  params,
  onParamChange: () => {},
  model: { ...model, supportsReferences: false },
  running: false,
  notConfigured: false,
  onGenerate: () => {},
  onCancel: () => {},
  onOpenModelPicker: () => {},
  lastSeconds: undefined,
  onOptimize: () => {},
  optimizing: false,
  canUndo: false,
  onUndo: () => {},
}), 'Composer（模型不支持参考图）')

checkContains(composerNoRef, '当前模型不支持', '不支持参考图的模型会提示并禁用参考图槽')
checkContains(composerNoRef, '尚无记录', '没有历史时显示「尚无记录」而不是假的耗时')

// 结果舞台：三种状态各渲染一次，都不许抛。
const baseImage = {
  id: 'gen-1',
  art: 'a',
  size: '1536 × 864',
  cost: 0.0391,
  seconds: 37,
  prompt: '一只柴犬',
  aspectRatio: '16:9',
  resolution: '1K',
  createdAt: Date.UTC(2026, 9, 9, 13, 14),
  // 只落在插件目录（没配「自动保存目录」时的样子）。
  savedPath: 'C:\\Users\\you\\.dsh\\dsh-imagegen-panel\\out\\x.png',
}

/** 配了「自动保存目录」之后：多一份 autoSavedPath，界面优先显示它。 */
const autoSavedImage = {
  ...baseImage,
  autoSavedPath: 'D:\\DSH\\.dsh-imagegen\\out\\x.png',
}

const stageProps = {
  preview: undefined,
  elapsedSec: 0,
  onCancel: () => {},
  onRetry: () => {},
  onViewLog: () => {},
  onSave: () => {},
  onSaveAs: () => {},
  onCopy: () => {},
  onOpen: () => {},
  onRegenerate: () => {},
  history: [],
  onSelectHistory: () => {},
  onClearHistory: () => {},
}

const stageEmpty = render(h(clientExports.ResultStage, { ...stageProps, run: { kind: 'idle' } }), 'ResultStage（空态）')
checkContains(stageEmpty, '还没有图片', '空态文案')

const stageRunning = render(h(clientExports.ResultStage, { ...stageProps, run: { kind: 'running', startedAt: Date.now() }, elapsedSec: 37 }), 'ResultStage（生成中）')
checkContains(stageRunning, '正在生成…', '生成中文案')
checkContains(stageRunning, '已用时 37s', '生成中计时')
checkContains(stageRunning, '取消生成', '生成中有取消按钮')

const stageError = render(h(clientExports.ResultStage, {
  ...stageProps,
  run: { kind: 'error', message: '生成失败', detail: '402 Payment Required\nOpenRouter: insufficient credits' },
}), 'ResultStage（出错）')
checkContains(stageError, '生成失败', '出错文案')
checkContains(stageError, '402 Payment Required', '原始报错原样展示（不做美化）')
checkContains(stageError, '本次未计费', '出错时说明未计费')
checkContains(stageError, '重试', '出错时有重试')
// 「报错看不全」的两道补丁：错误态自己能滚（.stage 是 overflow:hidden），
// 以及一键复制全文（上游原话 + code + 实际发送的字段都在 detail 里）。
checkContains(stageError, 'stageInnerErr', '错误态换成可滚动布局（长报错不再被舞台裁掉）')
checkContains(stageError, 'errCardWide', '错误卡片放宽到整宽（长 URL / JSON 少折行）')
checkContains(stageError, '复制报错', '错误态提供「复制报错」')
checkContains(stageError, '查看日志', '错误态仍然能打开宿主日志')

const stageDone = render(h(clientExports.ResultStage, {
  ...stageProps,
  run: { kind: 'done', image: baseImage },
  preview: baseImage,
  history: [baseImage],
}), 'ResultStage（已出图）')
checkContains(stageDone, '已存到插件目录 C:\\Users\\you\\.dsh\\dsh-imagegen-panel\\out\\x.png', '没配自动保存目录时，结果条显示插件目录里的路径')

// 配了自动保存目录：优先显示工作区那份（用户真正会去找的地方）。
const stageAutoSaved = render(h(clientExports.ResultStage, {
  ...stageProps,
  run: { kind: 'done', image: autoSavedImage },
  preview: autoSavedImage,
  history: [autoSavedImage],
}), 'ResultStage（自动另存到工作区）')
checkContains(stageAutoSaved, '已自动保存到 D:\\DSH\\.dsh-imagegen\\out\\x.png', '配了自动保存目录时，结果条显示工作区路径')
checkContains(stageDone, '$0.0391', '花费角标显示 usage.cost')
checkContains(stageDone, '1536 × 864', '尺寸角标')
checkContains(stageDone, '保存', '结果条有「保存」按钮（A8）')
checkContains(stageDone, '另存为', '结果条有「另存为…」')
checkContains(stageDone, '重新生成', '结果条有「重新生成」')
checkContains(stageDone, '打开', '结果条有「打开」按钮（用系统默认程序打开这张图的本地原图）')
checkContains(stageDone, '2026-10-09', '结果条显示时间')

// 真图路径（阶段 4）：有 imageUrl 时渲染 <img>，而不是占位插画。
const realImage = {
  ...baseImage,
  imageUrl: '/dsh-imagegen/image/gen-real',
  size: '1536 × 864',
  count: 3,
}
const stageReal = render(h(clientExports.ResultStage, {
  ...stageProps,
  run: { kind: 'done', image: realImage },
  preview: realImage,
  history: [realImage],
}), 'ResultStage（真图 + n>1）')
checkContains(stageReal, '<img', '有 imageUrl 时渲染真图 <img>')
checkContains(stageReal, 'src="/dsh-imagegen/image/gen-real"', 'img 指向宿主的图片路由')
checkContains(stageReal, '1536 × 864 · 1K', '角标显示量出来的真实尺寸')
checkContains(stageReal, '3 张', 'n>1 时角标显示张数')
checkContains(stageReal, 'loading="lazy"', '历史/舞台的图懒加载（历史很多张时不一次性拉爆）')

// 相对路径解析：宿主给的是 `dsh-imagegen/image/<id>`，客户端要按挂载点补成绝对路径。
const mapped = clientExports.toImage({ id: 'gen-1', imageUrl: 'dsh-imagegen/image/gen-1', size: '1024 × 1024' })
check(mapped?.imageUrl === '/dsh-imagegen/image/gen-1', `toImage 把相对 imageUrl 解析成挂载点下的绝对路径（实际 ${JSON.stringify(mapped?.imageUrl)}）`)
check(clientExports.toImage({ id: 'gen-2' })?.imageUrl === undefined, '没有 imageUrl 时不编一个（退回占位插画）')

// 历史图右键菜单：三项 + 每种「点不了」的原因都要说清楚。
const menuProps = {
  image: baseImage,
  x: 120,
  y: 400,
  alreadyReference: false,
  atLimit: false,
  busy: false,
  onUseAsReference: () => {},
  onSaveToWorkspace: () => {},
  onCopy: () => {},
  onOpen: () => {},
  onClose: () => {},
}
const menu = render(h(clientExports.HistoryMenu, menuProps), 'HistoryMenu')
checkContains(menu, '打开', '右键菜单有「打开」（用系统默认程序打开本地原图）')
checkContains(menu, '用系统默认程序打开原图', '「打开」说清了用的是什么程序（不是含糊的「打开」）')
// 两个 needle 都必须在场再比位置：任一缺失时 indexOf 给 -1，而 `-1 < n` 恒真 ——
// 只比大小会让「文案被整个删掉」这种情况悄悄通过。
const openHintAt = menu.indexOf('用系统默认程序打开原图')
const referenceAt = menu.indexOf('作为参考图')
check(openHintAt >= 0 && referenceAt >= 0 && openHintAt < referenceAt, '「打开」排在菜单第一项（最高频的动作不该埋在下面）')
checkContains(menu, '作为参考图', '右键菜单有「作为参考图」')
checkContains(menu, '保存到工作区', '右键菜单有「保存到工作区」')
checkContains(menu, '复制图片', '右键菜单有「复制图片」')
checkContains(menu, '把这张图作为图生图的底图', '菜单项带说明文字')
checkContains(menu, 'role="menu"', '菜单有 role=menu（可访问性）')
checkContains(menu, 'role="menuitem"', '菜单项有 role=menuitem')

const menuAlready = render(h(clientExports.HistoryMenu, { ...menuProps, alreadyReference: true }), 'HistoryMenu（已在参考图里）')
checkContains(menuAlready, '已经在参考图里了', '已加过时说明「已经在参考图里了」')
const menuLimit = render(h(clientExports.HistoryMenu, { ...menuProps, atLimit: true }), 'HistoryMenu（参考图已满）')
checkContains(menuLimit, '参考图已满', '满员时说明「参考图已满」')

const strip = render(h(clientExports.HistoryStrip, {
  items: [baseImage],
  selectedId: baseImage.id,
  onSelect: () => {},
  onClear: () => {},
  onContextMenu: () => {},
}), 'HistoryStrip（带右键）')
checkContains(strip, '右键更多操作', '历史缩略图的 tooltip 提示可以右键')

// ---------------------------------------------------------------------------
// 结果行第二行：这张图当时用的模型与参数（老板截图里红线标出的位置）
// ---------------------------------------------------------------------------

/**
 * 一张「新记录」：模型、参数快照、实发字段都齐。
 *
 * 刻意让**面板值**与**实发值**不一样（面板 medium、实发 high）：那正是
 * 「配置里那段额外参数把面板值覆盖掉」的样子，用来验证结果行显示的是实发值。
 */
const factsImage = {
  ...baseImage,
  model: 'openai/gpt-image-2.5-flare',
  params: {
    aspectRatio: '16:9',
    resolution: '1K',
    count: 1,
    quality: 'medium',
    extra: { background: 'auto' },
  },
  sentFields: {
    aspect_ratio: '16:9',
    resolution: '1K',
    quality: 'high',
    n: '1',
    output_format: 'png',
    background: 'opaque',
  },
  referenceCount: 2,
}

const factsSame = render(
  h(clientExports.HistoryFacts, { image: factsImage, currentModel: 'openai/gpt-image-2.5-flare' }),
  'HistoryFacts（同模型）',
)
checkContains(factsSame, '模型 openai/gpt-image-2.5-flare', '结果行显示「这张图当时的模型」')
checkContains(factsSame, '比例 16:9', '显示比例')
checkContains(factsSame, '分辨率 1K', '显示分辨率')
checkContains(factsSame, '张数 1', '显示张数')
checkContains(factsSame, '质量 high', '参数显示的是**实发值**（high）')
check(!factsSame.includes('medium'), '绝不显示被覆盖掉的面板值（medium）—— 那种「以为设上了」正是这次要消灭的')
checkContains(factsSame, '参考图 2 张', '参考图只显示张数（data URL 不落盘）')
checkContains(factsSame, '+3', '条目超过一行能放下的数量时折成「+N」（老板要求考虑长度）')
checkContains(factsSame, '背景 opaque', '被折起的条目在 tooltip（title）里仍能看到全文')
check(!factsSame.includes('与设置区不同'), '模型与设置区一致时不乱标')

const factsDiff = render(
  h(clientExports.HistoryFacts, { image: factsImage, currentModel: 'google/gemini-3-pro-image' }),
  'HistoryFacts（模型不同）',
)
checkContains(factsDiff, '与设置区不同', '模型与设置区不一致时明确标出来（点历史图**不改**设置区的模型）')
checkContains(factsDiff, 'factModelDiff', '不一致时模型 chip 走高亮样式')
checkContains(factsDiff, '生成这张图用的是 openai/gpt-image-2.5-flare', 'tooltip 说清这张是哪个模型生的')
checkContains(factsDiff, '设置区当前选中的是 google/gemini-3-pro-image', 'tooltip 说清设置区当前是什么')

// 升级前的记录：只有模型，没有参数/实发字段 —— 必须明说，不能留白让人猜。
const legacyFacts = render(
  h(clientExports.HistoryFacts, { image: { ...baseImage, model: 'old/model' }, currentModel: 'google/gemini-3-pro-image' }),
  'HistoryFacts（升级前的记录）',
)
checkContains(legacyFacts, '模型 old/model', '老记录照样显示模型')
checkContains(legacyFacts, '参数未记录', '老记录明说「参数未记录」（不伪造、不留白）')

const olderFacts = render(h(clientExports.HistoryFacts, { image: baseImage }), 'HistoryFacts（连模型都没有）')
checkContains(olderFacts, '模型未记录', '连模型都没有的条目也说清楚')

// ---- 进面板时提示词该不该在（纯函数） ----
const draftOf = (prompt, lastGeneratedPrompt) => ({
  prompt,
  params: { aspectRatio: '16:9', resolution: '1K', count: '1', quality: 'high' },
  extra: {},
  lastGeneratedPrompt,
  updatedAt: 1,
})

check(clientExports.promptForEntry(undefined) === '', '没有草稿 → 提示词空（「上次生成成功就给我一块空面板」）')
check(clientExports.promptForEntry(draftOf('写了一半的草稿', '')) === '写了一半的草稿', '写了没生成过的草稿 → 留着')
check(
  clientExports.promptForEntry(draftOf('已经生成过的提示词', '已经生成过的提示词')) === '',
  '提示词 == 最后一次成功生成用的那句 → 清空（上次已经生成过了）',
)
check(
  clientExports.promptForEntry(draftOf('  已生成  ', '已生成')) === '',
  '只差首尾空白不算「我改了」（按 trim 比）',
)
check(clientExports.promptForEntry(draftOf('', '上一句')) === '', '输入框被清空 → 就是空的')

// ---- 点历史图时参数怎么回填（纯函数） ----
const paramField = (name, label, extra = {}) => ({
  name,
  label,
  control: 'select',
  valueType: 'string',
  group: 'output',
  values: ['16:9', '1:1'],
  clearable: false,
  default: '1:1',
  hint: '',
  ...extra,
})

const sameModelTable = [
  paramField('aspect_ratio', '比例'),
  paramField('resolution', '分辨率', { values: ['1K', '2K'] }),
  paramField('quality', '质量', { values: ['low', 'medium', 'high'] }),
  paramField('n', '张数', { control: 'count', values: ['1', '2', '3'] }),
  paramField('background', '背景', { values: ['auto', 'opaque', 'transparent'] }),
]
const blankParams = { aspectRatio: '1:1', resolution: '2K', count: '3', quality: 'low' }

const applied = clientExports.paramsFromHistory(
  { aspectRatio: '16:9', resolution: '1K', count: 1, quality: 'high', extra: { background: 'transparent' } },
  { params: blankParams, extra: {}, parameters: sameModelTable },
)
check(applied.params.aspectRatio === '16:9' && applied.params.resolution === '1K', '回填核心参数（比例 / 分辨率）')
check(applied.params.count === '1' && applied.params.quality === 'high', '回填张数与质量')
check(applied.extra.background === 'transparent', '回填模型驱动表单里的额外字段（背景）')
check(applied.skipped.length === 0, '同一个模型：一项都不该被跳过')
check(applied.applied.length === 5, `写入 5 个字段（实际 ${applied.applied.length}）`)

// 换了模型：历史图里的取值当前模型不认 —— 不写入，但必须点名。
const narrowTable = [
  paramField('aspect_ratio', '比例'),
  paramField('quality', '质量', { values: ['low', 'medium'] }),
]
const skipped = clientExports.paramsFromHistory(
  { aspectRatio: '1:1', resolution: '4K', count: 3, quality: 'xhigh', extra: { background: 'transparent', seed: '42' } },
  { params: blankParams, extra: {}, parameters: narrowTable },
)
check(skipped.params.quality === 'low', '不合法的质量值不写入（保持原值）')
check(skipped.params.resolution === '2K', '当前模型不声明分辨率 → 不写入')
check(skipped.extra.background === undefined, '当前模型不声明背景 → 不写入（否则下拉会显示成空）')
check(skipped.extra.seed === undefined, '当前模型不声明种子 → 不写入')
check(skipped.skipped.includes('质量'), '被跳过的字段要能点名（质量）')
check(skipped.skipped.includes('背景') && skipped.skipped.includes('随机种子'), '被跳过的字段要能点名（背景 / 随机种子）')
check(skipped.params.aspectRatio === '1:1', '合法的那一项照旧写入')

// 没有能力表（OpenAI / Gemini / 自定义协议）：不判合法性，照搬。
const legacyApply = clientExports.paramsFromHistory(
  { aspectRatio: '21:9', resolution: '4K', count: 2, quality: 'xhigh', extra: { seed: '9' } },
  { params: blankParams, extra: {}, parameters: [] },
)
check(legacyApply.params.aspectRatio === '21:9' && legacyApply.params.quality === 'xhigh', '没有能力表时照搬（不误判为不支持）')
check(legacyApply.skipped.length === 0, '没有能力表时不报「与当前模型不符」')

// 升级前的老记录：没有参数快照 → 一个字段都不动（连对象都不换）。
const noSnapshot = clientExports.paramsFromHistory(undefined, { params: blankParams, extra: {}, parameters: sameModelTable })
check(noSnapshot.params === blankParams, '老记录没有参数快照时不改参数区（返回原对象）')
check(noSnapshot.applied.length === 0 && noSnapshot.skipped.length === 0, '老记录既没有「写入」也没有「跳过」')


// 配置弹层：Key 只以掩码出现，绝不含明文。
const config = {
  protocol: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: true,
  keyHint: 'sk-or-v1-••••••••4f2a',
  model: 'google/gemini-3-pro-image',
  autoSaveDir: 'D:\\DSH\\.dsh-imagegen\\out\\',
  extraJson: '{}',
  timeoutSec: 180,
  outputFormat: 'png',
}

const modal = render(h(clientExports.ConfigModal, {
  config,
  models: [model],
  pulling: false,
  onPullModels: () => {},
  onSave: () => {},
  onClose: () => {},
}), 'ConfigModal')

checkContains(modal, '连接配置', '弹层标题')
checkContains(modal, 'OpenRouter', '协议选项')
checkContains(modal, 'OpenAI 兼容', '协议选项')
checkContains(modal, '已配置', '已配置的 Key 显示为「已配置」')
checkContains(modal, 'sk-or-v1-••••••••4f2a', '只显示掩码')
checkContains(modal, '拉取模型列表', '有拉取模型列表按钮')
checkContains(modal, '自动保存目录', '有自动保存目录')
checkContains(modal, '高级', '有高级区')
checkContains(modal, 'supported_parameters', '说明了参数候选值来自 supported_parameters')

// 高级区的三项必须**一直可见**。
// 回归点：原来用 `<details>` 折叠，而 `.modalBody` 是缺 `min-height:0` 的 flex 子项，
// 展开的内容被 `.modal` 的 overflow:hidden 裁掉 —— 真机上表现为「点了没反应、看不到配置项」。
check(!modal.includes('<details'), '高级不再用 details 折叠（折叠态在 flex 弹层里点不开）')
checkContains(modal, '额外参数', '高级里有「额外参数」')
checkContains(modal, '超时（秒）', '高级里有「超时（秒）」')
checkContains(modal, '输出格式', '高级里有「输出格式」')
checkContains(modal, 'provider', '额外参数给了示例（provider.sort）')
checkContains(modal, '只在模型声明支持时才发', '输出格式那项说明了它的生效条件')
checkContains(modal, 'svg', '输出格式下拉里有 svg（矢量模型的唯一合法值）')

// 参考图约束：模型级上限不再是写死的 4 张。
const modalNarrow = render(h(clientExports.ConfigModal, {
  config: { ...config, model: 'recraft/recraft-v4-vector' },
  models: [model, vectorModel],
  pulling: false,
  onPullModels: () => {},
  onSave: () => {},
  onClose: () => {},
}), 'ConfigModal（窄模型）')
checkContains(modalNarrow, '参考图最多 1 张', '模型级参考图上限写进了说明')
checkContains(modalNarrow, '只接受', '配置的输出格式不在该模型枚举内时会提示')

const modalRequired = render(h(clientExports.ConfigModal, {
  config: { ...config, model: 'recraft/recraft-v4-styles' },
  models: [model, refRequiredModel],
  pulling: false,
  onPullModels: () => {},
  onSave: () => {},
  onClose: () => {},
}), 'ConfigModal（必填底图）')
checkContains(modalRequired, '必须', '必填底图的模型被明确标出来')

// provider.options 的键必须来自接口（slug 带区域后缀，同族还不一样）。
const modalProviders = render(h(clientExports.ConfigModal, {
  config,
  models: [model],
  pulling: false,
  capabilities: {
    model: 'google/gemini-3-pro-image',
    price: '',
    supportsReferences: true,
    caps: [],
    providers: ['Google AI Studio'],
    passthrough: ['cachedContent'],
    providerOptions: [{ slug: 'google-ai-studio/global', name: 'Google AI Studio', params: ['cachedContent'] }],
    available: true,
    references: { min: 0, max: 14 },
    options: model.options,
  },
  onPullModels: () => {},
  onSave: () => {},
  onClose: () => {},
}), 'ConfigModal（带能力）')
checkContains(modalProviders, 'google-ai-studio/global', 'provider.options 的键显示为接口返回的 slug')
checkContains(modalProviders, 'cachedContent', '列出该 slug 允许透传的参数')
checkContains(modalProviders, '复制模板', '给出可复制的 provider.options 模板')

// -------------------------------------------- 宿主日志抽屉（「查看日志」的去处）
//
// 背景（2026-10-10 实测）：桌面版 DSH 没有可见的宿主控制台 —— 宿主进程的 stdout
// 没有人接管，`%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 是空目录，界面上也没有
// 「控制台」入口。原来那句提示等于让用户去找一个不存在的东西，所以要有一个真页面。
const viewer = render(h(clientExports.LogViewer, {
  backend: { fetchLogs: async () => ({ entries: [], file: 'C:\\x\\logs\\host.log', dir: 'C:\\x\\logs', count: 0 }) },
  onClose: () => {},
}), 'LogViewer（首帧）')
checkContains(viewer, '宿主日志', '抽屉标题')
checkContains(viewer, '正在读取宿主日志', '首帧在读（useEffect 在静态渲染里不执行）')
checkContains(viewer, '关闭', '有关闭按钮')

// 列表本身（纯展示部分）：静态渲染看不到 useEffect 的结果，所以直接渲染它。
const logRows = h(clientExports.LogList, {
  entries: [
    { seq: 3, at: '2026-10-10 18:42:05', level: 'error', text: '上游拒绝（HTTP 400）：output_format 不是 jpeg/webp' },
    { seq: 2, at: '2026-10-10 18:42:05', level: 'warn', text: '本次生成裁掉了不支持的字段：quality' },
    { seq: 1, at: '2026-10-10 18:42:04', level: 'info', text: '生成开始：openai/gpt-image-2.5-flare · 16:9' },
  ],
})
const logRowsHtml = render(logRows, 'LogList（三条日志）')
checkContains(logRowsHtml, '2026-10-10 18:42:05', '日志行显示时间')
checkContains(logRowsHtml, '上游拒绝（HTTP 400）', '日志行显示正文')
checkContains(logRowsHtml, 'logErr', '错误级别的行带错误样式')
checkContains(logRowsHtml, 'logWarn', '警告级别的行带警告样式')
const emptyLogs = render(h(clientExports.LogList, { entries: [] }), 'LogList（空）')
checkContains(emptyLogs, '宿主还没有写过任何日志', '空态说明「生成一次就有内容」')

// 日志条目的收敛器：级别不认识按 info 记，正文为空直接丢掉（别渲染一行空白）。
const logEntry = clientExports.toLogEntry({ seq: 7, at: '2026-10-10 18:42:03', level: 'error', text: '上游拒绝（HTTP 400）' })
check(logEntry !== undefined && logEntry.level === 'error', 'toLogEntry 保留级别')
check(logEntry !== undefined && logEntry.seq === 7, 'toLogEntry 保留序号')
check(clientExports.toLogEntry({ text: '' }) === undefined, 'toLogEntry 丢掉没有正文的条目')
const relaxedEntry = clientExports.toLogEntry({ text: 'x', level: 'nonsense' })
check(relaxedEntry !== undefined && relaxedEntry.level === 'info', 'toLogEntry 兜底成 info')

// CSS Module 注入：panel.module.css 应当在首次求值时注入了 <style>。
check(injectedStyles.length >= 1, `CSS Module 注入了 <style>（实际 ${injectedStyles.length} 个）`)
const cssText = injectedStyles.map((style) => style.textContent).join('\n')
check(cssText.includes('.panel_panel'), '注入的 CSS 里类名已按模块作用域重命名（.panel_panel）')
check(cssText.includes('--dsw-alias-bg-base'), '注入的 CSS 使用 DSH design token，而非自造色值')
// 这次修复的两个样式前提：错误态能滚、日志行分色（否则「看不全」在样式层面就修不掉）。
check(cssText.includes('stageInnerErr'), 'CSS 里有错误态的滚动布局')
check(cssText.includes('logModal'), 'CSS 里有日志抽屉的弹层宽度')
check(cssText.includes('logErr'), 'CSS 里有错误行着色')

// ------------------------------------------------------------------ 汇总

console.log(`\n${total - failures.length}/${total} passed`)
if (failures.length > 0) {
  console.error('\n失败项：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
