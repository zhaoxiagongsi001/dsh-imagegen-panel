/**
 * 「连接配置」弹层。
 *
 * 依据决策 D6：**不做独立设置页**，所有配置就在这个弹层里。
 *
 * 一条硬性约束（PLAN §5 / 阶段 3 验收）：
 *   **API Key 的明文永远不下发到浏览器。**
 *   - 已配置时，面板只能拿到 `hasKey: boolean` 与掩码 `keyHint`，用来显示「已配置 · sk-or-…4f2a」；
 *   - 要换 Key 时用户重新输入，提交后宿主吞掉明文，只回新的掩码。
 *   所以这里的 draft 里 Key 是**临时输入值**，保存成功即清空。
 *
 * 弹层用本地草稿状态：取消 = 丢弃草稿，不改动已生效的配置。
 */
import { useState } from 'react'
import { CheckIcon, ChevronIcon, GearIcon } from './icons.tsx'
import type { ModelCapabilities, ModelOption, PanelConfig, Protocol } from './types.ts'
import css from './panel.module.css'

/** 协议显示名。 */
const PROTOCOL_LABELS: { value: Protocol; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'custom', label: '自定义' },
]

/**
 * 各协议的接口形态提示 —— 用户最容易在这里搞错。
 *
 * 每条都写清「哪些参数它不吃」：只有 OpenRouter 有能力表，其余协议下面板不会
 * 假装知道模型支持什么，用户需要知道这一点。
 */
const PROTOCOL_HINTS: Record<Protocol, React.JSX.Element> = {
  openrouter: <>走 <code>POST /images</code>；模型与参数候选值都从它的能力表来（唯一有能力表的协议）。</>,
  openai: <>走 <code>POST /images/generations</code>；比例会映射成 <code>size</code>。<b>图生图（/images/edits）本版未接</b>。</>,
  gemini: <>走 <code>models/&lt;id&gt;:generateContent</code>；<b>不支持比例 / 分辨率 / 质量</b>这几个参数（会如实裁掉）。</>,
  custom: <>只按你填的 Base URL 与「额外参数」透传到 <code>POST /images</code>，不做字段改写；没有模型能力表，模型 id 手填。</>,
}

/** {@link ConfigModal} 的 props。 */
export interface ConfigModalProps {
  config: PanelConfig
  models: ModelOption[]
  /** 正在拉取模型列表。 */
  pulling: boolean
  /** 当前选中模型的权威能力（拉不到时为 undefined）。用来提示可透传参数。 */
  capabilities?: ModelCapabilities
  onPullModels: () => void
  onSave: (next: PanelConfig, plainKey: string) => void
  onClose: () => void
}

/** 连接配置弹层。 */
export function ConfigModal(props: ConfigModalProps): React.JSX.Element {
  const [draft, setDraft] = useState<PanelConfig>(props.config)
  // 新输入的明文 Key。空串 = 不改动已有的 Key。
  const [plainKey, setPlainKey] = useState('')
  /** 刚复制过模板的 provider slug（按钮上给个反馈）。 */
  const [copiedSlug, setCopiedSlug] = useState<string | undefined>(undefined)

  /**
   * 复制一份 `provider.options` 模板。
   *
   * 值一律留 `null`：各 provider 的参数语义不同（数值 / 布尔 / 对象都有），
   * 编一个「推荐值」比留空更危险 —— 用户会以为那是我们验证过的。
   */
  const copyProviderTemplate = async (slug: string, params: string[]): Promise<void> => {
    const skeleton: Record<string, unknown> = {}
    for (const param of params) skeleton[param] = null
    try {
      await navigator.clipboard.writeText(JSON.stringify({ provider: { options: { [slug]: skeleton } } }))
      setCopiedSlug(slug)
      window.setTimeout(() => { setCopiedSlug(undefined) }, 2000)
    } catch {
      // 剪贴板被拒时静默：参数名就在旁边，用户可以手写。
    }
  }

  const patch = (values: Partial<PanelConfig>): void => {
    setDraft((current) => ({ ...current, ...values }))
  }

  const selectedModel = props.models.find((model) => model.id === draft.model)
  /**
   * 该模型声明了 `output_format`、但不含当前配置值。
   *
   * 这是**必须提示**的一种状态：上游网关只校验全局枚举（png/jpeg/webp/svg 都放行），
   * 不看每个模型自己的枚举 —— 越界值会透传给 provider，要么被忽略、要么换回一次 502。
   * 我们的做法是不发这个字段（下游用它自己的默认），但要在界面上说清楚。
   */
  const formatMismatch = selectedModel !== undefined
    && (selectedModel.options.outputFormat?.length ?? 0) > 0
    && !selectedModel.options.outputFormat.includes(draft.outputFormat)

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="连接配置">
      <div className={css.modal}>
        <div className={css.modalHead}>
          <div>
            <h2>连接配置</h2>
            <div className={css.sub}>配置存在宿主侧，API Key 不下发到前端</div>
          </div>
        </div>

        <div className={css.modalBody}>
          <div className={css.formRow}>
            <div className={css.formKey}>协议<span className={css.req}>*</span></div>
            <div className={css.formCtl}>
              <div className={css.seg} role="group" aria-label="协议">
                {PROTOCOL_LABELS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={draft.protocol === item.value}
                    onClick={() => { patch({ protocol: item.value }) }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className={css.formTip}>{PROTOCOL_HINTS[draft.protocol]}</div>
            </div>
          </div>

          <div className={css.formRow}>
            <div className={css.formKey}>Base URL<span className={css.req}>*</span></div>
            <div className={css.formCtl}>
              <div className={css.input}>
                <input
                  className={css.mono}
                  spellCheck={false}
                  value={draft.baseUrl}
                  onChange={(event) => { patch({ baseUrl: event.target.value }) }}
                />
              </div>
              <div className={css.formTip}>换成自建网关时只改这一处。</div>
            </div>
          </div>

          <div className={css.formRow}>
            <div className={css.formKey}>API Key<span className={css.req}>*</span></div>
            <div className={css.formCtl}>
              {draft.hasKey && plainKey === ''
                ? (
                  <div className={css.keyOk}>
                    <CheckIcon />
                    已配置
                    <span className={css.badge}>{draft.keyHint}</span>
                    <button className={`${css.btn} ${css.btnSm} ${css.btnGhost}`} type="button" onClick={() => { patch({ hasKey: false }) }}>
                      更换
                    </button>
                  </div>
                )
                : (
                  <div className={css.input}>
                    <input
                      className={css.mono}
                      type="password"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="sk-or-v1-…"
                      value={plainKey}
                      onChange={(event) => { setPlainKey(event.target.value) }}
                    />
                  </div>
                )}
              <div className={css.formTip}>
                明文只落盘在宿主 <code>~/.dsh/dsh-imagegen-panel/config.json</code>，保存后前端只看到「已配置」。
              </div>
            </div>
          </div>

          <div className={css.formRow}>
            <div className={css.formKey}>默认模型</div>
            <div className={css.formCtl}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className={css.input} style={{ flex: 1 }}>
                  <input className={css.mono} spellCheck={false} value={draft.model} onChange={(event) => { patch({ model: event.target.value }) }} />
                </div>
                <button className={`${css.btn} ${css.btnSm}`} type="button" disabled={props.pulling} onClick={props.onPullModels}>
                  {props.pulling ? '拉取中…' : '拉取模型列表'}
                </button>
              </div>

              {props.models.length > 0 && (
                <div className={css.modelList}>
                  {props.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={css.modelItem}
                      aria-selected={model.id === draft.model}
                      onClick={() => { patch({ model: model.id }) }}
                    >
                      <span className={css.id}>{model.id}</span>
                      <span className={css.caps}>
                        {model.caps.map((cap) => <span className={css.cap} key={cap}>{cap}</span>)}
                      </span>
                      <span className={css.price}>{model.price}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className={css.formTip}>
                选中模型后会拉 <code>GET /images/models/&lt;id&gt;/endpoints</code>，用返回的{' '}
                <code>supported_parameters</code> 生成左侧「比例 / 分辨率 / 张数 / 质量 / 输出格式」的可选项。
                {selectedModel !== undefined && !selectedModel.supportsReferences && ' 当前模型不支持参考图，左侧参考图槽会禁用。'}
                {selectedModel !== undefined && selectedModel.references.max > 0
                  && ` 参考图最多 ${selectedModel.references.max} 张${selectedModel.references.min > 0 ? '，且**必须**给底图（改图专用模型）' : ''}。`}
              </div>
            </div>
          </div>

          <div className={css.formRow}>
            <div className={css.formKey}>自动保存目录</div>
            <div className={css.formCtl}>
              <div className={css.input}>
                <input
                  className={css.mono}
                  spellCheck={false}
                  value={draft.autoSaveDir}
                  onChange={(event) => { patch({ autoSaveDir: event.target.value }) }}
                />
              </div>
              <div className={css.formTip}>出图后自动写一份到这里；面板里的「保存」按钮可另存到别处。</div>
            </div>
          </div>

          {/*
            高级区**不做折叠**。
            原来用 `<details>` 收着，结果点开看不见东西 —— `.modalBody` 是 flex 子项，
            没有 `min-height: 0` 就不肯收缩，展开的内容被 `.modal` 的 overflow:hidden 裁掉，
            用户视角就是「点了没反应」。只有三项，直接摊开 + 每项一句说明更省事。
          */}
          <div className={css.adv}>
            <div className={css.advTitle}>
              <GearIcon size={13} />
              高级
              <span>一般不用改</span>
            </div>
            <div className={css.advBody}>
              <div>
                <div className={css.paramLabel}>额外参数（JSON，原样并进请求体）</div>
                <textarea
                  className={css.extraJson}
                  spellCheck={false}
                  value={draft.extraJson}
                  onChange={(event) => { patch({ extraJson: event.target.value }) }}
                />
                <div className={css.formTip}>
                  想指定上游通道或透传私有参数时用，例如 <code>{'{"provider":{"sort":"price"}}'}</code>；留空就不加。
                </div>
                {props.capabilities !== undefined && props.capabilities.providerOptions.length > 0 && (
                  <div className={css.formTip}>
                    当前模型允许透传的 provider 私有参数（键是 <code>provider.options[slug]</code>，
                    <b>slug 带区域后缀、同族还不一样</b>，所以只能按接口返回值填 —— 官方文档里写死的那个键对
                    <code>flux.2-max</code> 这类模型是错的）：
                    {props.capabilities.providerOptions.map((option) => (
                      <div key={option.slug} style={{ marginTop: 4 }}>
                        <code>{option.slug}</code>（{option.name}）→ {option.params.join('、')}
                        <button
                          className={`${css.btn} ${css.btnSm}`}
                          type="button"
                          style={{ marginLeft: 8 }}
                          onClick={() => { void copyProviderTemplate(option.slug, option.params) }}
                        >
                          {copiedSlug === option.slug ? '已复制' : '复制模板'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div className={css.paramLabel}>超时（秒）</div>
                  <div className={css.input}>
                    <input
                      className={css.mono}
                      value={String(draft.timeoutSec)}
                      onChange={(event) => { patch({ timeoutSec: Number(event.target.value) || 0 }) }}
                    />
                  </div>
                  <div className={css.formTip}>超过就中止并回 504；模型很慢时调大。</div>
                </div>
                <div>
                  <div className={css.paramLabel}>输出格式</div>
                  <div className={css.select}>
                    <select
                      value={draft.outputFormat}
                      onChange={(event) => { patch({ outputFormat: event.target.value as PanelConfig['outputFormat'] }) }}
                    >
                      <option value="png">png</option>
                      <option value="jpeg">jpeg</option>
                      <option value="webp">webp</option>
                      <option value="svg">svg</option>
                    </select>
                    <span className={css.chev}><ChevronIcon /></span>
                  </div>
                  <div className={css.formTip}>
                    只在模型声明支持时才发。上游 6 个矢量化模型（<code>recraft/*-vector</code>）只收 <code>svg</code>，
                    选它们要在这里切过来；<code>riverflow-v2.5-fast</code> 只收 <code>jpeg</code>。
                  </div>
                  {formatMismatch && (
                    <div className={css.formTip}>
                      ⚠ 当前模型只接受 <code>{selectedModel!.options.outputFormat.join(' / ')}</code>，
                      与配置的 <code>{draft.outputFormat}</code> 不符 —— 生成时**不会发送**这个字段（下游用它的默认格式）。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={css.modalFoot}>
          <span className={css.formTip}>Key 只存宿主，前端永远拿不到明文。</span>
          <span className={css.spacer} />
          <button className={css.btn} type="button" onClick={props.onClose}>取消</button>
          <button className={`${css.btn} ${css.btnPrimary}`} type="button" onClick={() => { props.onSave(draft, plainKey) }}>保存</button>
        </div>
      </div>
    </div>
  )
}
