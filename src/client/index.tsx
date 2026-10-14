/**
 * dsh-imagegen-panel —— 浏览器半边（client half）。
 *
 * 贡献两个界面，别的不做：
 *   1. 侧栏「插件」**上方**那一行「生图」（`sidebar.panellist`，id=`imagegen`, order=-1）；
 *   2. 点它之后主区显示的整块生图面板（`main`，key=`imagegen`）。
 *
 * **接线原理（A1/A2，2026-10-09 已实测通过）**：
 * 侧栏的 `sidebar.panellist` 与主区的 `main` 用**同一个字符串**做 key ——
 * `main` 的 catalog 原文是「Central panel **selected by sidebar entry id**」，
 * registration `key` 是「the entry renders where the owner dispatches this exact key」。
 * 现有「插件」行（`@deepseek-ai/dsh-client-ui-plugin-manager`）正是把同一个 `PANEL_ID`
 * 一处两用。所以这里不需要任何导航代码：壳自己把 id 和 key 对上。
 *
 * 侧栏那一行的**外观由壳负责**（行高 / 悬停 / 选中态 / 收起态 / 文字省略），
 * 本插件只提供图标组件与 `label`。这也是为什么原型里量到的 36px 行高、22px 图标 x
 * 在这里一行 CSS 都不用写。
 *
 * 失败策略：注册包在 `try/catch` 里。插件从 `apply` 抛出会连带 web 启动一起挂掉
 * （cordis 把 fiber 置为 FAILED），所以坏掉的入口必须退化成「少一行」，
 * 绝不能变成「整个 GUI 白屏」。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ImageGenIcon } from './icons.tsx'
import { ImageGenPanel } from './ImageGenPanel.tsx'

/** 侧栏那一行与主区那个面板共用的 cell key。必须与 cordis.patch.yml 的行 id 一致。 */
const PANEL_ID = 'imagegen'

/**
 * `sidebar.panellist` 的 ownerProps（由侧栏那一行下发）。
 *
 * 声明见 `dsh-client-ui-sidebar` 的 slot contract：
 * `{ size: number; active: boolean }` —— size 在侧栏展开时是 16、收起时是 18，
 * 所以图标必须用这个值而不是写死尺寸。
 */
interface PanelIconProps {
  /** 侧栏要求的正方形边长（px）。 */
  size: number
  /** 该面板是否正被主区选中。 */
  active: boolean
}

/** 本插件消费的 slots 服务面（结构化声明，避免为它拉类型依赖）。 */
interface SlotsFace {
  register(options: Record<string, unknown>, component: (props: never) => unknown): () => void
  inject(key: string, callback: () => () => void): () => void
}

/** Cordis 客户端上下文里我们用到的那一小部分。 */
interface ClientContextLike {
  get(name: string): unknown
}

/**
 * 侧栏图标适配器。
 *
 * 壳会把 `size` / `active` 传进来；这里只做转发，保证缺省值合理，
 * 让「契约漂移」退化成图标略小而不是整行崩掉。
 */
function SidebarIcon(props: PanelIconProps): React.JSX.Element {
  return <ImageGenIcon size={props.size ?? 16} active={props.active ?? false} />
}

/** 插件依赖的服务。 */
export const inject = ['slots']

/**
 * 浏览器半边的挂载点。
 * @param ctx - 客户端根上下文；这里只用到 `slots`。
 *
 * 关于 `inject` 与 `ctx.get` 并用（技能 SKILL.md §12 那一条）：
 * 依赖已经用 `export const inject = ['slots']` **声明**了，所以 `slots` 必然先于本插件
 * 就绪 —— 这是技能铁律 3 要求的正路。之后的形状守卫不是为了探测依赖是否存在，
 * 而是因为 `apply` 抛错会让 fiber 进 FAILED、连带整个 web 启动一起挂掉
 * （技能 §1：注册走 ctx、卸载自动回收；没说出口的是 apply 抛错的代价）。
 * 所以这里宁可退化成「少一行入口」，也不要让 GUI 起不来。
 */
export function apply(ctx: ClientContext | ClientContextLike): void {
  const slots = (ctx as ClientContextLike).get('slots') as SlotsFace | undefined
  if (slots === undefined || typeof slots.register !== 'function' || typeof slots.inject !== 'function') {
    console.warn('[dsh-imagegen-panel] slots 服务形状异常，未挂载任何界面')
    return
  }

  try {
    // 侧栏那一行。order=-1 → 排在「插件」(order=0) 之前，即老板要的「上方」。
    slots.inject('sidebar.panellist', () => slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: -1, label: () => '生图' },
      SidebarIcon as never,
    ))

    // 主区面板。key 与上面的 id 相同 —— 这就是「侧栏 id 寻址主区面板」的接线。
    slots.inject('main', () => slots.register(
      { name: 'main', key: PANEL_ID },
      ImageGenPanel as never,
    ))
  } catch (error) {
    // 槽位冲突或声明缺失都不能把 GUI 带下水。
    console.warn('[dsh-imagegen-panel] 界面注册失败：', error)
  }
}

// 这些导出是给 scripts/render-check.mjs / scripts/host-check.mjs 用的：它们在受控环境里
// 真实渲染面板、断言槽位注册参数、并把「客户端打的路径」与「宿主挂的路径」逐字比对，
// 从而不必每次改动都去动老板的 GUI。
export { PANEL_ID, SidebarIcon }
export { ImageGenPanel, promptForEntry, paramsFromHistory } from './ImageGenPanel.tsx'
export { Composer, MAX_REFERENCES } from './Composer.tsx'
export { ResultStage, HistoryStrip, HistoryMenu, HistoryFacts } from './ResultStage.tsx'
export { ConfigModal } from './ConfigModal.tsx'
export { LogViewer, LogDrawer, LogList } from './LogViewer.tsx'
export { createHttpBackend, apiPath, ROUTES, toPanelConfig, toOutboundConfig, toModelOptions, toImage, toCapabilities, toLogEntry, toPanelDraft } from './api.ts'
export { factListOf, factTextOf, fieldLabelOf, FIELD_LABELS } from './labels.ts'
export { DEFAULT_CONFIG } from './defaults.ts'
