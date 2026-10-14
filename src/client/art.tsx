/**
 * 占位插画（原型里那 6 张假图）。
 *
 * 阶段 2 没有任何 API Key，也不该打网络，所以用内联 SVG 造几张看起来像
 * 「AI 生成图」的图，让评审能判断版式与角标位置。阶段 4 接上真出图后，
 * 这里会被真正的图片（data URL / 宿主 `/dsh-imagegen/image/:id`）替换掉 ——
 * 届时只需改 {@link ArtFrame} 一个组件。
 *
 * 渐变 id 带 `fig-` 前缀并挂在一个隐藏的 <svg><defs> 上，避免同一个面板里
 * 多张图重复定义 id 互相覆盖（原型是单实例所以没这个问题）。
 */

/** 可用的占位图形变体。 */
export const ART_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/** 一个变体键。 */
export type ArtKey = (typeof ART_KEYS)[number]

/** 把任意字符串收敛到合法变体键，越界时回退到 'a'。 */
export function asArtKey(value: string): ArtKey {
  return (ART_KEYS as readonly string[]).includes(value) ? (value as ArtKey) : 'a'
}

/** 渐变定义。挂在隐藏 svg 上，全面板共用一份。 */
export function ArtDefs(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="fig-g-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1035" /><stop offset=".45" stopColor="#3b1e6e" /><stop offset="1" stopColor="#0b1a2e" />
        </linearGradient>
        <linearGradient id="fig-g-a2" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ff5fa2" /><stop offset="1" stopColor="#39d0ff" />
        </linearGradient>
        <linearGradient id="fig-g-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb35c" /><stop offset=".5" stopColor="#ff7a59" /><stop offset="1" stopColor="#5b2a63" />
        </linearGradient>
        <linearGradient id="fig-g-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b3d91" /><stop offset=".55" stopColor="#2f6fe0" /><stop offset="1" stopColor="#8ed1ff" />
        </linearGradient>
        <linearGradient id="fig-g-d" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6f7f9" /><stop offset="1" stopColor="#dfe5ee" />
        </linearGradient>
        <linearGradient id="fig-g-e" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd9a0" /><stop offset=".6" stopColor="#e08a6b" /><stop offset="1" stopColor="#4a2342" />
        </linearGradient>
        <linearGradient id="fig-g-f" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8f4ea" /><stop offset="1" stopColor="#bfe0cc" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/** 一个变体的图形内容（不含 <svg> 外壳，便于在缩略图与大图里复用）。 */
function body(key: ArtKey): React.JSX.Element {
  switch (key) {
    case 'a':
      return (
        <>
          <rect width="120" height="120" fill="url(#fig-g-a)" />
          <g opacity=".85">
            <rect x="8" y="52" width="14" height="68" fill="#2b1d4d" />
            <rect x="26" y="34" width="16" height="86" fill="#241844" />
            <rect x="46" y="60" width="12" height="60" fill="#2f2054" />
            <rect x="62" y="24" width="18" height="96" fill="#1e1439" />
            <rect x="84" y="46" width="14" height="74" fill="#281c4a" />
            <rect x="102" y="38" width="14" height="82" fill="#221744" />
          </g>
          <g stroke="url(#fig-g-a2)" strokeWidth="1.3" fill="none" opacity=".95">
            <path d="M0 44h120M0 74h120M20 0v120M52 0v120M88 0v120" />
          </g>
          <circle cx="92" cy="30" r="11" fill="#39d0ff" opacity=".28" />
          <circle cx="92" cy="30" r="5.5" fill="#ff5fa2" opacity=".75" />
        </>
      )
    case 'b':
      return (
        <>
          <rect width="120" height="120" fill="url(#fig-g-b)" />
          <circle cx="60" cy="56" r="19" fill="#fff3c4" opacity=".95" />
          <path d="M0 92 26 66l18 15 20-24 24 26 12-10v27H0z" fill="#3a1f47" opacity=".92" />
          <path d="M0 104 34 84l22 12 26-16 38 22v14H0z" fill="#241430" opacity=".95" />
          <g fill="#fff" opacity=".5">
            <circle cx="20" cy="20" r="1" /><circle cx="46" cy="12" r=".8" /><circle cx="104" cy="26" r="1.1" />
          </g>
        </>
      )
    case 'c':
      return (
        <>
          <rect width="120" height="120" fill="url(#fig-g-c)" />
          <g opacity=".7">
            <ellipse cx="40" cy="46" rx="34" ry="26" fill="#8ed1ff" opacity=".55" />
            <ellipse cx="84" cy="72" rx="38" ry="30" fill="#0b3d91" opacity=".6" />
            <ellipse cx="70" cy="34" rx="22" ry="18" fill="#ffffff" opacity=".4" />
          </g>
          <path d="M-5 96c22-16 40 10 62-4s38-24 68-8v40H-5z" fill="#072a63" opacity=".85" />
        </>
      )
    case 'd':
      return (
        <>
          <rect width="120" height="120" fill="url(#fig-g-d)" />
          <ellipse cx="60" cy="104" rx="34" ry="8" fill="#b9c2cf" opacity=".55" />
          <rect x="38" y="34" width="44" height="62" rx="12" fill="#ffffff" />
          <rect x="38" y="34" width="44" height="62" rx="12" fill="none" stroke="#c9d2de" strokeWidth="1" />
          <circle cx="60" cy="58" r="11" fill="#e8eef7" />
          <circle cx="60" cy="58" r="4.6" fill="#7aa0d8" />
          <rect x="50" y="80" width="20" height="4" rx="2" fill="#dde5f0" />
        </>
      )
    case 'e':
      return (
        <>
          <rect width="120" height="120" fill="url(#fig-g-e)" />
          <circle cx="60" cy="48" r="17" fill="#5a2b45" opacity=".85" />
          <path d="M22 120c0-22 17-38 38-38s38 16 38 38z" fill="#5a2b45" opacity=".85" />
          <rect y="84" width="120" height="36" fill="#3a1a33" opacity=".55" />
        </>
      )
    default:
      return (
        <>
          <rect width="120" height="120" fill="url(#fig-g-f)" />
          <circle cx="44" cy="46" r="24" fill="#4caf7d" opacity=".8" />
          <path d="M68 96 92 46l26 50z" fill="#2f7d5b" opacity=".75" />
          <rect x="14" y="74" width="44" height="30" rx="6" fill="#ffffff" opacity=".8" />
          <circle cx="94" cy="30" r="9" fill="#ffd18a" />
        </>
      )
  }
}

/** 铺满容器的占位插画（大图预览用）。 */
export function Art({ artKey }: { artKey: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 120 120"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      {body(asArtKey(artKey))}
    </svg>
  )
}
