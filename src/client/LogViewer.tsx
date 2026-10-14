/**
 * 宿主日志抽屉。
 *
 * 它是这次修复的**用户可见部分**：以前「查看日志」只弹一句「宿主侧日志在 DSH 控制台」，
 * 而桌面版 DSH 根本没有那个控制台（宿主进程 stdout 无人接管，界面上也没有对应入口）。
 * 现在点「查看日志」直接在这里把宿主记的东西摊开 —— 一次生成发了什么、裁了哪些字段、
 * 上游原话是什么，全都在一屏里，还能一键复制或下载。
 *
 * 拆成三层，各有各的理由：
 *  - {@link LogList}：纯列表。离屏渲染（`render-check` / `preview`）能直接看它的样子。
 *  - {@link LogDrawer}：纯外壳 + 按钮，状态由外部给。同一件事 —— 让外观可被离屏渲染验证。
 *  - {@link LogViewer}：取数与交互（`useEffect` 拉日志、复制、下载），只做副作用。
 *
 * 两个刻意的设计：
 *  1. **最新在最上面**。排查时看的是刚才那一次，不该让人先滚到底。
 *  2. **文件路径也显示出来**。抽屉只覆盖进程内最近 400 条；要翻更早的，路径就在
 *     标题下面，复制走即可 —— 日志同时落盘在 `~/.dsh/dsh-imagegen-panel/logs/`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiPath } from './api.ts'
import { CopyIcon, ClockIcon, RetryIcon } from './icons.tsx'
import type { Backend, HostLogEntry, HostLogs } from './types.ts'
import css from './panel.module.css'

/**
 * 抽屉的状态。
 *
 * 导出是给离屏渲染用的：`scripts/preview.mjs` 直接构造 `ready` 形态来渲染外观，
 * 不必起宿主、也不必等异步。
 */
export type LogDrawerState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: HostLogs }
  | { kind: 'error'; message: string }

/** {@link LogList} 的 props。 */
export interface LogListProps {
  /** 日志条目，**新的在前**（与宿主返回一致）。 */
  entries: HostLogEntry[]
}

/**
 * 日志列表（纯展示，没有副作用）。
 * @param props - 见 {@link LogListProps}。
 */
export function LogList(props: LogListProps): React.JSX.Element {
  if (props.entries.length === 0) {
    return (
      <div className={css.logEmpty}>
        宿主还没有写过任何日志。生成一次（成功或失败都行）之后再点「查看日志」就有内容了。
      </div>
    )
  }
  return (
    <div className={css.logList}>
      {props.entries.map((entry) => (
        <div
          key={entry.seq}
          className={entry.level === 'error'
            ? `${css.logLine} ${css.logErr}`
            : entry.level === 'warn' ? `${css.logLine} ${css.logWarn}` : css.logLine}
        >
          <span className={css.logTime}>{entry.at}</span>
          <span className={css.logText}>{entry.text}</span>
        </div>
      ))}
    </div>
  )
}

/** {@link LogDrawer} 的 props。 */
export interface LogDrawerProps {
  state: LogDrawerState
  /** 「复制全部」刚点过的反馈。 */
  copied: boolean
  /** 有没有内容可以复制/下载（加载中、出错、空列表时为 false）。 */
  hasContent: boolean
  onRefresh: () => void
  onCopy: () => void
  onDownload: () => void
  onClose: () => void
}

/**
 * 抽屉外壳 + 操作条（纯展示）。
 * @param props - 见 {@link LogDrawerProps}。
 */
export function LogDrawer(props: LogDrawerProps): React.JSX.Element {
  const { state } = props
  return (
    <div className={css.overlay} onClick={props.onClose}>
      <div
        className={`${css.modal} ${css.logModal}`}
        role="dialog"
        aria-label="宿主日志"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.modalHead}>
          <h2>宿主日志</h2>
          <span className={css.sub}>生成时实际发了什么、裁掉了什么，都记在这里</span>
        </div>

        {state.kind === 'ready' && (
          <div className={css.logPath} title={state.data.file}>
            <span>内存 {state.data.count} 条 · 落盘文件</span>
            <code>{state.data.file}</code>
          </div>
        )}

        <div className={css.modalBody}>
          {state.kind === 'loading' && <div className={css.logEmpty}>正在读取宿主日志…</div>}

          {state.kind === 'error' && (
            <div className={css.logEmpty}>
              读取失败：{state.message}
              <br />
              （宿主半边没加载时也会这样 —— 面板顶部的「宿主路由不可用」会同时出现）
            </div>
          )}

          {state.kind === 'ready' && <LogList entries={state.data.entries} />}
        </div>

        <div className={css.modalFoot}>
          <button className={`${css.btn} ${css.btnSm}`} type="button" onClick={props.onRefresh}>
            <RetryIcon />
            刷新
          </button>
          <button
            className={`${css.btn} ${css.btnSm}`}
            type="button"
            onClick={props.onCopy}
            disabled={!props.hasContent}
          >
            <CopyIcon />
            {props.copied ? '已复制' : '复制全部'}
          </button>
          <button
            className={`${css.btn} ${css.btnSm}`}
            type="button"
            onClick={props.onDownload}
            disabled={!props.hasContent}
          >
            <ClockIcon />
            下载
          </button>
          <span className={css.spacer} />
          <button className={css.btn} type="button" onClick={props.onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

/** {@link LogViewer} 的 props。 */
export interface LogViewerProps {
  /** 走后面的同一个后端实现（`fetchLogs`）。 */
  backend: Backend
  onClose: () => void
}

/** 一次取多少条：比宿主缓冲上限小一点，够看最近的几轮生成。 */
const LOG_LIMIT = 300

/** 宿主日志抽屉（取数 + 交互）。 */
export function LogViewer(props: LogViewerProps): React.JSX.Element {
  const { backend, onClose } = props
  const [state, setState] = useState<LogDrawerState>({ kind: 'loading' })
  const [copied, setCopied] = useState(false)

  /** 拉一次日志。 */
  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' })
    try {
      const data = await backend.fetchLogs(LOG_LIMIT)
      setState({ kind: 'ready', data })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [backend])

  useEffect(() => { void load() }, [load])

  /**
   * 复制用的纯文本。
   *
   * 刻意**倒回时间正序**：贴给别人看时正序才读得下去，界面上倒序只是为了「最新在眼前」。
   */
  const asText = useMemo(() => {
    if (state.kind !== 'ready') return ''
    return state.data.entries
      .slice()
      .reverse()
      .map((entry) => `${entry.at} [${entry.level}] ${entry.text}`)
      .join('\n')
  }, [state])

  const copyAll = useCallback((): void => {
    if (asText === '') return
    void navigator.clipboard.writeText(asText).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1600)
    }).catch(() => {
      // 剪贴板被拒不是致命错误：日志还在屏幕上，用户可以手动选。
    })
  }, [asText])

  /** 下载整份日志（宿主用 `?format=text` 当附件回）。 */
  const download = useCallback((): void => {
    const anchor = document.createElement('a')
    anchor.href = apiPath('dsh-imagegen/logs?format=text')
    anchor.download = 'dsh-imagegen-host.log'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [])

  return (
    <LogDrawer
      state={state}
      copied={copied}
      hasContent={asText !== ''}
      onRefresh={() => { void load() }}
      onCopy={copyAll}
      onDownload={download}
      onClose={onClose}
    />
  )
}
