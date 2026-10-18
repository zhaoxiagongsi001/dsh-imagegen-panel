/**
 * 重出 README 的三张展示图（`assets/screenshot-*.png`）。
 *
 * 为什么要有这个脚本：README 的图**必须是可复现的**。用真机截图会把这台机器的
 * 绝对保存路径印进画面（结果行会显示「已存到插件目录 <路径>」），一旦提交就跟着
 * 仓库发布出去 —— v0.1.0 的三张图就是这么带上了一条本机路径。这里改成从
 * `scripts/preview.mjs` 的离屏渲染里出图：那套 fixture 用的是中性占位路径
 * （`C:\Users\you\...`），既没有本机痕迹，又跟当前界面天然同步。
 *
 * 用法：
 *   node scripts/build.mjs && node scripts/preview.mjs   # 先刷新预览页
 *   node scripts/screenshots.mjs                         # 出全部三张
 *   node scripts/screenshots.mjs params                  # 只出某一个状态
 *
 * 需要 Chromium 系浏览器（Edge / Chrome）。可用 `EDGE_PATH` 指定可执行文件。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const previewFile = path.join(root, 'preview', 'panel.html')
if (!existsSync(previewFile)) {
  throw new Error('缺少 preview/panel.html —— 先跑：node scripts/build.mjs && node scripts/preview.mjs')
}

const browserCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter((candidate) => candidate !== undefined && candidate !== '')
const browser = browserCandidates.find((candidate) => existsSync(candidate))
if (browser === undefined) {
  throw new Error(`找不到 Chromium 系浏览器，请用 EDGE_PATH 指定。候选：${browserCandidates.join(' | ')}`)
}

/** 三个状态 —— 与 README 里三处 ![...] 一一对应。尺寸沿用 v0.1.0 那三张，避免版面跳动。 */
const SHOTS = [
  { id: 'done', file: 'screenshot-1-result.png', width: 1224, height: 762 },
  { id: 'params', file: 'screenshot-2-params.png', width: 1224, height: 762 },
  { id: 'config', file: 'screenshot-3-config.png', width: 902, height: 562 },
]

const only = process.argv[2] ?? ''
const targets = SHOTS.filter((shot) => only === '' || shot.id === only)
if (targets.length === 0) {
  throw new Error(`未知状态 id：${only}（可用：${SHOTS.map((shot) => shot.id).join(' / ')}）`)
}

// ---------------------------------------------------------------- 拆预览页

const page = readFileSync(previewFile, 'utf8')
const styles = [...page.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1])
if (styles.length !== 2) {
  throw new Error(`预览页里应当有 2 个 <style> 块（DSH token + CSS Module），实际 ${styles.length} 个`)
}

const bodyHtml = page.slice(
  page.indexOf('<body>') + '<body>'.length,
  page.lastIndexOf('</body>'),
)
/** 面板本体的 HTML：每个 case 是 `caseHead + .frame`，只取 `.frame` 里面那份（不带开发者注释）。 */
const panelHtmlById = new Map()
for (const frag of bodyHtml.split('<div class="case" id="').slice(1)) {
  const id = frag.slice(0, frag.indexOf('"'))
  const cluster = frag.replace(/^[^>]*>/, '').replace(/<\/div>\s*$/, '')
  const framed = cluster.match(/<div class="frame[^"]*">([\s\S]*)<\/div>\s*$/)
  if (framed === null) throw new Error(`定位不到 ${id} 的 .frame`)
  panelHtmlById.set(id, framed[1])
}

// -------------------------------------------------------------------- 出图

const outDir = path.join(root, 'assets')
mkdirSync(outDir, { recursive: true })
const tmp = path.join(tmpdir(), `dsh-imagegen-shots-${process.pid}`)
mkdirSync(tmp, { recursive: true })

for (const shot of targets) {
  const panel = panelHtmlById.get(shot.id)
  if (panel === undefined) throw new Error(`预览页里没有状态 ${shot.id}`)

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>${styles[0]}</style>
<style>${styles[1]}</style>
<style>
/* 只出面板本体：不带预览页的外边距与开发者注释。 */
html { height: 100%; overflow: hidden; }
body { margin: 0; padding: 0; box-sizing: border-box; width: ${shot.width}px; height: 100%;
       overflow: hidden; position: relative; background: var(--dsw-alias-bg-base);
       color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
       font-size: 14px; line-height: 22px; }
.shot { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--dsw-alias-bg-base); }
.shot .panel_panel { height: 100%; }
</style></head>
<body><div class="shot">${panel}</div></body></html>`

  const tmpHtml = path.join(tmp, `${shot.id}.html`)
  writeFileSync(tmpHtml, html, 'utf8')

  const png = path.join(outDir, shot.file)
  rmSync(png, { force: true })
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--force-device-scale-factor=1',
    '--virtual-time-budget=4000',
    `--user-data-dir=${path.join(tmp, `profile-${shot.id}`)}`,
    `--window-size=${shot.width},${shot.height}`,
    `--screenshot=${png}`,
    'file:///' + tmpHtml.replace(/\\/g, '/'),
  ], { stdio: 'inherit' })

  console.log(`${shot.id.padEnd(7)} -> assets/${shot.file}  ${readFileSync(png).length} bytes`)
}

rmSync(tmp, { recursive: true, force: true })
