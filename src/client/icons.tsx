/**
 * 面板用到的图标。
 *
 * 统一约定（与壳内星座风格图标一致）：
 *   - 16 视口、线宽 1.2–1.5、`stroke="currentColor"`、`fill="none"`；
 *   - 颜色一律继承，不自己判断主题 —— 深色模式由 token 自动接管；
 *   - 尺寸由调用方通过 width/height 决定（侧栏图标由壳下发 size）。
 */

/** 一组图标共用的属性。 */
interface IconProps {
  /** 正方形边长（px）。默认 16。 */
  size?: number
}

/**
 * 侧栏「生图」那一行的图标。
 *
 * 由壳下发 `{ size, active }`：size 在侧栏展开时是 16、收起时是 18，
 * 所以这里必须用 props 而不是写死尺寸。
 */
export function ImageGenIcon({ size = 16, active = false }: IconProps & { active?: boolean }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', opacity: active ? 1 : 0.92 }}
    >
      <rect x="1.7" y="2.7" width="12.6" height="10.6" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.6" cy="6.3" r="1.15" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2.3 11.4 5.9 8.1l2.5 2.3 2.1-1.9 3.2 2.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 加号。 */
export function PlusIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** 下拉箭头。 */
export function ChevronIcon({ size = 12 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.4 6.4 3.6 3.6 3.6-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 生成按钮上的星芒。 */
export function SparkIcon({ size = 15 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.9c.5 3 1.25 3.75 4.25 4.25-3 .5-3.75 1.25-4.25 4.25-.5-3-1.25-3.75-4.25-4.25C6.75 5.65 7.5 4.9 8 1.9Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M12.3 10.2c.25 1.4.6 1.75 2 2-1.4.25-1.75.6-2 2-.25-1.4-.6-1.75-2-2 1.4-.25 1.75-.6 2-2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 停止（取消生成）。 */
export function StopIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.6" fill="currentColor" />
    </svg>
  )
}

/** 齿轮（连接配置）。 */
export function GearIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5 11 5M5 11l-1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 列表（模型 chip 左侧）。 */
export function ListIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4.6h12M2 8h12M2 11.4h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** 警告三角（未配置引导条）。 */
export function WarnIcon({ size = 15 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.2 14 13H2L8 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.4v3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r=".85" fill="currentColor" />
    </svg>
  )
}

/** 空态取景框。 */
export function EmptyGlyphIcon({ size = 26 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.6" y="4.2" width="18.8" height="15.6" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8.4" cy="9.4" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3.4 17 8.9 12l3.7 3.4 3.1-2.8 4.9 4.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 出错圆形感叹号。 */
export function ErrorGlyphIcon({ size = 22 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 5v4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r=".95" fill="currentColor" />
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** 对勾。 */
export function CheckIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.6 8.4 3 3 5.8-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 下载/保存。 */
export function SaveIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 10.6V2.4m0 0L5.2 5.2M8 2.4l2.8 2.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 9.4v3.2c0 .8.6 1.4 1.4 1.4h7.2c.8 0 1.4-.6 1.4-1.4V9.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

/** 复制。 */
export function CopyIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.6" y="5.6" width="7.8" height="7.8" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.4 5.6V4.2c0-1-.8-1.8-1.8-1.8H4.2c-1 0-1.8.8-1.8 1.8v4.4c0 1 .8 1.8 1.8 1.8h1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 用系统默认程序打开（方框 + 外跳箭头）。 */
export function OpenIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.8 2.6h3.6v3.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.4 2.6 8.2 7.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path
        d="M12.2 9.6v2.8c0 .8-.6 1.4-1.4 1.4H4.2c-.8 0-1.4-.6-1.4-1.4V5.6c0-.8.6-1.4 1.4-1.4h2.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 重来。 */
export function RetryIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8M13.4 2.6v2.8h-2.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 时钟（历史标题）。 */
export function ClockIcon({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.6V8l2.4 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 信息圈（参数说明）。 */
export function InfoIcon({ size = 12 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="5" r=".85" fill="currentColor" />
    </svg>
  )
}

/** 钱币（花费角标）。 */
export function CoinIcon({ size = 11 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.4v11.2M10.6 5.1H6.4a1.9 1.9 0 0 0 0 3.8h3.2a1.9 1.9 0 0 1 0 3.8H5.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
