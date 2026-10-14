/**
 * Build both halves of dsh-imagegen-panel with no child processes.
 *
 * 说明：本文件改编自同版本姊妹插件 dsh-prompt-forge 的 `scripts/build.mjs`
 * （同版本 0.2.0-rc.2、已跑通的本地插件）。构建策略与其一致，只改了：
 *   1. typescript 的解析路径 —— 本包不装 node_modules，改为多路径回退查找；
 *   2. 客户端 external 收敛到 `react`（本插件只用它一个种子模块）；
 *   3. 宿主半边对外导出的名字清单；
 *   4. 入口/出口的注释与包名。
 *
 * Output contract (what the DSH web profile actually loads):
 *   - `lib/index.js`  — the host half: plain ESM. Node builtins and the
 *     `@deepseek-ai/*` packages stay external and are resolved by the loader in
 *     the host process.
 *   - `lib/client.js` — the browser half: a classic, self-registering script
 *     that calls `window.__ModuleLoader__.load({ id, factory })`. Every bare
 *     import must resolve through the shell's frozen module table; anything else
 *     has to be inlined, because the browser cannot fetch it.
 *
 * Why a hand-written bundler: the native esbuild binary and esbuild-wasm both
 * spawn a helper process with piped stdio, which the DSH file sandbox refuses
 * (EPERM on spawn). The TypeScript compiler API is pure JavaScript and runs
 * in-process, so it works under the sandbox. The bundler is deliberately small:
 * two targets, one pass, no minification, no code splitting.
 *
 * Style handling: the client module system claims every `<style>` tag that
 * exists at the moment a factory first materializes, so CSS has to be installed
 * *during* materialization. Each `*.module.css` compiles to an internal module
 * that injects one tagged `<style>` on first evaluation and exports the class
 * mapping — which is both that moment and what lets teardown remove it again.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * 解析 typescript。
 *
 * 本包刻意不建 node_modules（避免为一款工具拉一整棵依赖树）。按下面的顺序找，
 * 都找不到就明确报错，不静默降级 —— 构建脚本静默失败会产出坏 bundle，
 * 而坏 bundle 在浏览器里只表现为「插件没反应」，很难查。
 *
 * 可用环境变量 DSH_TS_PATH 指定一个 typescript 目录覆盖整个搜索。
 */
function loadTypeScript() {
  const candidates = [
    process.env.DSH_TS_PATH,
    path.join(root, 'node_modules', 'typescript'),
    // 本机开发布局：同版本的样板插件与本包目录并排。公开 clone 直接
    // `npm install`，上面那条 node_modules 就会命中，这里只是兜底。
    path.join(process.env.DSH_SAMPLE_ROOT || path.join(root, '..', 'dsh-prompt-forge'), 'node_modules', 'typescript'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')

  const tried = []
  for (const candidate of candidates) {
    const entry = path.join(candidate, 'lib', 'typescript.js')
    if (!existsSync(entry)) { tried.push(candidate); continue }
    return require(entry)
  }
  throw new Error(
    `找不到 typescript。已尝试：\n  ${tried.join('\n  ')}\n` +
    '请先 `pnpm add -D typescript` 到本包，或设置 DSH_TS_PATH 指向一个 typescript 目录。',
  )
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = path.join(root, 'src')
const OUT = path.join(root, 'lib')
const ts = loadTypeScript()

/**
 * The id the bundle registers under.
 *
 * The client module system identifies a bundle by its resolved package name, so
 * this is read from package.json rather than repeated as a literal: a rename
 * that updated only one of the two would load the bundle under an id nothing
 * routes to, and the plugin would silently never mount.
 */
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const PACKAGE_NAME = manifest.name
if (typeof PACKAGE_NAME !== 'string' || PACKAGE_NAME === '') {
  throw new Error('package.json has no usable "name" field')
}

/**
 * Packages the browser shell seeds into its frozen module table.
 *
 * 本插件只用到 `react` 一个种子模块：侧栏图标与主面板都是普通函数组件，
 * 不需要 store / locale / theme 这些额外种子。列表越短，跨壳版本越稳 ——
 * 一个被移除的种子名会变成硬加载失败。
 */
const CLIENT_EXTERNALS = new Set([
  'react',
])

/** Bare specifiers the host process resolves at runtime. */
const HOST_EXTERNAL_PREFIXES = ['node:', '@deepseek-ai/', 'zod']

/** Virtual module id standing in for the automatic JSX runtime. */
const JSX_RUNTIME = '\0jsx-runtime'

/** Normalize an absolute path to a stable, posix, root-relative module id. */
function idOf(absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/** Normalize an id to an absolute path. */
function fileOf(id) {
  return path.join(root, id.split('/').join(path.sep))
}

/** Whether a specifier is resolved by the host/shell rather than bundled. */
function isExternal(specifier, externals, prefixes) {
  if (externals.has(specifier)) return true
  return prefixes.some(prefix => specifier === prefix || specifier.startsWith(prefix))
}

/**
 * Whether a specifier is a path this plugin owns rather than a package name.
 * Both `./x` and a bare-looking `src/client/x` fall here, because the generated
 * ids are root-relative paths, not package specifiers.
 */
function isInternalPath(specifier) {
  if (specifier.startsWith('.')) return true
  return existsSync(path.join(root, specifier))
}

/**
 * Resolve a relative specifier against its importer.
 * @param specifier - the raw specifier text.
 * @param importerId - the importing module's id.
 * @returns the resolved module id.
 */
function resolveRelative(specifier, importerId) {
  const base = path.dirname(fileOf(importerId))
  const raw = path.resolve(base, specifier)
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    path.join(raw, 'index.ts'),
    path.join(raw, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith('.d.ts')) return idOf(candidate)
  }
  throw new Error(`cannot resolve "${specifier}" from ${importerId}`)
}

/** TypeScript's transpile options for the host half (real ESM, imports kept). */
const HOST_TRANSPILE = {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    // Elide type-only imports so concatenation never leaves a dangling import.
    verbatimModuleSyntax: false,
    isolatedModules: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
  },
  fileName: 'module.ts',
}

/** TypeScript's transpile options for the browser half (CommonJS, require kept). */
const CLIENT_TRANSPILE = {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    jsx: ts.JsxEmit.ReactJSX,
    verbatimModuleSyntax: false,
    isolatedModules: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
  },
  fileName: 'module.tsx',
}

/** Transpile one TS/TSX source to JavaScript text. */
function transpile(source, filePath, options) {
  const result = ts.transpileModule(source, { ...options, fileName: path.basename(filePath) })
  const diagnostics = result.diagnostics ?? []
  if (diagnostics.length > 0) {
    const text = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')
    throw new Error(`${idOf(filePath)}: ${text}`)
  }
  return result.outputText
}

/**
 * Compile one CSS module into an internal JavaScript module.
 *
 * Class names are namespaced by file, so a future plugin's selectors cannot
 * collide with this one's, and the generated code injects the sheet exactly once
 * with the tag the module system uses to release it on teardown.
 * @param id - the module id (used for the namespace and the style tag).
 * @param source - the stylesheet text.
 * @returns JavaScript module source exporting the class mapping.
 */
function compileCssModule(id, source) {
  const scope = path.basename(id, '.module.css')
  const renamed = new Map()

  /**
   * 只作用域化「真正的选择器」。
   *
   * 原版（prompt-forge）直接在整份源码上跑正则，会把**注释里**的 `.xxx`
   * 一起改写：本包的 probe.module.css 注释里写了 `build.mjs`，
   * 结果被改成了 `.probe_mjs`，还往导出的映射里塞了一个假类名 `mjs`。
   * 功能上不致命，但注释会被悄悄改掉、映射会带垃圾键，是个迟早咬人的坑。
   *
   * 做法：按注释切段，奇数段是注释，原样放回；其余段才做改写。
   */
  const scopeSelector = (text) => text.replace(/\.([A-Za-z_][\w-]*)(?=[^;{}]*\{)/gu, (match, name) => {
    const existing = renamed.get(name)
    if (existing !== undefined) return `.${existing}`
    const next = `${scope}_${name}`
    renamed.set(name, next)
    return `.${next}`
  })

  const scoped = source
    .split(/(\/\*[\s\S]*?\*\/)/u)
    .map((part, index) => (index % 2 === 1 ? part : scopeSelector(part)))
    .join('')

  const mapping = Object.fromEntries([...renamed].map(([from, to]) => [from, to]))
  return [
    `"use strict";`,
    `Object.defineProperty(exports, "__esModule", { value: true });`,
    `const css = ${JSON.stringify(scoped)};`,
    `const tagId = ${JSON.stringify(`${PACKAGE_NAME}/${scope}`)};`,
    `if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {`,
    `  const style = document.createElement("style");`,
    `  style.setAttribute("data-plugin-css", tagId);`,
    `  style.textContent = css;`,
    `  document.head.appendChild(style);`,
    `}`,
    `exports.default = ${JSON.stringify(mapping)};`,
  ].join('\n')
}

/**
 * Collect every module reachable from one entry, transpiled to CommonJS.
 *
 * Relative `require(...)` calls in the emitted code drive discovery, so the
 * dependency graph comes from what the compiler actually emitted rather than
 * from a second scan of the TypeScript sources.
 * @param entryId - the entry module id.
 * @returns a map of module id to emitted CommonJS source.
 */
function collectClientModules(entryId) {
  const modules = new Map()
  const queue = [entryId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (modules.has(id)) continue
    if (id === JSX_RUNTIME) {
      modules.set(id, [
        `"use strict";`,
        // Route the automatic JSX runtime through `react`, so the bundle depends
        // on one seeded module instead of two.
        `const React = require("react");`,
        `function jsx(type, props, key) {`,
        `  if (key === undefined) return React.createElement(type, props);`,
        `  return React.createElement(type, Object.assign({}, props, { key: key }));`,
        `}`,
        `exports.jsx = jsx;`,
        `exports.jsxs = jsx;`,
        `exports.Fragment = React.Fragment;`,
      ].join('\n'))
      continue
    }

    const absolute = fileOf(id)
    const source = require('node:fs').readFileSync(absolute, 'utf8')
    const emitted = id.endsWith('.module.css')
      ? compileCssModule(id, source)
      : transpile(source, absolute, CLIENT_TRANSPILE)
    modules.set(id, emitted)

    const seen = new Set()
    for (const match of emitted.matchAll(/require\((["'])([^"']+)\1\)/gu)) {
      const specifier = match[2]
      if (seen.has(specifier)) continue
      seen.add(specifier)
      if (specifier === 'react/jsx-runtime') { queue.push(JSX_RUNTIME); continue }
      if (isExternal(specifier, CLIENT_EXTERNALS, [])) continue
      if (!isInternalPath(specifier)) {
        throw new Error(`${id} imports "${specifier}", which is neither a seeded platform module nor a bundled source file; add it to CLIENT_EXTERNALS or inline it`)
      }
      const resolved = isInternalPath(specifier) && !specifier.startsWith('.')
        ? idOf(path.resolve(root, specifier))
        : resolveRelative(specifier, id)
      queue.push(resolved)
    }
  }
  return modules
}

/** Rewrite emitted common-js `require(...)` calls to internal registry lookups. */
function rewriteRelativeRequires(code, id) {
  return code.replace(/require\((["'])([^"']+)\1\)/gu, (match, quote, specifier) => {
    // The automatic JSX runtime is routed to the internal shim so the bundle
    // depends on `react` alone, which is the module the shell seeds.
    if (specifier === 'react/jsx-runtime') return `__dshRequire(${JSON.stringify(JSX_RUNTIME)})`
    if (!isInternalPath(specifier)) return match
    const resolved = specifier.startsWith('.')
      ? resolveRelative(specifier, id)
      : idOf(path.resolve(root, specifier))
    return `__dshRequire(${JSON.stringify(resolved)})`
  })
}

/** Emit the browser bundle wrapped in the loader's factory protocol. */
function emitClientBundle(modules, entryId) {
  const bodies = []
  for (const [id, code] of modules) {
    bodies.push(`${JSON.stringify(id)}: function (module, exports, require) {`)
    bodies.push(id === JSX_RUNTIME ? code : rewriteRelativeRequires(code, id))
    bodies.push('},')
  }
  return [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(PACKAGE_NAME)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    '\t\tvar __cache = new Map();',
    '\t\tvar __modules = {',
    ...bodies.map(line => `\t\t\t${line}`),
    '\t\t};',
    '\t\tfunction __dshRequire(id) {',
    '\t\t\tvar cached = __cache.get(id);',
    '\t\t\tif (cached !== undefined) return cached.exports;',
    '\t\t\tvar factory = __modules[id];',
    '\t\t\tif (factory === undefined) throw new Error(' + JSON.stringify(`${PACKAGE_NAME}: unknown bundled module `) + ' + id);',
    '\t\t\tvar record = { exports: {} };',
    '\t\t\t__cache.set(id, record);',
    '\t\t\tfactory(record, record.exports, __dshModuleRequire);',
    '\t\t\treturn record.exports;',
    '\t\t}',
    '\t\t// A bundled factory calling require() must reach the platform table for',
    '\t\t// seeded specifiers and the internal registry for everything bundled.',
    '\t\tfunction __dshModuleRequire(id) {',
    '\t\t\tif (__modules[id] !== undefined) return __dshRequire(id);',
    '\t\t\treturn require(id);',
    '\t\t}',
    '\t\t// The entry module owns the bundle\'s public exports. Dispatching it with',
    '\t\t// THIS module object (rather than a fresh record) is what makes the',
    '\t\t// loader see the real export surface.',
    `\t\tvar __entryFactory = __modules[${JSON.stringify(entryId)}];`,
    `\t\tif (__entryFactory === undefined) throw new Error(${JSON.stringify(`${PACKAGE_NAME}: entry module ${entryId} is missing from the bundle`)});`,
    `\t\t__cache.set(${JSON.stringify(entryId)}, module);`,
    '\t\t__entryFactory(module, exports, __dshModuleRequire);',
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
}

/**
 * Merge one hoisted external import into the bundle-wide import table.
 *
 * 为什么不能按「行」去重：两个模块各写一行
 * `import { mkdir, readFile } from 'node:fs/promises'` 和
 * `import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'`，
 * 行文本不同 → 两行都被保留 → **同一个 `mkdir` 被声明两次 → SyntaxError**，
 * 整个宿主半边加载失败（插件表现为「路由全没了」）。
 * 所以这里按 **specifier + 绑定名** 归并：同名同源只留一份，同名不同源直接构建失败
 * （那本来就是我们自己的命名冲突，不该等到运行时才发现）。
 * @param line - 一条外部 import 语句。
 * @param table - specifier → { defaults, namespaces, names }。
 * @param ownerOfName - 绑定名 → specifier，跨 specifier 重名时报错。
 * @param owner - 出错时报告是谁写的。
 * @returns 是否是已识别的 import 形式。
 */
function collectExternalImport(line, table, ownerOfName, owner) {
  const trimmed = line.trim()
  let specifier
  let kind
  let names = []

  let match = /^import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["'];?$/u.exec(trimmed)
  if (match !== null) {
    kind = 'default'
    names = [match[1]]
    specifier = match[2]
  }
  if (specifier === undefined) {
    match = /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["'];?$/u.exec(trimmed)
    if (match !== null) {
      kind = 'namespace'
      names = [match[1]]
      specifier = match[2]
    }
  }
  if (specifier === undefined) {
    match = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?$/u.exec(trimmed)
    if (match !== null) {
      kind = 'named'
      names = match[1].split(',').map(part => part.trim()).filter(part => part !== '')
      specifier = match[2]
    }
  }
  if (specifier === undefined) return false

  let entry = table.get(specifier)
  if (entry === undefined) {
    entry = { defaults: new Set(), namespaces: new Set(), names: new Set() }
    table.set(specifier, entry)
  }

  for (const raw of names) {
    const local = raw.split(/\s+as\s+/u).pop().trim()
    const previous = ownerOfName.get(local)
    if (previous !== undefined && previous !== specifier) {
      throw new Error(`${owner}: 绑定名 "${local}" 已由 "${previous}" 提供，又被 "${specifier}" 重复声明 —— 改名或改用命名空间导入`)
    }
    ownerOfName.set(local, specifier)

    if (kind === 'default') entry.defaults.add(local)
    else if (kind === 'namespace') entry.namespaces.add(local)
    else entry.names.add(raw)
  }
  return true
}

/** Render the merged external import table back into import statements. */
function renderExternalImports(table) {
  const lines = []
  for (const [specifier, entry] of table) {
    const parts = [...entry.defaults, ...entry.namespaces]
    if (entry.names.size > 0) parts.push(`{ ${[...entry.names].join(', ')} }`)
    lines.push(parts.length === 0 ? `import '${specifier}';` : `import ${parts.join(', ')} from '${specifier}';`)
  }
  return lines
}

/**
 * Emit the host half as one ESM file.
 *
 * The host graph is a shallow tree with no cycles, so the modules concatenate
 * in dependency order: internal imports are dropped, external imports are
 * hoisted once, and the entry's public names are re-exported. This avoids a
 * runtime registry in the host, where a plain ESM module is what the loader
 * expects to import.
 */
function emitHostBundle(entryId) {
  const ordered = []
  const visited = new Set()
  /** Depth-first walk so a dependency always precedes its consumer. */
  const visit = (id) => {
    if (visited.has(id)) return
    visited.add(id)
    const absolute = fileOf(id)
    const source = require('node:fs').readFileSync(absolute, 'utf8')
    const emitted = transpile(source, absolute, { ...HOST_TRANSPILE, fileName: path.basename(absolute) })
    for (const match of emitted.matchAll(/^import\s[^;]*?from\s*(["'])([^"']+)\1;?$/gmu)) {
      const specifier = match[2]
      if (specifier.startsWith('.')) visit(resolveRelative(specifier, id))
    }
    ordered.push({ id, source, emitted })
  }
  visit(entryId)

  /** specifier → 归并后的绑定；ownerOfName 负责跨 specifier 的重名检查。 */
  const externalImports = new Map()
  const ownerOfName = new Map()
  /** 顶层声明名 → 定义它的模块；跨模块重名会让拼出来的单文件变成 SyntaxError。 */
  const declaredIn = new Map()
  const chunks = []
  const exported = new Set()

  for (const { id, emitted } of ordered) {
    const kept = []
    for (const line of emitted.split('\n')) {
      const importMatch = /^import\s[^;]*?from\s*(["'])([^"']+)\1;?$/u.exec(line)
      if (importMatch !== null) {
        const specifier = importMatch[2]
        if (!specifier.startsWith('.')) collectExternalImport(line, externalImports, ownerOfName, id)
        continue
      }

      /**
       * 顶层声明重名检查。
       *
       * 宿主打包器把所有模块**拼进同一个作用域**（没有运行时注册表），所以两个模块
       * 各写一个 `const MAX_BODY_BYTES` 就会拼出 `SyntaxError: Identifier … has
       * already been declared` —— 而失败形态是「构建成功、插件静默不工作」，
       * 最难查的那种。所以在构建期就拦住，并报出是哪两个模块。
       * 只看顶格声明：嵌套代码在转译产物里都带缩进。
       */
      const declaration = /^(?:export\s+)?(?:declare\s+)?(const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/u.exec(line)
      if (declaration !== null) {
        const name = declaration[2]
        const previous = declaredIn.get(name)
        if (previous !== undefined && previous !== id) {
          throw new Error(`顶层重名："${name}" 同时定义在 ${previous} 与 ${id} —— 宿主打包器把两个模块拼进同一个作用域，请改名`)
        }
        declaredIn.set(name, id)
      }
      const exportMatch = /^export\s+(?:declare\s+)?(const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/u.exec(line)
      if (exportMatch !== null) {
        exported.add(exportMatch[2])
        kept.push(line.replace(/^export\s+/u, ''))
        continue
      }
      if (/^export\s*\{/u.test(line)) {
        for (const name of line.replace(/^export\s*\{|\}\s*;?\s*$/gu, '').split(',')) {
          const trimmed = name.trim().split(/\s+as\s+/u).pop()?.trim()
          if (trimmed !== undefined && trimmed !== '') exported.add(trimmed)
        }
        continue
      }
      if (/^export\s+(interface|type)\s/u.test(line)) continue
      kept.push(line)
    }
    chunks.push(`// ---- ${id} ----`)
    chunks.push(kept.join('\n'))
  }

  // 本插件对外暴露的宿主半边名字：壳按名字取 apply / inject / Config / name；
  // API 是路由表，导出它是为了让 scripts/host-check.mjs 能拿产物做契约比对
  // （宿主挂的路径 vs 客户端打的路径）；几个 parse*/build* 是纯函数，给
  // scripts/upstream-check.mjs 拿**真上游响应**验映射（不需要 Key、不花钱）。
  const publicNames = [
    'name', 'inject', 'Config', 'apply', 'API',
    'parseImageModels', 'parseCapabilities', 'priceFrom', 'normalizeQuality', 'buildImageRequest', 'measureSize',
    // 字段规格表：host-check 拿它断言「客户端结果行的中文标签覆盖了每个字段」——
    // 漏一个，界面上就会冒出一个英文键名。
    'FIELD_SPECS',
    // 拉目录的完整路径（含**可用性探测**）：给 upstream-check 拿真上游验
    // 「endpoints 为空的条目会被剔掉」，不用起 DSH、不用 Key。
    'getImageModels',
    // 读 prompt-forge 模板的解析器：给 host-check 做夹具自检，也给
    // `.ref/probe-preset-resolution.mjs` 拿**真实 profile patch** 验一遍（不用重启）。
    'findForgePreset', 'FORGE_PRESET_NAME',
    // 交给 Explorer 的目标怎么编码（「打开」功能的路径）：给 host-check 断言
    // 逗号/等号转义与非 ASCII 还原 —— 这是那个功能里唯一「写错了也不报错、
    // 只会安静地打开另一个东西」的部分。
    'explorerTarget',
    // 等宿主日志落盘排空：host-check 要断言「日志文件里真的有内容」，
    // 而不是「已经入队了」——日志是异步追加的，不冲刷就会偶发看不到。
    'flushHostLogs',
  ]
  const present = publicNames.filter(name => exported.has(name))

  return [
    ...renderExternalImports(externalImports),
    '',
    ...chunks,
    '',
    ...present.length === 0 ? [] : [`export { ${present.join(', ')} };`],
    '',
  ].join('\n')
}

/** One full build of both halves. */
async function buildAll() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const hostEntry = 'src/index.ts'
  await writeFile(path.join(OUT, 'index.js'), emitHostBundle(hostEntry))

  const clientEntry = 'src/client/index.tsx'
  const modules = collectClientModules(clientEntry)
  await writeFile(path.join(OUT, 'client.js'), emitClientBundle(modules, clientEntry))

  return { hostModules: 1, clientModules: modules.size }
}

const stats = await buildAll()
console.log(`built lib/index.js and lib/client.js (${stats.clientModules} bundled client modules)`)
