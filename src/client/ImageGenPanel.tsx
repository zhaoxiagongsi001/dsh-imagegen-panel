/**
 * 生图面板根组件。
 *
 * 它是 `main` 槽位里 `key: "imagegen"` 那一个 cell 的内容 —— 也就是点侧栏
 * 「生图」后主区显示的东西。
 *
 * 状态与生命周期的几条约定：
 *  - **持久状态放模块作用域**（`panelStore`）。`main` 槽位在切换面板时可能卸载
 *    本组件，但用户回到「生图」时提示词、参数、历史都应当还在（与真插件的预期一致）。
 *  - **跨 DSH 重启的只有草稿**（宿主 `draft.json`，见 `src/draft-store.ts`）。
 *    模块作用域撑不过一次重启，而「我上次写了一半的提示词」必须撑过去。
 *  - **进面板的初始态**（2026-10-11 定，2026-10-18 改了第 3 条）：
 *      1. 上一次是**成功生成** → 提示词区是空的；
 *      2. 有一份**没生成过**的草稿（提示词 ≠ 最后一次成功生成用的那句）→ 提示词留着；
 *      3. 图像展示区恢复**最后一次成功生成的那张图**（老板 2026-10-18 拍板）。
 *         起因：点「新会话」再点回「生图」，面板是重新挂载的，舞台按老规则一律为空 ——
 *         老板看到的就是「刚才那张图不见了，非得再生成一次才又能看到图」。
 *         现在判据是草稿里的 `lastImageId`（跨 DSH 重启也活），恢复逻辑见
 *         {@link stageImageIdFor}。
 *         **仍然不认「历史列表里的第一张」** —— 进面板就当头看到一张别人写的、
 *         或者更早的图，正是 2026-10-11 要避免的那件事；这里只认那根明确的引用。
 *  - **点历史记录**（2026-10-11）：提示词与该图的参数搬回工作区、图像上舞台；
 *    **设置区的模型不动** —— 那张图当时的模型与参数在结果行里如实显示。
 *  - **回归历史**：进面板时只看那一根引用，所以「点了一张老图 → 切走 → 回来」会回到
 *    **最后一次成功生成的那张**（不是刚才点开看的那张老图）。这是有意的：老板要的是
 *    「刚才生成的图还在」，而把「随手上翻的一张老图」也记成进面板的落点会让语义变糊。
 *  - **组件卸载要取消在飞请求**：用一个递增的 run token 判定「这次结果还算不算数」，
 *    同时用 AbortController 真的把 HTTP 请求掐掉（阶段 4 一次生成可能要 90 秒，
 *    「取消」必须真取消，不能只是不看结果）。
 *  - 未配置时不给生成，但**提示词与参数仍然可编辑** —— 用户可以先写好再配。
 *  - **宿主路由不可用**（宿主半边没加载 / 端口不对）是一种独立状态：这时既不显示
 *    「还没配置」（那是误导），也不静默降级成假数据，而是明说哪里断了。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createHttpBackend } from './api.ts'
import { ArtDefs } from './art.tsx'
import { Composer, prepareReference, referenceLimit, referencesRequired, type ParamState, type Reference } from './Composer.tsx'
import { ConfigModal } from './ConfigModal.tsx'
import { WarnIcon } from './icons.tsx'
import { fieldLabelOf } from './labels.ts'
import { DEFAULT_CONFIG } from './defaults.ts'
import { HistoryMenu, ResultStage } from './ResultStage.tsx'
import { LogViewer } from './LogViewer.tsx'
import { fetchForgePreset, optimizePrompt } from './optimize.ts'
import { GenerateError, type Backend, type GeneratedImage, type ImageParams, type ModelCapabilities, type ModelOption, type PanelConfig, type PanelDraft, type ParameterField, type RunState } from './types.ts'
import css from './panel.module.css'

/**
 * 后端实现。
 *
 * 阶段 3 起是**真实现**：打宿主 `/dsh-imagegen/*` 路由（`src/client/api.ts`）。
 * UI 只依赖 `Backend` 接口，所以换实现没有改任何组件代码。
 */
const backend: Backend = createHttpBackend()

/** 两个候选值表取并集（取长的那个，避免「能力接口比列表窄」把选项变少）。 */
function widerOptions(a: string[], b: string[]): string[] {
  return b.length > a.length ? b : a
}

/** 时间戳 → `21:14`（历史图当参考图时的角标名）。 */
function shortTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 打一次**幂等的读**，失败就退避重试。
 *
 * 为什么需要它（2026-10-18）：挂载时那几跳是**并行**发出的，而面板完全可能正好落在
 * 「宿主半边还没挂上路由」「上一跳被 abort」这类窗口里。原来的写法是读失败静默吞掉、
 * **永不重试** —— 于是「历史是空的、舞台也是空的」这件事在用户眼里要等到**下一次
 * 成功出图**（那条路径会无条件重读一次历史）才自愈，也就是老板报的那个现象。
 *
 * 只用于读接口（它们幂等，重试没有副作用）；**绝不用于生成** —— 那会变成一次点击
 * 扣两次钱。目前只有挂载时的**历史**这一跳用它：配置读失败会明确显示「宿主路由不可用」，
 * 草稿读失败保持内存状态，两者的失败都已经有看得见的落点，不需要靠重试去遮。
 * @param read - 发起一次读。
 * @param attempts - 总尝试次数（含第一次）。
 * @param delays - 每次失败后的等待毫秒数（比尝试次数少一个）。
 * @returns 第一次成功的结果。
 * @throws 最后一次失败的原因。
 */
async function retryRead<T>(read: () => Promise<T>, attempts = 3, delays: number[] = [350, 900]): Promise<T> {
  let last: unknown
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await read()
    } catch (error) {
      last = error
      if (index < delays.length) await new Promise((resolve) => { setTimeout(resolve, delays[index]) })
    }
  }
  throw last
}

/**
 * 进面板时舞台上该摆哪张图（**纯函数，自检直接测它**）。
 *
 * 输入是「候选的那根引用」（草稿/模块作用域里的 `lastImageId`）与已经拿到的历史列表：
 *  - 候选是空串 → 不给图（第一次用、或者用户点过「清空」）；
 *  - 候选不在历史列表里 → 也不给图。**不硬塞**：id 失效（索引被轮转掉、图被删了）
 *    时宁可给一块空舞台，也不要渲染一个必然裂掉的 `<img>`。
 * @param candidate - 最后一次成功生成的那张图的 id。
 * @param history - 当前已知的历史列表。
 * @returns 该推上舞台的 id；没有就 undefined。
 */
export function stageImageIdFor(candidate: string, history: GeneratedImage[]): string | undefined {
  if (candidate === '') return undefined
  return history.some((item) => item.id === candidate) ? candidate : undefined
}

/**
 * 把当前参数值收敛到候选值里。
 *
 * 为什么必要：面板的默认质量是中文「高」，而 OpenRouter 只认 `auto/low/medium/high`。
 * 如果用户不手动改就点生成，会把「高」原样发上去换回一个 400。选中模型后拿到
 * 真实候选值，就把不合法的那一项换成第一个候选 —— 静默修正，但方向是「变成合法的」。
 * @param current - 当前参数。
 * @param options - 该模型的候选值。
 * @returns 收敛后的参数；没有变化时**返回原对象**（避免无谓的重渲染）。
 */
function snapParams(current: ParamState, options: ModelOption['options']): ParamState {
  const keys: (keyof ParamState)[] = ['aspectRatio', 'resolution', 'count', 'quality']
  let next: ParamState | undefined
  for (const key of keys) {
    const candidates = options[key]
    if (candidates.length === 0) continue
    if (candidates.includes(current[key])) continue
    next = { ...(next ?? current), [key]: candidates[0]! }
  }
  return next ?? current
}

/**
 * 进面板时提示词该显示什么（**纯函数，自检直接测它**）。
 *
 * 规则就是老板拍板的那两条：
 *  - 有一份**没生成过**的草稿（提示词 ≠ 最后一次成功生成用的那句）→ 留着；
 *  - 上次是成功生成（两者相等）、或者压根没有草稿 → 空。
 *
 * 比较用 `trim()`：提示词首尾的换行/空格是手滑，不该被当成「我改了内容」。
 * @param draft - 宿主的草稿、或模块作用域里那份；undefined = 还没有草稿。
 * @returns 提示词框里该显示的内容。
 */
export function promptForEntry(draft: { prompt: string; lastGeneratedPrompt: string } | undefined): string {
  if (draft === undefined) return ''
  const current = draft.prompt.trim()
  if (current === '') return ''
  return current === draft.lastGeneratedPrompt.trim() ? '' : draft.prompt
}

/** 点历史记录后，参数区该变成什么样。 */
export interface HistoryParamApply {
  params: ParamState
  extra: Record<string, string>
  /** 真正写进去的字段（中文标签）。 */
  applied: string[]
  /** 当前模型不认、**没有**写进去的字段（中文标签）。 */
  skipped: string[]
}

/**
 * 把一张历史图的参数算成参数区的落点（**纯函数，自检直接测它**）。
 *
 * 为什么不能直接照搬：那张图可能是**另一个模型**生的，它的取值放到当前模型上未必
 * 合法（A 有 `transparent` 背景、B 的枚举里没有）。硬塞进去的后果是下拉框显示成空、
 * 或者用户以为设上了其实发不出去 —— 所以逐个字段判一道，不合格的不写、如实点名。
 *
 * 没有能力表（OpenAI / Gemini / 自定义协议，或老宿主）时不判合法性：那时界面上的
 * 四项本来就是官方全局枚举，照搬比「一项都不写」有用。
 * @param snapshot - 历史图当时的参数（老记录没有）。
 * @param current - 当前的面板状态与当前模型的参数表。
 * @returns 新的参数取值 + 写入/跳过的字段清单。
 */
export function paramsFromHistory(
  snapshot: ImageParams | undefined,
  current: { params: ParamState; extra: Record<string, string>; parameters: ParameterField[] },
): HistoryParamApply {
  if (snapshot === undefined) {
    return { params: current.params, extra: current.extra, applied: [], skipped: [] }
  }
  const hasTable = current.parameters.length > 0
  const table = new Map(current.parameters.map((field) => [field.name, field]))
  const applied: string[] = []
  const skipped: string[] = []

  const params: ParamState = { ...current.params }
  for (const item of HISTORY_CORE_SLOTS) {
    const value = String(snapshot[item.slot] ?? '')
    if (value === '') continue
    if (hasTable && !fieldAccepts(table.get(item.name), value)) { skipped.push(item.label); continue }
    if (params[item.slot] === value) continue
    params[item.slot] = value
    applied.push(item.label)
  }

  const extra: Record<string, string> = { ...current.extra }
  for (const [name, value] of Object.entries(snapshot.extra)) {
    if (value === '') continue
    if (hasTable && !fieldAccepts(table.get(name), value)) { skipped.push(fieldLabelOf(name)); continue }
    if (extra[name] === value) continue
    extra[name] = value
    applied.push(fieldLabelOf(name))
  }

  return { params, extra, applied, skipped }
}

/**
 * 有专属状态槽的字段名。
 *
 * 这四个走 {@link ParamState}（`GenerateRequest` 的一等字段），其余走 `extra`。
 * 与 `Composer.tsx` 的 `CORE_SLOTS` 是同一份约定 —— 那边管渲染，这边管收敛。
 */
const CORE_FIELD_NAMES = new Set(['aspect_ratio', 'resolution', 'n', 'quality'])

/**
 * 历史记录里的核心四项 → 面板参数槽（点历史图回填参数时用）。
 *
 * 顺序就是结果行里「参数」的显示顺序：比例 / 分辨率 / 张数 / 质量。
 */
const HISTORY_CORE_SLOTS: ReadonlyArray<{ name: string; slot: keyof ParamState; label: string }> = [
  { name: 'aspect_ratio', slot: 'aspectRatio', label: '比例' },
  { name: 'resolution', slot: 'resolution', label: '分辨率' },
  { name: 'n', slot: 'count', label: '张数' },
  { name: 'quality', slot: 'quality', label: '质量' },
]

/**
 * 当前模型的参数表接受这个取值吗。
 *
 * 用在「点历史图回填参数」上：那张图可能是**另一个模型**生的，它的参数值放到当前
 * 模型上未必合法（比如 A 有 `transparent` 背景、B 的枚举里没有）。硬塞进去的结果
 * 是下拉框显示成空、或者用户以为设上了其实发不出去 —— 所以先判一道，
 * 不合格的**不写入**，并在提示里如实点名。
 * @param field - 当前模型对该字段的规格；undefined = 该模型不声明这个字段。
 * @param value - 历史记录里的取值。
 * @returns 是否可以直接写进参数区。
 */
function fieldAccepts(field: ParameterField | undefined, value: string): boolean {
  if (field === undefined) return false
  if ((field.control === 'select' || field.control === 'count') && (field.values?.length ?? 0) > 0) {
    return field.values!.includes(value)
  }
  if (field.control === 'number') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return false
    if (field.min !== undefined && parsed < field.min) return false
    if (field.max !== undefined && parsed > field.max) return false
    return true
  }
  return true
}

/**
 * 把「模型驱动表单」里的取值收敛到该模型的合法范围。
 *
 * 切模型时最容易出的错：A 模型给了 `background: transparent`，切到 B 模型后
 * B 的 `background` 枚举里没有 `transparent` —— 不收敛的话界面上会显示一个
 * 该模型不认的值（宿主会在发请求时裁掉它，但用户看到的是「我明明设了」）。
 *
 * 实现上**从新模型的参数表重建**整份 `extra`：新模型不再声明的键自然消失，
 * 也就不会在切回来时冒出一个上次的残留值。
 * @param current - 当前的 extra 取值。
 * @param fields - 新模型的参数表（空数组 = 没有能力表，保持原样）。
 * @param preferred - 配置里给的默认值（目前只有 `output_format`）。
 *   **只在字段还没被用户动过时生效**，且仍要落在该模型的枚举内 ——
 *   否则配置弹层里选的那个格式会因为「字段有自己的默认值」而被无声忽略。
 * @returns 收敛后的 extra；无变化时返回原对象（避免无谓重渲染）。
 */
function snapExtra(
  current: Record<string, string>,
  fields: ParameterField[],
  preferred: Record<string, string> = {},
): Record<string, string> {
  // 没有能力表（OpenAI / Gemini / 自定义协议）：这套收敛无从谈起，别动用户的值。
  if (fields.length === 0) return current
  const next: Record<string, string> = {}
  for (const field of fields) {
    if (CORE_FIELD_NAMES.has(field.name)) continue
    const value = current[field.name] ?? preferred[field.name] ?? field.default
    if (value === '') {
      // 留空 = 不发这个字段，这是合法状态（`seed` / `size` / `output_compression`）。
      // 不可留空的字段（格式 / 背景）由它自己的默认值补上。
      if (!field.clearable && field.default !== '') next[field.name] = field.default
      continue
    }
    if ((field.control === 'select' || field.control === 'count') && (field.values?.length ?? 0) > 0) {
      next[field.name] = field.values!.includes(value) ? value : field.values![0]!
      continue
    }
    if (field.control === 'number') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) continue
      const min = field.min ?? Number.NEGATIVE_INFINITY
      const max = field.max ?? Number.POSITIVE_INFINITY
      next[field.name] = String(Math.min(max, Math.max(min, parsed)))
      continue
    }
    next[field.name] = value
  }
  const changed = Object.keys(next).length !== Object.keys(current).length
    || Object.entries(next).some(([name, value]) => current[name] !== value)
  return changed ? next : current
}

/**
 * 从参数表里取出核心四项的候选值（给 {@link snapParams} 用）。
 *
 * 为什么要放到参数表上算：收敛原来只在 `/capabilities` 回来时跑一次，
 * 而**模型列表比能力接口先到** —— 那段窗口里「质量」会显示成中文「高」，
 * 混在一个候选值是 `auto/low/medium/high` 的下拉里（宿主会把它归一化成
 * `high`、再按模型枚举裁一次，所以不会发错，但界面看着不对）。
 * 拿参数表兜一道，模型列表一到就能收敛。
 * @param fields - 该模型的参数表。
 * @param fallback - 列表接口那份候选值（参数表里没有的项用它兜底）。
 * @returns 与 `ModelOption['options']` 同形的候选值表。
 */
function coreOptionsOf(fields: ParameterField[], fallback: ModelOption['options']): ModelOption['options'] {
  const valuesOf = (name: string): string[] => fields.find((field) => field.name === name)?.values ?? []
  const pick = (name: string, other: string[]): string[] => {
    const own = valuesOf(name)
    return own.length > 0 ? own : other
  }
  return {
    aspectRatio: pick('aspect_ratio', fallback.aspectRatio),
    resolution: pick('resolution', fallback.resolution),
    count: pick('n', fallback.count),
    quality: pick('quality', fallback.quality),
    outputFormat: fallback.outputFormat,
  }
}

/** 跨面板卸载保留的状态（**撑不过 DSH 重启**，跨重启的那份在宿主 `draft.json`）。 */
interface PanelStore {
  prompt: string
  /** 最后一次**成功生成**用的提示词（判「草稿是不是没生成过」用）。 */
  lastGeneratedPrompt: string
  params: ParamState
  /**
   * 模型驱动表单里「非核心四项」的取值（键 = 请求体字段名）。
   *
   * 它的键集合随所选模型变 —— 切模型时由 `snapExtra()` 重建。
   */
  extra: Record<string, string>
  references: Reference[]
  history: GeneratedImage[]
  /**
   * 最后一次**成功生成**的那张图的 id（`''` = 还没有 / 已清空）。
   *
   * 它是「切走再回来时舞台摆哪张」的**内存里那一份**。磁盘上的那份在宿主 `draft.json`
   * （字段同名），两者分工：内存这份撑住同一次运行里的重新挂载，磁盘那份撑住重启 ——
   * 出图后 400 ms 的防抖窗口里可能还没来得及落盘，所以**内存优先**。
   */
  lastImageId: string
  config: PanelConfig | undefined
  models: ModelOption[]
}

const panelStore: PanelStore = {
  /**
   * 提示词**默认是空的**。
   *
   * 这里原来写着一句演示用的「戴耳机的柴犬」，于是每次重启 DSH 进面板都会看到一句
   * 自己没写过的话 —— 与「上次生成成功就给我一块空面板」直接冲突。面板的初始态由
   * 草稿决定（见文件头），不再有硬编码的示例文案。
   */
  prompt: '',
  lastGeneratedPrompt: '',
  params: { aspectRatio: '16:9', resolution: '1K', count: '1', quality: '高' },
  extra: {},
  references: [],
  history: [],
  // 空 = 还没有成功生成过（或用户清空过）。舞台恢复的候选就是它。
  lastImageId: '',
  // 用默认配置打底，而不是留 undefined。
  // 否则首帧（配置还没从宿主回来那几十毫秒）页头会闪一下「模型 未选择」。
  // 默认配置的 hasKey 是 false，所以这一帧仍然按「未配置」渲染 ——
  // 行为不变，只是不再闪。**它只是首帧占位**：宿主配置一回来就会被接管
  // （见下面的挂载 effect；别把这里改成「有值就不覆盖」，那会让存好的配置永远读不进来）。
  config: { ...DEFAULT_CONFIG },
  models: [],
}

/**
 * 轻提示。错误提示停留更久（见下面那个定时器）。
 *
 * 位置：2026-10-18 起显示在**「历史记录 · 最近 N 张」右边**（原来是浮在面板底部
 * 的一块 toast），所以这里只是数据，渲染在 `ResultStage` 的历史行里。
 */
interface Toast {
  text: string
  kind: 'ok' | 'err'
}

/** 生图面板。 */
export function ImageGenPanel(): React.JSX.Element {
  const [prompt, setPrompt] = useState(() => promptForEntry(panelStore))
  const [lastGeneratedPrompt, setLastGeneratedPrompt] = useState(panelStore.lastGeneratedPrompt)
  const [params, setParams] = useState(panelStore.params)
  const [extra, setExtra] = useState(panelStore.extra)
  const [references, setReferences] = useState<Reference[]>(panelStore.references)
  const [history, setHistory] = useState<GeneratedImage[]>(panelStore.history)
  /**
   * 「最后一次成功生成的那张图」的 id（舞台恢复的候选，见 {@link stageImageIdFor}）。
   *
   * 初始值取模块作用域里那份：同一次运行里切走再回来时，它是最新的（比磁盘新）。
   */
  const [lastImageId, setLastImageId] = useState(panelStore.lastImageId)
  /**
   * 舞台上展示的那张。
   *
   * 初始值 = **最后一次成功生成的那张**（老板 2026-10-18 拍板）：
   * 切到会话/新建会话会把面板卸载，回到「生图」是重新挂载 —— 这时舞台上应当还是
   * 刚才那张图，而不是一块空面板。
   *
   * 首帧就能拿到它靠两件事同时成立：模块作用域里的 `lastImageId` 与 `history` 都在
   * （`stageImageIdFor()` 只在候选确实在列表里时才给图）。所以「切走再回来」不会
   * 先闪一下「还没有图片」再蹦出图；磁盘那份（草稿里的 `lastImageId`）是重启后的兜底。
   *
   * 提示词的初始值则走 {@link promptForEntry}（同样的思路），宿主草稿回来后还会再判一次。
   */
  const [previewId, setPreviewId] = useState<string | undefined>(
    () => stageImageIdFor(panelStore.lastImageId, panelStore.history),
  )
  const [config, setConfig] = useState<PanelConfig | undefined>(panelStore.config)
  const [models, setModels] = useState<ModelOption[]>(panelStore.models)
  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const [configOpen, setConfigOpen] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [toast, setToast] = useState<Toast | undefined>(undefined)
  /** 宿主路由不可用时的原因（不是「未配置」）。 */
  const [hostError, setHostError] = useState<string | undefined>(undefined)
  /** 出错时点「查看日志」打开的宿主日志抽屉。 */
  const [logOpen, setLogOpen] = useState(false)
  /** 历史图的右键菜单（含鼠标视口坐标）。 */
  const [historyMenu, setHistoryMenu] = useState<{ image: GeneratedImage; x: number; y: number } | undefined>(undefined)
  /** 菜单触发的动作正在跑（取图/保存中）——期间禁用菜单项，避免连点。 */
  const [menuBusy, setMenuBusy] = useState(false)
  /** 正在用 prompt-forge 优化提示词。 */
  const [optimizing, setOptimizing] = useState(false)
  /** 优化前的草稿（有值就显示「撤销」）。点历史图覆盖草稿时也会用它。 */
  const [undoPrompt, setUndoPrompt] = useState<string | undefined>(undefined)
  /** 在飞的优化请求（换面板/卸载时中止）。 */
  const optimizeAbort = useRef<AbortController | null>(null)

  /**
   * 草稿已经读回来了吗。
   *
   * 在它变成 true 之前**绝不回写草稿** —— 否则首帧那份空提示词会先把磁盘上
   * 真正的草稿覆盖掉，然后「上次写的东西」就永远回不来了。
   */
  const draftReady = useRef(false)

  /**
   * 防抖窗口里还没落盘的那份草稿。
   *
   * 存在的意义是卸载时能补一刀：用户敲完最后一个字就切走，那 400 ms 的定时器
   * 被清掉，改动就丢了 —— 这里留一份，卸载时补发一次。
   */
  const pendingDraft = useRef<PanelDraft | undefined>(undefined)

  /**
   * 用户在草稿回来**之前**就动过面板了吗。
   *
   * 挂载时三件事并行读（配置 / 历史 / 草稿），`applyDraft` 要等三件都落地才跑 ——
   * 这段时间里用户完全可能已经开始打字（尤其是一次 Ctrl+V 粘贴）。那种情况下
   * 铺草稿会把刚敲的内容**覆盖掉**，所以一旦动过，就只认用户手上的状态。
   */
  const touchedBeforeDraft = useRef(false)

  /** 记一笔「用户动过面板」。草稿已经回来之后再动就没有这层顾虑了。 */
  const markTouched = useCallback((): void => {
    if (!draftReady.current) touchedBeforeDraft.current = true
  }, [])

  /**
   * 「参数表变了就收敛一次」的额外触发计数。
   *
   * 草稿是异步回来的，可能在模型参数表**已经到位之后**才铺进面板 —— 那时
   * 收敛 effect 的依赖（参数表 / 模型）都没变，不会再跑一次，草稿里那些
   * 当前模型不认的取值就会一直挂在界面上。铺草稿时把计数加一，让它补跑。
   */
  const [snapEpoch, setSnapEpoch] = useState(0)

  /**
   * 当前在飞的那次生成的 token。
   *
   * 卸载或取消时把它加一，回调据此判断自己是否已经过期 —— 配合下面的
   * AbortController，既不看过期结果，也不让请求白跑。
   */
  const runToken = useRef(0)

  /** 在飞的生成请求。取消/卸载时 abort。 */
  const inFlight = useRef<AbortController | null>(null)

  /** 轻提示。 */
  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok'): void => {
    setToast({ text, kind })
  }, [])

  /**
   * 从宿主重读历史。
   *
   * 出图后一定要重读一次：`n > 1` 时宿主把每张都落盘并进了索引，而 `generate()`
   * 只拿到第一张 —— 不重读的话，另外几张要等下次进面板才看得到。
   * 顺带也把宿主的 `autoSavedPath`（自动另存到工作区的那份）带回来。
   */
  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      const list = await backend.listHistory()
      setHistory(list)
    } catch {
      // 读不到就保持现状：下一次生成或下次进面板会再试。
    }
  }, [])

  // 回写模块作用域，让面板在切换后回来还能接上（跨 DSH 重启的那份在宿主草稿里）。
  useEffect(() => { panelStore.prompt = prompt }, [prompt])
  useEffect(() => { panelStore.lastGeneratedPrompt = lastGeneratedPrompt }, [lastGeneratedPrompt])
  useEffect(() => { panelStore.params = params }, [params])
  useEffect(() => { panelStore.extra = extra }, [extra])
  useEffect(() => { panelStore.references = references }, [references])
  useEffect(() => { panelStore.history = history }, [history])
  useEffect(() => { panelStore.lastImageId = lastImageId }, [lastImageId])
  useEffect(() => { panelStore.config = config }, [config])
  useEffect(() => { panelStore.models = models }, [models])

  /**
   * 把读回来的草稿铺进面板。
   *
   * 规则集中在这一个函数里（对应文件头那三条）：
   *  - 提示词**只在「与最后一次成功生成用的那句不同」时才留下** —— 那正是
   *    「我写了、还没生成」；相等就意味着上次已经生成过了，给一块空面板。
   *  - 参数永远跟着草稿走：草稿就是「工作区最后一次的样子」。
   *  - `undefined` = 宿主明确回答「还没有草稿」（首次使用）。**读失败不算**
   *    —— 那种情况调用方直接跳过，保持内存里的状态不动，绝不能把用户手上的
   *    提示词当成「磁盘上没有」清掉。
   *
   * 另外它还负责**舞台恢复的候选**（`lastImageId`）：这一条**与用户有没有抢在草稿
   * 之前动过手无关** —— 打字不影响「刚才那张图是哪张」，所以放在最前面、三个分支都吃。
   * @param draft - 宿主回的草稿。
   */
  const applyDraft = useCallback((draft: PanelDraft | undefined): void => {
    // 只在内存里没有候选时才认磁盘那份：刚出图就切走时，磁盘上的草稿可能还在
    // 400 ms 防抖窗口里（甚至没写成功），而模块作用域里那份一定是最新的。
    if (panelStore.lastImageId === '') setLastImageId(draft?.lastImageId ?? '')
    // 用户抢在草稿之前动过手 → 只记「最后一次成功生成用的那句」（那是判据），
    // 提示词与参数一概不覆盖：他手上的东西比磁盘上那份新。
    if (touchedBeforeDraft.current) {
      setLastGeneratedPrompt(draft?.lastGeneratedPrompt ?? '')
      return
    }
    if (draft === undefined) {
      setLastGeneratedPrompt('')
      setPrompt('')
      return
    }
    setLastGeneratedPrompt(draft.lastGeneratedPrompt)
    setParams(draft.params)
    setExtra(draft.extra)
    setPrompt(promptForEntry(draft))
    // 草稿里的取值可能来自另一个模型 —— 让收敛 effect 补跑一次（见 snapEpoch）。
    setSnapEpoch((epoch) => epoch + 1)
  }, [])

  // 首次挂载：读配置、历史与草稿。
  //
  // 刻意**不用** loading 门挡住首帧：配置还没回来时按「未配置」渲染完整骨架，
  // 用户看到的是稳定的版面而不是闪一下的空白。宿主配置一回来就直接接管 ——
  // 它是权威（磁盘文件），面板不跟它讨价还价。
  //
  // 三件事用 `Promise.allSettled` 而不是 `Promise.all`：草稿读不到（宿主还是旧构建、
  // 路由 404）不该让配置也判失败 —— 那是三个互不相干的接口。
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    void (async () => {
      const [configOutcome, historyOutcome, draftOutcome] = await Promise.allSettled([
        backend.loadConfig(controller.signal),
        // 历史这一跳要**能重试**：它失败原来是静默吞掉且永不重试，于是「面板回来
        // 是空的」只能等下一次成功出图才自愈（见 retryRead 的注释）。
        retryRead(() => backend.listHistory(controller.signal)),
        backend.loadDraft(controller.signal),
      ])
      if (!alive) return

      if (configOutcome.status === 'fulfilled') {
        setConfig(configOutcome.value)
        setHostError(undefined)
      } else {
        setHostError(configOutcome.reason instanceof Error ? configOutcome.reason.message : String(configOutcome.reason))
      }

      // 历史：**无条件**灌一次。模块作用域那份只用来撑住首帧，不能拿它当真相 ——
      // 索引是宿主的磁盘文件，别的实例/上一轮都可能改过它（原来那句「模块缓存非空
      // 就不读宿主」会让「回来时看到的是旧列表」变成一个查不出的怪事）。
      // 读失败时保持现状：模块作用域那份还在，不会把已经画出来的缩略图抹掉。
      if (historyOutcome.status === 'fulfilled') setHistory(historyOutcome.value)

      // 草稿：读成功才动面板状态；读失败保持现状（见 applyDraft 的注释）。
      if (draftOutcome.status === 'fulfilled') applyDraft(draftOutcome.value)
      draftReady.current = true
    })()
    return () => {
      alive = false
      controller.abort()
    }
  }, [applyDraft])

  // 草稿自动落盘（防抖 400 ms）。**读完之前绝不回写**，理由见 draftReady 的注释。
  useEffect(() => {
    if (!draftReady.current) return undefined
    pendingDraft.current = { prompt, params, extra, lastGeneratedPrompt, lastImageId, updatedAt: 0 }
    const timer = window.setTimeout(() => {
      const draft = pendingDraft.current
      pendingDraft.current = undefined
      if (draft !== undefined) void backend.saveDraft(draft)
    }, 400)
    return () => { window.clearTimeout(timer) }
  }, [prompt, params, extra, lastGeneratedPrompt, lastImageId])

  // 卸载时把防抖窗口里那一份补上：敲完最后一个字就切走/关窗，改动不该丢。
  useEffect(() => () => {
    const draft = pendingDraft.current
    pendingDraft.current = undefined
    if (draft !== undefined) void backend.saveDraft(draft)
  }, [])

  // 卸载时作废在飞的请求，并把 HTTP 请求掐掉。
  useEffect(() => () => {
    runToken.current += 1
    inFlight.current?.abort()
    inFlight.current = null
  }, [])

  // 生成中每秒刷新计时。
  useEffect(() => {
    if (run.kind !== 'running') return undefined
    const timer = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)))
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [run])

  // 轻提示自动消失：报错留 6 秒（用户要读完那句原始报错），成功留 1.8 秒。
  useEffect(() => {
    if (toast === undefined) return undefined
    const timer = window.setTimeout(() => { setToast(undefined) }, toast.kind === 'err' ? 6000 : 1800)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  const model = useMemo(
    () => models.find((item) => item.id === config?.model) ?? models[0],
    [models, config?.model],
  )

  /**
   * 所选模型的权威能力（`/capabilities`）；拉不到时 undefined，界面退回保守行为。
   *
   * **必须带着它的 model id 一起存。** 只存能力对象会有一个很难查的 bug：
   * 用户切模型的瞬间，新模型的请求还在飞、旧的能力对象还在 state 里，
   * 参数行会短暂地按**上一个模型**渲染 —— 甚至连参考图上限都用错的那个。
   * 带上 id 之后，能力对象只在「它所属的模型 == 当前选中的模型」时才算数。
   */
  const [capsState, setCapsState] = useState<{ id: string; caps: ModelCapabilities } | undefined>(undefined)
  const modelCaps = capsState !== undefined && capsState.id === config?.model ? capsState.caps : undefined

  /**
   * 界面上要渲染的参数表。
   *
   * 能力接口的（endpoint 级并集）优先；还没回来时用模型列表里那份（模型级），
   * 两者都没有就是空数组 —— 那时 `Composer` 退回固定的四项。
   */
  const parameters: ParameterField[] = useMemo(
    () => ((modelCaps?.parameters?.length ?? 0) > 0 ? modelCaps!.parameters : (model?.parameters ?? [])),
    [modelCaps, model],
  )

  // 参数表一变（切模型、或列表/能力接口刚到）就把取值收敛到该模型的合法范围。
  // 两个 `snap*()` 在无变化时都返回原对象，所以这次 setState 会直接 bail out，
  // 不会因为 effect 依赖了 state 而打转。
  //
  // `snapEpoch` 是「铺完草稿再收敛一次」的触发器：草稿异步回来时参数表可能早就
  // 到位了，不补跑这一趟，草稿里那些当前模型不认的取值就会一直挂在界面上。
  useEffect(() => {
    if (parameters.length === 0) return
    const options = coreOptionsOf(parameters, model?.options ?? {
      aspectRatio: [], resolution: [], count: [], quality: [], outputFormat: [],
    })
    setParams((state) => snapParams(state, options))
    // 配置弹层里那个「输出格式」是**默认值**，不是空话：字段还没被用户动过时，
    // 它优先于字段自己的默认值（仍要落在该模型枚举内 —— 收敛逻辑会兜住）。
    setExtra((state) => snapExtra(state, parameters, { output_format: config?.outputFormat ?? '' }))
  }, [parameters, model, config?.outputFormat, snapEpoch])

  /** 该模型允许的参考图上限（已按网关全局 `maxItems: 16` 收敛）。 */
  const refLimit = referenceLimit(model)
  /** 该模型是否必须给底图（改图专用模型）。 */
  const refRequired = referencesRequired(model)
  /** 模型声明但被全局上限压下来的那个数（`tencent/…` 声明 20、接口只收 16）。 */
  const referenceDeclaredMax = modelCaps?.referencesDeclaredMax ?? 0

  /**
   * 配置里那段「额外参数」JSON 覆盖了哪些**面板上看得见**的字段（中文标签）。
   *
   * 为什么要算这个：宿主侧那段 JSON 是**最后无条件合并**的（用户显式写的东西优先），
   * 而本机默认配置里就写着 `output_compression: 90` 与 `background: "opaque"` ——
   * 这两个字段原来没有界面，现在有了。不算的话用户会在面板上选 80、实际发 90，
   * 属于典型的「以为设上了」。这里在**生成之前**就把它摆到台面上。
   */
  const overriddenFields = useMemo(() => {
    const raw = config?.extraJson?.trim() ?? ''
    if (raw === '' || parameters.length === 0) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return []
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
    const keys = new Set(Object.keys(parsed as Record<string, unknown>))
    return parameters.filter((field) => keys.has(field.name)).map((field) => field.label)
  }, [config?.extraJson, parameters])

  const preview = useMemo(
    () => history.find((item) => item.id === previewId),
    [history, previewId],
  )

  /**
   * 舞台恢复：把「最后一次成功生成的那张」重新推上舞台。
   *
   * 为什么要有这个 effect（而不是挂载时算一次就完）：历史的到达**顺序不定** ——
   *  - 同一次运行里重新挂载：`useState` 的初值已经带上了（这里是空转）；
   *  - DSH 重启后：模块作用域是空的，历史要从宿主读回来、候选 id 要等草稿落地；
   *  - 出图后重读历史（`n > 1`）：整个列表会被替换。
   * 统一在这里补一刀，上面任何一种顺序都能收敛到「那张图在舞台上」。
   *
   * 三条刻意的边界：
   *  1. 用户自己选过图（`previewId` 有值）就不再抢 —— 他点哪张就是哪张；
   *  2. 点「清空」会把 `lastImageId` 一起清掉，所以清空之后不会在这里自己长回来；
   *  3. 候选不在历史里就什么都不做（见 {@link stageImageIdFor}），不硬塞一个必然裂掉的图。
   */
  useEffect(() => {
    if (previewId !== undefined) return
    const wanted = stageImageIdFor(lastImageId, history)
    if (wanted === undefined) return
    setPreviewId(wanted)
  }, [history, lastImageId, previewId])

  const notConfigured = config === undefined || !config.hasKey

  // --------------------------------------------------------------- 生成

  const generate = useCallback(async (): Promise<void> => {
    if (config === undefined) return
    // 本地先拦掉两类「必被上游拒」的请求 —— 让用户看一句人话，而不是等 90 秒换回 502。
    if (modelCaps?.available === false) {
      notify(`「${config.model}」当前没有可服务的上游通道（目录里有它，但一个 endpoint 都没有）`, 'err')
      return
    }
    const needRefs = model?.references?.min ?? 0
    if (needRefs >= 1 && references.length < needRefs) {
      notify(`「${config.model}」是改图专用模型，至少要给 ${needRefs} 张参考图`, 'err')
      return
    }
    const token = ++runToken.current
    // 前一次还在飞就先掐掉：同一时刻只允许一次生成。
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    setRun({ kind: 'running', startedAt: Date.now() })
    setElapsedSec(0)

    try {
      const image = await backend.generate(config, {
        prompt,
        model: config.model,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        count: Number(params.count) || 1,
        quality: params.quality,
        references: references.map((item) => item.dataUrl),
        // 模型驱动表单收集的其它字段（`background` / `seed` / `size` / `stream` …）。
        // 宿主会按同一份能力表再裁一次：这里给什么，它都要过一遍「该模型是否声明」
        // 与「取值是否在枚举/区间内」，所以多给不会出错，只会被如实记进 `dropped`。
        ...Object.keys(extra).length === 0 ? {} : { extra },
      }, controller.signal)
      if (runToken.current !== token) return
      setHistory((current) => [image, ...current])
      setPreviewId(image.id)
      /**
       * 记下「最后一次成功生成的是哪张」。
       *
       * 它就是**舞台恢复**的判据：切到会话再回来（面板重新挂载）、甚至重启 DSH，
       * 舞台上摆的都是这张。跟着草稿一起落盘（400 ms 防抖），所以「刚出图就切走」
       * 也不会丢 —— 内存那份比磁盘新，见 applyDraft。
       */
      setLastImageId(image.id)
      setRun({ kind: 'done', image })
      /**
       * 记下「最后一次成功生成用的是哪句提示词」。
       *
       * 它就是进面板时那条规则的判据：提示词框里的话**等于**它 = 上次已经生成过了，
       * 下次进来给一块空面板；**不等于**它 = 这是一份没生成过的草稿，得留着。
       *
       * 注意这里**不清空输入框** —— 刚出图就把提示词抹掉，用户想微调后「重新生成」
       * 还得重敲一遍。清空只发生在**下一次进入面板**时（见 applyDraft）。
       */
      setLastGeneratedPrompt(prompt)
      if (image.count !== undefined && image.count > 1) {
        notify(`已生成 ${image.count} 张，全部已保存（下方历史里可逐张查看）`)
      }
      // 重读一次历史：把 n>1 的其余几张、以及宿主的 autoSavedPath 一并带回来。
      void refreshHistory()
    } catch (error) {
      if (runToken.current !== token) return
      if (error instanceof GenerateError) {
        setRun({ kind: 'error', message: error.message, detail: error.detail })
      } else {
        setRun({ kind: 'error', message: '生成失败', detail: String(error) })
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }, [config, modelCaps, model, references, prompt, params, extra, notify, refreshHistory])

  const cancel = useCallback((): void => {
    runToken.current += 1
    inFlight.current?.abort()
    inFlight.current = null
    setRun({ kind: 'idle' })
    notify('已取消')
  }, [notify])

  // ---------------------------------------- 点历史记录：把提示词与参数搬回来

  /**
   * 点一条历史记录：该图的**提示词与参数**回到工作区，图本身推上舞台。
   *
   * 三条刻意的行为：
   *  1. **设置区的模型不动**（老板拍板）。那张图当时用的是哪个模型、哪些参数，
   *     由结果行如实显示 —— 否则「参数回来了、模型还是另一个」这件事根本看不见。
   *  2. **参数只写「当前模型也认」的那些**：历史图可能来自另一个模型，硬塞一个
   *     不合法取值会让下拉显示成空、或者让人以为设上了其实发不出去。认不下的
   *     如实点名，而不是静默改掉。
   *  3. 覆盖用户正在写的草稿之前，先把原草稿放进「撤销」——一句话就能找回来。
   * @param image - 被点中的历史图。
   */
  const applyHistoryImage = useCallback((image: GeneratedImage): void => {
    setPreviewId(image.id)
    // 上一次是报错时，舞台正显示着错误卡片 —— 点了历史图却什么都没变，看着像坏了。
    // 报错态让位给「看这张图」；**生成中不动**（那会儿进度和「取消」比看图重要）。
    setRun((current) => (current.kind === 'error' ? { kind: 'idle' } : current))
    if (prompt.trim() !== '' && prompt !== image.prompt) setUndoPrompt(prompt)
    setPrompt(image.prompt)

    if (image.params === undefined) {
      notify('已载入该图的提示词（这张生成于升级前，没有参数记录）')
      return
    }

    const result = paramsFromHistory(image.params, { params, extra, parameters })
    setParams(result.params)
    setExtra(result.extra)
    // 与铺草稿同理：参数表这会儿可能早就到位了，补跑一次收敛（幂等）。
    setSnapEpoch((epoch) => epoch + 1)

    if (result.skipped.length > 0) {
      notify(
        `已载入该图的提示词与参数；${result.skipped.length} 项与当前模型不符、没有写入：${[...new Set(result.skipped)].join('、')}`,
        'err',
      )
      return
    }
    notify(result.applied.length > 0 ? `已载入该图的提示词与参数（${result.applied.length} 项）` : '已载入该图的提示词与参数')
  }, [prompt, params, extra, parameters, notify])

  // ------------------------------------------------- 保存 / 另存为 / 复制

  /** 把某张图另存一份到工作区目录（「保存」按钮与历史右键菜单共用）。 */
  const saveImageToWorkspace = useCallback(async (image: GeneratedImage): Promise<void> => {
    try {
      const path = await backend.saveImage(image.id)
      notify(`已保存到 ${path}`)
      void refreshHistory()
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    }
  }, [notify, refreshHistory])

  /** 把某张图写进系统剪贴板。 */
  const copyImage = useCallback(async (image: GeneratedImage): Promise<void> => {
    if (image.imageUrl === undefined) return
    try {
      const response = await fetch(image.imageUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      notify('图片已复制到剪贴板')
    } catch (error) {
      // 剪贴板写入在部分环境会被拒；这不是致命错误，提示改走「另存为…」。
      notify(`复制失败：${error instanceof Error ? error.message : String(error)}（可改用「另存为…」）`, 'err')
    }
  }, [notify])

  /**
   * 用系统默认程序打开某张图的**本地原图**。
   *
   * 这件事只能宿主做（浏览器起不来看图工具），所以走 `/dsh-imagegen/open`。
   * 提示里只放**文件名**（不是完整路径）：出问题时要能说出是哪一张，而完整路径
   * 有一百多个字符，单行 toast 放不下会被裁掉；打开的一律是 `out/` 里那份，
   * 也不存在两份同名图要区分的歧义。
   */
  const openImage = useCallback(async (image: GeneratedImage): Promise<void> => {
    try {
      const path = await backend.openImage(image.id)
      const name = path.split(/[\\/]/u).pop() ?? ''
      notify(name === '' ? '已交给系统默认程序打开' : `已用系统默认程序打开 ${name}`)
    } catch (error) {
      notify(`打开失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    }
  }, [notify])

  /** 「保存」：把舞台上那张存到工作区。 */
  const saveCurrent = useCallback((): void => {
    if (preview !== undefined) void saveImageToWorkspace(preview)
  }, [preview, saveImageToWorkspace])

  /** 「复制」：把舞台上那张写进剪贴板。 */
  const copyCurrent = useCallback((): void => {
    if (preview !== undefined) void copyImage(preview)
  }, [preview, copyImage])

  /** 「另存为…」：交给浏览器下载 —— 系统会弹真正的保存对话框。 */
  const saveAsCurrent = useCallback((): void => {
    if (preview?.imageUrl === undefined) return
    const fileName = preview.savedPath?.split(/[\\/]/u).pop() ?? `${preview.id}.png`
    const anchor = document.createElement('a')
    anchor.href = preview.imageUrl
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    notify('已交给系统的保存对话框')
  }, [preview, notify])

  // ------------------------------------------------- 历史图右键菜单

  /**
   * 把一张历史图变成参考图。
   *
   * 链路：历史缩略图 →（宿主 `/image/<id>`）→ Blob → data URL → 参考图槽。
   * 之所以要绕一圈 data URL：生成时参考图是随请求体一起发的（`input_references`），
   * 不是给宿主一个 URL 让它自己去取 —— 那样等于让宿主去访问一个它自己的路由。
   */
  const useAsReference = useCallback(async (image: GeneratedImage): Promise<void> => {
    if (image.imageUrl === undefined) {
      notify('这张图没有可取回的地址（可能是旧索引数据）', 'err')
      return
    }
    if (references.some((item) => item.sourceId === image.id)) {
      notify('这张已经在参考图里了')
      return
    }
    if (references.length >= refLimit) {
      notify(`参考图最多 ${refLimit} 张`, 'err')
      return
    }

    setMenuBusy(true)
    try {
      const response = await fetch(image.imageUrl)
      if (!response.ok) throw new Error(`取图失败 HTTP ${response.status}`)
      // 走的和「选文件」同一条准备链路：历史图也可能很大（4K PNG 动辄几 MB），
      // 图生图时同样会撞 413。
      const prepared = await prepareReference(await response.blob())
      const dataUrl = prepared.dataUrl
      setReferences((current) => {
        // 再查一次：等图的这段时间里用户可能自己又加了一张。
        if (current.some((item) => item.sourceId === image.id) || current.length >= refLimit) return current
        return [...current, {
          id: `ref-hist-${image.id}`,
          name: `历史 ${shortTime(image.createdAt)}`,
          dataUrl,
          sourceId: image.id,
          ...prepared.note === '' ? {} : { note: prepared.note },
        }]
      })
      notify(prepared.note === '' ? '已作为参考图加入左侧' : `已作为参考图加入左侧（${prepared.note}）`)
    } catch (error) {
      notify(`作为参考图失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    } finally {
      setMenuBusy(false)
      setHistoryMenu(undefined)
    }
  }, [references, refLimit, notify])

  // Esc 关掉右键菜单（点别处由菜单自带的遮罩负责）。
  useEffect(() => {
    if (historyMenu === undefined) return undefined
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setHistoryMenu(undefined) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [historyMenu])

  // --------------------------------------------------------------- 提示词优化

  /**
   * 用 prompt-forge 的「文生图优化」模板改写当前草稿。
   *
   * 两步都在浏览器侧完成：先从我们宿主拿模板文本（`/dsh-imagegen/preset`），
   * 再直接打 prompt-forge 自己的 SSE 路由。结果**直接覆盖输入框**，并留一个「撤销」。
   */
  const runOptimize = useCallback(async (): Promise<void> => {
    const draft = prompt.trim()
    if (draft === '' || optimizing) return

    const original = prompt
    const controller = new AbortController()
    optimizeAbort.current = controller
    setOptimizing(true)
    setUndoPrompt(undefined)
    let received = false

    try {
      const preset = await fetchForgePreset(controller.signal)
      setPrompt('')
      const result = await optimizePrompt(draft, preset.system, (chunk) => {
        received = true
        setPrompt((current) => current + chunk)
      }, controller.signal)
      setPrompt(result)
      setUndoPrompt(original)
      const where = preset.model !== '' ? preset.model : preset.provider
      notify(where === '' ? `提示词已优化（${preset.name}）` : `提示词已优化（${preset.name} · ${where}）`)
    } catch (error) {
      // 一个字都没收到 → 原样还原；已经收到半截 → 留着，但给撤销，别让用户白丢草稿。
      if (received) setUndoPrompt(original)
      else setPrompt(original)
      const message = error instanceof Error ? error.message : String(error)
      notify(`优化失败：${message}`, 'err')
    } finally {
      optimizeAbort.current = null
      setOptimizing(false)
    }
  }, [prompt, optimizing, notify])

  /** 还原成优化前那段草稿。 */
  const undoOptimize = useCallback((): void => {
    if (undoPrompt === undefined) return
    setPrompt(undoPrompt)
    setUndoPrompt(undefined)
    notify('已还原优化前的提示词')
  }, [undoPrompt, notify])

  // 面板卸载时中止在飞的优化（SSE 连接不能挂着）。
  useEffect(() => () => { optimizeAbort.current?.abort() }, [])

  // --------------------------------------------------------------- 配置

  const openConfig = useCallback((): void => { setConfigOpen(true) }, [])

  const pullModels = useCallback(async (): Promise<void> => {
    if (config === undefined) return
    setPulling(true)
    try {
      const { models: list, note } = await backend.listModels(config)
      setModels(list)
      // 宿主给的 note 优先（例如「这个协议没有能力表，请手填模型 id」）——
      // 比「拉到 0 个模型」有用得多。
      notify(note ?? `拉到 ${list.length} 个模型`)
    } catch (error) {
      // 拉不到模型不该让面板不可用：参数行会退化成当前值，生成仍可点。
      notify(`模型列表拉取失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    } finally {
      setPulling(false)
    }
  }, [config, notify])

  const saveConfig = useCallback(async (next: PanelConfig, plainKey: string): Promise<void> => {
    // 明文 Key 只随这一次 PUT 进宿主，前端不保存。宿主校验不过会抛，
    // 这时**不关弹层**，让用户就着原来的输入改。
    try {
      const saved = await backend.saveConfig(next, plainKey)
      setConfig(saved)
      setHostError(undefined)
      setConfigOpen(false)
      notify(saved.hasKey ? '配置已保存' : '已保存，但还没有可用的 Key', saved.hasKey ? 'ok' : 'err')
      if (models.length === 0) void pullModels()
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    }
  }, [models.length, pullModels, notify])

  // 首次进面板时把模型候选也拉一次（真接口：上游 `GET /images/models`）。
  useEffect(() => {
    if (config !== undefined && models.length === 0) void pullModels()
  }, [config, models.length, pullModels])

  // 选中模型后拉它的**权威能力与定价**：模型列表接口不含定价，所以这一跳换来的
  // 是界面上那句真报价，以及跨 provider 合并后的参数候选值。
  // 失败不致命：下拉退化成列表里那份候选值，价格留空。
  useEffect(() => {
    const modelId = config?.model
    if (modelId === undefined || modelId === '') return undefined
    const current = config
    const controller = new AbortController()
    void (async () => {
      try {
        const caps = await backend.modelCapabilities(current, modelId, params.resolution, controller.signal)
        if (controller.signal.aborted) return
        const merged = {
          aspectRatio: caps.options.aspectRatio,
          resolution: caps.options.resolution,
          count: caps.options.count,
          quality: caps.options.quality,
          outputFormat: caps.options.outputFormat,
        }
        setCapsState({ id: modelId, caps })
        setModels((list) => list.map((item) => item.id !== modelId ? item : {
          ...item,
          price: caps.price !== '' ? caps.price : item.price,
          caps: caps.caps.length > 0 ? caps.caps : item.caps,
          supportsReferences: caps.supportsReferences,
          // 参考图张数是硬约束（上游上限从 1 到 20 都有）：以能力接口为准，
          // 拿不到才退回列表里那份。
          references: caps.available ? caps.references : item.references,
          // 参数表同理：endpoint 级并集比模型级更权威。
          parameters: caps.parameters.length > 0 ? caps.parameters : item.parameters,
          supportsStreaming: caps.supportsStreaming || item.supportsStreaming,
          options: {
            aspectRatio: widerOptions(item.options.aspectRatio, merged.aspectRatio),
            resolution: widerOptions(item.options.resolution, merged.resolution),
            count: widerOptions(item.options.count, merged.count),
            quality: widerOptions(item.options.quality, merged.quality),
            outputFormat: widerOptions(item.options.outputFormat ?? [], merged.outputFormat),
          },
        }))
        // 参数值不在候选里就换成第一个候选（中文「高」→ 合法的英文枚举）。
        setParams((state) => snapParams(state, merged))
        // `extra` 的收敛交给下面那个「参数表变了就收敛」的 effect —— 它依赖的
        // `parameters` 正是从 `capsState` 推出来的，放在这里会变成两个写入方。
      } catch {
        // 静默：能力拉不到时面板照常可用。
      }
    })()
    return () => { controller.abort() }
  }, [config, params.resolution])

  // --------------------------------------------------------------- 渲染

  return (
    <div className={css.panel}>
      <ArtDefs />

      {hostError !== undefined && (
        <div className={css.guideErr}>
          <WarnIcon />
          宿主路由不可用：{hostError}
          <span className={css.guideHint}>配置与落盘都在宿主侧，请确认插件宿主半边已加载</span>
        </div>
      )}

      {notConfigured && hostError === undefined && (
        <div className={css.guide}>
          <WarnIcon />
          还没配置生图服务，配置后才能生成图片。
          <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={openConfig}>去配置</button>
        </div>
      )}

      <div className={css.body2}>
        {/*
          左栏 = 页头 + 输入区。

          页头原来横跨整宽、右上角钉着「模型」chip 与「连接配置」按钮，那一条的高度
          是从右边预览区身上扣的（老板 2026-10-18：「释放右边预览图片的空间」）。
          现在页头跟着左栏走，`.result` 成为 `.body2` 的第二个 grid 项、从面板最顶部
          开始 —— 预览区多出的就是这个页头的高度。
        */}
        <div className={css.leftCol}>
          <header className={css.head}>
            <div className={css.headText}>
              <div className={css.title}>生图</div>
              <div className={css.sub}>提示词 / 参考图 → 生成 → 面板内预览 · 保存 · 历史</div>
            </div>
          </header>

          <Composer
            prompt={prompt}
            onPromptChange={(value) => {
              markTouched()
              setPrompt(value)
              // 用户自己动手改了，就别再留着「撤销」去覆盖他的手改。
              if (!optimizing) setUndoPrompt(undefined)
            }}
            onOptimize={() => { void runOptimize() }}
            optimizing={optimizing}
            canUndo={undoPrompt !== undefined}
            onUndo={undoOptimize}
            references={references}
            onAddReference={(name, dataUrl, note) => {
              if (references.length >= refLimit) return
              markTouched()
              setReferences((current) => [...current, {
                id: `ref-${Date.now()}-${current.length}`,
                name,
                dataUrl,
                ...note === undefined ? {} : { note },
              }])
            }}
            onRemoveReference={(id) => {
              markTouched()
              setReferences((current) => current.filter((item) => item.id !== id))
            }}
            params={params}
            onParamChange={(key, value) => {
              markTouched()
              setParams((current) => ({ ...current, [key]: value }))
            }}
            parameters={parameters}
            extra={extra}
            onExtraChange={(name, value) => {
              markTouched()
              setExtra((current) => ({ ...current, [name]: value }))
            }}
            {...referenceDeclaredMax <= refLimit ? {} : { referenceDeclaredMax }}
            {...overriddenFields.length === 0 ? {} : { overriddenFields }}
            onNotice={(text, kind) => { notify(text, kind ?? 'ok') }}
            model={model}
            running={run.kind === 'running'}
            notConfigured={notConfigured}
            onGenerate={() => { void generate() }}
            onCancel={cancel}
            onOpenModelPicker={openConfig}
            onOpenConfig={openConfig}
            lastSeconds={history[0]?.seconds}
            outputFormat={config?.outputFormat}
        />
        </div>

        <ResultStage
          run={run}
          preview={preview}
          elapsedSec={elapsedSec}
          onCancel={cancel}
          onRetry={() => { void generate() }}
          onViewLog={() => { setLogOpen(true) }}
          onSave={() => { void saveCurrent() }}
          onSaveAs={saveAsCurrent}
          onCopy={() => { void copyCurrent() }}
          onOpen={() => { if (preview !== undefined) void openImage(preview) }}
          onRegenerate={() => { void generate() }}
          history={history}
          onSelectHistory={applyHistoryImage}
          {...config?.model === undefined ? {} : { currentModel: config.model }}
          onHistoryContextMenu={(image, position) => { setHistoryMenu({ image, x: position.x, y: position.y }) }}
          onClearHistory={() => {
            setHistory([])
            setPreviewId(undefined)
            // 舞台的恢复候选要一起清掉：只清预览的话，下次进面板它又会自己长回来
            // （`lastImageId` 还指着那张图）—— 那就不叫「清空」了。
            setLastImageId('')
            /**
             * 立刻落一次盘，不等 400 ms 防抖。
             *
             * 为什么（2026-10-18 独立复验挑出的窄窗口）：清空只改内存时，若在这 400 ms 里
             * 刷新页面 / 重启 DSH，磁盘上那份草稿还是旧 id —— 重挂载时 `applyDraft` 会把它
             * 认回来，那张图就自己长回舞台了。这里补一次立即写，把窗口从 400 ms 压到一次
             * HTTP 往返（防抖那次照旧会再写一遍，内容相同，无害）。
             *
             * 同时把防抖窗口里那份**清掉**：卸载时的补写用的是 `pendingDraft.current`，
             * 留着旧的 lastImageId 会把上面这次立即写又覆盖回去。
             */
            pendingDraft.current = undefined
            void backend.saveDraft({ prompt, params, extra, lastGeneratedPrompt, lastImageId: '', updatedAt: 0 })
            notify('历史已清空（仅本次会话）')
          }}
          {...toast === undefined ? {} : { notice: toast }}
        />
      </div>

      {configOpen && config !== undefined && (
        <ConfigModal
          config={config}
          models={models}
          pulling={pulling}
          {...modelCaps === undefined ? {} : { capabilities: modelCaps }}
          onPullModels={() => { void pullModels() }}
          onSave={(next, plainKey) => { void saveConfig(next, plainKey) }}
          onClose={() => { setConfigOpen(false) }}
        />
      )}

      {historyMenu !== undefined && (
        <HistoryMenu
          image={historyMenu.image}
          x={historyMenu.x}
          y={historyMenu.y}
          busy={menuBusy}
          alreadyReference={references.some((item) => item.sourceId === historyMenu.image.id)}
          atLimit={references.length >= refLimit}
          onUseAsReference={() => { void useAsReference(historyMenu.image) }}
          onOpen={() => {
            const image = historyMenu.image
            setHistoryMenu(undefined)
            void openImage(image)
          }}
          onSaveToWorkspace={() => {
            const image = historyMenu.image
            setHistoryMenu(undefined)
            void saveImageToWorkspace(image)
          }}
          onCopy={() => {
            const image = historyMenu.image
            setHistoryMenu(undefined)
            void copyImage(image)
          }}
          onClose={() => { setHistoryMenu(undefined) }}
        />
      )}

      {logOpen && (
        <LogViewer backend={backend} onClose={() => { setLogOpen(false) }} />
      )}
    </div>
  )
}
