/**
 * 客户端首帧兜底配置。
 *
 * **宿主才是权威** —— 真配置在 `~/.dsh/dsh-imagegen-panel/config.json`，由
 * `src/config-store.ts` 读写。这一份只解决一件事：面板挂载后到宿主配置回来之间
 * 有几十毫秒，没有它页头会闪一下「模型 未选择」，版式会跳。
 *
 * 字段清单必须与宿主 `src/config-store.ts` 的 `Settings` 一致 ——
 * `scripts/host-check.mjs` 会拿两半边的产物做一次字面比对，防止只改一边。
 */
import type { PanelConfig } from './types.ts'

/** 未配置时的默认值（`hasKey: false` → 首帧按「未配置」渲染）。 */
export const DEFAULT_CONFIG: PanelConfig = {
  protocol: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: false,
  keyHint: '',
  model: 'google/gemini-3-pro-image',
  autoSaveDir: 'D:\\DSH\\.dsh-imagegen\\out\\',
  extraJson: '{\n  "background": "opaque",\n  "output_compression": 90,\n  "provider": { "sort": "price" }\n}',
  timeoutSec: 180,
  outputFormat: 'png',
}
