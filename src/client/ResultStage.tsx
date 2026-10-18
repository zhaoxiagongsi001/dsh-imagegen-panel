/**
 * 右栏结果区：舞台（空 / 生成中 / 已出图 / 出错）+ 三行操作条 + 历史条。
 *
 * 三个刻意的决定：
 *  1. 舞台占满剩余高度，操作条与历史条 `flex: none` 钉在下面 —— 所以出图不会把
 *     下面的东西挤走，长宽比变化也不会让版面跳。
 *  2. 出图后**自动选中它**，同时它也会进历史；用户在历史里点别的图只换预览，
 *     不改变「刚生成的是哪张」这个语义（后者用于「重新生成」）。
 *     2026-10-11 起点历史图还会把该图的提示词与参数搬回工作区（上层负责），
 *     并在这里的**信息行**如实显示「这张当时用的是哪个模型、哪些参数」——
 *     因为设置区的模型不会被改（老板拍板），不写出来就没人知道。
 *  3. 出错时保留提示词与参数（上层负责），错误原文原样展示不做美化 ——
 *     提供商的话比我们的转述更有用。
 */
import { useState } from 'react'
import { Art } from './art.tsx'
import { CheckIcon, ClockIcon, CoinIcon, CopyIcon, EmptyGlyphIcon, ErrorGlyphIcon, OpenIcon, RetryIcon, SaveIcon, WarnIcon } from './icons.tsx'
import { factListOf, factTextOf, type FieldFact } from './labels.ts'
import type { GeneratedImage, RunState } from './types.ts'
import css from './panel.module.css'

/** 花费格式化：OpenRouter 的 usage.cost 是美元，位数不固定。 */
function formatCost(cost: number | undefined): string {
  if (cost === undefined) return '—'
  return `$${cost.toFixed(4)}`
}

/** 时间戳格式化为 `2026-10-09 21:14`。 */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 有真图就渲染真图，否则退回占位插画。
 *
 * `onError` 那条路是必要的：图挂在宿主路由上（`/dsh-imagegen/image/<id>`），
 * 那条路由要是没挂上（宿主半边没重启、文件被删），`<img>` 会显示成裂图 ——
 * 一个碎图标比一张占位插画糟糕得多。取不到就退回占位，并保留提示词等信息。
 */
function ImageOrArt(props: { image: GeneratedImage; variant: 'stage' | 'thumb' }): React.JSX.Element {
  const { image, variant } = props
  const [failed, setFailed] = useState(false)
  if (image.imageUrl === undefined || failed) return <Art artKey={image.art} />
  return (
    <img
      className={variant === 'stage' ? css.realImage : css.realThumb}
      src={image.imageUrl}
      alt={image.prompt}
      loading="lazy"
      draggable={false}
      onError={() => { setFailed(true) }}
    />
  )
}

/** 已出图的舞台内容。 */
function ArtStage(props: { image: GeneratedImage; onOpen: () => void }): React.JSX.Element {
  const { image } = props
  // 保持图片原始宽高比，并限制在舞台内 —— 用 aspect-ratio 而不是写死高度。
  const ratio = image.aspectRatio === 'auto' ? '1 / 1' : image.aspectRatio.replace(':', ' / ')
  return (
    <div
      className={css.artFrame}
      style={{ width: 'min(100%, 720px)', aspectRatio: ratio }}
      /*
       * 双击大图 = 用系统默认程序打开这张图的**本地原图**（老板 2026-10-18 需求）。
       *
       * 走的是结果条那颗「打开」按钮**同一个** `onOpen` —— 不另开一条路，
       * 免得两处行为分叉（比如哪天加了「只能打开已保存的图」的判定）。
       * `title` 必须写：双击是个隐藏手势，不说没人会去试。
       */
      onDoubleClick={props.onOpen}
      title="双击用系统默认程序打开原图"
    >
      <ImageOrArt image={image} variant="stage" />
      <span className={css.costBadge}>
        <CoinIcon />
        {formatCost(image.cost)} <span className={css.ok}>· 已计费</span>
      </span>
      <span className={css.sizeBadge}>
        {image.size === '' ? image.resolution : `${image.size} · ${image.resolution}`}
        {image.count !== undefined && image.count > 1 ? ` · ${image.count} 张` : ''}
      </span>
    </div>
  )
}

/** {@link ResultStage} 的 props。 */
export interface ResultStageProps {
  run: RunState
  /**
   * 舞台上正在展示的图。
   *
   * 它同时是结果条（保存 / 另存为 / 复制 / 重新生成）的操作对象 ——
   * 从历史里点出来的图也应该能保存与重新生成，所以这里不区分
   * 「刚生成的」与「翻出来的」，只认「当前看的是哪张」。
   */
  preview: GeneratedImage | undefined
  elapsedSec: number
  onCancel: () => void
  onRetry: () => void
  onViewLog: () => void
  onSave: () => void
  onSaveAs: () => void
  onCopy: () => void
  /** 用系统默认程序打开舞台上这张图的**本地原图**（由宿主交给桌面 shell）。 */
  onOpen: () => void
  onRegenerate: () => void
  history: GeneratedImage[]
  onSelectHistory: (image: GeneratedImage) => void
  onClearHistory: () => void
  /** 设置区当前选中的模型 —— 结果行用它标出「这张不是它生成的」。 */
  currentModel?: string
  /**
   * 一句行内提示（成功 / 警告 / 失败）。
   *
   * 它以前是浮在面板底部的一块 `.toast`：盖在大图上。2026-10-18 老板要求搬到
   * 「历史记录 · 最近 N 张」右边，做成一行小字。
   *
   * 说清楚**没变**的那部分：消息仍然会自己消失（成功 1.8s、失败 6s，见
   * `ImageGenPanel.tsx` 里那个定时器）—— 这次改的是**位置**（固定、不遮图、
   * 失败是红色），不是停留时间。
   */
  notice?: { text: string; kind?: 'ok' | 'err' }
  /** 右键历史图（菜单由上层渲染）。 */
  onHistoryContextMenu?: (image: GeneratedImage, position: { x: number; y: number }) => void
}

/**
 * 右栏结果区。
 *
 * `.result` 是三行网格（舞台 · 操作条 · 历史条）；历史条必须作为它的第三行渲染，
 * 否则 grid 的 `minmax(0,1fr)` 那一行就没有兄弟节点可以压缩，舞台高度会算错。
 */
export function ResultStage(props: ResultStageProps): React.JSX.Element {
  const { run, preview } = props
  /** 「复制报错」刚点过（给一秒反馈，省得用户怀疑没生效）。 */
  const [copied, setCopied] = useState(false)

  /**
   * 复制错误全文。
   *
   * 细节比「截图里那几行」重要得多：上游原话、code、我们实际发的参数都在里面，
   * 一键复制才能拿去搜或者贴给别人看。
   */
  const copyDetail = async (): Promise<void> => {
    if (run.kind !== 'error') return
    try {
      await navigator.clipboard.writeText(run.detail)
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1600)
    } catch {
      // 剪贴板被拒（某些环境需要用户手势）：文本就在屏幕上，可手动选中复制。
    }
  }

  return (
    <section className={css.result}>
      <div className={css.stage}>
        {run.kind === 'running' && (
          <div className={css.stageInner}>
            <div className={css.spinner} />
            <div className={css.stageTitle}>正在生成…</div>
            <div className={css.stageDesc}>出图通常 30–120 秒，可以取消。</div>
            <div className={css.progressWrap}>
              <div className={css.progressTrack}><div className={css.progressBar} /></div>
            </div>
            <div className={css.elapsed}>已用时 {props.elapsedSec}s</div>
            <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onCancel}>取消生成</button>
          </div>
        )}

        {run.kind === 'error' && (
          /*
            错误态必须能滚。
            `.stage` 是 `overflow: hidden`（出图时靠它裁掉溢出的缩放），而错误详情
            一长就正好超出舞台高度 —— 以前的下半截直接被裁掉，且没有任何滚动条，
            用户看到的就是「报错看不全」。这里换成可滚动布局，长文本自己滚。
          */
          <div className={`${css.stageInner} ${css.stageInnerErr}`}>
            <div className={css.errGlyph}><ErrorGlyphIcon /></div>
            <div className={css.stageTitle}>生成失败</div>
            <div className={`${css.errCard} ${css.errCardWide}`}>{run.detail}</div>
            <div className={css.stageDesc}>本次未计费。检查额度后可直接重试，提示词与参数已保留。</div>
            <div className={css.genRow} style={{ justifyContent: 'center' }}>
              <button className={css.btn} type="button" onClick={props.onViewLog}>查看日志</button>
              <button className={css.btn} type="button" onClick={() => { void copyDetail() }}>
                {copied ? '已复制' : '复制报错'}
              </button>
              <button className={`${css.btn} ${css.btnPrimary}`} type="button" onClick={props.onRetry}>重试</button>
            </div>
          </div>
        )}

        {(run.kind === 'idle' || run.kind === 'done') && (
          preview === undefined
            ? (
              <div className={css.stageInner}>
                <div className={css.emptyGlyph}><EmptyGlyphIcon /></div>
                <div className={css.stageTitle}>还没有图片</div>
                <div className={css.stageDesc}>
                  在左侧填写提示词，需要时加一张参考图，然后按「生成」。出图后可在面板内预览、保存，并保留在下方历史里。
                </div>
              </div>
            )
            : <div className={css.stageInner}><ArtStage image={preview} onOpen={props.onOpen} /></div>
        )}
      </div>

      {/* 结果操作条：三行（信息一行、**模型与参数**一行、按钮一行）—— 挤一行会把
          保存路径与参数一起折掉，那是老板截图里红线标出的位置，专门要求「考虑长度」。
          只要舞台上有图就出现；生成中与出错时不出现（那两种状态下没有可操作的成品）。 */}
      {preview !== undefined && (run.kind === 'idle' || run.kind === 'done') && (
        <div className={css.resultBar}>
          <div className={css.resultInfo}>
            <span className={css.savedTag} title={preview.autoSavedPath ?? preview.savedPath ?? ''}>
              <CheckIcon />
              {preview.autoSavedPath !== undefined
                ? `已自动保存到 ${preview.autoSavedPath}`
                : preview.savedPath !== undefined
                  ? `已存到插件目录 ${preview.savedPath}`
                  : '未保存'}
            </span>
            <span className={css.spacer} />
            <span className={css.resultMeta}>
              {formatTime(preview.createdAt)} · {preview.aspectRatio} · {preview.resolution} · {preview.seconds}s
            </span>
          </div>
          <HistoryFacts
            image={preview}
            {...props.currentModel === undefined ? {} : { currentModel: props.currentModel }}
          />
          <div className={css.resultActions}>
            <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onSave}><SaveIcon />保存</button>
            <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onSaveAs}>另存为…</button>
            <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onCopy}><CopyIcon />复制</button>
            <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onOpen}><OpenIcon />打开</button>
            <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onRegenerate}><RetryIcon />重新生成</button>
          </div>
        </div>
      )}

      <HistoryStrip
        items={props.history}
        selectedId={preview?.id}
        onSelect={props.onSelectHistory}
        onClear={props.onClearHistory}
        {...props.notice === undefined ? {} : { notice: props.notice }}
        {...props.onHistoryContextMenu === undefined ? {} : { onContextMenu: props.onHistoryContextMenu }}
      />
    </section>
  )
}

/**
 * 一条历史记录「当时用的参数」，从哪来。
 *
 * `sent` = 实发字段（最可信）；`panel` = 退回面板快照（只有手改过索引的老数据才会走到）；
 * `none` = 两样都没有（升级前的记录）。
 */
type FactsSource = 'sent' | 'panel' | 'none'

/**
 * 取出一张图的参数列表。
 *
 * 优先用 `sentFields`（真正发给上游的字段）—— 面板值可能被配置里那段「额外参数」
 * JSON 覆盖过，显示面板值等于骗人。老记录没有它时退回面板快照，并在 tooltip 里说明。
 * @param image - 任意一张图。
 * @returns 参数列表与它的来源。
 */
function factsOf(image: GeneratedImage): { facts: FieldFact[]; source: FactsSource } {
  const sent = factListOf(image.sentFields)
  if (sent.length > 0) return { facts: sent, source: 'sent' }
  const snapshot = image.params
  if (snapshot === undefined) return { facts: [], source: 'none' }
  const synthetic: Record<string, string> = { ...snapshot.extra }
  if (snapshot.aspectRatio !== '') synthetic['aspect_ratio'] = snapshot.aspectRatio
  if (snapshot.resolution !== '') synthetic['resolution'] = snapshot.resolution
  if (snapshot.quality !== '') synthetic['quality'] = snapshot.quality
  synthetic['n'] = String(snapshot.count)
  return { facts: factListOf(synthetic), source: 'panel' }
}

/** {@link HistoryFacts} 的 props。 */
export interface HistoryFactsProps {
  /** 舞台上这张图。 */
  image: GeneratedImage
  /** 设置区当前选中的模型（用来标出「这张不是它生成的」）。 */
  currentModel?: string
}

/** 一行里先显示几条参数，剩下的折成 `+N`（老板特意提过「注意长度和显示问题」）。 */
const FACTS_VISIBLE = 4

/**
 * 结果行第二行：**这张图当时用的模型与参数**。
 *
 * 位置就是老板截图里红线标出的那一处（「已自动保存到 …」下面）。
 * 三个要点：
 *  1. 点历史记录**不会**改设置区的模型，所以「这张是哪个模型生的」只能在这里说；
 *     与设置区不一致时高亮并明说当前是什么，免得用户拿另一个模型去「重新生成」还
 *     以为参数是对上的。
 *  2. 参数用实发值，不用面板值（见 {@link factsOf}）。
 *  3. 长度：默认一行、超出省略、hover 看全文，`+N` 展开成可换行的多行；
 *     升级前的老记录没有这些字段 —— 明说「未记录」，而不是留一片空白让人猜。
 * @param props - 图与当前模型。
 */
export function HistoryFacts(props: HistoryFactsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { image } = props
  const { facts, source } = factsOf(image)
  const list = image.referenceCount !== undefined && image.referenceCount > 0
    ? [...facts, { name: 'input_references', label: '参考图', value: `${image.referenceCount} 张` }]
    : facts

  const model = image.model ?? ''
  const differs = model !== '' && props.currentModel !== undefined && props.currentModel !== ''
    && model !== props.currentModel
  const shown = expanded ? list : list.slice(0, FACTS_VISIBLE)
  const rest = list.length - shown.length

  const modelTitle = model === ''
    ? '这张图生成时没有记录模型（升级前的记录）'
    : differs
      ? `生成这张图用的是 ${model}；设置区当前选中的是 ${props.currentModel}（点历史记录不会改设置区的模型）`
      : `生成这张图用的是 ${model}`
  const paramsTitle = list.length === 0
    ? '这张图生成于升级前，没有记录参数'
    : `${list.map(factTextOf).join(' · ')}${source === 'panel' ? '（这张没记录实发字段，显示的是当时面板上的值）' : ''}`

  return (
    <div className={expanded ? `${css.facts} ${css.factsExpanded}` : css.facts}>
      <span
        className={differs ? `${css.factModel} ${css.factModelDiff}` : css.factModel}
        title={modelTitle}
      >
        {model === '' ? '模型未记录' : `模型 ${model}`}
      </span>
      {differs && <span className={css.factDiffTag} title={modelTitle}>与设置区不同</span>}
      <span className={css.factParams} title={paramsTitle}>
        {list.length === 0 ? '参数未记录' : shown.map(factTextOf).join(' · ')}
      </span>
      {rest > 0 && (
        <button className={css.factMore} type="button" title={paramsTitle} onClick={() => { setExpanded(true) }}>
          +{rest}
        </button>
      )}
      {expanded && list.length > FACTS_VISIBLE && (
        <button className={css.factMore} type="button" onClick={() => { setExpanded(false) }}>收起</button>
      )}
    </div>
  )
}

/** {@link HistoryStrip} 的 props。 */
export interface HistoryStripProps {
  items: GeneratedImage[]
  /** 当前在舞台上展示的那张的 id。 */
  selectedId: string | undefined
  onSelect: (image: GeneratedImage) => void
  onClear: () => void
  /**
   * 一句行内提示，显示在「历史记录 · 最近 N 张」右边。
   *
   * 2026-10-18 老板要求：底部那块浮层提示条搬到这行来，字体与颜色按「成功 / 失败」
   * 分档（成功 = 次级灰，失败 = 错误红）。长消息单行省略、全文进 `title`；
   * 消失时机没改（成功 1.8s / 失败 6s），改的是位置。
   */
  notice?: { text: string; kind?: 'ok' | 'err' }
  /**
   * 右键某张历史图（鼠标位置是**视口坐标**）。
   *
   * 菜单本身由上层渲染：它才知道「还能不能再加参考图」「保存到哪儿」这些状态，
   * 历史条只负责把事件连同位置递上去。
   */
  onContextMenu?: (image: GeneratedImage, position: { x: number; y: number }) => void
}

/** 底部历史条。 */
export function HistoryStrip(props: HistoryStripProps): React.JSX.Element {
  return (
    <div className={css.history}>
      <div className={css.historyHead}>
        <ClockIcon />
        历史记录
        <span>最近 {props.items.length} 张</span>
        {/*
          行内提示（原来是浮在面板底部的 `.toast`）。
          `role="status"` 让读屏软件也能播报；`title` 兜住单行省略掉的长消息。
        */}
        {props.notice !== undefined && (
          <span
            className={props.notice.kind === 'err' ? `${css.notice} ${css.noticeErr}` : css.notice}
            title={props.notice.text}
            role="status"
          >
            {props.notice.kind === 'err' && <WarnIcon size={12} />}
            <span className={css.noticeText}>{props.notice.text}</span>
          </span>
        )}
        <button className={css.clear} type="button" onClick={props.onClear}>清空</button>
      </div>
      <div className={css.historyStrip}>
        {props.items.length === 0 && (
          <span className={css.stageDesc}>还没有历史记录。</span>
        )}
        {props.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={css.histItem}
            aria-current={item.id === props.selectedId}
            title={`${formatTime(item.createdAt)} · ${formatCost(item.cost)}（右键更多操作）`}
            onClick={() => { props.onSelect(item) }}
            onContextMenu={(event) => {
              if (props.onContextMenu === undefined) return
              // 接管浏览器默认菜单：历史图的右键菜单是本插件的功能位。
              event.preventDefault()
              props.onContextMenu(item, { x: event.clientX, y: event.clientY })
            }}
          >
            <ImageOrArt image={item} variant="thumb" />
            <span className={css.hcost}>{item.cost === undefined ? '—' : `$${item.cost.toFixed(4)}`}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** {@link HistoryMenu} 的 props。 */
export interface HistoryMenuProps {
  image: GeneratedImage
  /** 视口坐标（右键时的鼠标位置）。 */
  x: number
  y: number
  /** 这张已经在参考图槽里了。 */
  alreadyReference: boolean
  /** 参考图槽已满。 */
  atLimit: boolean
  /** 正在忙（取图 / 保存中），此时菜单项禁用。 */
  busy: boolean
  onUseAsReference: () => void
  onSaveToWorkspace: () => void
  onCopy: () => void
  /** 用系统默认程序打开这张历史图的**本地原图**。 */
  onOpen: () => void
  onClose: () => void
}

/** 菜单宽度（用于贴边收口）。 */
const MENU_WIDTH = 216

/**
 * 历史图的右键菜单。
 *
 * 交互上的两个细节：
 *  1. 一层透明遮罩接管「点别处就关」——比在 document 上挂监听干净，也不会漏掉点击。
 *  2. 贴右/下边缘时把菜单往回收，别让它跑到屏幕外（历史条在最底部，这个很容易踩）。
 */
export function HistoryMenu(props: HistoryMenuProps): React.JSX.Element {
  const hasViewport = typeof window !== 'undefined' && typeof window.innerWidth === 'number'
  const left = hasViewport ? Math.max(8, Math.min(props.x, window.innerWidth - MENU_WIDTH - 8)) : props.x
  // 208 ≈ 四个菜单项（打开 / 作为参考图 / 保存到工作区 / 复制图片）+ 内边距的实高。
  const top = hasViewport ? Math.max(8, Math.min(props.y, window.innerHeight - 208)) : props.y

  /** 「作为参考图」为什么点不了 —— 说清楚原因，而不是给个灰按钮。 */
  const referenceHint = props.alreadyReference
    ? '已经在参考图里了'
    : props.atLimit
      ? '参考图已满（最多 4 张）'
      : '把这张图作为图生图的底图'

  return (
    <>
      <div className={css.ctxBackdrop} onClick={props.onClose} onContextMenu={(event) => { event.preventDefault(); props.onClose() }} />
      <div className={css.ctxMenu} style={{ left, top }} role="menu" aria-label="历史图操作">
        <button
          className={css.ctxItem}
          type="button"
          role="menuitem"
          onClick={props.onOpen}
        >
          打开
          <span className={css.ctxHint}>用系统默认程序打开原图</span>
        </button>
        <button
          className={css.ctxItem}
          type="button"
          role="menuitem"
          disabled={props.busy || props.alreadyReference || props.atLimit}
          onClick={props.onUseAsReference}
        >
          作为参考图
          <span className={css.ctxHint}>{referenceHint}</span>
        </button>
        <button
          className={css.ctxItem}
          type="button"
          role="menuitem"
          disabled={props.busy}
          onClick={props.onSaveToWorkspace}
        >
          保存到工作区
          <span className={css.ctxHint}>复制一份到「自动保存目录」</span>
        </button>
        <button
          className={css.ctxItem}
          type="button"
          role="menuitem"
          disabled={props.busy}
          onClick={props.onCopy}
        >
          复制图片
          <span className={css.ctxHint}>写进系统剪贴板</span>
        </button>
      </div>
    </>
  )
}
