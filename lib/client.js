window.__ModuleLoader__.load({
	id: "dsh-imagegen-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var __cache = new Map();
		var __modules = {
			"src/client/index.tsx": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.FIELD_LABELS = exports.fieldLabelOf = exports.factTextOf = exports.factListOf = exports.toPanelDraft = exports.toLogEntry = exports.toCapabilities = exports.toImage = exports.toModelOptions = exports.toOutboundConfig = exports.toPanelConfig = exports.ROUTES = exports.apiPath = exports.createHttpBackend = exports.LogList = exports.LogDrawer = exports.LogViewer = exports.ConfigModal = exports.HistoryFacts = exports.HistoryMenu = exports.HistoryStrip = exports.ResultStage = exports.MAX_REFERENCES = exports.Composer = exports.paramsFromHistory = exports.promptForEntry = exports.ImageGenPanel = exports.PANEL_ID = exports.inject = void 0;
exports.apply = apply;
exports.SidebarIcon = SidebarIcon;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
const icons_tsx_1 = __dshRequire("src/client/icons.tsx");
const ImageGenPanel_tsx_1 = __dshRequire("src/client/ImageGenPanel.tsx");
/** 侧栏那一行与主区那个面板共用的 cell key。必须与 cordis.patch.yml 的行 id 一致。 */
const PANEL_ID = 'imagegen';
exports.PANEL_ID = PANEL_ID;
/**
 * 侧栏图标适配器。
 *
 * 壳会把 `size` / `active` 传进来；这里只做转发，保证缺省值合理，
 * 让「契约漂移」退化成图标略小而不是整行崩掉。
 */
function SidebarIcon(props) {
    return (0, jsx_runtime_1.jsx)(icons_tsx_1.ImageGenIcon, { size: props.size ?? 16, active: props.active ?? false });
}
/** 插件依赖的服务。 */
exports.inject = ['slots'];
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
function apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined || typeof slots.register !== 'function' || typeof slots.inject !== 'function') {
        console.warn('[dsh-imagegen-panel] slots 服务形状异常，未挂载任何界面');
        return;
    }
    try {
        // 侧栏那一行。order=-1 → 排在「插件」(order=0) 之前，即老板要的「上方」。
        slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: -1, label: () => '生图' }, SidebarIcon));
        // 主区面板。key 与上面的 id 相同 —— 这就是「侧栏 id 寻址主区面板」的接线。
        slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, ImageGenPanel_tsx_1.ImageGenPanel));
    }
    catch (error) {
        // 槽位冲突或声明缺失都不能把 GUI 带下水。
        console.warn('[dsh-imagegen-panel] 界面注册失败：', error);
    }
}
var ImageGenPanel_tsx_2 = __dshRequire("src/client/ImageGenPanel.tsx");
Object.defineProperty(exports, "ImageGenPanel", { enumerable: true, get: function () { return ImageGenPanel_tsx_2.ImageGenPanel; } });
Object.defineProperty(exports, "promptForEntry", { enumerable: true, get: function () { return ImageGenPanel_tsx_2.promptForEntry; } });
Object.defineProperty(exports, "paramsFromHistory", { enumerable: true, get: function () { return ImageGenPanel_tsx_2.paramsFromHistory; } });
var Composer_tsx_1 = __dshRequire("src/client/Composer.tsx");
Object.defineProperty(exports, "Composer", { enumerable: true, get: function () { return Composer_tsx_1.Composer; } });
Object.defineProperty(exports, "MAX_REFERENCES", { enumerable: true, get: function () { return Composer_tsx_1.MAX_REFERENCES; } });
var ResultStage_tsx_1 = __dshRequire("src/client/ResultStage.tsx");
Object.defineProperty(exports, "ResultStage", { enumerable: true, get: function () { return ResultStage_tsx_1.ResultStage; } });
Object.defineProperty(exports, "HistoryStrip", { enumerable: true, get: function () { return ResultStage_tsx_1.HistoryStrip; } });
Object.defineProperty(exports, "HistoryMenu", { enumerable: true, get: function () { return ResultStage_tsx_1.HistoryMenu; } });
Object.defineProperty(exports, "HistoryFacts", { enumerable: true, get: function () { return ResultStage_tsx_1.HistoryFacts; } });
var ConfigModal_tsx_1 = __dshRequire("src/client/ConfigModal.tsx");
Object.defineProperty(exports, "ConfigModal", { enumerable: true, get: function () { return ConfigModal_tsx_1.ConfigModal; } });
var LogViewer_tsx_1 = __dshRequire("src/client/LogViewer.tsx");
Object.defineProperty(exports, "LogViewer", { enumerable: true, get: function () { return LogViewer_tsx_1.LogViewer; } });
Object.defineProperty(exports, "LogDrawer", { enumerable: true, get: function () { return LogViewer_tsx_1.LogDrawer; } });
Object.defineProperty(exports, "LogList", { enumerable: true, get: function () { return LogViewer_tsx_1.LogList; } });
var api_ts_1 = __dshRequire("src/client/api.ts");
Object.defineProperty(exports, "createHttpBackend", { enumerable: true, get: function () { return api_ts_1.createHttpBackend; } });
Object.defineProperty(exports, "apiPath", { enumerable: true, get: function () { return api_ts_1.apiPath; } });
Object.defineProperty(exports, "ROUTES", { enumerable: true, get: function () { return api_ts_1.ROUTES; } });
Object.defineProperty(exports, "toPanelConfig", { enumerable: true, get: function () { return api_ts_1.toPanelConfig; } });
Object.defineProperty(exports, "toOutboundConfig", { enumerable: true, get: function () { return api_ts_1.toOutboundConfig; } });
Object.defineProperty(exports, "toModelOptions", { enumerable: true, get: function () { return api_ts_1.toModelOptions; } });
Object.defineProperty(exports, "toImage", { enumerable: true, get: function () { return api_ts_1.toImage; } });
Object.defineProperty(exports, "toCapabilities", { enumerable: true, get: function () { return api_ts_1.toCapabilities; } });
Object.defineProperty(exports, "toLogEntry", { enumerable: true, get: function () { return api_ts_1.toLogEntry; } });
Object.defineProperty(exports, "toPanelDraft", { enumerable: true, get: function () { return api_ts_1.toPanelDraft; } });
var labels_ts_1 = __dshRequire("src/client/labels.ts");
Object.defineProperty(exports, "factListOf", { enumerable: true, get: function () { return labels_ts_1.factListOf; } });
Object.defineProperty(exports, "factTextOf", { enumerable: true, get: function () { return labels_ts_1.factTextOf; } });
Object.defineProperty(exports, "fieldLabelOf", { enumerable: true, get: function () { return labels_ts_1.fieldLabelOf; } });
Object.defineProperty(exports, "FIELD_LABELS", { enumerable: true, get: function () { return labels_ts_1.FIELD_LABELS; } });
var defaults_ts_1 = __dshRequire("src/client/defaults.ts");
Object.defineProperty(exports, "DEFAULT_CONFIG", { enumerable: true, get: function () { return defaults_ts_1.DEFAULT_CONFIG; } });

			},
			"\u0000jsx-runtime": function (module, exports, require) {
			"use strict";
const React = require("react");
function jsx(type, props, key) {
  if (key === undefined) return React.createElement(type, props);
  return React.createElement(type, Object.assign({}, props, { key: key }));
}
exports.jsx = jsx;
exports.jsxs = jsx;
exports.Fragment = React.Fragment;
			},
			"src/client/icons.tsx": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageGenIcon = ImageGenIcon;
exports.PlusIcon = PlusIcon;
exports.ChevronIcon = ChevronIcon;
exports.SparkIcon = SparkIcon;
exports.StopIcon = StopIcon;
exports.GearIcon = GearIcon;
exports.ListIcon = ListIcon;
exports.WarnIcon = WarnIcon;
exports.EmptyGlyphIcon = EmptyGlyphIcon;
exports.ErrorGlyphIcon = ErrorGlyphIcon;
exports.CheckIcon = CheckIcon;
exports.SaveIcon = SaveIcon;
exports.CopyIcon = CopyIcon;
exports.OpenIcon = OpenIcon;
exports.RetryIcon = RetryIcon;
exports.ClockIcon = ClockIcon;
exports.InfoIcon = InfoIcon;
exports.CoinIcon = CoinIcon;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
/**
 * 侧栏「生图」那一行的图标。
 *
 * 由壳下发 `{ size, active }`：size 在侧栏展开时是 16、收起时是 18，
 * 所以这里必须用 props 而不是写死尺寸。
 */
function ImageGenIcon({ size = 16, active = false }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { display: 'block', opacity: active ? 1 : 0.92 }, children: [(0, jsx_runtime_1.jsx)("rect", { x: "1.7", y: "2.7", width: "12.6", height: "10.6", rx: "2.2", stroke: "currentColor", strokeWidth: "1.3" }), (0, jsx_runtime_1.jsx)("circle", { cx: "5.6", cy: "6.3", r: "1.15", stroke: "currentColor", strokeWidth: "1.2" }), (0, jsx_runtime_1.jsx)("path", { d: "M2.3 11.4 5.9 8.1l2.5 2.3 2.1-1.9 3.2 2.9", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" })] }));
}
/** 加号。 */
function PlusIcon({ size = 18 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("path", { d: "M8 3.4v9.2M3.4 8h9.2", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }) }));
}
/** 下拉箭头。 */
function ChevronIcon({ size = 12 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("path", { d: "m4.4 6.4 3.6 3.6 3.6-3.6", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
/** 生成按钮上的星芒。 */
function SparkIcon({ size = 15 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("path", { d: "M8 1.9c.5 3 1.25 3.75 4.25 4.25-3 .5-3.75 1.25-4.25 4.25-.5-3-1.25-3.75-4.25-4.25C6.75 5.65 7.5 4.9 8 1.9Z", stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round" }), (0, jsx_runtime_1.jsx)("path", { d: "M12.3 10.2c.25 1.4.6 1.75 2 2-1.4.25-1.75.6-2 2-.25-1.4-.6-1.75-2-2 1.4-.25 1.75-.6 2-2Z", stroke: "currentColor", strokeWidth: "1.1", strokeLinejoin: "round" })] }));
}
/** 停止（取消生成）。 */
function StopIcon({ size = 14 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("rect", { x: "4", y: "4", width: "8", height: "8", rx: "1.6", fill: "currentColor" }) }));
}
/** 齿轮（连接配置）。 */
function GearIcon({ size = 14 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "2.2", stroke: "currentColor", strokeWidth: "1.3" }), (0, jsx_runtime_1.jsx)("path", { d: "M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5 11 5M5 11l-1.5 1.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" })] }));
}
/** 列表（模型 chip 左侧）。 */
function ListIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("path", { d: "M2 4.6h12M2 8h12M2 11.4h7", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" }) }));
}
/** 警告三角（未配置引导条）。 */
function WarnIcon({ size = 15 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("path", { d: "M8 2.2 14 13H2L8 2.2Z", stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round" }), (0, jsx_runtime_1.jsx)("path", { d: "M8 6.4v3.1", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }), (0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "11.3", r: ".85", fill: "currentColor" })] }));
}
/** 空态取景框。 */
function EmptyGlyphIcon({ size = 26 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("rect", { x: "2.6", y: "4.2", width: "18.8", height: "15.6", rx: "3", stroke: "currentColor", strokeWidth: "1.4" }), (0, jsx_runtime_1.jsx)("circle", { cx: "8.4", cy: "9.4", r: "1.7", stroke: "currentColor", strokeWidth: "1.3" }), (0, jsx_runtime_1.jsx)("path", { d: "M3.4 17 8.9 12l3.7 3.4 3.1-2.8 4.9 4.4", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })] }));
}
/** 出错圆形感叹号。 */
function ErrorGlyphIcon({ size = 22 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("path", { d: "M8 5v4.1", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }), (0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "11.6", r: ".95", fill: "currentColor" }), (0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "6.2", stroke: "currentColor", strokeWidth: "1.4" })] }));
}
/** 对勾。 */
function CheckIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("path", { d: "m3.6 8.4 3 3 5.8-6", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
/** 下载/保存。 */
function SaveIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("path", { d: "M8 10.6V2.4m0 0L5.2 5.2M8 2.4l2.8 2.8", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round", strokeLinejoin: "round" }), (0, jsx_runtime_1.jsx)("path", { d: "M3 9.4v3.2c0 .8.6 1.4 1.4 1.4h7.2c.8 0 1.4-.6 1.4-1.4V9.4", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round" })] }));
}
/** 复制。 */
function CopyIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("rect", { x: "5.6", y: "5.6", width: "7.8", height: "7.8", rx: "1.8", stroke: "currentColor", strokeWidth: "1.3" }), (0, jsx_runtime_1.jsx)("path", { d: "M10.4 5.6V4.2c0-1-.8-1.8-1.8-1.8H4.2c-1 0-1.8.8-1.8 1.8v4.4c0 1 .8 1.8 1.8 1.8h1.4", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" })] }));
}
/** 用系统默认程序打开（方框 + 外跳箭头）。 */
function OpenIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("path", { d: "M9.8 2.6h3.6v3.6", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round", strokeLinejoin: "round" }), (0, jsx_runtime_1.jsx)("path", { d: "M13.4 2.6 8.2 7.8", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round" }), (0, jsx_runtime_1.jsx)("path", { d: "M12.2 9.6v2.8c0 .8-.6 1.4-1.4 1.4H4.2c-.8 0-1.4-.6-1.4-1.4V5.6c0-.8.6-1.4 1.4-1.4h2.8", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round", strokeLinejoin: "round" })] }));
}
/** 重来。 */
function RetryIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("path", { d: "M13.4 8a5.4 5.4 0 1 1-1.6-3.8M13.4 2.6v2.8h-2.8", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
/** 时钟（历史标题）。 */
function ClockIcon({ size = 13 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "6.2", stroke: "currentColor", strokeWidth: "1.3" }), (0, jsx_runtime_1.jsx)("path", { d: "M8 4.6V8l2.4 1.6", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" })] }));
}
/** 信息圈（参数说明）。 */
function InfoIcon({ size = 12 }) {
    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "6.2", stroke: "currentColor", strokeWidth: "1.25" }), (0, jsx_runtime_1.jsx)("path", { d: "M8 7.2v4", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }), (0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "5", r: ".85", fill: "currentColor" })] }));
}
/** 钱币（花费角标）。 */
function CoinIcon({ size = 11 }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: (0, jsx_runtime_1.jsx)("path", { d: "M8 2.4v11.2M10.6 5.1H6.4a1.9 1.9 0 0 0 0 3.8h3.2a1.9 1.9 0 0 1 0 3.8H5.4", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" }) }));
}

			},
			"src/client/ImageGenPanel.tsx": function (module, exports, require) {
			"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptForEntry = promptForEntry;
exports.paramsFromHistory = paramsFromHistory;
exports.ImageGenPanel = ImageGenPanel;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
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
 *  - **进面板的初始态**（2026-10-11 老板拍板）：
 *      1. 上一次是**成功生成** → 提示词区与图像展示区都是空的；
 *      2. 有一份**没生成过**的草稿（提示词 ≠ 最后一次成功生成用的那句）→ 提示词留着；
 *      3. 图像展示区**一律为空** —— 不再自动选中最新一张历史图（想看就点下面的缩略图）。
 *  - **点历史记录**（2026-10-11）：提示词与该图的参数搬回工作区、图像上舞台；
 *    **设置区的模型不动** —— 那张图当时的模型与参数在结果行里如实显示。
 *  - **组件卸载要取消在飞请求**：用一个递增的 run token 判定「这次结果还算不算数」，
 *    同时用 AbortController 真的把 HTTP 请求掐掉（阶段 4 一次生成可能要 90 秒，
 *    「取消」必须真取消，不能只是不看结果）。
 *  - 未配置时不给生成，但**提示词与参数仍然可编辑** —— 用户可以先写好再配。
 *  - **宿主路由不可用**（宿主半边没加载 / 端口不对）是一种独立状态：这时既不显示
 *    「还没配置」（那是误导），也不静默降级成假数据，而是明说哪里断了。
 */
const react_1 = require("react");
const api_ts_1 = __dshRequire("src/client/api.ts");
const art_tsx_1 = __dshRequire("src/client/art.tsx");
const Composer_tsx_1 = __dshRequire("src/client/Composer.tsx");
const ConfigModal_tsx_1 = __dshRequire("src/client/ConfigModal.tsx");
const icons_tsx_1 = __dshRequire("src/client/icons.tsx");
const labels_ts_1 = __dshRequire("src/client/labels.ts");
const defaults_ts_1 = __dshRequire("src/client/defaults.ts");
const ResultStage_tsx_1 = __dshRequire("src/client/ResultStage.tsx");
const LogViewer_tsx_1 = __dshRequire("src/client/LogViewer.tsx");
const optimize_ts_1 = __dshRequire("src/client/optimize.ts");
const types_ts_1 = __dshRequire("src/client/types.ts");
const panel_module_css_1 = __importDefault(__dshRequire("src/client/panel.module.css"));
/**
 * 后端实现。
 *
 * 阶段 3 起是**真实现**：打宿主 `/dsh-imagegen/*` 路由（`src/client/api.ts`）。
 * UI 只依赖 `Backend` 接口，所以换实现没有改任何组件代码。
 */
const backend = (0, api_ts_1.createHttpBackend)();
/** 两个候选值表取并集（取长的那个，避免「能力接口比列表窄」把选项变少）。 */
function widerOptions(a, b) {
    return b.length > a.length ? b : a;
}
/** 时间戳 → `21:14`（历史图当参考图时的角标名）。 */
function shortTime(ms) {
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
function snapParams(current, options) {
    const keys = ['aspectRatio', 'resolution', 'count', 'quality'];
    let next;
    for (const key of keys) {
        const candidates = options[key];
        if (candidates.length === 0)
            continue;
        if (candidates.includes(current[key]))
            continue;
        next = { ...(next ?? current), [key]: candidates[0] };
    }
    return next ?? current;
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
function promptForEntry(draft) {
    if (draft === undefined)
        return '';
    const current = draft.prompt.trim();
    if (current === '')
        return '';
    return current === draft.lastGeneratedPrompt.trim() ? '' : draft.prompt;
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
function paramsFromHistory(snapshot, current) {
    if (snapshot === undefined) {
        return { params: current.params, extra: current.extra, applied: [], skipped: [] };
    }
    const hasTable = current.parameters.length > 0;
    const table = new Map(current.parameters.map((field) => [field.name, field]));
    const applied = [];
    const skipped = [];
    const params = { ...current.params };
    for (const item of HISTORY_CORE_SLOTS) {
        const value = String(snapshot[item.slot] ?? '');
        if (value === '')
            continue;
        if (hasTable && !fieldAccepts(table.get(item.name), value)) {
            skipped.push(item.label);
            continue;
        }
        if (params[item.slot] === value)
            continue;
        params[item.slot] = value;
        applied.push(item.label);
    }
    const extra = { ...current.extra };
    for (const [name, value] of Object.entries(snapshot.extra)) {
        if (value === '')
            continue;
        if (hasTable && !fieldAccepts(table.get(name), value)) {
            skipped.push((0, labels_ts_1.fieldLabelOf)(name));
            continue;
        }
        if (extra[name] === value)
            continue;
        extra[name] = value;
        applied.push((0, labels_ts_1.fieldLabelOf)(name));
    }
    return { params, extra, applied, skipped };
}
/**
 * 有专属状态槽的字段名。
 *
 * 这四个走 {@link ParamState}（`GenerateRequest` 的一等字段），其余走 `extra`。
 * 与 `Composer.tsx` 的 `CORE_SLOTS` 是同一份约定 —— 那边管渲染，这边管收敛。
 */
const CORE_FIELD_NAMES = new Set(['aspect_ratio', 'resolution', 'n', 'quality']);
/**
 * 历史记录里的核心四项 → 面板参数槽（点历史图回填参数时用）。
 *
 * 顺序就是结果行里「参数」的显示顺序：比例 / 分辨率 / 张数 / 质量。
 */
const HISTORY_CORE_SLOTS = [
    { name: 'aspect_ratio', slot: 'aspectRatio', label: '比例' },
    { name: 'resolution', slot: 'resolution', label: '分辨率' },
    { name: 'n', slot: 'count', label: '张数' },
    { name: 'quality', slot: 'quality', label: '质量' },
];
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
function fieldAccepts(field, value) {
    if (field === undefined)
        return false;
    if ((field.control === 'select' || field.control === 'count') && (field.values?.length ?? 0) > 0) {
        return field.values.includes(value);
    }
    if (field.control === 'number') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed))
            return false;
        if (field.min !== undefined && parsed < field.min)
            return false;
        if (field.max !== undefined && parsed > field.max)
            return false;
        return true;
    }
    return true;
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
function snapExtra(current, fields, preferred = {}) {
    // 没有能力表（OpenAI / Gemini / 自定义协议）：这套收敛无从谈起，别动用户的值。
    if (fields.length === 0)
        return current;
    const next = {};
    for (const field of fields) {
        if (CORE_FIELD_NAMES.has(field.name))
            continue;
        const value = current[field.name] ?? preferred[field.name] ?? field.default;
        if (value === '') {
            // 留空 = 不发这个字段，这是合法状态（`seed` / `size` / `output_compression`）。
            // 不可留空的字段（格式 / 背景）由它自己的默认值补上。
            if (!field.clearable && field.default !== '')
                next[field.name] = field.default;
            continue;
        }
        if ((field.control === 'select' || field.control === 'count') && (field.values?.length ?? 0) > 0) {
            next[field.name] = field.values.includes(value) ? value : field.values[0];
            continue;
        }
        if (field.control === 'number') {
            const parsed = Number(value);
            if (!Number.isFinite(parsed))
                continue;
            const min = field.min ?? Number.NEGATIVE_INFINITY;
            const max = field.max ?? Number.POSITIVE_INFINITY;
            next[field.name] = String(Math.min(max, Math.max(min, parsed)));
            continue;
        }
        next[field.name] = value;
    }
    const changed = Object.keys(next).length !== Object.keys(current).length
        || Object.entries(next).some(([name, value]) => current[name] !== value);
    return changed ? next : current;
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
function coreOptionsOf(fields, fallback) {
    const valuesOf = (name) => fields.find((field) => field.name === name)?.values ?? [];
    const pick = (name, other) => {
        const own = valuesOf(name);
        return own.length > 0 ? own : other;
    };
    return {
        aspectRatio: pick('aspect_ratio', fallback.aspectRatio),
        resolution: pick('resolution', fallback.resolution),
        count: pick('n', fallback.count),
        quality: pick('quality', fallback.quality),
        outputFormat: fallback.outputFormat,
    };
}
const panelStore = {
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
    // 用默认配置打底，而不是留 undefined。
    // 否则首帧（配置还没从宿主回来那几十毫秒）页头会闪一下「模型 未选择」。
    // 默认配置的 hasKey 是 false，所以这一帧仍然按「未配置」渲染 ——
    // 行为不变，只是不再闪。**它只是首帧占位**：宿主配置一回来就会被接管
    // （见下面的挂载 effect；别把这里改成「有值就不覆盖」，那会让存好的配置永远读不进来）。
    config: { ...defaults_ts_1.DEFAULT_CONFIG },
    models: [],
};
/** 生图面板。 */
function ImageGenPanel() {
    const [prompt, setPrompt] = (0, react_1.useState)(() => promptForEntry(panelStore));
    const [lastGeneratedPrompt, setLastGeneratedPrompt] = (0, react_1.useState)(panelStore.lastGeneratedPrompt);
    const [params, setParams] = (0, react_1.useState)(panelStore.params);
    const [extra, setExtra] = (0, react_1.useState)(panelStore.extra);
    const [references, setReferences] = (0, react_1.useState)(panelStore.references);
    const [history, setHistory] = (0, react_1.useState)(panelStore.history);
    /**
     * 舞台上展示的那张。
     *
     * **初始永远是 undefined**（老板拍板）：进面板就是一块空面板，历史里有图也不自动
     * 选中 —— 想看哪张，点下面的缩略图。
     *
     * 提示词的初始值则走 {@link promptForEntry}（拿模块作用域里那份先判一次），
     * 这样「切走再切回来」时首帧就已经是最终结果，不会先闪一下上次的提示词
     * 再被草稿接口清掉。宿主草稿回来后还会再判一次（重启后模块作用域是空的）。
     */
    const [previewId, setPreviewId] = (0, react_1.useState)(undefined);
    const [config, setConfig] = (0, react_1.useState)(panelStore.config);
    const [models, setModels] = (0, react_1.useState)(panelStore.models);
    const [run, setRun] = (0, react_1.useState)({ kind: 'idle' });
    const [configOpen, setConfigOpen] = (0, react_1.useState)(false);
    const [pulling, setPulling] = (0, react_1.useState)(false);
    const [elapsedSec, setElapsedSec] = (0, react_1.useState)(0);
    const [toast, setToast] = (0, react_1.useState)(undefined);
    /** 宿主路由不可用时的原因（不是「未配置」）。 */
    const [hostError, setHostError] = (0, react_1.useState)(undefined);
    /** 出错时点「查看日志」打开的宿主日志抽屉。 */
    const [logOpen, setLogOpen] = (0, react_1.useState)(false);
    /** 历史图的右键菜单（含鼠标视口坐标）。 */
    const [historyMenu, setHistoryMenu] = (0, react_1.useState)(undefined);
    /** 菜单触发的动作正在跑（取图/保存中）——期间禁用菜单项，避免连点。 */
    const [menuBusy, setMenuBusy] = (0, react_1.useState)(false);
    /** 正在用 prompt-forge 优化提示词。 */
    const [optimizing, setOptimizing] = (0, react_1.useState)(false);
    /** 优化前的草稿（有值就显示「撤销」）。点历史图覆盖草稿时也会用它。 */
    const [undoPrompt, setUndoPrompt] = (0, react_1.useState)(undefined);
    /** 在飞的优化请求（换面板/卸载时中止）。 */
    const optimizeAbort = (0, react_1.useRef)(null);
    /**
     * 草稿已经读回来了吗。
     *
     * 在它变成 true 之前**绝不回写草稿** —— 否则首帧那份空提示词会先把磁盘上
     * 真正的草稿覆盖掉，然后「上次写的东西」就永远回不来了。
     */
    const draftReady = (0, react_1.useRef)(false);
    /**
     * 防抖窗口里还没落盘的那份草稿。
     *
     * 存在的意义是卸载时能补一刀：用户敲完最后一个字就切走，那 400 ms 的定时器
     * 被清掉，改动就丢了 —— 这里留一份，卸载时补发一次。
     */
    const pendingDraft = (0, react_1.useRef)(undefined);
    /**
     * 用户在草稿回来**之前**就动过面板了吗。
     *
     * 挂载时三件事并行读（配置 / 历史 / 草稿），`applyDraft` 要等三件都落地才跑 ——
     * 这段时间里用户完全可能已经开始打字（尤其是一次 Ctrl+V 粘贴）。那种情况下
     * 铺草稿会把刚敲的内容**覆盖掉**，所以一旦动过，就只认用户手上的状态。
     */
    const touchedBeforeDraft = (0, react_1.useRef)(false);
    /** 记一笔「用户动过面板」。草稿已经回来之后再动就没有这层顾虑了。 */
    const markTouched = (0, react_1.useCallback)(() => {
        if (!draftReady.current)
            touchedBeforeDraft.current = true;
    }, []);
    /**
     * 「参数表变了就收敛一次」的额外触发计数。
     *
     * 草稿是异步回来的，可能在模型参数表**已经到位之后**才铺进面板 —— 那时
     * 收敛 effect 的依赖（参数表 / 模型）都没变，不会再跑一次，草稿里那些
     * 当前模型不认的取值就会一直挂在界面上。铺草稿时把计数加一，让它补跑。
     */
    const [snapEpoch, setSnapEpoch] = (0, react_1.useState)(0);
    /**
     * 当前在飞的那次生成的 token。
     *
     * 卸载或取消时把它加一，回调据此判断自己是否已经过期 —— 配合下面的
     * AbortController，既不看过期结果，也不让请求白跑。
     */
    const runToken = (0, react_1.useRef)(0);
    /** 在飞的生成请求。取消/卸载时 abort。 */
    const inFlight = (0, react_1.useRef)(null);
    /** 轻提示。 */
    const notify = (0, react_1.useCallback)((text, kind = 'ok') => {
        setToast({ text, kind });
    }, []);
    /**
     * 从宿主重读历史。
     *
     * 出图后一定要重读一次：`n > 1` 时宿主把每张都落盘并进了索引，而 `generate()`
     * 只拿到第一张 —— 不重读的话，另外几张要等下次进面板才看得到。
     * 顺带也把宿主的 `autoSavedPath`（自动另存到工作区的那份）带回来。
     */
    const refreshHistory = (0, react_1.useCallback)(async () => {
        try {
            const list = await backend.listHistory();
            setHistory(list);
        }
        catch {
            // 读不到就保持现状：下一次生成或下次进面板会再试。
        }
    }, []);
    // 回写模块作用域，让面板在切换后回来还能接上（跨 DSH 重启的那份在宿主草稿里）。
    (0, react_1.useEffect)(() => { panelStore.prompt = prompt; }, [prompt]);
    (0, react_1.useEffect)(() => { panelStore.lastGeneratedPrompt = lastGeneratedPrompt; }, [lastGeneratedPrompt]);
    (0, react_1.useEffect)(() => { panelStore.params = params; }, [params]);
    (0, react_1.useEffect)(() => { panelStore.extra = extra; }, [extra]);
    (0, react_1.useEffect)(() => { panelStore.references = references; }, [references]);
    (0, react_1.useEffect)(() => { panelStore.history = history; }, [history]);
    (0, react_1.useEffect)(() => { panelStore.config = config; }, [config]);
    (0, react_1.useEffect)(() => { panelStore.models = models; }, [models]);
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
     * @param draft - 宿主回的草稿。
     */
    const applyDraft = (0, react_1.useCallback)((draft) => {
        // 用户抢在草稿之前动过手 → 只记「最后一次成功生成用的那句」（那是判据），
        // 提示词与参数一概不覆盖：他手上的东西比磁盘上那份新。
        if (touchedBeforeDraft.current) {
            setLastGeneratedPrompt(draft?.lastGeneratedPrompt ?? '');
            return;
        }
        if (draft === undefined) {
            setLastGeneratedPrompt('');
            setPrompt('');
            return;
        }
        setLastGeneratedPrompt(draft.lastGeneratedPrompt);
        setParams(draft.params);
        setExtra(draft.extra);
        setPrompt(promptForEntry(draft));
        // 草稿里的取值可能来自另一个模型 —— 让收敛 effect 补跑一次（见 snapEpoch）。
        setSnapEpoch((epoch) => epoch + 1);
    }, []);
    // 首次挂载：读配置、历史与草稿。
    //
    // 刻意**不用** loading 门挡住首帧：配置还没回来时按「未配置」渲染完整骨架，
    // 用户看到的是稳定的版面而不是闪一下的空白。宿主配置一回来就直接接管 ——
    // 它是权威（磁盘文件），面板不跟它讨价还价。
    //
    // 三件事用 `Promise.allSettled` 而不是 `Promise.all`：草稿读不到（宿主还是旧构建、
    // 路由 404）不该让配置也判失败 —— 那是三个互不相干的接口。
    (0, react_1.useEffect)(() => {
        let alive = true;
        const controller = new AbortController();
        void (async () => {
            const [configOutcome, historyOutcome, draftOutcome] = await Promise.allSettled([
                backend.loadConfig(controller.signal),
                backend.listHistory(controller.signal),
                backend.loadDraft(controller.signal),
            ]);
            if (!alive)
                return;
            if (configOutcome.status === 'fulfilled') {
                setConfig(configOutcome.value);
                setHostError(undefined);
            }
            else {
                setHostError(configOutcome.reason instanceof Error ? configOutcome.reason.message : String(configOutcome.reason));
            }
            // 历史：模块作用域里已经有就不用再灌一次（切面板回来时它更新）。
            if (historyOutcome.status === 'fulfilled' && panelStore.history.length === 0) {
                setHistory(historyOutcome.value);
            }
            // 草稿：读成功才动面板状态；读失败保持现状（见 applyDraft 的注释）。
            if (draftOutcome.status === 'fulfilled')
                applyDraft(draftOutcome.value);
            draftReady.current = true;
        })();
        return () => {
            alive = false;
            controller.abort();
        };
    }, [applyDraft]);
    // 草稿自动落盘（防抖 400 ms）。**读完之前绝不回写**，理由见 draftReady 的注释。
    (0, react_1.useEffect)(() => {
        if (!draftReady.current)
            return undefined;
        pendingDraft.current = { prompt, params, extra, lastGeneratedPrompt, updatedAt: 0 };
        const timer = window.setTimeout(() => {
            const draft = pendingDraft.current;
            pendingDraft.current = undefined;
            if (draft !== undefined)
                void backend.saveDraft(draft);
        }, 400);
        return () => { window.clearTimeout(timer); };
    }, [prompt, params, extra, lastGeneratedPrompt]);
    // 卸载时把防抖窗口里那一份补上：敲完最后一个字就切走/关窗，改动不该丢。
    (0, react_1.useEffect)(() => () => {
        const draft = pendingDraft.current;
        pendingDraft.current = undefined;
        if (draft !== undefined)
            void backend.saveDraft(draft);
    }, []);
    // 卸载时作废在飞的请求，并把 HTTP 请求掐掉。
    (0, react_1.useEffect)(() => () => {
        runToken.current += 1;
        inFlight.current?.abort();
        inFlight.current = null;
    }, []);
    // 生成中每秒刷新计时。
    (0, react_1.useEffect)(() => {
        if (run.kind !== 'running')
            return undefined;
        const timer = window.setInterval(() => {
            setElapsedSec(Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)));
        }, 1000);
        return () => { window.clearInterval(timer); };
    }, [run]);
    // 轻提示自动消失：报错留 6 秒（用户要读完那句原始报错），成功留 1.8 秒。
    (0, react_1.useEffect)(() => {
        if (toast === undefined)
            return undefined;
        const timer = window.setTimeout(() => { setToast(undefined); }, toast.kind === 'err' ? 6000 : 1800);
        return () => { window.clearTimeout(timer); };
    }, [toast]);
    const model = (0, react_1.useMemo)(() => models.find((item) => item.id === config?.model) ?? models[0], [models, config?.model]);
    /**
     * 所选模型的权威能力（`/capabilities`）；拉不到时 undefined，界面退回保守行为。
     *
     * **必须带着它的 model id 一起存。** 只存能力对象会有一个很难查的 bug：
     * 用户切模型的瞬间，新模型的请求还在飞、旧的能力对象还在 state 里，
     * 参数行会短暂地按**上一个模型**渲染 —— 甚至连参考图上限都用错的那个。
     * 带上 id 之后，能力对象只在「它所属的模型 == 当前选中的模型」时才算数。
     */
    const [capsState, setCapsState] = (0, react_1.useState)(undefined);
    const modelCaps = capsState !== undefined && capsState.id === config?.model ? capsState.caps : undefined;
    /**
     * 界面上要渲染的参数表。
     *
     * 能力接口的（endpoint 级并集）优先；还没回来时用模型列表里那份（模型级），
     * 两者都没有就是空数组 —— 那时 `Composer` 退回固定的四项。
     */
    const parameters = (0, react_1.useMemo)(() => ((modelCaps?.parameters?.length ?? 0) > 0 ? modelCaps.parameters : (model?.parameters ?? [])), [modelCaps, model]);
    // 参数表一变（切模型、或列表/能力接口刚到）就把取值收敛到该模型的合法范围。
    // 两个 `snap*()` 在无变化时都返回原对象，所以这次 setState 会直接 bail out，
    // 不会因为 effect 依赖了 state 而打转。
    //
    // `snapEpoch` 是「铺完草稿再收敛一次」的触发器：草稿异步回来时参数表可能早就
    // 到位了，不补跑这一趟，草稿里那些当前模型不认的取值就会一直挂在界面上。
    (0, react_1.useEffect)(() => {
        if (parameters.length === 0)
            return;
        const options = coreOptionsOf(parameters, model?.options ?? {
            aspectRatio: [], resolution: [], count: [], quality: [], outputFormat: [],
        });
        setParams((state) => snapParams(state, options));
        // 配置弹层里那个「输出格式」是**默认值**，不是空话：字段还没被用户动过时，
        // 它优先于字段自己的默认值（仍要落在该模型枚举内 —— 收敛逻辑会兜住）。
        setExtra((state) => snapExtra(state, parameters, { output_format: config?.outputFormat ?? '' }));
    }, [parameters, model, config?.outputFormat, snapEpoch]);
    /** 该模型允许的参考图上限（已按网关全局 `maxItems: 16` 收敛）。 */
    const refLimit = (0, Composer_tsx_1.referenceLimit)(model);
    /** 该模型是否必须给底图（改图专用模型）。 */
    const refRequired = (0, Composer_tsx_1.referencesRequired)(model);
    /** 模型声明但被全局上限压下来的那个数（`tencent/…` 声明 20、接口只收 16）。 */
    const referenceDeclaredMax = modelCaps?.referencesDeclaredMax ?? 0;
    /**
     * 配置里那段「额外参数」JSON 覆盖了哪些**面板上看得见**的字段（中文标签）。
     *
     * 为什么要算这个：宿主侧那段 JSON 是**最后无条件合并**的（用户显式写的东西优先），
     * 而本机默认配置里就写着 `output_compression: 90` 与 `background: "opaque"` ——
     * 这两个字段原来没有界面，现在有了。不算的话用户会在面板上选 80、实际发 90，
     * 属于典型的「以为设上了」。这里在**生成之前**就把它摆到台面上。
     */
    const overriddenFields = (0, react_1.useMemo)(() => {
        const raw = config?.extraJson?.trim() ?? '';
        if (raw === '' || parameters.length === 0)
            return [];
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return [];
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return [];
        const keys = new Set(Object.keys(parsed));
        return parameters.filter((field) => keys.has(field.name)).map((field) => field.label);
    }, [config?.extraJson, parameters]);
    const preview = (0, react_1.useMemo)(() => history.find((item) => item.id === previewId), [history, previewId]);
    const notConfigured = config === undefined || !config.hasKey;
    // --------------------------------------------------------------- 生成
    const generate = (0, react_1.useCallback)(async () => {
        if (config === undefined)
            return;
        // 本地先拦掉两类「必被上游拒」的请求 —— 让用户看一句人话，而不是等 90 秒换回 502。
        if (modelCaps?.available === false) {
            notify(`「${config.model}」当前没有可服务的上游通道（目录里有它，但一个 endpoint 都没有）`, 'err');
            return;
        }
        const needRefs = model?.references?.min ?? 0;
        if (needRefs >= 1 && references.length < needRefs) {
            notify(`「${config.model}」是改图专用模型，至少要给 ${needRefs} 张参考图`, 'err');
            return;
        }
        const token = ++runToken.current;
        // 前一次还在飞就先掐掉：同一时刻只允许一次生成。
        inFlight.current?.abort();
        const controller = new AbortController();
        inFlight.current = controller;
        setRun({ kind: 'running', startedAt: Date.now() });
        setElapsedSec(0);
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
            }, controller.signal);
            if (runToken.current !== token)
                return;
            setHistory((current) => [image, ...current]);
            setPreviewId(image.id);
            setRun({ kind: 'done', image });
            /**
             * 记下「最后一次成功生成用的是哪句提示词」。
             *
             * 它就是进面板时那条规则的判据：提示词框里的话**等于**它 = 上次已经生成过了，
             * 下次进来给一块空面板；**不等于**它 = 这是一份没生成过的草稿，得留着。
             *
             * 注意这里**不清空输入框** —— 刚出图就把提示词抹掉，用户想微调后「重新生成」
             * 还得重敲一遍。清空只发生在**下一次进入面板**时（见 applyDraft）。
             */
            setLastGeneratedPrompt(prompt);
            if (image.count !== undefined && image.count > 1) {
                notify(`已生成 ${image.count} 张，全部已保存（下方历史里可逐张查看）`);
            }
            // 重读一次历史：把 n>1 的其余几张、以及宿主的 autoSavedPath 一并带回来。
            void refreshHistory();
        }
        catch (error) {
            if (runToken.current !== token)
                return;
            if (error instanceof types_ts_1.GenerateError) {
                setRun({ kind: 'error', message: error.message, detail: error.detail });
            }
            else {
                setRun({ kind: 'error', message: '生成失败', detail: String(error) });
            }
        }
        finally {
            if (inFlight.current === controller)
                inFlight.current = null;
        }
    }, [config, modelCaps, model, references, prompt, params, extra, notify, refreshHistory]);
    const cancel = (0, react_1.useCallback)(() => {
        runToken.current += 1;
        inFlight.current?.abort();
        inFlight.current = null;
        setRun({ kind: 'idle' });
        notify('已取消');
    }, [notify]);
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
    const applyHistoryImage = (0, react_1.useCallback)((image) => {
        setPreviewId(image.id);
        // 上一次是报错时，舞台正显示着错误卡片 —— 点了历史图却什么都没变，看着像坏了。
        // 报错态让位给「看这张图」；**生成中不动**（那会儿进度和「取消」比看图重要）。
        setRun((current) => (current.kind === 'error' ? { kind: 'idle' } : current));
        if (prompt.trim() !== '' && prompt !== image.prompt)
            setUndoPrompt(prompt);
        setPrompt(image.prompt);
        if (image.params === undefined) {
            notify('已载入该图的提示词（这张生成于升级前，没有参数记录）');
            return;
        }
        const result = paramsFromHistory(image.params, { params, extra, parameters });
        setParams(result.params);
        setExtra(result.extra);
        // 与铺草稿同理：参数表这会儿可能早就到位了，补跑一次收敛（幂等）。
        setSnapEpoch((epoch) => epoch + 1);
        if (result.skipped.length > 0) {
            notify(`已载入该图的提示词与参数；${result.skipped.length} 项与当前模型不符、没有写入：${[...new Set(result.skipped)].join('、')}`, 'err');
            return;
        }
        notify(result.applied.length > 0 ? `已载入该图的提示词与参数（${result.applied.length} 项）` : '已载入该图的提示词与参数');
    }, [prompt, params, extra, parameters, notify]);
    // ------------------------------------------------- 保存 / 另存为 / 复制
    /** 把某张图另存一份到工作区目录（「保存」按钮与历史右键菜单共用）。 */
    const saveImageToWorkspace = (0, react_1.useCallback)(async (image) => {
        try {
            const path = await backend.saveImage(image.id);
            notify(`已保存到 ${path}`);
            void refreshHistory();
        }
        catch (error) {
            notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'err');
        }
    }, [notify, refreshHistory]);
    /** 把某张图写进系统剪贴板。 */
    const copyImage = (0, react_1.useCallback)(async (image) => {
        if (image.imageUrl === undefined)
            return;
        try {
            const response = await fetch(image.imageUrl);
            const blob = await response.blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            notify('图片已复制到剪贴板');
        }
        catch (error) {
            // 剪贴板写入在部分环境会被拒；这不是致命错误，提示改走「另存为…」。
            notify(`复制失败：${error instanceof Error ? error.message : String(error)}（可改用「另存为…」）`, 'err');
        }
    }, [notify]);
    /**
     * 用系统默认程序打开某张图的**本地原图**。
     *
     * 这件事只能宿主做（浏览器起不来看图工具），所以走 `/dsh-imagegen/open`。
     * 提示里只放**文件名**（不是完整路径）：出问题时要能说出是哪一张，而完整路径
     * 有一百多个字符，单行 toast 放不下会被裁掉；打开的一律是 `out/` 里那份，
     * 也不存在两份同名图要区分的歧义。
     */
    const openImage = (0, react_1.useCallback)(async (image) => {
        try {
            const path = await backend.openImage(image.id);
            const name = path.split(/[\\/]/u).pop() ?? '';
            notify(name === '' ? '已交给系统默认程序打开' : `已用系统默认程序打开 ${name}`);
        }
        catch (error) {
            notify(`打开失败：${error instanceof Error ? error.message : String(error)}`, 'err');
        }
    }, [notify]);
    /** 「保存」：把舞台上那张存到工作区。 */
    const saveCurrent = (0, react_1.useCallback)(() => {
        if (preview !== undefined)
            void saveImageToWorkspace(preview);
    }, [preview, saveImageToWorkspace]);
    /** 「复制」：把舞台上那张写进剪贴板。 */
    const copyCurrent = (0, react_1.useCallback)(() => {
        if (preview !== undefined)
            void copyImage(preview);
    }, [preview, copyImage]);
    /** 「另存为…」：交给浏览器下载 —— 系统会弹真正的保存对话框。 */
    const saveAsCurrent = (0, react_1.useCallback)(() => {
        if (preview?.imageUrl === undefined)
            return;
        const fileName = preview.savedPath?.split(/[\\/]/u).pop() ?? `${preview.id}.png`;
        const anchor = document.createElement('a');
        anchor.href = preview.imageUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        notify('已交给系统的保存对话框');
    }, [preview, notify]);
    // ------------------------------------------------- 历史图右键菜单
    /**
     * 把一张历史图变成参考图。
     *
     * 链路：历史缩略图 →（宿主 `/image/<id>`）→ Blob → data URL → 参考图槽。
     * 之所以要绕一圈 data URL：生成时参考图是随请求体一起发的（`input_references`），
     * 不是给宿主一个 URL 让它自己去取 —— 那样等于让宿主去访问一个它自己的路由。
     */
    const useAsReference = (0, react_1.useCallback)(async (image) => {
        if (image.imageUrl === undefined) {
            notify('这张图没有可取回的地址（可能是旧索引数据）', 'err');
            return;
        }
        if (references.some((item) => item.sourceId === image.id)) {
            notify('这张已经在参考图里了');
            return;
        }
        if (references.length >= refLimit) {
            notify(`参考图最多 ${refLimit} 张`, 'err');
            return;
        }
        setMenuBusy(true);
        try {
            const response = await fetch(image.imageUrl);
            if (!response.ok)
                throw new Error(`取图失败 HTTP ${response.status}`);
            // 走的和「选文件」同一条准备链路：历史图也可能很大（4K PNG 动辄几 MB），
            // 图生图时同样会撞 413。
            const prepared = await (0, Composer_tsx_1.prepareReference)(await response.blob());
            const dataUrl = prepared.dataUrl;
            setReferences((current) => {
                // 再查一次：等图的这段时间里用户可能自己又加了一张。
                if (current.some((item) => item.sourceId === image.id) || current.length >= refLimit)
                    return current;
                return [...current, {
                        id: `ref-hist-${image.id}`,
                        name: `历史 ${shortTime(image.createdAt)}`,
                        dataUrl,
                        sourceId: image.id,
                        ...prepared.note === '' ? {} : { note: prepared.note },
                    }];
            });
            notify(prepared.note === '' ? '已作为参考图加入左侧' : `已作为参考图加入左侧（${prepared.note}）`);
        }
        catch (error) {
            notify(`作为参考图失败：${error instanceof Error ? error.message : String(error)}`, 'err');
        }
        finally {
            setMenuBusy(false);
            setHistoryMenu(undefined);
        }
    }, [references, refLimit, notify]);
    // Esc 关掉右键菜单（点别处由菜单自带的遮罩负责）。
    (0, react_1.useEffect)(() => {
        if (historyMenu === undefined)
            return undefined;
        const onKey = (event) => { if (event.key === 'Escape')
            setHistoryMenu(undefined); };
        window.addEventListener('keydown', onKey);
        return () => { window.removeEventListener('keydown', onKey); };
    }, [historyMenu]);
    // --------------------------------------------------------------- 提示词优化
    /**
     * 用 prompt-forge 的「文生图优化」模板改写当前草稿。
     *
     * 两步都在浏览器侧完成：先从我们宿主拿模板文本（`/dsh-imagegen/preset`），
     * 再直接打 prompt-forge 自己的 SSE 路由。结果**直接覆盖输入框**，并留一个「撤销」。
     */
    const runOptimize = (0, react_1.useCallback)(async () => {
        const draft = prompt.trim();
        if (draft === '' || optimizing)
            return;
        const original = prompt;
        const controller = new AbortController();
        optimizeAbort.current = controller;
        setOptimizing(true);
        setUndoPrompt(undefined);
        let received = false;
        try {
            const preset = await (0, optimize_ts_1.fetchForgePreset)(controller.signal);
            setPrompt('');
            const result = await (0, optimize_ts_1.optimizePrompt)(draft, preset.system, (chunk) => {
                received = true;
                setPrompt((current) => current + chunk);
            }, controller.signal);
            setPrompt(result);
            setUndoPrompt(original);
            const where = preset.model !== '' ? preset.model : preset.provider;
            notify(where === '' ? `提示词已优化（${preset.name}）` : `提示词已优化（${preset.name} · ${where}）`);
        }
        catch (error) {
            // 一个字都没收到 → 原样还原；已经收到半截 → 留着，但给撤销，别让用户白丢草稿。
            if (received)
                setUndoPrompt(original);
            else
                setPrompt(original);
            const message = error instanceof Error ? error.message : String(error);
            notify(`优化失败：${message}`, 'err');
        }
        finally {
            optimizeAbort.current = null;
            setOptimizing(false);
        }
    }, [prompt, optimizing, notify]);
    /** 还原成优化前那段草稿。 */
    const undoOptimize = (0, react_1.useCallback)(() => {
        if (undoPrompt === undefined)
            return;
        setPrompt(undoPrompt);
        setUndoPrompt(undefined);
        notify('已还原优化前的提示词');
    }, [undoPrompt, notify]);
    // 面板卸载时中止在飞的优化（SSE 连接不能挂着）。
    (0, react_1.useEffect)(() => () => { optimizeAbort.current?.abort(); }, []);
    // --------------------------------------------------------------- 配置
    const openConfig = (0, react_1.useCallback)(() => { setConfigOpen(true); }, []);
    const pullModels = (0, react_1.useCallback)(async () => {
        if (config === undefined)
            return;
        setPulling(true);
        try {
            const { models: list, note } = await backend.listModels(config);
            setModels(list);
            // 宿主给的 note 优先（例如「这个协议没有能力表，请手填模型 id」）——
            // 比「拉到 0 个模型」有用得多。
            notify(note ?? `拉到 ${list.length} 个模型`);
        }
        catch (error) {
            // 拉不到模型不该让面板不可用：参数行会退化成当前值，生成仍可点。
            notify(`模型列表拉取失败：${error instanceof Error ? error.message : String(error)}`, 'err');
        }
        finally {
            setPulling(false);
        }
    }, [config, notify]);
    const saveConfig = (0, react_1.useCallback)(async (next, plainKey) => {
        // 明文 Key 只随这一次 PUT 进宿主，前端不保存。宿主校验不过会抛，
        // 这时**不关弹层**，让用户就着原来的输入改。
        try {
            const saved = await backend.saveConfig(next, plainKey);
            setConfig(saved);
            setHostError(undefined);
            setConfigOpen(false);
            notify(saved.hasKey ? '配置已保存' : '已保存，但还没有可用的 Key', saved.hasKey ? 'ok' : 'err');
            if (models.length === 0)
                void pullModels();
        }
        catch (error) {
            notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'err');
        }
    }, [models.length, pullModels, notify]);
    // 首次进面板时把模型候选也拉一次（真接口：上游 `GET /images/models`）。
    (0, react_1.useEffect)(() => {
        if (config !== undefined && models.length === 0)
            void pullModels();
    }, [config, models.length, pullModels]);
    // 选中模型后拉它的**权威能力与定价**：模型列表接口不含定价，所以这一跳换来的
    // 是界面上那句真报价，以及跨 provider 合并后的参数候选值。
    // 失败不致命：下拉退化成列表里那份候选值，价格留空。
    (0, react_1.useEffect)(() => {
        const modelId = config?.model;
        if (modelId === undefined || modelId === '')
            return undefined;
        const current = config;
        const controller = new AbortController();
        void (async () => {
            try {
                const caps = await backend.modelCapabilities(current, modelId, params.resolution, controller.signal);
                if (controller.signal.aborted)
                    return;
                const merged = {
                    aspectRatio: caps.options.aspectRatio,
                    resolution: caps.options.resolution,
                    count: caps.options.count,
                    quality: caps.options.quality,
                    outputFormat: caps.options.outputFormat,
                };
                setCapsState({ id: modelId, caps });
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
                }));
                // 参数值不在候选里就换成第一个候选（中文「高」→ 合法的英文枚举）。
                setParams((state) => snapParams(state, merged));
                // `extra` 的收敛交给下面那个「参数表变了就收敛」的 effect —— 它依赖的
                // `parameters` 正是从 `capsState` 推出来的，放在这里会变成两个写入方。
            }
            catch {
                // 静默：能力拉不到时面板照常可用。
            }
        })();
        return () => { controller.abort(); };
    }, [config, params.resolution]);
    // --------------------------------------------------------------- 渲染
    return ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.panel, children: [(0, jsx_runtime_1.jsx)(art_tsx_1.ArtDefs, {}), hostError !== undefined && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.guideErr, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, {}), "\u5BBF\u4E3B\u8DEF\u7531\u4E0D\u53EF\u7528\uFF1A", hostError, (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.guideHint, children: "\u914D\u7F6E\u4E0E\u843D\u76D8\u90FD\u5728\u5BBF\u4E3B\u4FA7\uFF0C\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5BBF\u4E3B\u534A\u8FB9\u5DF2\u52A0\u8F7D" })] })), notConfigured && hostError === undefined && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.guide, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, {}), "\u8FD8\u6CA1\u914D\u7F6E\u751F\u56FE\u670D\u52A1\uFF0C\u914D\u7F6E\u540E\u624D\u80FD\u751F\u6210\u56FE\u7247\u3002", (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: openConfig, children: "\u53BB\u914D\u7F6E" })] })), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.body2, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.leftCol, children: [(0, jsx_runtime_1.jsx)("header", { className: panel_module_css_1.default.head, children: (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.headText, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.title, children: "\u751F\u56FE" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.sub, children: "\u63D0\u793A\u8BCD / \u53C2\u8003\u56FE \u2192 \u751F\u6210 \u2192 \u9762\u677F\u5185\u9884\u89C8 \u00B7 \u4FDD\u5B58 \u00B7 \u5386\u53F2" })] }) }), (0, jsx_runtime_1.jsx)(Composer_tsx_1.Composer, { prompt: prompt, onPromptChange: (value) => {
                                    markTouched();
                                    setPrompt(value);
                                    // 用户自己动手改了，就别再留着「撤销」去覆盖他的手改。
                                    if (!optimizing)
                                        setUndoPrompt(undefined);
                                }, onOptimize: () => { void runOptimize(); }, optimizing: optimizing, canUndo: undoPrompt !== undefined, onUndo: undoOptimize, references: references, onAddReference: (name, dataUrl, note) => {
                                    if (references.length >= refLimit)
                                        return;
                                    markTouched();
                                    setReferences((current) => [...current, {
                                            id: `ref-${Date.now()}-${current.length}`,
                                            name,
                                            dataUrl,
                                            ...note === undefined ? {} : { note },
                                        }]);
                                }, onRemoveReference: (id) => {
                                    markTouched();
                                    setReferences((current) => current.filter((item) => item.id !== id));
                                }, params: params, onParamChange: (key, value) => {
                                    markTouched();
                                    setParams((current) => ({ ...current, [key]: value }));
                                }, parameters: parameters, extra: extra, onExtraChange: (name, value) => {
                                    markTouched();
                                    setExtra((current) => ({ ...current, [name]: value }));
                                }, ...referenceDeclaredMax <= refLimit ? {} : { referenceDeclaredMax }, ...overriddenFields.length === 0 ? {} : { overriddenFields }, onNotice: (text, kind) => { notify(text, kind ?? 'ok'); }, model: model, running: run.kind === 'running', notConfigured: notConfigured, onGenerate: () => { void generate(); }, onCancel: cancel, onOpenModelPicker: openConfig, onOpenConfig: openConfig, lastSeconds: history[0]?.seconds, outputFormat: config?.outputFormat })] }), (0, jsx_runtime_1.jsx)(ResultStage_tsx_1.ResultStage, { run: run, preview: preview, elapsedSec: elapsedSec, onCancel: cancel, onRetry: () => { void generate(); }, onViewLog: () => { setLogOpen(true); }, onSave: () => { void saveCurrent(); }, onSaveAs: saveAsCurrent, onCopy: () => { void copyCurrent(); }, onOpen: () => { if (preview !== undefined)
                            void openImage(preview); }, onRegenerate: () => { void generate(); }, history: history, onSelectHistory: applyHistoryImage, ...config?.model === undefined ? {} : { currentModel: config.model }, onHistoryContextMenu: (image, position) => { setHistoryMenu({ image, x: position.x, y: position.y }); }, onClearHistory: () => {
                            setHistory([]);
                            setPreviewId(undefined);
                            notify('历史已清空（仅本次会话）');
                        }, ...toast === undefined ? {} : { notice: toast } })] }), configOpen && config !== undefined && ((0, jsx_runtime_1.jsx)(ConfigModal_tsx_1.ConfigModal, { config: config, models: models, pulling: pulling, ...modelCaps === undefined ? {} : { capabilities: modelCaps }, onPullModels: () => { void pullModels(); }, onSave: (next, plainKey) => { void saveConfig(next, plainKey); }, onClose: () => { setConfigOpen(false); } })), historyMenu !== undefined && ((0, jsx_runtime_1.jsx)(ResultStage_tsx_1.HistoryMenu, { image: historyMenu.image, x: historyMenu.x, y: historyMenu.y, busy: menuBusy, alreadyReference: references.some((item) => item.sourceId === historyMenu.image.id), atLimit: references.length >= refLimit, onUseAsReference: () => { void useAsReference(historyMenu.image); }, onOpen: () => {
                    const image = historyMenu.image;
                    setHistoryMenu(undefined);
                    void openImage(image);
                }, onSaveToWorkspace: () => {
                    const image = historyMenu.image;
                    setHistoryMenu(undefined);
                    void saveImageToWorkspace(image);
                }, onCopy: () => {
                    const image = historyMenu.image;
                    setHistoryMenu(undefined);
                    void copyImage(image);
                }, onClose: () => { setHistoryMenu(undefined); } })), logOpen && ((0, jsx_runtime_1.jsx)(LogViewer_tsx_1.LogViewer, { backend: backend, onClose: () => { setLogOpen(false); } }))] }));
}

			},
			"src/client/Composer.tsx": function (module, exports, require) {
			"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REFERENCES_TOTAL_CHARS = exports.MAX_REFERENCE_BYTES = exports.MAX_REFERENCE_EDGE = exports.GLOBAL_MAX_REFERENCES = exports.MAX_REFERENCES = void 0;
exports.referenceLimit = referenceLimit;
exports.referencesRequired = referencesRequired;
exports.prepareReference = prepareReference;
exports.readAsDataUrl = readAsDataUrl;
exports.Composer = Composer;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
/**
 * 左栏输入区：提示词 + 参考图 + 参数 + 生成。
 *
 * 设计要点（都来自已批准的原型）：
 *   - 参数候选值**由所选模型的能力驱动**，不是硬编码 —— 见 ModelOption.options；
 *     切到不支持参考图的模型时，参考图槽要禁用而不是静默忽略。
 *   - 生成中时主按钮换成「取消」，且提示词与参数保持可读（用户要能看着改）。
 *   - 参考图只接受图片；超过上限直接拒绝并提示，不静默丢弃。
 */
const react_1 = require("react");
const icons_tsx_1 = __dshRequire("src/client/icons.tsx");
const panel_module_css_1 = __importDefault(__dshRequire("src/client/panel.module.css"));
/**
 * 参考图上限的**兜底值**（拿不到模型能力时用）。
 *
 * 它**不是**上游规则：实测 59 个模型的上限从 1 到 20 都有，其中 17 个只允许 1 张。
 * 真实上限一律用 {@link referenceLimit} 从所选模型的 `input_references.max` 取。
 */
exports.MAX_REFERENCES = 4;
/**
 * `input_references` 的**网关全局上限**（官方 OpenAPI `maxItems: 16`）。
 *
 * 为什么必须单独记这一条：模型自己的能力表会报出比它更大的数 ——
 * 实测 `tencent/hy-image-v3.5-preview` 声明 `max: 20`。模型级枚举**网关不校验**，
 * 但**全局 `maxItems` 是校验的**（400 ZodError）。所以真正能发的张数是
 * `min(模型上限, 16)`，多出来的那张会让整次请求失败（全有或全无计费，
 * 不给钱但白等一次）。
 */
exports.GLOBAL_MAX_REFERENCES = 16;
/**
 * 该模型允许的参考图张数上限。
 * @param model - 所选模型（还没拉到时为 undefined）。
 * @returns 真实上限（已按全局 `maxItems: 16` 收敛）；模型信息缺失时退回 {@link MAX_REFERENCES}。
 */
function referenceLimit(model) {
    const max = model?.references?.max ?? 0;
    if (max <= 0)
        return exports.MAX_REFERENCES;
    return Math.min(max, exports.GLOBAL_MAX_REFERENCES);
}
/**
 * 该模型是否**必须**给参考图。
 *
 * `input_references.min >= 1` 的模型是「改图专用」（实测 5 个：`ming-image-0.1-design-layer`
 * 必须 1 张、`recraft-v4-styles` 四兄弟必须 ≥1）。不给底图就提交，上游必拒 ——
 * 这种错在本地拦住比让用户看 502 好。
 * @param model - 所选模型。
 * @returns 是否必填。
 */
function referencesRequired(model) {
    return (model?.references?.min ?? 0) >= 1;
}
/**
 * 参考图下采样的长边上限。
 *
 * 2048 的依据：它不是拍脑袋定的 —— 上游多数模型的分辨率档位到 2K/4K，
 * 但参考图只是「引导」，2048 长边足够保住构图与风格；而 base64 会让体积膨胀 4/3，
 * 一张 4096px 的 PNG 动辄 10 MB 以上，四张就是几十 MB，直接 413。
 */
exports.MAX_REFERENCE_EDGE = 2048;
/** 单张参考图重编码后的体积上限（data URL 字符数）；超过就再压一档。 */
exports.MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
/**
 * 参考图的**总量**预算（data URL 字符数）。
 *
 * 为什么要有总量这一道：宿主 `/generate` 的请求体上限是 **32 MB**
 * （`src/index.ts` 的 `GENERATE_BODY_BYTES`），超限时 `readJsonBody()` 只能回一句
 * 「请求体不是合法 JSON，或超过了大小上限」—— 那个提示和真实原因对不上号，
 * 用户会去查 JSON 而不是查图片大小。而且单张上限卡不住总量：一张 4 MB × 16 张
 * 就是 64 MB，照样超。所以这里按总量算：**20 M 字符 ≈ 20 MB**，留足 JSON 包装、
 * 提示词与 base64 膨胀（4/3）的余量。
 */
exports.MAX_REFERENCES_TOTAL_CHARS = 20 * 1024 * 1024;
/**
 * 把一张图准备成可用的参考图：必要时下采样。
 *
 * 三条纪律：
 *  1. **失败即原样返回** —— 缩图是个优化，绝不能因为它把用户的图弄丢或弄坏。
 *     浏览器不支持 `createImageBitmap`、canvas 被污染、解码失败…一律退回原图。
 *  2. **不改格式语义**：PNG 保持 PNG（可能有透明通道），其余转 JPEG。
 *  3. **只在真的超限时才动**：小于上限的图一个字节都不改。
 * @param blob - 用户选的文件或从宿主取回的历史图。
 * @param budgetChars - 本轮还能用多少字符（总预算减去已有的参考图）。
 * @returns data URL + 说明 + 体积。
 */
async function prepareReference(blob, budgetChars = exports.MAX_REFERENCES_TOTAL_CHARS) {
    const original = await readAsDataUrl(blob);
    // 本轮真正的上限：单张上限与「剩余总预算」取小。给一个下限，免得预算耗尽时
    // 被无限压到看不清。
    const cap = Math.max(256 * 1024, Math.min(exports.MAX_REFERENCE_BYTES, budgetChars));
    // `createImageBitmap` 在部分内核/安全上下文里不可用 —— 那条路直接原样返回。
    if (typeof createImageBitmap !== 'function')
        return { dataUrl: original, note: '', chars: original.length };
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
        const longEdge = Math.max(bitmap.width, bitmap.height);
        // 本来就在上限内：一个字节都不改。
        if (longEdge <= exports.MAX_REFERENCE_EDGE && original.length <= cap) {
            return { dataUrl: original, note: '', chars: original.length };
        }
        const keepPng = blob.type === 'image/png';
        // 逐档试，取第一个装得下的。PNG 的 quality 参数会被忽略，所以只能缩边。
        const plans = keepPng
            ? [{ edge: 2048, quality: 1 }, { edge: 1440, quality: 1 }, { edge: 1024, quality: 1 }]
            : [{ edge: 2048, quality: 0.92 }, { edge: 2048, quality: 0.78 }, { edge: 1440, quality: 0.7 }, { edge: 1024, quality: 0.62 }];
        let best = '';
        let bestEdge = longEdge;
        let width = bitmap.width;
        let height = bitmap.height;
        for (const plan of plans) {
            const edge = Math.min(plan.edge, longEdge);
            const scale = edge / longEdge;
            width = Math.max(1, Math.round(bitmap.width * scale));
            height = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (context === null)
                return { dataUrl: original, note: '', chars: original.length };
            context.drawImage(bitmap, 0, 0, width, height);
            const out = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', plan.quality);
            if (!out.startsWith('data:image/'))
                return { dataUrl: original, note: '', chars: original.length };
            best = out;
            bestEdge = edge;
            if (out.length <= cap)
                break;
        }
        if (best === '')
            return { dataUrl: original, note: '', chars: original.length };
        const shrink = longEdge > bestEdge ? `${bitmap.width}×${bitmap.height} → ${width}×${height}` : '已压缩';
        return { dataUrl: best, note: `已自动缩小（${shrink}）`, chars: best.length };
    }
    catch {
        // 解码/编码任何一步失败都退回原图 —— 宁可让上游报 413，也不能丢用户的图。
        return { dataUrl: original, note: '', chars: original.length };
    }
    finally {
        bitmap?.close();
    }
}
/**
 * 有专属状态槽的四个字段。
 *
 * `aspect_ratio` / `resolution` / `n` / `quality` 从阶段 4 起就是 `GenerateRequest`
 * 的一等字段（宿主、适配层、自检都按它们写），所以模型驱动表单里遇到这四个
 * 仍然写回老槽位；其余字段（`background` / `seed` / `size` / `output_format` /
 * `output_compression` / `stream`）走 `extra`。
 * 这样界面可以整个换掉，线上协议一个字都不用动。
 */
const CORE_SLOTS = {
    aspect_ratio: 'aspectRatio',
    resolution: 'resolution',
    n: 'count',
    quality: 'quality',
};
/**
 * 没有能力表时（OpenAI / Gemini / 自定义协议，或老宿主）展示的固定四项。
 *
 * 候选值取**官方全局枚举**，而不是留一个「只有一个选项」的死下拉 ——
 * 这是改版前最难看的地方：50/59 个模型的「质量」下拉里只有当前值一项，
 * 点了等于没点。协议没有能力表这件事本身由配置弹层如实说明，
 * 这里至少给用户一个能选的集合。
 */
const LEGACY_FIELDS = [
    {
        name: 'aspect_ratio', label: '比例', control: 'select', valueType: 'string', group: 'output',
        values: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', 'auto'],
        clearable: false, default: '1:1', hint: '该协议没有能力表，这里是官方全局枚举。',
    },
    {
        name: 'resolution', label: '分辨率', control: 'select', valueType: 'string', group: 'output',
        values: ['512', '768', '1K', '1.5K', '2K', '4K'],
        clearable: false, default: '1K', hint: '该协议没有能力表，这里是官方全局枚举。',
    },
    {
        name: 'n', label: '张数', control: 'count', valueType: 'integer', group: 'output',
        values: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], min: 1, max: 10,
        clearable: false, default: '1', hint: '该协议没有能力表，这里是官方全局区间 1–10。',
    },
    {
        name: 'quality', label: '质量', control: 'select', valueType: 'string', group: 'output',
        values: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
        clearable: false, default: 'auto', hint: '该协议没有能力表，这里是官方全局枚举。',
    },
];
/** 把字符数说成人话（参考图预算用）。 */
function formatChars(chars) {
    const mb = chars / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(chars / 1024)} KB`;
}
/**
 * 把一个 Blob/File 读成 data URL。浏览器 FileReader，纯本地、不打网络。
 *
 * 导出是因为「历史图右键 → 作为参考图」也要用：那条路拿到的是一个从宿主取回的
 * Blob，不是用户选的文件。
 */
function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { resolve(String(reader.result)); };
        reader.onerror = () => { reject(reader.error ?? new Error('读取文件失败')); };
        reader.readAsDataURL(blob);
    });
}
/** 一个下拉参数（`enum` 与「张数」共用）。 */
function SelectField(props) {
    // 当前值不在候选里时**把它临时插到最前面**：直接用 `<select value>` 指向一个
    // 不存在的 option，浏览器会显示成空白 —— 那看起来像坏了。插进去至少让用户
    // 知道现在是什么值，而收敛逻辑会在能力回来时把它换成合法值。
    const values = props.values.includes(props.value) || props.value === ''
        ? props.values
        : [props.value, ...props.values];
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramLabel, title: props.hint, children: props.label }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.select, children: [(0, jsx_runtime_1.jsx)("select", { value: props.value, onChange: (event) => { props.onChange(event.target.value); }, children: values.map((value) => (0, jsx_runtime_1.jsx)("option", { value: value, children: value }, value)) }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.chev, children: (0, jsx_runtime_1.jsx)(icons_tsx_1.ChevronIcon, {}) })] })] }));
}
/**
 * 一个数值/文本参数。
 *
 * `clearable`（`seed` / `size` / `output_compression`）留空 = **不发这个字段**，
 * 所以 placeholder 要说清「留空会怎样」—— 尤其 `seed`：填死会让每次出图都一样。
 */
function NumberField(props) {
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramLabel, title: props.hint, children: props.label }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.input, children: (0, jsx_runtime_1.jsx)("input", { className: panel_module_css_1.default.mono, spellCheck: false, inputMode: props.numeric ? 'numeric' : 'text', placeholder: props.placeholder ?? (props.numeric ? '留空 = 不发送' : '留空 = 不发送'), value: props.value, onChange: (event) => { props.onChange(event.target.value); } }) }), (props.min !== undefined || props.max !== undefined) && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.paramRange, children: ["\u5141\u8BB8 ", props.min ?? '?', " \u2013 ", props.max ?? '?'] }))] }));
}
/** 一个开关参数（目前只有 `stream`）。 */
function ToggleField(props) {
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramLabel, title: props.hint, children: props.label }), (0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.toggle, type: "button", role: "switch", "aria-checked": props.value, "aria-label": props.label, onClick: () => { props.onChange(!props.value); }, children: [(0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.toggleKnob }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.toggleText, children: props.value ? '开' : '关' })] })] }));
}
/** 左栏输入区。 */
function Composer(props) {
    const fileInput = (0, react_1.useRef)(null);
    const model = props.model;
    const canReference = !props.notConfigured && (model?.supportsReferences ?? false);
    const refLimit = referenceLimit(model);
    const refRequired = referencesRequired(model);
    /** 必填底图却没给 —— 生成会被宿主/上游拒，界面上先把原因说清楚。 */
    const missingRequired = refRequired && props.references.length < (model?.references?.min ?? 1);
    const atLimit = props.references.length >= refLimit;
    /**
     * 参考图的体积预算（data URL 字符数）。
     *
     * 参考图是随请求体 base64 发的，宿主 `/generate` 的请求体上限 32 MB —— 超了
     * 只会回一句「请求体不是合法 JSON，或超过了大小上限」，把用户引到错误的方向。
     * 所以在客户端就按总量卡住，并把用量显示出来（用户能自己判断该删哪张）。
     */
    const usedChars = props.references.reduce((sum, item) => sum + item.dataUrl.length, 0);
    const budgetLeft = Math.max(0, exports.MAX_REFERENCES_TOTAL_CHARS - usedChars);
    const overBudget = budgetLeft <= 0;
    /**
     * 参考图槽的状态文案。
     *
     * 分几种而不是两种 —— 「模型还没拉到」和「该模型就是不支持」是完全不同的两件事，
     * 混成一句会让用户以为模型选错了。「必填」还要单独说，否则用户不知道
     * 为什么生成按钮点不动。
     */
    const refHint = () => {
        if (props.notConfigured)
            return '配置后可上传';
        if (model === undefined)
            return '模型加载中…';
        if (!model.supportsReferences)
            return '当前模型不支持';
        const tally = `${props.references.length}/${refLimit}`;
        // 「模型声明了 20 张、接口只收 16 张」必须说出来，否则计数器显示 0/16
        // 会被当成「这个模型只有 16 张额度」，用户不知道为什么加不进第 17 张。
        const clamped = (props.referenceDeclaredMax ?? 0) > refLimit
            ? `（该模型声明 ${props.referenceDeclaredMax} 张，接口全局上限 ${refLimit} 张）`
            : '';
        // 有参考图时把体积用量一并显示 —— 它是「为什么加不进第 N 张」的一个真实原因。
        const size = props.references.length === 0
            ? ''
            : ` · ${formatChars(usedChars)}/${formatChars(exports.MAX_REFERENCES_TOTAL_CHARS)}`;
        if (refRequired)
            return `必填 · 至少 ${model.references?.min ?? 1} 张（${tally}）${size}${clamped}`;
        return `可多张 · 图生图（${tally}）${size}${clamped}`;
    };
    // 参数行**由所选模型的参数表驱动**：模型声明了什么就显示什么。
    // 拿不到能力表（非 OpenRouter 协议 / 老宿主）时退化成固定的四项。
    const fields = props.parameters ?? [];
    const dynamic = fields.length > 0;
    const shown = dynamic ? fields : LEGACY_FIELDS;
    const outputFields = shown.filter((field) => field.group === 'output');
    const advancedFields = shown.filter((field) => field.group === 'advanced');
    /** 该字段当前的取值（核心四项读老槽位，其余读 `extra`）。 */
    const valueOf = (field) => {
        const slot = CORE_SLOTS[field.name];
        if (slot !== undefined)
            return props.params[slot];
        return props.extra?.[field.name] ?? field.default;
    };
    /** 写回该字段（核心四项写老槽位，其余写 `extra`）。 */
    const setValue = (field, value) => {
        const slot = CORE_SLOTS[field.name];
        if (slot !== undefined)
            props.onParamChange(slot, value);
        else
            props.onExtraChange?.(field.name, value);
    };
    /**
     * 该模型**没声明**的核心参数 —— 它们不会出现在参数行里，也不会被发出去。
     *
     * 这一行是「诚实的补充说明」：用户从别的模型切过来时，会发现「分辨率」不见了，
     * 不说一句他会以为是界面坏了，而不是「这个模型本来就不支持」。
     */
    const hiddenCore = dynamic
        ? [['aspect_ratio', '比例'], ['resolution', '分辨率'], ['n', '张数'], ['quality', '质量']]
            .filter(([name]) => !fields.some((field) => field.name === name))
            .map(([, label]) => label)
        : [];
    /**
     * `background: transparent` 要求输出格式是 png / webp（官方口径）。
     *
     * 这是唯一一处**字段之间的约束**：单看两个下拉都合法，合起来是无效组合。
     * 上游不会 400（网关不校验模型级语义），只会把 transparent 悄悄忽略掉 ——
     * 用户以为拿到了透明底图，实际没有。所以必须在这里说。
     */
    const backgroundField = shown.find((field) => field.name === 'background');
    const formatField = shown.find((field) => field.name === 'output_format');
    const formatValue = formatField === undefined ? '' : valueOf(formatField);
    const transparentMismatch = backgroundField !== undefined && formatField !== undefined
        && valueOf(backgroundField) === 'transparent'
        && formatValue !== '' && formatValue !== 'png' && formatValue !== 'webp';
    /**
     * 配置里的输出格式与该模型不符。
     *
     * 只在**没有能力表**的那条路上才可能发生 —— 有参数表时「输出格式」就是参数行里的
     * 一行下拉，候选值来自该模型自己的枚举，用户根本选不出越界值。
     */
    const formatMismatch = !dynamic
        && props.outputFormat !== undefined
        && (model?.options.outputFormat?.length ?? 0) > 0
        && !model.options.outputFormat.includes(props.outputFormat);
    /**
     * 底部那行参数摘要。
     *
     * 从**实际显示的字段**拼，而不是硬写「张数 · 比例 · 分辨率」——
     * 对一个不声明分辨率的模型（36/59 个），写「分辨率 1K」是在编。
     */
    const summaryParts = shown
        .map((field) => ({ field, value: valueOf(field) }))
        .filter((item) => item.value !== '')
        .map((item) => `${item.field.label} ${item.value}`)
        .slice(0, 5);
    /** 留空语义各不相同的三个字段，placeholder 必须分开写。 */
    const placeholderOf = (field) => {
        if (field.name === 'seed')
            return '留空 = 每次随机';
        if (field.name === 'size')
            return '如 2K 或 2048x2048';
        if (field.name === 'output_compression')
            return '0–100，留空 = 上游默认';
        return '留空 = 不发送';
    };
    /** 按字段规格渲染一个控件。 */
    const renderField = (field) => {
        const value = valueOf(field);
        if (field.control === 'select' || field.control === 'count') {
            return ((0, jsx_runtime_1.jsx)(SelectField, { label: field.label, hint: field.hint, value: value, values: field.values ?? [], onChange: (next) => { setValue(field, next); } }, field.name));
        }
        if (field.control === 'toggle') {
            return ((0, jsx_runtime_1.jsx)(ToggleField, { label: field.label, hint: field.hint, value: value === 'true', onChange: (next) => { setValue(field, next ? 'true' : 'false'); } }, field.name));
        }
        return ((0, jsx_runtime_1.jsx)(NumberField, { label: field.label, hint: field.hint, value: value, ...field.min === undefined ? {} : { min: field.min }, ...field.max === undefined ? {} : { max: field.max }, numeric: field.valueType === 'integer', placeholder: placeholderOf(field), onChange: (next) => { setValue(field, next); } }, field.name));
    };
    const pickFile = async (file) => {
        if (file === undefined)
            return;
        if (!file.type.startsWith('image/')) {
            props.onNotice?.(`「${file.name}」不是图片文件`, 'err');
            return;
        }
        if (props.references.length >= refLimit) {
            props.onNotice?.(`参考图最多 ${refLimit} 张`, 'err');
            return;
        }
        if (budgetLeft <= 0) {
            props.onNotice?.(`参考图总预算已满（${formatChars(exports.MAX_REFERENCES_TOTAL_CHARS)}），先移除一张再加`, 'err');
            return;
        }
        // 参考图会随请求体 base64 发上去，原图太大会撞宿主的 32 MB 请求体上限 ——
        // 先按「剩余预算」下采样。`prepareReference()` 失败时原样返回，绝不丢用户的图。
        const prepared = await prepareReference(file, budgetLeft);
        if (prepared.chars > budgetLeft) {
            props.onNotice?.(`「${file.name}」压到最小仍有 ${formatChars(prepared.chars)}，`
                + `加上已有的会超过参考图总预算 ${formatChars(exports.MAX_REFERENCES_TOTAL_CHARS)}`, 'err');
            return;
        }
        props.onAddReference(file.name, prepared.dataUrl, prepared.note === '' ? undefined : prepared.note);
    };
    return ((0, jsx_runtime_1.jsxs)("section", { className: panel_module_css_1.default.composer, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.field, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.fieldLabel, children: ["\u63D0\u793A\u8BCD", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.hint, children: "Ctrl/\u2318 + Enter \u751F\u6210" })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.promptWrap, children: [(0, jsx_runtime_1.jsx)("textarea", { className: panel_module_css_1.default.prompt, spellCheck: false, value: props.prompt, readOnly: props.optimizing, placeholder: "\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u753B\u9762\uFF0C\u4F8B\u5982\uFF1A\u4E00\u53EA\u6234\u8033\u673A\u7684\u67F4\u72AC\u5750\u5728\u7A97\u8FB9\uFF0C\u5348\u540E\u9633\u5149\uFF0C\u80F6\u7247\u8D28\u611F\uFF0C\u666F\u6DF1\u6D45\u2026", onChange: (event) => { props.onPromptChange(event.target.value); }, onKeyDown: (event) => {
                                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !props.notConfigured) {
                                        event.preventDefault();
                                        props.onGenerate();
                                    }
                                } }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.promptTools, children: [(0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm} ${panel_module_css_1.default.btnGhost}`, type: "button", disabled: props.optimizing || props.prompt.trim() === '', title: props.prompt.trim() === ''
                                            ? '先写点内容再优化'
                                            : '用 prompt-forge 的「文生图优化」模板改写这段提示词（结果直接覆盖，可撤销）', onClick: props.onOptimize, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.SparkIcon, { size: 13 }), props.optimizing ? '优化中…' : '优化提示词'] }), props.canUndo && !props.optimizing && ((0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm} ${panel_module_css_1.default.btnGhost}`, type: "button", title: "\u8FD8\u539F\u6210\u4E0A\u4E00\u6B21\u7684\u8349\u7A3F\uFF08\u63D0\u793A\u8BCD\u4F18\u5316\u524D / \u70B9\u5386\u53F2\u8BB0\u5F55\u8986\u76D6\u524D\uFF09", onClick: props.onUndo, children: "\u64A4\u9500" })), (0, jsx_runtime_1.jsxs)("span", { className: panel_module_css_1.default.counter, children: [props.prompt.length, " / 4000"] })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.field, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.fieldLabel, children: ["\u53C2\u8003\u56FE", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.hint, children: refHint() })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.refGrid, children: [props.references.map((reference) => ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.refThumb, title: reference.note ?? reference.name, children: [(0, jsx_runtime_1.jsx)("img", { src: reference.dataUrl, alt: "", style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' } }), (0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.rm, type: "button", "aria-label": "\u79FB\u9664\u53C2\u8003\u56FE", onClick: () => { props.onRemoveReference(reference.id); }, children: "\u2715" }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.tag, children: reference.note === undefined ? '底图' : '已缩小' })] }, reference.id))), (0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.refAdd, type: "button", disabled: !canReference || atLimit || overBudget, title: props.notConfigured ? '配置生图服务后可上传参考图'
                                    : model === undefined ? '正在读取模型能力…'
                                        : !model.supportsReferences ? '当前模型不支持参考图'
                                            : overBudget ? `参考图总预算已满（${formatChars(exports.MAX_REFERENCES_TOTAL_CHARS)}），先移除一张`
                                                : atLimit ? `最多 ${refLimit} 张` : '添加参考图', onClick: () => { fileInput.current?.click(); }, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.PlusIcon, {}), (0, jsx_runtime_1.jsx)("span", { children: "\u6DFB\u52A0" })] }), (0, jsx_runtime_1.jsx)("input", { ref: fileInput, type: "file", accept: "image/*", multiple: true, style: { display: 'none' }, onChange: (event) => {
                                    const files = Array.from(event.target.files ?? []);
                                    event.target.value = '';
                                    for (const file of files)
                                        void pickFile(file);
                                } })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.field, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.fieldLabel, children: ["\u53C2\u6570", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.hint, children: dynamic ? `${model?.id ?? '所选模型'} 声明的字段（${shown.length} 项）` : '该协议没有能力表 · 官方全局枚举' })] }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.params, children: outputFields.map((field) => renderField(field)) }), advancedFields.length > 0 && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramGroup, children: "\u9AD8\u7EA7" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.params, children: advancedFields.map((field) => renderField(field)) })] })), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.paramsNote, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.InfoIcon, {}), dynamic
                                ? '参数行完全由所选模型声明的 supported_parameters 生成：它没声明的字段不显示、也绝不发送；取值超出该模型枚举时同样不发'
                                : '候选值为官方全局枚举；本协议没有模型能力表，参数能否生效由上游决定', hiddenCore.length > 0 && `。该模型不声明：${hiddenCore.join('、')}`] }), (props.overriddenFields?.length ?? 0) > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.paramsNoteWarn, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, { size: 12 }), "\u300C\u8FDE\u63A5\u914D\u7F6E \u2192 \u989D\u5916\u53C2\u6570\u300D\u91CC\u5199\u6B7B\u4E86 ", props.overriddenFields.join('、'), "\uFF0C\u5B83\u4F1A**\u8986\u76D6**\u9762\u677F\u4E0A\u9009\u7684\u503C \uFF08\u90A3\u6BB5 JSON \u6700\u540E\u5408\u5E76\u3001\u4F18\u5148\u7EA7\u6700\u9AD8\uFF09\u3002\u60F3\u8BA9\u9762\u677F\u8BF4\u4E86\u7B97\uFF0C\u5C31\u628A\u8FD9\u51E0\u4E2A\u952E\u4ECE\u90A3\u6BB5 JSON \u91CC\u5220\u6389\u3002"] })), transparentMismatch && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.paramsNoteWarn, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, { size: 12 }), "\u80CC\u666F\u9009\u4E86 transparent\uFF0C\u4F46\u8F93\u51FA\u683C\u5F0F\u662F ", formatValue, " \u2014\u2014 \u5B98\u65B9\u8981\u6C42 transparent \u642D\u914D png \u6216 webp\uFF0C\u5426\u5219\u4E0A\u6E38\u4F1A\u5FFD\u7565\u8FD9\u4E2A\u80CC\u666F\u8BBE\u7F6E"] })), formatMismatch && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.paramsNoteWarn, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, { size: 12 }), "\u914D\u7F6E\u91CC\u7684\u8F93\u51FA\u683C\u5F0F ", props.outputFormat ?? '', " \u4E0D\u5728\u8BE5\u6A21\u578B\u7684\u679A\u4E3E\u91CC\uFF0C\u672C\u6B21\u4E0D\u4F1A\u53D1\u9001\u8FD9\u4E2A\u5B57\u6BB5"] }))] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.actions, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modelRow, children: [(0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.chip, type: "button", onClick: props.onOpenModelPicker, title: "\u5207\u6362\u672C\u6B21\u4F7F\u7528\u7684\u6A21\u578B", children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.ListIcon, {}), "\u6A21\u578B ", (0, jsx_runtime_1.jsx)("b", { children: model?.id ?? '未选择' }), (0, jsx_runtime_1.jsx)(icons_tsx_1.ChevronIcon, {})] }), (0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.btn, type: "button", onClick: props.onOpenConfig, title: "\u534F\u8BAE / Base URL / API Key / \u9ED8\u8BA4\u6A21\u578B / \u81EA\u52A8\u4FDD\u5B58\u76EE\u5F55 / \u9AD8\u7EA7", children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.GearIcon, {}), "\u8FDE\u63A5\u914D\u7F6E"] })] }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.genRow, children: props.running
                            ? ((0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnLg}`, type: "button", onClick: props.onCancel, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.StopIcon, {}), "\u53D6\u6D88"] }))
                            : ((0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnPrimary} ${panel_module_css_1.default.btnLg}`, type: "button", disabled: props.notConfigured || props.prompt.trim() === '' || missingRequired, onClick: props.onGenerate, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.SparkIcon, {}), "\u751F\u6210"] })) }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.genMeta, children: [(0, jsx_runtime_1.jsx)("span", { children: summaryParts.length === 0 ? '无额外参数' : summaryParts.join(' · ') }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.dot, children: "\u2022" }), (0, jsx_runtime_1.jsx)("span", { children: props.lastSeconds === undefined ? '尚无记录' : `上次耗时 ${props.lastSeconds}s` }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.dot, children: "\u2022" }), (0, jsx_runtime_1.jsx)("span", { children: "\u5931\u8D25\u4E0D\u8BA1\u8D39" })] }), props.notConfigured && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.genMeta, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.CheckIcon, { size: 12 }), "\u914D\u597D\u751F\u56FE\u670D\u52A1\u540E\u5373\u53EF\u751F\u6210"] })), missingRequired && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.genMeta, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, { size: 12 }), "\u8BE5\u6A21\u578B\u662F\u6539\u56FE\u4E13\u7528\uFF1A\u81F3\u5C11\u8981\u6709 ", model?.references?.min ?? 1, " \u5F20\u53C2\u8003\u56FE\u624D\u80FD\u751F\u6210"] }))] })] }));
}

			},
			"src/client/ResultStage.tsx": function (module, exports, require) {
			"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultStage = ResultStage;
exports.HistoryFacts = HistoryFacts;
exports.HistoryStrip = HistoryStrip;
exports.HistoryMenu = HistoryMenu;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
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
const react_1 = require("react");
const art_tsx_1 = __dshRequire("src/client/art.tsx");
const icons_tsx_1 = __dshRequire("src/client/icons.tsx");
const labels_ts_1 = __dshRequire("src/client/labels.ts");
const panel_module_css_1 = __importDefault(__dshRequire("src/client/panel.module.css"));
/** 花费格式化：OpenRouter 的 usage.cost 是美元，位数不固定。 */
function formatCost(cost) {
    if (cost === undefined)
        return '—';
    return `$${cost.toFixed(4)}`;
}
/** 时间戳格式化为 `2026-10-09 21:14`。 */
function formatTime(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/**
 * 有真图就渲染真图，否则退回占位插画。
 *
 * `onError` 那条路是必要的：图挂在宿主路由上（`/dsh-imagegen/image/<id>`），
 * 那条路由要是没挂上（宿主半边没重启、文件被删），`<img>` 会显示成裂图 ——
 * 一个碎图标比一张占位插画糟糕得多。取不到就退回占位，并保留提示词等信息。
 */
function ImageOrArt(props) {
    const { image, variant } = props;
    const [failed, setFailed] = (0, react_1.useState)(false);
    if (image.imageUrl === undefined || failed)
        return (0, jsx_runtime_1.jsx)(art_tsx_1.Art, { artKey: image.art });
    return ((0, jsx_runtime_1.jsx)("img", { className: variant === 'stage' ? panel_module_css_1.default.realImage : panel_module_css_1.default.realThumb, src: image.imageUrl, alt: image.prompt, loading: "lazy", draggable: false, onError: () => { setFailed(true); } }));
}
/** 已出图的舞台内容。 */
function ArtStage(props) {
    const { image } = props;
    // 保持图片原始宽高比，并限制在舞台内 —— 用 aspect-ratio 而不是写死高度。
    const ratio = image.aspectRatio === 'auto' ? '1 / 1' : image.aspectRatio.replace(':', ' / ');
    return ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.artFrame, style: { width: 'min(100%, 720px)', aspectRatio: ratio }, 
        /*
         * 双击大图 = 用系统默认程序打开这张图的**本地原图**（老板 2026-10-18 需求）。
         *
         * 走的是结果条那颗「打开」按钮**同一个** `onOpen` —— 不另开一条路，
         * 免得两处行为分叉（比如哪天加了「只能打开已保存的图」的判定）。
         * `title` 必须写：双击是个隐藏手势，不说没人会去试。
         */
        onDoubleClick: props.onOpen, title: "\u53CC\u51FB\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u7A0B\u5E8F\u6253\u5F00\u539F\u56FE", children: [(0, jsx_runtime_1.jsx)(ImageOrArt, { image: image, variant: "stage" }), (0, jsx_runtime_1.jsxs)("span", { className: panel_module_css_1.default.costBadge, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.CoinIcon, {}), formatCost(image.cost), " ", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.ok, children: "\u00B7 \u5DF2\u8BA1\u8D39" })] }), (0, jsx_runtime_1.jsxs)("span", { className: panel_module_css_1.default.sizeBadge, children: [image.size === '' ? image.resolution : `${image.size} · ${image.resolution}`, image.count !== undefined && image.count > 1 ? ` · ${image.count} 张` : ''] })] }));
}
/**
 * 右栏结果区。
 *
 * `.result` 是三行网格（舞台 · 操作条 · 历史条）；历史条必须作为它的第三行渲染，
 * 否则 grid 的 `minmax(0,1fr)` 那一行就没有兄弟节点可以压缩，舞台高度会算错。
 */
function ResultStage(props) {
    const { run, preview } = props;
    /** 「复制报错」刚点过（给一秒反馈，省得用户怀疑没生效）。 */
    const [copied, setCopied] = (0, react_1.useState)(false);
    /**
     * 复制错误全文。
     *
     * 细节比「截图里那几行」重要得多：上游原话、code、我们实际发的参数都在里面，
     * 一键复制才能拿去搜或者贴给别人看。
     */
    const copyDetail = async () => {
        if (run.kind !== 'error')
            return;
        try {
            await navigator.clipboard.writeText(run.detail);
            setCopied(true);
            window.setTimeout(() => { setCopied(false); }, 1600);
        }
        catch {
            // 剪贴板被拒（某些环境需要用户手势）：文本就在屏幕上，可手动选中复制。
        }
    };
    return ((0, jsx_runtime_1.jsxs)("section", { className: panel_module_css_1.default.result, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.stage, children: [run.kind === 'running' && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.stageInner, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.spinner }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageTitle, children: "\u6B63\u5728\u751F\u6210\u2026" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageDesc, children: "\u51FA\u56FE\u901A\u5E38 30\u2013120 \u79D2\uFF0C\u53EF\u4EE5\u53D6\u6D88\u3002" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.progressWrap, children: (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.progressTrack, children: (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.progressBar }) }) }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.elapsed, children: ["\u5DF2\u7528\u65F6 ", props.elapsedSec, "s"] }), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onCancel, children: "\u53D6\u6D88\u751F\u6210" })] })), run.kind === 'error' && (
                    /*
                      错误态必须能滚。
                      `.stage` 是 `overflow: hidden`（出图时靠它裁掉溢出的缩放），而错误详情
                      一长就正好超出舞台高度 —— 以前的下半截直接被裁掉，且没有任何滚动条，
                      用户看到的就是「报错看不全」。这里换成可滚动布局，长文本自己滚。
                    */
                    (0, jsx_runtime_1.jsxs)("div", { className: `${panel_module_css_1.default.stageInner} ${panel_module_css_1.default.stageInnerErr}`, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.errGlyph, children: (0, jsx_runtime_1.jsx)(icons_tsx_1.ErrorGlyphIcon, {}) }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageTitle, children: "\u751F\u6210\u5931\u8D25" }), (0, jsx_runtime_1.jsx)("div", { className: `${panel_module_css_1.default.errCard} ${panel_module_css_1.default.errCardWide}`, children: run.detail }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageDesc, children: "\u672C\u6B21\u672A\u8BA1\u8D39\u3002\u68C0\u67E5\u989D\u5EA6\u540E\u53EF\u76F4\u63A5\u91CD\u8BD5\uFF0C\u63D0\u793A\u8BCD\u4E0E\u53C2\u6570\u5DF2\u4FDD\u7559\u3002" }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.genRow, style: { justifyContent: 'center' }, children: [(0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.btn, type: "button", onClick: props.onViewLog, children: "\u67E5\u770B\u65E5\u5FD7" }), (0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.btn, type: "button", onClick: () => { void copyDetail(); }, children: copied ? '已复制' : '复制报错' }), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnPrimary}`, type: "button", onClick: props.onRetry, children: "\u91CD\u8BD5" })] })] })), (run.kind === 'idle' || run.kind === 'done') && (preview === undefined
                        ? ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.stageInner, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.emptyGlyph, children: (0, jsx_runtime_1.jsx)(icons_tsx_1.EmptyGlyphIcon, {}) }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageTitle, children: "\u8FD8\u6CA1\u6709\u56FE\u7247" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageDesc, children: "\u5728\u5DE6\u4FA7\u586B\u5199\u63D0\u793A\u8BCD\uFF0C\u9700\u8981\u65F6\u52A0\u4E00\u5F20\u53C2\u8003\u56FE\uFF0C\u7136\u540E\u6309\u300C\u751F\u6210\u300D\u3002\u51FA\u56FE\u540E\u53EF\u5728\u9762\u677F\u5185\u9884\u89C8\u3001\u4FDD\u5B58\uFF0C\u5E76\u4FDD\u7559\u5728\u4E0B\u65B9\u5386\u53F2\u91CC\u3002" })] }))
                        : (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.stageInner, children: (0, jsx_runtime_1.jsx)(ArtStage, { image: preview, onOpen: props.onOpen }) }))] }), preview !== undefined && (run.kind === 'idle' || run.kind === 'done') && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.resultBar, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.resultInfo, children: [(0, jsx_runtime_1.jsxs)("span", { className: panel_module_css_1.default.savedTag, title: preview.autoSavedPath ?? preview.savedPath ?? '', children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.CheckIcon, {}), preview.autoSavedPath !== undefined
                                        ? `已自动保存到 ${preview.autoSavedPath}`
                                        : preview.savedPath !== undefined
                                            ? `已存到插件目录 ${preview.savedPath}`
                                            : '未保存'] }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.spacer }), (0, jsx_runtime_1.jsxs)("span", { className: panel_module_css_1.default.resultMeta, children: [formatTime(preview.createdAt), " \u00B7 ", preview.aspectRatio, " \u00B7 ", preview.resolution, " \u00B7 ", preview.seconds, "s"] })] }), (0, jsx_runtime_1.jsx)(HistoryFacts, { image: preview, ...props.currentModel === undefined ? {} : { currentModel: props.currentModel } }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.resultActions, children: [(0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onSave, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.SaveIcon, {}), "\u4FDD\u5B58"] }), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onSaveAs, children: "\u53E6\u5B58\u4E3A\u2026" }), (0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onCopy, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.CopyIcon, {}), "\u590D\u5236"] }), (0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onOpen, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.OpenIcon, {}), "\u6253\u5F00"] }), (0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onRegenerate, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.RetryIcon, {}), "\u91CD\u65B0\u751F\u6210"] })] })] })), (0, jsx_runtime_1.jsx)(HistoryStrip, { items: props.history, selectedId: preview?.id, onSelect: props.onSelectHistory, onClear: props.onClearHistory, ...props.notice === undefined ? {} : { notice: props.notice }, ...props.onHistoryContextMenu === undefined ? {} : { onContextMenu: props.onHistoryContextMenu } })] }));
}
/**
 * 取出一张图的参数列表。
 *
 * 优先用 `sentFields`（真正发给上游的字段）—— 面板值可能被配置里那段「额外参数」
 * JSON 覆盖过，显示面板值等于骗人。老记录没有它时退回面板快照，并在 tooltip 里说明。
 * @param image - 任意一张图。
 * @returns 参数列表与它的来源。
 */
function factsOf(image) {
    const sent = (0, labels_ts_1.factListOf)(image.sentFields);
    if (sent.length > 0)
        return { facts: sent, source: 'sent' };
    const snapshot = image.params;
    if (snapshot === undefined)
        return { facts: [], source: 'none' };
    const synthetic = { ...snapshot.extra };
    if (snapshot.aspectRatio !== '')
        synthetic['aspect_ratio'] = snapshot.aspectRatio;
    if (snapshot.resolution !== '')
        synthetic['resolution'] = snapshot.resolution;
    if (snapshot.quality !== '')
        synthetic['quality'] = snapshot.quality;
    synthetic['n'] = String(snapshot.count);
    return { facts: (0, labels_ts_1.factListOf)(synthetic), source: 'panel' };
}
/** 一行里先显示几条参数，剩下的折成 `+N`（老板特意提过「注意长度和显示问题」）。 */
const FACTS_VISIBLE = 4;
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
function HistoryFacts(props) {
    const [expanded, setExpanded] = (0, react_1.useState)(false);
    const { image } = props;
    const { facts, source } = factsOf(image);
    const list = image.referenceCount !== undefined && image.referenceCount > 0
        ? [...facts, { name: 'input_references', label: '参考图', value: `${image.referenceCount} 张` }]
        : facts;
    const model = image.model ?? '';
    const differs = model !== '' && props.currentModel !== undefined && props.currentModel !== ''
        && model !== props.currentModel;
    const shown = expanded ? list : list.slice(0, FACTS_VISIBLE);
    const rest = list.length - shown.length;
    const modelTitle = model === ''
        ? '这张图生成时没有记录模型（升级前的记录）'
        : differs
            ? `生成这张图用的是 ${model}；设置区当前选中的是 ${props.currentModel}（点历史记录不会改设置区的模型）`
            : `生成这张图用的是 ${model}`;
    const paramsTitle = list.length === 0
        ? '这张图生成于升级前，没有记录参数'
        : `${list.map(labels_ts_1.factTextOf).join(' · ')}${source === 'panel' ? '（这张没记录实发字段，显示的是当时面板上的值）' : ''}`;
    return ((0, jsx_runtime_1.jsxs)("div", { className: expanded ? `${panel_module_css_1.default.facts} ${panel_module_css_1.default.factsExpanded}` : panel_module_css_1.default.facts, children: [(0, jsx_runtime_1.jsx)("span", { className: differs ? `${panel_module_css_1.default.factModel} ${panel_module_css_1.default.factModelDiff}` : panel_module_css_1.default.factModel, title: modelTitle, children: model === '' ? '模型未记录' : `模型 ${model}` }), differs && (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.factDiffTag, title: modelTitle, children: "\u4E0E\u8BBE\u7F6E\u533A\u4E0D\u540C" }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.factParams, title: paramsTitle, children: list.length === 0 ? '参数未记录' : shown.map(labels_ts_1.factTextOf).join(' · ') }), rest > 0 && ((0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.factMore, type: "button", title: paramsTitle, onClick: () => { setExpanded(true); }, children: ["+", rest] })), expanded && list.length > FACTS_VISIBLE && ((0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.factMore, type: "button", onClick: () => { setExpanded(false); }, children: "\u6536\u8D77" }))] }));
}
/** 底部历史条。 */
function HistoryStrip(props) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.history, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.historyHead, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.ClockIcon, {}), "\u5386\u53F2\u8BB0\u5F55", (0, jsx_runtime_1.jsxs)("span", { children: ["\u6700\u8FD1 ", props.items.length, " \u5F20"] }), props.notice !== undefined && ((0, jsx_runtime_1.jsxs)("span", { className: props.notice.kind === 'err' ? `${panel_module_css_1.default.notice} ${panel_module_css_1.default.noticeErr}` : panel_module_css_1.default.notice, title: props.notice.text, role: "status", children: [props.notice.kind === 'err' && (0, jsx_runtime_1.jsx)(icons_tsx_1.WarnIcon, { size: 12 }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.noticeText, children: props.notice.text })] })), (0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.clear, type: "button", onClick: props.onClear, children: "\u6E05\u7A7A" })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.historyStrip, children: [props.items.length === 0 && ((0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.stageDesc, children: "\u8FD8\u6CA1\u6709\u5386\u53F2\u8BB0\u5F55\u3002" })), props.items.map((item) => ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: panel_module_css_1.default.histItem, "aria-current": item.id === props.selectedId, title: `${formatTime(item.createdAt)} · ${formatCost(item.cost)}（右键更多操作）`, onClick: () => { props.onSelect(item); }, onContextMenu: (event) => {
                            if (props.onContextMenu === undefined)
                                return;
                            // 接管浏览器默认菜单：历史图的右键菜单是本插件的功能位。
                            event.preventDefault();
                            props.onContextMenu(item, { x: event.clientX, y: event.clientY });
                        }, children: [(0, jsx_runtime_1.jsx)(ImageOrArt, { image: item, variant: "thumb" }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.hcost, children: item.cost === undefined ? '—' : `$${item.cost.toFixed(4)}` })] }, item.id)))] })] }));
}
/** 菜单宽度（用于贴边收口）。 */
const MENU_WIDTH = 216;
/**
 * 历史图的右键菜单。
 *
 * 交互上的两个细节：
 *  1. 一层透明遮罩接管「点别处就关」——比在 document 上挂监听干净，也不会漏掉点击。
 *  2. 贴右/下边缘时把菜单往回收，别让它跑到屏幕外（历史条在最底部，这个很容易踩）。
 */
function HistoryMenu(props) {
    const hasViewport = typeof window !== 'undefined' && typeof window.innerWidth === 'number';
    const left = hasViewport ? Math.max(8, Math.min(props.x, window.innerWidth - MENU_WIDTH - 8)) : props.x;
    // 208 ≈ 四个菜单项（打开 / 作为参考图 / 保存到工作区 / 复制图片）+ 内边距的实高。
    const top = hasViewport ? Math.max(8, Math.min(props.y, window.innerHeight - 208)) : props.y;
    /** 「作为参考图」为什么点不了 —— 说清楚原因，而不是给个灰按钮。 */
    const referenceHint = props.alreadyReference
        ? '已经在参考图里了'
        : props.atLimit
            ? '参考图已满（最多 4 张）'
            : '把这张图作为图生图的底图';
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.ctxBackdrop, onClick: props.onClose, onContextMenu: (event) => { event.preventDefault(); props.onClose(); } }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.ctxMenu, style: { left, top }, role: "menu", "aria-label": "\u5386\u53F2\u56FE\u64CD\u4F5C", children: [(0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.ctxItem, type: "button", role: "menuitem", onClick: props.onOpen, children: ["\u6253\u5F00", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.ctxHint, children: "\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u7A0B\u5E8F\u6253\u5F00\u539F\u56FE" })] }), (0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.ctxItem, type: "button", role: "menuitem", disabled: props.busy || props.alreadyReference || props.atLimit, onClick: props.onUseAsReference, children: ["\u4F5C\u4E3A\u53C2\u8003\u56FE", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.ctxHint, children: referenceHint })] }), (0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.ctxItem, type: "button", role: "menuitem", disabled: props.busy, onClick: props.onSaveToWorkspace, children: ["\u4FDD\u5B58\u5230\u5DE5\u4F5C\u533A", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.ctxHint, children: "\u590D\u5236\u4E00\u4EFD\u5230\u300C\u81EA\u52A8\u4FDD\u5B58\u76EE\u5F55\u300D" })] }), (0, jsx_runtime_1.jsxs)("button", { className: panel_module_css_1.default.ctxItem, type: "button", role: "menuitem", disabled: props.busy, onClick: props.onCopy, children: ["\u590D\u5236\u56FE\u7247", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.ctxHint, children: "\u5199\u8FDB\u7CFB\u7EDF\u526A\u8D34\u677F" })] })] })] }));
}

			},
			"src/client/ConfigModal.tsx": function (module, exports, require) {
			"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigModal = ConfigModal;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
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
const react_1 = require("react");
const icons_tsx_1 = __dshRequire("src/client/icons.tsx");
const panel_module_css_1 = __importDefault(__dshRequire("src/client/panel.module.css"));
/** 协议显示名。 */
const PROTOCOL_LABELS = [
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'openai', label: 'OpenAI 兼容' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'custom', label: '自定义' },
];
/**
 * 各协议的接口形态提示 —— 用户最容易在这里搞错。
 *
 * 每条都写清「哪些参数它不吃」：只有 OpenRouter 有能力表，其余协议下面板不会
 * 假装知道模型支持什么，用户需要知道这一点。
 */
const PROTOCOL_HINTS = {
    openrouter: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: ["\u8D70 ", (0, jsx_runtime_1.jsx)("code", { children: "POST /images" }), "\uFF1B\u6A21\u578B\u4E0E\u53C2\u6570\u5019\u9009\u503C\u90FD\u4ECE\u5B83\u7684\u80FD\u529B\u8868\u6765\uFF08\u552F\u4E00\u6709\u80FD\u529B\u8868\u7684\u534F\u8BAE\uFF09\u3002"] }),
    openai: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: ["\u8D70 ", (0, jsx_runtime_1.jsx)("code", { children: "POST /images/generations" }), "\uFF1B\u6BD4\u4F8B\u4F1A\u6620\u5C04\u6210 ", (0, jsx_runtime_1.jsx)("code", { children: "size" }), "\u3002", (0, jsx_runtime_1.jsx)("b", { children: "\u56FE\u751F\u56FE\uFF08/images/edits\uFF09\u672C\u7248\u672A\u63A5" }), "\u3002"] }),
    gemini: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: ["\u8D70 ", (0, jsx_runtime_1.jsx)("code", { children: "models/<id>:generateContent" }), "\uFF1B", (0, jsx_runtime_1.jsx)("b", { children: "\u4E0D\u652F\u6301\u6BD4\u4F8B / \u5206\u8FA8\u7387 / \u8D28\u91CF" }), "\u8FD9\u51E0\u4E2A\u53C2\u6570\uFF08\u4F1A\u5982\u5B9E\u88C1\u6389\uFF09\u3002"] }),
    custom: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: ["\u53EA\u6309\u4F60\u586B\u7684 Base URL \u4E0E\u300C\u989D\u5916\u53C2\u6570\u300D\u900F\u4F20\u5230 ", (0, jsx_runtime_1.jsx)("code", { children: "POST /images" }), "\uFF0C\u4E0D\u505A\u5B57\u6BB5\u6539\u5199\uFF1B\u6CA1\u6709\u6A21\u578B\u80FD\u529B\u8868\uFF0C\u6A21\u578B id \u624B\u586B\u3002"] }),
};
/** 连接配置弹层。 */
function ConfigModal(props) {
    const [draft, setDraft] = (0, react_1.useState)(props.config);
    // 新输入的明文 Key。空串 = 不改动已有的 Key。
    const [plainKey, setPlainKey] = (0, react_1.useState)('');
    /** 刚复制过模板的 provider slug（按钮上给个反馈）。 */
    const [copiedSlug, setCopiedSlug] = (0, react_1.useState)(undefined);
    /**
     * 复制一份 `provider.options` 模板。
     *
     * 值一律留 `null`：各 provider 的参数语义不同（数值 / 布尔 / 对象都有），
     * 编一个「推荐值」比留空更危险 —— 用户会以为那是我们验证过的。
     */
    const copyProviderTemplate = async (slug, params) => {
        const skeleton = {};
        for (const param of params)
            skeleton[param] = null;
        try {
            await navigator.clipboard.writeText(JSON.stringify({ provider: { options: { [slug]: skeleton } } }));
            setCopiedSlug(slug);
            window.setTimeout(() => { setCopiedSlug(undefined); }, 2000);
        }
        catch {
            // 剪贴板被拒时静默：参数名就在旁边，用户可以手写。
        }
    };
    const patch = (values) => {
        setDraft((current) => ({ ...current, ...values }));
    };
    const selectedModel = props.models.find((model) => model.id === draft.model);
    /**
     * 该模型声明了 `output_format`、但不含当前配置值。
     *
     * 这是**必须提示**的一种状态：上游网关只校验全局枚举（png/jpeg/webp/svg 都放行），
     * 不看每个模型自己的枚举 —— 越界值会透传给 provider，要么被忽略、要么换回一次 502。
     * 我们的做法是不发这个字段（下游用它自己的默认），但要在界面上说清楚。
     */
    const formatMismatch = selectedModel !== undefined
        && (selectedModel.options.outputFormat?.length ?? 0) > 0
        && !selectedModel.options.outputFormat.includes(draft.outputFormat);
    return ((0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.overlay, role: "dialog", "aria-modal": "true", "aria-label": "\u8FDE\u63A5\u914D\u7F6E", children: (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modal, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.modalHead, children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { children: "\u8FDE\u63A5\u914D\u7F6E" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.sub, children: "\u914D\u7F6E\u5B58\u5728\u5BBF\u4E3B\u4FA7\uFF0CAPI Key \u4E0D\u4E0B\u53D1\u5230\u524D\u7AEF" })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modalBody, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formRow, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formKey, children: ["\u534F\u8BAE", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.req, children: "*" })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formCtl, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.seg, role: "group", "aria-label": "\u534F\u8BAE", children: PROTOCOL_LABELS.map((item) => ((0, jsx_runtime_1.jsx)("button", { type: "button", "aria-pressed": draft.protocol === item.value, onClick: () => { patch({ protocol: item.value }); }, children: item.label }, item.value))) }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.formTip, children: PROTOCOL_HINTS[draft.protocol] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formRow, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formKey, children: ["Base URL", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.req, children: "*" })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formCtl, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.input, children: (0, jsx_runtime_1.jsx)("input", { className: panel_module_css_1.default.mono, spellCheck: false, value: draft.baseUrl, onChange: (event) => { patch({ baseUrl: event.target.value }); } }) }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.formTip, children: "\u6362\u6210\u81EA\u5EFA\u7F51\u5173\u65F6\u53EA\u6539\u8FD9\u4E00\u5904\u3002" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formRow, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formKey, children: ["API Key", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.req, children: "*" })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formCtl, children: [draft.hasKey && plainKey === ''
                                            ? ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.keyOk, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.CheckIcon, {}), "\u5DF2\u914D\u7F6E", (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.badge, children: draft.keyHint }), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm} ${panel_module_css_1.default.btnGhost}`, type: "button", onClick: () => { patch({ hasKey: false }); }, children: "\u66F4\u6362" })] }))
                                            : ((0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.input, children: (0, jsx_runtime_1.jsx)("input", { className: panel_module_css_1.default.mono, type: "password", spellCheck: false, autoComplete: "off", placeholder: "sk-or-v1-\u2026", value: plainKey, onChange: (event) => { setPlainKey(event.target.value); } }) })), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formTip, children: ["\u660E\u6587\u53EA\u843D\u76D8\u5728\u5BBF\u4E3B ", (0, jsx_runtime_1.jsx)("code", { children: "~/.dsh/dsh-imagegen-panel/config.json" }), "\uFF0C\u4FDD\u5B58\u540E\u524D\u7AEF\u53EA\u770B\u5230\u300C\u5DF2\u914D\u7F6E\u300D\u3002"] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formRow, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.formKey, children: "\u9ED8\u8BA4\u6A21\u578B" }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formCtl, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.input, style: { flex: 1 }, children: (0, jsx_runtime_1.jsx)("input", { className: panel_module_css_1.default.mono, spellCheck: false, value: draft.model, onChange: (event) => { patch({ model: event.target.value }); } }) }), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", disabled: props.pulling, onClick: props.onPullModels, children: props.pulling ? '拉取中…' : '拉取模型列表' })] }), props.models.length > 0 && ((0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.modelList, children: props.models.map((model) => ((0, jsx_runtime_1.jsxs)("button", { type: "button", className: panel_module_css_1.default.modelItem, "aria-selected": model.id === draft.model, onClick: () => { patch({ model: model.id }); }, children: [(0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.id, children: model.id }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.caps, children: model.caps.map((cap) => (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.cap, children: cap }, cap)) }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.price, children: model.price })] }, model.id))) })), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formTip, children: ["\u9009\u4E2D\u6A21\u578B\u540E\u4F1A\u62C9 ", (0, jsx_runtime_1.jsx)("code", { children: "GET /images/models/<id>/endpoints" }), "\uFF0C\u7528\u8FD4\u56DE\u7684", ' ', (0, jsx_runtime_1.jsx)("code", { children: "supported_parameters" }), " \u751F\u6210\u5DE6\u4FA7\u300C\u6BD4\u4F8B / \u5206\u8FA8\u7387 / \u5F20\u6570 / \u8D28\u91CF / \u8F93\u51FA\u683C\u5F0F\u300D\u7684\u53EF\u9009\u9879\u3002", selectedModel !== undefined && !selectedModel.supportsReferences && ' 当前模型不支持参考图，左侧参考图槽会禁用。', selectedModel !== undefined && selectedModel.references.max > 0
                                                    && ` 参考图最多 ${selectedModel.references.max} 张${selectedModel.references.min > 0 ? '，且**必须**给底图（改图专用模型）' : ''}。`] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formRow, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.formKey, children: "\u81EA\u52A8\u4FDD\u5B58\u76EE\u5F55" }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formCtl, children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.input, children: (0, jsx_runtime_1.jsx)("input", { className: panel_module_css_1.default.mono, spellCheck: false, value: draft.autoSaveDir, onChange: (event) => { patch({ autoSaveDir: event.target.value }); } }) }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.formTip, children: "\u51FA\u56FE\u540E\u81EA\u52A8\u5199\u4E00\u4EFD\u5230\u8FD9\u91CC\uFF1B\u9762\u677F\u91CC\u7684\u300C\u4FDD\u5B58\u300D\u6309\u94AE\u53EF\u53E6\u5B58\u5230\u522B\u5904\u3002" })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.adv, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.advTitle, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.GearIcon, { size: 13 }), "\u9AD8\u7EA7", (0, jsx_runtime_1.jsx)("span", { children: "\u4E00\u822C\u4E0D\u7528\u6539" })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.advBody, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramLabel, children: "\u989D\u5916\u53C2\u6570\uFF08JSON\uFF0C\u539F\u6837\u5E76\u8FDB\u8BF7\u6C42\u4F53\uFF09" }), (0, jsx_runtime_1.jsx)("textarea", { className: panel_module_css_1.default.extraJson, spellCheck: false, value: draft.extraJson, onChange: (event) => { patch({ extraJson: event.target.value }); } }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formTip, children: ["\u60F3\u6307\u5B9A\u4E0A\u6E38\u901A\u9053\u6216\u900F\u4F20\u79C1\u6709\u53C2\u6570\u65F6\u7528\uFF0C\u4F8B\u5982 ", (0, jsx_runtime_1.jsx)("code", { children: '{"provider":{"sort":"price"}}' }), "\uFF1B\u7559\u7A7A\u5C31\u4E0D\u52A0\u3002"] }), props.capabilities !== undefined && props.capabilities.providerOptions.length > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formTip, children: ["\u5F53\u524D\u6A21\u578B\u5141\u8BB8\u900F\u4F20\u7684 provider \u79C1\u6709\u53C2\u6570\uFF08\u952E\u662F ", (0, jsx_runtime_1.jsx)("code", { children: "provider.options[slug]" }), "\uFF0C", (0, jsx_runtime_1.jsx)("b", { children: "slug \u5E26\u533A\u57DF\u540E\u7F00\u3001\u540C\u65CF\u8FD8\u4E0D\u4E00\u6837" }), "\uFF0C\u6240\u4EE5\u53EA\u80FD\u6309\u63A5\u53E3\u8FD4\u56DE\u503C\u586B \u2014\u2014 \u5B98\u65B9\u6587\u6863\u91CC\u5199\u6B7B\u7684\u90A3\u4E2A\u952E\u5BF9", (0, jsx_runtime_1.jsx)("code", { children: "flux.2-max" }), " \u8FD9\u7C7B\u6A21\u578B\u662F\u9519\u7684\uFF09\uFF1A", props.capabilities.providerOptions.map((option) => ((0, jsx_runtime_1.jsxs)("div", { style: { marginTop: 4 }, children: [(0, jsx_runtime_1.jsx)("code", { children: option.slug }), "\uFF08", option.name, "\uFF09\u2192 ", option.params.join('、'), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", style: { marginLeft: 8 }, onClick: () => { void copyProviderTemplate(option.slug, option.params); }, children: copiedSlug === option.slug ? '已复制' : '复制模板' })] }, option.slug)))] }))] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramLabel, children: "\u8D85\u65F6\uFF08\u79D2\uFF09" }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.input, children: (0, jsx_runtime_1.jsx)("input", { className: panel_module_css_1.default.mono, value: String(draft.timeoutSec), onChange: (event) => { patch({ timeoutSec: Number(event.target.value) || 0 }); } }) }), (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.formTip, children: "\u8D85\u8FC7\u5C31\u4E2D\u6B62\u5E76\u56DE 504\uFF1B\u6A21\u578B\u5F88\u6162\u65F6\u8C03\u5927\u3002" })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.paramLabel, children: "\u8F93\u51FA\u683C\u5F0F" }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.select, children: [(0, jsx_runtime_1.jsxs)("select", { value: draft.outputFormat, onChange: (event) => { patch({ outputFormat: event.target.value }); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "png", children: "png" }), (0, jsx_runtime_1.jsx)("option", { value: "jpeg", children: "jpeg" }), (0, jsx_runtime_1.jsx)("option", { value: "webp", children: "webp" }), (0, jsx_runtime_1.jsx)("option", { value: "svg", children: "svg" })] }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.chev, children: (0, jsx_runtime_1.jsx)(icons_tsx_1.ChevronIcon, {}) })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formTip, children: ["\u53EA\u5728\u6A21\u578B\u58F0\u660E\u652F\u6301\u65F6\u624D\u53D1\u3002\u4E0A\u6E38 6 \u4E2A\u77E2\u91CF\u5316\u6A21\u578B\uFF08", (0, jsx_runtime_1.jsx)("code", { children: "recraft/*-vector" }), "\uFF09\u53EA\u6536 ", (0, jsx_runtime_1.jsx)("code", { children: "svg" }), "\uFF0C \u9009\u5B83\u4EEC\u8981\u5728\u8FD9\u91CC\u5207\u8FC7\u6765\uFF1B", (0, jsx_runtime_1.jsx)("code", { children: "riverflow-v2.5-fast" }), " \u53EA\u6536 ", (0, jsx_runtime_1.jsx)("code", { children: "jpeg" }), "\u3002"] }), formatMismatch && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.formTip, children: ["\u26A0 \u5F53\u524D\u6A21\u578B\u53EA\u63A5\u53D7 ", (0, jsx_runtime_1.jsx)("code", { children: selectedModel.options.outputFormat.join(' / ') }), "\uFF0C \u4E0E\u914D\u7F6E\u7684 ", (0, jsx_runtime_1.jsx)("code", { children: draft.outputFormat }), " \u4E0D\u7B26 \u2014\u2014 \u751F\u6210\u65F6**\u4E0D\u4F1A\u53D1\u9001**\u8FD9\u4E2A\u5B57\u6BB5\uFF08\u4E0B\u6E38\u7528\u5B83\u7684\u9ED8\u8BA4\u683C\u5F0F\uFF09\u3002"] }))] })] })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modalFoot, children: [(0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.formTip, children: "Key \u53EA\u5B58\u5BBF\u4E3B\uFF0C\u524D\u7AEF\u6C38\u8FDC\u62FF\u4E0D\u5230\u660E\u6587\u3002" }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.spacer }), (0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.btn, type: "button", onClick: props.onClose, children: "\u53D6\u6D88" }), (0, jsx_runtime_1.jsx)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnPrimary}`, type: "button", onClick: () => { props.onSave(draft, plainKey); }, children: "\u4FDD\u5B58" })] })] }) }));
}

			},
			"src/client/LogViewer.tsx": function (module, exports, require) {
			"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogList = LogList;
exports.LogDrawer = LogDrawer;
exports.LogViewer = LogViewer;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
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
const react_1 = require("react");
const api_ts_1 = __dshRequire("src/client/api.ts");
const icons_tsx_1 = __dshRequire("src/client/icons.tsx");
const panel_module_css_1 = __importDefault(__dshRequire("src/client/panel.module.css"));
/**
 * 日志列表（纯展示，没有副作用）。
 * @param props - 见 {@link LogListProps}。
 */
function LogList(props) {
    if (props.entries.length === 0) {
        return ((0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.logEmpty, children: "\u5BBF\u4E3B\u8FD8\u6CA1\u6709\u5199\u8FC7\u4EFB\u4F55\u65E5\u5FD7\u3002\u751F\u6210\u4E00\u6B21\uFF08\u6210\u529F\u6216\u5931\u8D25\u90FD\u884C\uFF09\u4E4B\u540E\u518D\u70B9\u300C\u67E5\u770B\u65E5\u5FD7\u300D\u5C31\u6709\u5185\u5BB9\u4E86\u3002" }));
    }
    return ((0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.logList, children: props.entries.map((entry) => ((0, jsx_runtime_1.jsxs)("div", { className: entry.level === 'error'
                ? `${panel_module_css_1.default.logLine} ${panel_module_css_1.default.logErr}`
                : entry.level === 'warn' ? `${panel_module_css_1.default.logLine} ${panel_module_css_1.default.logWarn}` : panel_module_css_1.default.logLine, children: [(0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.logTime, children: entry.at }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.logText, children: entry.text })] }, entry.seq))) }));
}
/**
 * 抽屉外壳 + 操作条（纯展示）。
 * @param props - 见 {@link LogDrawerProps}。
 */
function LogDrawer(props) {
    const { state } = props;
    return ((0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.overlay, onClick: props.onClose, children: (0, jsx_runtime_1.jsxs)("div", { className: `${panel_module_css_1.default.modal} ${panel_module_css_1.default.logModal}`, role: "dialog", "aria-label": "\u5BBF\u4E3B\u65E5\u5FD7", onClick: (event) => { event.stopPropagation(); }, children: [(0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modalHead, children: [(0, jsx_runtime_1.jsx)("h2", { children: "\u5BBF\u4E3B\u65E5\u5FD7" }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.sub, children: "\u751F\u6210\u65F6\u5B9E\u9645\u53D1\u4E86\u4EC0\u4E48\u3001\u88C1\u6389\u4E86\u4EC0\u4E48\uFF0C\u90FD\u8BB0\u5728\u8FD9\u91CC" })] }), state.kind === 'ready' && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.logPath, title: state.data.file, children: [(0, jsx_runtime_1.jsxs)("span", { children: ["\u5185\u5B58 ", state.data.count, " \u6761 \u00B7 \u843D\u76D8\u6587\u4EF6"] }), (0, jsx_runtime_1.jsx)("code", { children: state.data.file })] })), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modalBody, children: [state.kind === 'loading' && (0, jsx_runtime_1.jsx)("div", { className: panel_module_css_1.default.logEmpty, children: "\u6B63\u5728\u8BFB\u53D6\u5BBF\u4E3B\u65E5\u5FD7\u2026" }), state.kind === 'error' && ((0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.logEmpty, children: ["\u8BFB\u53D6\u5931\u8D25\uFF1A", state.message, (0, jsx_runtime_1.jsx)("br", {}), "\uFF08\u5BBF\u4E3B\u534A\u8FB9\u6CA1\u52A0\u8F7D\u65F6\u4E5F\u4F1A\u8FD9\u6837 \u2014\u2014 \u9762\u677F\u9876\u90E8\u7684\u300C\u5BBF\u4E3B\u8DEF\u7531\u4E0D\u53EF\u7528\u300D\u4F1A\u540C\u65F6\u51FA\u73B0\uFF09"] })), state.kind === 'ready' && (0, jsx_runtime_1.jsx)(LogList, { entries: state.data.entries })] }), (0, jsx_runtime_1.jsxs)("div", { className: panel_module_css_1.default.modalFoot, children: [(0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onRefresh, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.RetryIcon, {}), "\u5237\u65B0"] }), (0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onCopy, disabled: !props.hasContent, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.CopyIcon, {}), props.copied ? '已复制' : '复制全部'] }), (0, jsx_runtime_1.jsxs)("button", { className: `${panel_module_css_1.default.btn} ${panel_module_css_1.default.btnSm}`, type: "button", onClick: props.onDownload, disabled: !props.hasContent, children: [(0, jsx_runtime_1.jsx)(icons_tsx_1.ClockIcon, {}), "\u4E0B\u8F7D"] }), (0, jsx_runtime_1.jsx)("span", { className: panel_module_css_1.default.spacer }), (0, jsx_runtime_1.jsx)("button", { className: panel_module_css_1.default.btn, type: "button", onClick: props.onClose, children: "\u5173\u95ED" })] })] }) }));
}
/** 一次取多少条：比宿主缓冲上限小一点，够看最近的几轮生成。 */
const LOG_LIMIT = 300;
/** 宿主日志抽屉（取数 + 交互）。 */
function LogViewer(props) {
    const { backend, onClose } = props;
    const [state, setState] = (0, react_1.useState)({ kind: 'loading' });
    const [copied, setCopied] = (0, react_1.useState)(false);
    /** 拉一次日志。 */
    const load = (0, react_1.useCallback)(async () => {
        setState({ kind: 'loading' });
        try {
            const data = await backend.fetchLogs(LOG_LIMIT);
            setState({ kind: 'ready', data });
        }
        catch (error) {
            setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
    }, [backend]);
    (0, react_1.useEffect)(() => { void load(); }, [load]);
    /**
     * 复制用的纯文本。
     *
     * 刻意**倒回时间正序**：贴给别人看时正序才读得下去，界面上倒序只是为了「最新在眼前」。
     */
    const asText = (0, react_1.useMemo)(() => {
        if (state.kind !== 'ready')
            return '';
        return state.data.entries
            .slice()
            .reverse()
            .map((entry) => `${entry.at} [${entry.level}] ${entry.text}`)
            .join('\n');
    }, [state]);
    const copyAll = (0, react_1.useCallback)(() => {
        if (asText === '')
            return;
        void navigator.clipboard.writeText(asText).then(() => {
            setCopied(true);
            window.setTimeout(() => { setCopied(false); }, 1600);
        }).catch(() => {
            // 剪贴板被拒不是致命错误：日志还在屏幕上，用户可以手动选。
        });
    }, [asText]);
    /** 下载整份日志（宿主用 `?format=text` 当附件回）。 */
    const download = (0, react_1.useCallback)(() => {
        const anchor = document.createElement('a');
        anchor.href = (0, api_ts_1.apiPath)('dsh-imagegen/logs?format=text');
        anchor.download = 'dsh-imagegen-host.log';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }, []);
    return ((0, jsx_runtime_1.jsx)(LogDrawer, { state: state, copied: copied, hasContent: asText !== '', onRefresh: () => { void load(); }, onCopy: copyAll, onDownload: download, onClose: onClose }));
}

			},
			"src/client/api.ts": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTES = exports.HostRouteError = void 0;
exports.apiPath = apiPath;
exports.toPanelConfig = toPanelConfig;
exports.toOutboundConfig = toOutboundConfig;
exports.toParameters = toParameters;
exports.toModelOptions = toModelOptions;
exports.toImage = toImage;
exports.toImageParams = toImageParams;
exports.toPanelDraft = toPanelDraft;
exports.toCapabilities = toCapabilities;
exports.toLogEntry = toLogEntry;
exports.createHttpBackend = createHttpBackend;
/**
 * 真后端：打宿主路由 `/dsh-imagegen/*`。
 *
 * 这是 {@link Backend} 的生产实现 —— UI 不认识它，只认识接口，所以接上它
 * 不需要改任何组件（这是阶段 2 就留好的缝）。`mock.ts` 已删除：留着两份实现
 * 迟早会出现「改了一边、界面看起来正常、其实没生效」。
 *
 * 三条纪律：
 *   1. **明文 Key 只出现在 PUT 的请求体里**，进去就没了 —— 读回来的配置里
 *      只有 `hasKey` / `keyHint`。前端任何地方都不缓存明文。
 *   2. **路径只在这一处拼**。宿主侧同一张表在 `src/index.ts` 的 `API` 里，
 *      `scripts/host-check.mjs` 会断言两边字面一致。
 *   3. **失败要能读懂**。宿主回 `{ ok: false, code, message }`，这里原样抛出
 *      那句 message —— 面板把它显示给用户，不做二次美化。
 */
const defaults_ts_1 = __dshRequire("src/client/defaults.ts");
const types_ts_1 = __dshRequire("src/client/types.ts");
/**
 * 宿主路由（相对路径，不带前导斜杠）。
 *
 * 与 `src/index.ts` 的 `API` 表一一对应。刻意写相对形式：DSH 可能被反代挂在
 * 前缀下（`https://host/app/dsh/`），根绝对路径会绕过前缀直接 404 ——
 * 这正是 `dshmarket` 踩过的坑（#345）。
 */
const ROUTES = {
    config: 'dsh-imagegen/config',
    models: 'dsh-imagegen/models',
    capabilities: 'dsh-imagegen/capabilities',
    history: 'dsh-imagegen/history',
    generate: 'dsh-imagegen/generate',
    save: 'dsh-imagegen/save',
    open: 'dsh-imagegen/open',
    logs: 'dsh-imagegen/logs',
    draft: 'dsh-imagegen/draft',
};
exports.ROUTES = ROUTES;
/** 请求头里的 JSON 类型。 */
const JSON_HEADERS = { 'content-type': 'application/json' };
/**
 * 把一个相对路由解析成当前页面挂载点下的绝对路径。
 *
 * 锚点是 `document.baseURI`（宿主实际服务 UI 的那个目录），不是 `location.pathname`
 * —— dsh 的 Web UI 不做路径路由，所以 `pathname` 不能当挂载点用。
 * @param route - {@link ROUTES} 里的相对路径。
 * @returns 可直接喂给 `fetch` 的路径。
 */
function apiPath(route) {
    const relative = route.replace(/^\/+/, '');
    if (typeof document === 'undefined')
        return `/${relative}`;
    const base = document.baseURI;
    if (typeof base !== 'string' || base === '')
        return `/${relative}`;
    try {
        return new URL(relative, base).pathname;
    }
    catch {
        return `/${relative}`;
    }
}
/** 可读的错误文本。 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 宿主路由返回的业务失败，附带机器可读的 code。 */
class HostRouteError extends Error {
    /** 宿主给的错误码，如 `bad-extra-json`。 */
    code;
    /** HTTP 状态码（网络层失败时为 0）。 */
    status;
    /**
     * 宿主附带的诊断行（`/generate` 失败时给）。
     *
     * 这是「看不全」的补丁：上游只说一句 `HTTP 400 …`，而这几行告诉用户
     * 「我们实际发了哪些字段、裁掉了什么、日志文件在哪」。
     */
    diagnostics;
    constructor(message, code, status, diagnostics = []) {
        super(message);
        this.name = 'HostRouteError';
        this.code = code;
        this.status = status;
        this.diagnostics = diagnostics;
    }
}
exports.HostRouteError = HostRouteError;
/**
 * 打一次宿主路由，返回 `ok: true` 的响应体。
 *
 * 网络层失败（宿主半边没挂上、路由 404、非 JSON 响应）统一抛
 * {@link HostRouteError}：调用方只需要处理一种错误形状。
 * @param route - 相对路由。
 * @param init - fetch 参数。
 * @returns 解析后的响应对象。
 */
async function callHost(route, init) {
    const path = apiPath(route);
    let response;
    try {
        response = await fetch(path, { headers: { accept: 'application/json' }, ...init });
    }
    catch (error) {
        throw new HostRouteError(`连不上宿主路由 ${path}：${messageOf(error)}`, 'network', 0);
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw new HostRouteError(`宿主路由 ${path} 返回了非 JSON（HTTP ${response.status}）—— 多半是路由没挂上，被 SPA 兜底处理了`, 'non-json', response.status);
    }
    if (typeof body !== 'object' || body === null) {
        throw new HostRouteError(`宿主路由 ${path} 返回了非对象响应`, 'bad-shape', response.status);
    }
    const record = body;
    if (record.ok !== true) {
        const message = typeof record.message === 'string' && record.message !== ''
            ? record.message
            : `宿主路由 ${path} 拒绝了请求（HTTP ${response.status}）`;
        const code = typeof record.code === 'string' ? record.code : 'unknown';
        const diagnostics = Array.isArray(record.diagnostics)
            ? record.diagnostics.filter((item) => typeof item === 'string')
            : [];
        throw new HostRouteError(message, code, response.status, diagnostics);
    }
    return record;
}
// -------------------------------------------------------------- 响应收敛
/** 取字符串字段，缺省时回退。 */
function asString(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
/** 协议取值守卫。 */
function isProtocol(value) {
    return value === 'openrouter' || value === 'openai' || value === 'gemini' || value === 'custom';
}
/** 输出格式取值守卫。`svg` 是上游矢量化模型唯一接受的格式。 */
function isOutputFormat(value) {
    return value === 'png' || value === 'jpeg' || value === 'webp' || value === 'svg';
}
/** 张数区间（缺省 0/0 = 不支持参考图）。 */
function toReferenceRange(raw) {
    const source = (typeof raw === 'object' && raw !== null ? raw : {});
    const num = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    const min = num(source.min);
    return { min, max: Math.max(min, num(source.max)) };
}
/**
 * 把宿主回的配置收敛成 {@link PanelConfig}。
 *
 * 宽松：字段缺失/类型不对就退回默认值。宿主已经校验过一遍，这里只是不让一个
 * 意外字段把整个面板打成白屏。
 * @param raw - 响应里的 `config`。
 * @returns 面板可直接用的配置。
 */
function toPanelConfig(raw) {
    const source = (typeof raw === 'object' && raw !== null ? raw : {});
    return {
        protocol: isProtocol(source.protocol) ? source.protocol : defaults_ts_1.DEFAULT_CONFIG.protocol,
        baseUrl: asString(source.baseUrl, defaults_ts_1.DEFAULT_CONFIG.baseUrl),
        // 这两个字段**只信宿主**：hasKey 是布尔、keyHint 是掩码，明文根本到不了这里。
        hasKey: source.hasKey === true,
        keyHint: asString(source.keyHint, ''),
        model: asString(source.model, defaults_ts_1.DEFAULT_CONFIG.model),
        autoSaveDir: asString(source.autoSaveDir, defaults_ts_1.DEFAULT_CONFIG.autoSaveDir),
        extraJson: typeof source.extraJson === 'string' ? source.extraJson : defaults_ts_1.DEFAULT_CONFIG.extraJson,
        timeoutSec: typeof source.timeoutSec === 'number' && Number.isFinite(source.timeoutSec)
            ? source.timeoutSec
            : defaults_ts_1.DEFAULT_CONFIG.timeoutSec,
        outputFormat: isOutputFormat(source.outputFormat) ? source.outputFormat : defaults_ts_1.DEFAULT_CONFIG.outputFormat,
    };
}
/**
 * 取出要发给宿主的字段。
 *
 * 刻意**丢掉** `hasKey` / `keyHint`：那是宿主算出来的状态，前端回传只会制造
 * 「谁说了算」的歧义。明文 Key 走 `plainKey` 参数，是另一条独立通道。
 * @param config - 面板配置。
 * @returns 只含宿主可写字段的对象。
 */
function toOutboundConfig(config) {
    return {
        protocol: config.protocol,
        baseUrl: config.baseUrl,
        model: config.model,
        autoSaveDir: config.autoSaveDir,
        extraJson: config.extraJson,
        timeoutSec: config.timeoutSec,
        outputFormat: config.outputFormat,
    };
}
/**
 * 收敛「模型可配置参数表」。
 *
 * 每个字段都要过一遍类型守卫才收：宿主已经按字段规格表组装过，但这里是最后一道
 * 防线 —— 一个形状不对的字段会让参数行渲染成空白控件，比整行不显示更难排查。
 * @param raw - 响应里的 `parameters`。
 * @returns 可渲染的参数字段；形状不对的条目直接丢弃。
 */
function toParameters(raw) {
    if (!Array.isArray(raw))
        return [];
    const controls = ['select', 'count', 'number', 'toggle', 'text'];
    const valueTypes = ['string', 'integer', 'boolean'];
    const out = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null)
            continue;
        const source = item;
        const name = asString(source.name, '');
        if (name === '')
            continue;
        const control = controls.includes(asString(source.control, '')) ? asString(source.control, '') : 'text';
        const valueType = valueTypes.includes(asString(source.valueType, ''))
            ? asString(source.valueType, '')
            : 'string';
        const num = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
        const values = Array.isArray(source.values)
            ? source.values.filter((entry) => typeof entry === 'string')
            : undefined;
        out.push({
            name,
            label: asString(source.label, name),
            control,
            valueType,
            group: source.group === 'advanced' ? 'advanced' : 'output',
            ...values === undefined || values.length === 0 ? {} : { values },
            ...num(source.min) === undefined ? {} : { min: num(source.min) },
            ...num(source.max) === undefined ? {} : { max: num(source.max) },
            clearable: source.clearable === true,
            default: asString(source.default, ''),
            hint: asString(source.hint, ''),
        });
    }
    return out;
}
/** 参数候选值表（五项都必须是字符串数组）。 */
function toOptions(raw) {
    const source = (typeof raw === 'object' && raw !== null ? raw : {});
    const list = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    return {
        aspectRatio: list(source.aspectRatio),
        resolution: list(source.resolution),
        count: list(source.count),
        quality: list(source.quality),
        outputFormat: list(source.outputFormat),
    };
}
/**
 * 收敛模型列表。
 *
 * 没有 `id` 的条目直接丢弃 —— 一个 id 为空的模型会让下拉框出现一个选不中的幽灵项。
 * @param raw - 响应里的 `models`。
 * @returns 可用的模型候选。
 */
function toModelOptions(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null)
            continue;
        const source = item;
        if (typeof source.id !== 'string' || source.id === '')
            continue;
        out.push({
            id: source.id,
            caps: Array.isArray(source.caps) ? source.caps.filter((cap) => typeof cap === 'string') : [],
            price: asString(source.price, ''),
            supportsReferences: source.supportsReferences === true,
            references: toReferenceRange(source.references),
            options: toOptions(source.options),
            parameters: toParameters(source.parameters),
            supportsStreaming: source.supportsStreaming === true,
        });
    }
    return out;
}
/**
 * 收敛一张图（历史条目 / 生成结果同形）。
 * @param raw - 宿主给的图对象。
 * @returns 可渲染的图；结构不成形时返回 undefined（该条目被跳过）。
 */
function toImage(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const source = raw;
    const id = typeof source.id === 'string' && source.id !== '' ? source.id : undefined;
    if (id === undefined)
        return undefined;
    // `imageUrl` 是宿主给的**相对路径**，这里按挂载点解析 —— 反代挂前缀也取得到图。
    const imageUrl = typeof source.imageUrl === 'string' && source.imageUrl !== ''
        ? apiPath(source.imageUrl)
        : undefined;
    const model = asString(source.model, '');
    const params = toImageParams(source.params);
    const sentFields = toStringMap(source.sentFields);
    const referenceCount = typeof source.referenceCount === 'number' && Number.isFinite(source.referenceCount)
        ? Math.max(0, Math.round(source.referenceCount))
        : undefined;
    return {
        id,
        art: asString(source.art, 'a'),
        ...imageUrl === undefined ? {} : { imageUrl },
        size: asString(source.size, ''),
        ...typeof source.cost === 'number' && Number.isFinite(source.cost) ? { cost: source.cost } : {},
        seconds: typeof source.seconds === 'number' && Number.isFinite(source.seconds) ? source.seconds : 0,
        prompt: asString(source.prompt, ''),
        aspectRatio: asString(source.aspectRatio, '1:1'),
        resolution: asString(source.resolution, '1K'),
        createdAt: typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
        ...typeof source.savedPath === 'string' && source.savedPath !== '' ? { savedPath: source.savedPath } : {},
        ...typeof source.autoSavedPath === 'string' && source.autoSavedPath !== '' ? { autoSavedPath: source.autoSavedPath } : {},
        ...typeof source.count === 'number' && Number.isFinite(source.count) && source.count > 1 ? { count: source.count } : {},
        // ---- 2026-10-11 新增：这张图当时用的是哪个模型、哪些参数。
        // 老条目没有这些键 —— 界面按「升级前的记录」降级，不用空对象冒充。
        ...model === '' ? {} : { model },
        ...params === undefined ? {} : { params },
        ...sentFields === undefined ? {} : { sentFields },
        ...referenceCount === undefined ? {} : { referenceCount },
    };
}
/**
 * 收敛「当时用的参数」。
 * @param raw - 宿主给的 `params`。
 * @returns 参数快照；结构不成形时返回 undefined（当作老条目）。
 */
function toImageParams(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const source = raw;
    const count = typeof source.count === 'number' && Number.isFinite(source.count) ? Math.max(1, Math.round(source.count)) : 1;
    return {
        aspectRatio: asString(source.aspectRatio, ''),
        resolution: asString(source.resolution, ''),
        count,
        quality: asString(source.quality, ''),
        extra: toStringMap(source.extra) ?? {},
    };
}
/** 收敛一个「字符串 → 字符串」的扁平表；不是对象时返回 undefined。 */
function toStringMap(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string')
            out[key] = value;
        else if (typeof value === 'number' && Number.isFinite(value))
            out[key] = String(value);
        else if (typeof value === 'boolean')
            out[key] = String(value);
    }
    return out;
}
/**
 * 收敛一份草稿。
 * @param raw - 宿主给的 `draft`（`null` = 还没有草稿）。
 * @returns 草稿；没有/结构不成形时返回 undefined。
 */
function toPanelDraft(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const source = raw;
    const params = (typeof source.params === 'object' && source.params !== null ? source.params : {});
    return {
        prompt: asString(source.prompt, ''),
        params: {
            aspectRatio: asString(params.aspectRatio, ''),
            resolution: asString(params.resolution, ''),
            count: asString(params.count, '1') || '1',
            quality: asString(params.quality, ''),
        },
        extra: toStringMap(source.extra) ?? {},
        lastGeneratedPrompt: asString(source.lastGeneratedPrompt, ''),
        updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
    };
}
/**
 * 收敛模型能力明细。
 * @param raw - 响应里的 `capabilities`。
 * @returns 面板可直接用的能力对象；缺字段时给安全默认。
 */
function toCapabilities(raw) {
    const source = (typeof raw === 'object' && raw !== null ? raw : {});
    const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    const providerOptions = [];
    if (Array.isArray(source.providerOptions)) {
        for (const item of source.providerOptions) {
            if (typeof item !== 'object' || item === null)
                continue;
            const entry = item;
            const slug = asString(entry.slug, '');
            if (slug === '')
                continue;
            providerOptions.push({ slug, name: asString(entry.name, slug), params: strings(entry.params) });
        }
    }
    return {
        model: asString(source.model, ''),
        price: asString(source.price, ''),
        supportsReferences: source.supportsReferences === true,
        caps: strings(source.caps),
        providers: strings(source.providers),
        passthrough: strings(source.passthrough),
        providerOptions,
        // 拿不到这个字段时按「可用」处理（老宿主 / 其他协议）—— 宁可放行一次必失败的调用，
        // 也不要因为字段缺失就把模型全标成不可用。
        available: source.available !== false,
        references: toReferenceRange(source.references),
        referencesDeclaredMax: typeof source.referencesDeclaredMax === 'number' && Number.isFinite(source.referencesDeclaredMax)
            ? Math.max(0, Math.round(source.referencesDeclaredMax))
            : 0,
        options: toOptions(source.options),
        parameters: toParameters(source.parameters),
        supportsStreaming: source.supportsStreaming === true,
    };
}
/**
 * 收敛一条宿主日志（级别不认识就按 info 记）。
 * @param raw - 宿主给的条目。
 * @returns 可渲染的日志；没有正文时返回 undefined（该条被跳过）。
 */
function toLogEntry(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const source = raw;
    const text = asString(source.text, '');
    if (text === '')
        return undefined;
    const level = source.level === 'warn' || source.level === 'error' ? source.level : 'info';
    return {
        seq: typeof source.seq === 'number' && Number.isFinite(source.seq) ? source.seq : 0,
        at: asString(source.at, ''),
        level,
        text,
    };
}
// ------------------------------------------------------------------ 后端
/**
 * 造一个打宿主路由的后端。
 * @returns 生产用 {@link Backend} 实现。
 */
function createHttpBackend() {
    return {
        async loadConfig(signal) {
            const body = await callHost(ROUTES.config, signal === undefined ? {} : { signal });
            return toPanelConfig(body.config);
        },
        async saveConfig(config, plainKey, signal) {
            // 明文 Key 只在这一次 PUT 里存在。空串 = 不改动已有的 Key。
            const body = await callHost(ROUTES.config, {
                method: 'PUT',
                headers: JSON_HEADERS,
                body: JSON.stringify({ config: toOutboundConfig(config), apiKey: plainKey }),
                ...signal === undefined ? {} : { signal },
            });
            return toPanelConfig(body.config);
        },
        async listModels(_config, signal) {
            const body = await callHost(ROUTES.models, signal === undefined ? {} : { signal });
            return {
                models: toModelOptions(body.models),
                ...typeof body.note === 'string' && body.note !== '' ? { note: body.note } : {},
            };
        },
        async modelCapabilities(_config, modelId, resolution, signal) {
            const query = new URLSearchParams({ model: modelId });
            if (resolution !== undefined && resolution !== '')
                query.set('resolution', resolution);
            const body = await callHost(`${ROUTES.capabilities}?${query.toString()}`, signal === undefined ? {} : { signal });
            return toCapabilities(body.capabilities);
        },
        async generate(config, request, signal) {
            const started = Date.now();
            try {
                const body = await callHost(ROUTES.generate, {
                    method: 'POST',
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ config: toOutboundConfig(config), request }),
                    ...signal === undefined ? {} : { signal },
                });
                const image = toImage(body.image);
                if (image === undefined) {
                    throw new types_ts_1.GenerateError('生成失败', '宿主返回的图片结构不完整（缺少 id）');
                }
                const count = typeof body.count === 'number' && Number.isFinite(body.count) ? body.count : 1;
                return {
                    ...image,
                    ...count > 1 ? { count } : {},
                    seconds: image.seconds > 0 ? image.seconds : Math.round((Date.now() - started) / 1000),
                };
            }
            catch (error) {
                // 宿主拒绝 / 网络失败 / 上游报错，全都变成面板能直接展示的「生成失败 + 原文」。
                if (error instanceof types_ts_1.GenerateError)
                    throw error;
                const code = error instanceof HostRouteError ? error.code : 'unknown';
                const lines = [messageOf(error), `（code: ${code}）`];
                // 诊断行是宿主给的「我到底发了什么」—— 直接摊在错误卡片里，
                // 用户不用去翻日志就能判断是不是参数没发对。
                if (error instanceof HostRouteError && error.diagnostics.length > 0) {
                    lines.push('', '本次请求的实际参数：', ...error.diagnostics.map((line) => `· ${line}`));
                }
                throw new types_ts_1.GenerateError('生成失败', lines.join('\n'));
            }
        },
        async listHistory(signal) {
            const body = await callHost(ROUTES.history, signal === undefined ? {} : { signal });
            if (!Array.isArray(body.images))
                return [];
            return body.images.map(toImage).filter((image) => image !== undefined);
        },
        async saveImage(id, target, signal) {
            const body = await callHost(ROUTES.save, {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ id, ...target === undefined ? {} : { target } }),
                ...signal === undefined ? {} : { signal },
            });
            const savedPath = typeof body.savedPath === 'string' ? body.savedPath : '';
            if (savedPath === '')
                throw new HostRouteError('宿主没有返回保存路径', 'bad-shape', 200);
            return savedPath;
        },
        async openImage(id, signal) {
            const body = await callHost(ROUTES.open, {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ id }),
                ...signal === undefined ? {} : { signal },
            });
            return typeof body.path === 'string' ? body.path : '';
        },
        async fetchLogs(limit = 200, signal) {
            const body = await callHost(`${ROUTES.logs}?limit=${encodeURIComponent(String(limit))}`, signal === undefined ? {} : { signal });
            const raw = Array.isArray(body.entries) ? body.entries : [];
            return {
                entries: raw.map(toLogEntry).filter((entry) => entry !== undefined),
                file: asString(body.file, ''),
                dir: asString(body.dir, ''),
                count: typeof body.count === 'number' && Number.isFinite(body.count) ? body.count : raw.length,
            };
        },
        async loadDraft(signal) {
            const body = await callHost(ROUTES.draft, signal === undefined ? {} : { signal });
            return toPanelDraft(body.draft);
        },
        async saveDraft(draft, signal) {
            try {
                const body = await callHost(ROUTES.draft, {
                    method: 'PUT',
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ draft }),
                    ...signal === undefined ? {} : { signal },
                });
                return body.ok === true;
            }
            catch {
                // 草稿落盘失败不打扰用户：宿主已经记了 warn 日志，面板照常能用，
                // 而且下一次改动会再试一遍。**不能抛** —— 抛出去会打断正在打字的人。
                return false;
            }
        },
    };
}

			},
			"src/client/labels.ts": function (module, exports, require) {
			"use strict";
/**
 * 「当时用的参数」怎么显示成中文。
 *
 * 为什么单独一个模块：结果行要显示的是**任意一张历史图**的参数 —— 那张图可能是
 * 另一个模型生的，而面板上的参数表（`ModelCapabilities.parameters`）只描述**当前**
 * 模型。所以标签不能从当前模型的参数表里取，得有一份与模型无关的对照表。
 *
 * 这份表必须与宿主 `src/openrouter.ts` 的 `FIELD_SPECS` 对齐（那是权威），
 * 由 `scripts/host-check.mjs` 断言「每个字段都有中文标签」—— 少了哪个字段，
 * 界面上就会冒出一个英文键名。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FACT_ORDER = exports.FIELD_LABELS = void 0;
exports.fieldLabelOf = fieldLabelOf;
exports.formatFieldValue = formatFieldValue;
exports.factListOf = factListOf;
exports.factTextOf = factTextOf;
/** 请求体字段名 → 中文标签。 */
exports.FIELD_LABELS = {
    aspect_ratio: '比例',
    resolution: '分辨率',
    size: '尺寸',
    n: '张数',
    quality: '质量',
    output_format: '输出格式',
    background: '背景',
    output_compression: '压缩',
    seed: '随机种子',
    stream: '流式预览',
    /** 来自配置里那段「额外参数」JSON 的透传对象（`{"sort":"price"}`）。 */
    provider: '上游透传',
    /** 参考图**张数**（data URL 不落盘，只记数量）——结果行里追加的一条。 */
    input_references: '参考图',
};
/**
 * 展示顺序：核心四项在最前（用户最关心），然后是输出规格、高级项、最后透传对象。
 *
 * 不按字典序排的原因很实际：结果行只有一行，`+N` 折叠时先被裁掉的应该是
 * 「上游透传」而不是「比例」。
 */
exports.FACT_ORDER = [
    'aspect_ratio',
    'resolution',
    'quality',
    'n',
    'output_format',
    'background',
    'output_compression',
    'size',
    'seed',
    'stream',
    'provider',
];
/** 字段名的中文标签；没有对照时退回字段名本身（宁可露出英文，也不假装知道）。 */
function fieldLabelOf(name) {
    return exports.FIELD_LABELS[name] ?? name;
}
/** 取值的展示形态：布尔值翻成开/关，其余原样。 */
function formatFieldValue(value) {
    if (value === 'true')
        return '开';
    if (value === 'false')
        return '关';
    return value;
}
/**
 * 把一份「字段名 → 取值」的表排成可展示的事实列表。
 * @param fields - 例如 `GeneratedImage.sentFields`。
 * @returns 按 {@link FACT_ORDER} 排好的列表；未知字段按字典序接在后面。
 */
function factListOf(fields) {
    if (fields === undefined)
        return [];
    const names = Object.keys(fields).filter((name) => fields[name] !== '');
    const rank = (name) => {
        const at = exports.FACT_ORDER.indexOf(name);
        return at < 0 ? exports.FACT_ORDER.length : at;
    };
    names.sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
    return names.map((name) => ({ name, label: fieldLabelOf(name), value: formatFieldValue(fields[name]) }));
}
/** 一条事实的一行文本（`比例 16:9`）。 */
function factTextOf(fact) {
    return `${fact.label} ${fact.value}`;
}

			},
			"src/client/defaults.ts": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
/** 未配置时的默认值（`hasKey: false` → 首帧按「未配置」渲染）。 */
exports.DEFAULT_CONFIG = {
    protocol: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hasKey: false,
    keyHint: '',
    model: 'google/gemini-3-pro-image',
    // 空 = 首帧先按「不自动另存」渲染，宿主那份真实默认值到达后即覆盖它。
    // v0.1.0 这里硬编码过作者本机路径，已移除：它既泄漏本机目录结构，在别的机器上也是无效路径。
    autoSaveDir: '',
    extraJson: '{\n  "background": "opaque",\n  "output_compression": 90,\n  "provider": { "sort": "price" }\n}',
    timeoutSec: 180,
    outputFormat: 'png',
};

			},
			"src/client/art.tsx": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ART_KEYS = void 0;
exports.asArtKey = asArtKey;
exports.ArtDefs = ArtDefs;
exports.Art = Art;
const jsx_runtime_1 = __dshRequire("\u0000jsx-runtime");
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
exports.ART_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];
/** 把任意字符串收敛到合法变体键，越界时回退到 'a'。 */
function asArtKey(value) {
    return exports.ART_KEYS.includes(value) ? value : 'a';
}
/** 渐变定义。挂在隐藏 svg 上，全面板共用一份。 */
function ArtDefs() {
    return ((0, jsx_runtime_1.jsx)("svg", { width: "0", height: "0", style: { position: 'absolute' }, "aria-hidden": "true", children: (0, jsx_runtime_1.jsxs)("defs", { children: [(0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-a", x1: "0", y1: "0", x2: "1", y2: "1", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#1b1035" }), (0, jsx_runtime_1.jsx)("stop", { offset: ".45", stopColor: "#3b1e6e" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#0b1a2e" })] }), (0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-a2", x1: "0", y1: "1", x2: "1", y2: "0", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#ff5fa2" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#39d0ff" })] }), (0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-b", x1: "0", y1: "0", x2: "0", y2: "1", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#ffb35c" }), (0, jsx_runtime_1.jsx)("stop", { offset: ".5", stopColor: "#ff7a59" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#5b2a63" })] }), (0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-c", x1: "0", y1: "0", x2: "1", y2: "1", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#0b3d91" }), (0, jsx_runtime_1.jsx)("stop", { offset: ".55", stopColor: "#2f6fe0" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#8ed1ff" })] }), (0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-d", x1: "0", y1: "0", x2: "1", y2: "1", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#f6f7f9" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#dfe5ee" })] }), (0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-e", x1: "0", y1: "0", x2: "1", y2: "1", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#ffd9a0" }), (0, jsx_runtime_1.jsx)("stop", { offset: ".6", stopColor: "#e08a6b" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#4a2342" })] }), (0, jsx_runtime_1.jsxs)("linearGradient", { id: "fig-g-f", x1: "0", y1: "0", x2: "1", y2: "1", children: [(0, jsx_runtime_1.jsx)("stop", { offset: "0", stopColor: "#e8f4ea" }), (0, jsx_runtime_1.jsx)("stop", { offset: "1", stopColor: "#bfe0cc" })] })] }) }));
}
/** 一个变体的图形内容（不含 <svg> 外壳，便于在缩略图与大图里复用）。 */
function body(key) {
    switch (key) {
        case 'a':
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("rect", { width: "120", height: "120", fill: "url(#fig-g-a)" }), (0, jsx_runtime_1.jsxs)("g", { opacity: ".85", children: [(0, jsx_runtime_1.jsx)("rect", { x: "8", y: "52", width: "14", height: "68", fill: "#2b1d4d" }), (0, jsx_runtime_1.jsx)("rect", { x: "26", y: "34", width: "16", height: "86", fill: "#241844" }), (0, jsx_runtime_1.jsx)("rect", { x: "46", y: "60", width: "12", height: "60", fill: "#2f2054" }), (0, jsx_runtime_1.jsx)("rect", { x: "62", y: "24", width: "18", height: "96", fill: "#1e1439" }), (0, jsx_runtime_1.jsx)("rect", { x: "84", y: "46", width: "14", height: "74", fill: "#281c4a" }), (0, jsx_runtime_1.jsx)("rect", { x: "102", y: "38", width: "14", height: "82", fill: "#221744" })] }), (0, jsx_runtime_1.jsx)("g", { stroke: "url(#fig-g-a2)", strokeWidth: "1.3", fill: "none", opacity: ".95", children: (0, jsx_runtime_1.jsx)("path", { d: "M0 44h120M0 74h120M20 0v120M52 0v120M88 0v120" }) }), (0, jsx_runtime_1.jsx)("circle", { cx: "92", cy: "30", r: "11", fill: "#39d0ff", opacity: ".28" }), (0, jsx_runtime_1.jsx)("circle", { cx: "92", cy: "30", r: "5.5", fill: "#ff5fa2", opacity: ".75" })] }));
        case 'b':
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("rect", { width: "120", height: "120", fill: "url(#fig-g-b)" }), (0, jsx_runtime_1.jsx)("circle", { cx: "60", cy: "56", r: "19", fill: "#fff3c4", opacity: ".95" }), (0, jsx_runtime_1.jsx)("path", { d: "M0 92 26 66l18 15 20-24 24 26 12-10v27H0z", fill: "#3a1f47", opacity: ".92" }), (0, jsx_runtime_1.jsx)("path", { d: "M0 104 34 84l22 12 26-16 38 22v14H0z", fill: "#241430", opacity: ".95" }), (0, jsx_runtime_1.jsxs)("g", { fill: "#fff", opacity: ".5", children: [(0, jsx_runtime_1.jsx)("circle", { cx: "20", cy: "20", r: "1" }), (0, jsx_runtime_1.jsx)("circle", { cx: "46", cy: "12", r: ".8" }), (0, jsx_runtime_1.jsx)("circle", { cx: "104", cy: "26", r: "1.1" })] })] }));
        case 'c':
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("rect", { width: "120", height: "120", fill: "url(#fig-g-c)" }), (0, jsx_runtime_1.jsxs)("g", { opacity: ".7", children: [(0, jsx_runtime_1.jsx)("ellipse", { cx: "40", cy: "46", rx: "34", ry: "26", fill: "#8ed1ff", opacity: ".55" }), (0, jsx_runtime_1.jsx)("ellipse", { cx: "84", cy: "72", rx: "38", ry: "30", fill: "#0b3d91", opacity: ".6" }), (0, jsx_runtime_1.jsx)("ellipse", { cx: "70", cy: "34", rx: "22", ry: "18", fill: "#ffffff", opacity: ".4" })] }), (0, jsx_runtime_1.jsx)("path", { d: "M-5 96c22-16 40 10 62-4s38-24 68-8v40H-5z", fill: "#072a63", opacity: ".85" })] }));
        case 'd':
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("rect", { width: "120", height: "120", fill: "url(#fig-g-d)" }), (0, jsx_runtime_1.jsx)("ellipse", { cx: "60", cy: "104", rx: "34", ry: "8", fill: "#b9c2cf", opacity: ".55" }), (0, jsx_runtime_1.jsx)("rect", { x: "38", y: "34", width: "44", height: "62", rx: "12", fill: "#ffffff" }), (0, jsx_runtime_1.jsx)("rect", { x: "38", y: "34", width: "44", height: "62", rx: "12", fill: "none", stroke: "#c9d2de", strokeWidth: "1" }), (0, jsx_runtime_1.jsx)("circle", { cx: "60", cy: "58", r: "11", fill: "#e8eef7" }), (0, jsx_runtime_1.jsx)("circle", { cx: "60", cy: "58", r: "4.6", fill: "#7aa0d8" }), (0, jsx_runtime_1.jsx)("rect", { x: "50", y: "80", width: "20", height: "4", rx: "2", fill: "#dde5f0" })] }));
        case 'e':
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("rect", { width: "120", height: "120", fill: "url(#fig-g-e)" }), (0, jsx_runtime_1.jsx)("circle", { cx: "60", cy: "48", r: "17", fill: "#5a2b45", opacity: ".85" }), (0, jsx_runtime_1.jsx)("path", { d: "M22 120c0-22 17-38 38-38s38 16 38 38z", fill: "#5a2b45", opacity: ".85" }), (0, jsx_runtime_1.jsx)("rect", { y: "84", width: "120", height: "36", fill: "#3a1a33", opacity: ".55" })] }));
        default:
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("rect", { width: "120", height: "120", fill: "url(#fig-g-f)" }), (0, jsx_runtime_1.jsx)("circle", { cx: "44", cy: "46", r: "24", fill: "#4caf7d", opacity: ".8" }), (0, jsx_runtime_1.jsx)("path", { d: "M68 96 92 46l26 50z", fill: "#2f7d5b", opacity: ".75" }), (0, jsx_runtime_1.jsx)("rect", { x: "14", y: "74", width: "44", height: "30", rx: "6", fill: "#ffffff", opacity: ".8" }), (0, jsx_runtime_1.jsx)("circle", { cx: "94", cy: "30", r: "9", fill: "#ffd18a" })] }));
    }
}
/** 铺满容器的占位插画（大图预览用）。 */
function Art({ artKey }) {
    return ((0, jsx_runtime_1.jsx)("svg", { viewBox: "0 0 120 120", preserveAspectRatio: "xMidYMid slice", style: { display: 'block', width: '100%', height: '100%' }, "aria-hidden": "true", children: body(asArtKey(artKey)) }));
}

			},
			"src/client/optimize.ts": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptimizeError = void 0;
exports.fetchForgePreset = fetchForgePreset;
exports.optimizePrompt = optimizePrompt;
/**
 * 「优化提示词」的浏览器侧实现。
 *
 * 分两步，都不经过我们自己的宿主：
 *  1. `GET /dsh-imagegen/preset` —— 从宿主拿 prompt-forge 的「文生图优化」system 文本；
 *  2. `POST /api/dsh-prompt-forge/optimize` —— **直接打 prompt-forge 自己的路由**，
 *     它是同源 + loopback 围栏的 SSE 接口，跟它自家 UI 走的是同一条路。
 *
 * 为什么不把第 2 步也放到我们宿主：宿主不知道自己的监听端口，绕一圈反而要引入
 * 端口发现；而浏览器本来就在那个 origin 上，还能顺手把流式增量直接渲染出来。
 * 这样 prompt-forge 的渠道、模型、温度全都照旧生效，我们一行 LLM 逻辑都不用抄。
 */
const api_ts_1 = __dshRequire("src/client/api.ts");
/** 拿模板文本失败时抛这个，`message` 直接可展示。 */
class OptimizeError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'OptimizeError';
        this.code = code;
    }
}
exports.OptimizeError = OptimizeError;
/**
 * 读 prompt-forge 的「文生图优化」模板。
 * @param signal - 取消在飞请求。
 * @returns 模板文本与它当前用的渠道/模型。
 */
async function fetchForgePreset(signal) {
    let response;
    try {
        response = await fetch((0, api_ts_1.apiPath)('dsh-imagegen/preset'), signal === undefined ? {} : { signal });
    }
    catch (error) {
        throw new OptimizeError(`连不上宿主：${error instanceof Error ? error.message : String(error)}`, 'offline');
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw new OptimizeError(`宿主回了非 JSON（HTTP ${response.status}）`, 'bad-shape');
    }
    if (!response.ok) {
        const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`;
        throw new OptimizeError(message, typeof body.code === 'string' ? body.code : 'preset-failed');
    }
    const system = typeof body.system === 'string' ? body.system : '';
    if (system.trim() === '')
        throw new OptimizeError('宿主给的模板文本是空的', 'empty-preset');
    return {
        name: typeof body.name === 'string' ? body.name : '文生图优化',
        system,
        provider: typeof body.provider === 'string' ? body.provider : '',
        model: typeof body.model === 'string' ? body.model : '',
    };
}
/**
 * 追加在模板末尾的输出约束。
 *
 * **为什么必须有它**：老板那个「文生图优化」模板是**推理型**的（163 行、带自检清单），
 * 末尾没有 prompt-forge 内置三个模板都带的 OUTPUT_ONLY 那句。实测（2026-10-10）：
 * 不加这句，模型会回「1. 优化思路… 2. 最终提示词…」两段，直接塞进输入框没法用；
 * 加上之后是干净的一段（169 字，2.6 秒）。
 *
 * 我们**不改他的模板** —— 他在 prompt-forge 自己的界面里可能就想看推理过程 ——
 * 只在这一跳的 system 末尾补一句。
 */
const OUTPUT_ONLY = '只输出改写后的提示词本身。不要解释你做了什么，不要加标题、前言、说明、Markdown 代码块包裹，也不要加「优化后的提示词：」这类标签。';
/**
 * 调 prompt-forge 跑一次优化。
 *
 * SSE 帧格式是 `data: <json>` + 空行分隔（CRLF 也容忍），与它的客户端一致。
 * @param text - 待优化的草稿。
 * @param system - {@link fetchForgePreset} 拿到的模板文本。
 * @param onDelta - 每收到一段增量就回调一次（用来流式写进输入框）。
 * @param signal - 取消在飞请求。
 * @returns 完整结果文本。
 */
async function optimizePrompt(text, system, onDelta, signal) {
    let response;
    try {
        response = await fetch((0, api_ts_1.apiPath)('api/dsh-prompt-forge/optimize'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify({ text, system: `${system}\n\n${OUTPUT_ONLY}` }),
            ...signal === undefined ? {} : { signal },
        });
    }
    catch (error) {
        if (signal?.aborted === true)
            throw new OptimizeError('已取消', 'aborted');
        throw new OptimizeError(`连不上 prompt-forge：${error instanceof Error ? error.message : String(error)}`, 'offline');
    }
    if (!response.ok) {
        // 它拒绝时回的是 JSON（loopback 围栏、草稿为空、太长、enabled:false…），把原话带出来。
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (typeof body.message === 'string' && body.message !== '')
                message = body.message;
        }
        catch {
            // 保持 HTTP 状态码文案。
        }
        throw new OptimizeError(message, `forge-http-${response.status}`);
    }
    if (response.body === null)
        throw new OptimizeError('prompt-forge 没有返回流', 'no-body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assembled = '';
    let failure;
    let done = false;
    const handleFrame = (payload) => {
        let event;
        try {
            event = JSON.parse(payload);
        }
        catch {
            return;
        }
        if (event.type === 'delta' && typeof event.text === 'string') {
            assembled += event.text;
            onDelta(event.text);
            return;
        }
        if (event.type === 'done') {
            if (typeof event.text === 'string' && event.text !== '')
                assembled = event.text;
            done = true;
            return;
        }
        if (event.type === 'error') {
            failure = new OptimizeError(event.message ?? 'prompt-forge 报了错', event.code ?? 'forge-error');
        }
    };
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done)
            break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
            for (const line of frame.split(/\r?\n/u)) {
                if (line.startsWith('data:'))
                    handleFrame(line.slice(5).trim());
            }
        }
        if (failure !== undefined || done)
            break;
    }
    if (failure !== undefined)
        throw failure;
    if (assembled.trim() === '')
        throw new OptimizeError('prompt-forge 返回了空结果', 'empty-result');
    return assembled;
}

			},
			"src/client/types.ts": function (module, exports, require) {
			"use strict";
/**
 * 生图面板的共享类型。
 *
 * 这些类型刻意按「宿主路由会返回什么」来定，而不是按某个后端实现来定 ——
 * 阶段 3 把实现从 mock 换成真 fetch 时，UI 一行都没改。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateError = void 0;
/** 生成失败时抛出的错误，携带面向用户的原始报错文本。 */
class GenerateError extends Error {
    /** 提供商返回的原始报错，原样展示给用户（如 OpenRouter 的 402 文案）。 */
    detail;
    constructor(message, detail) {
        super(message);
        this.name = 'GenerateError';
        this.detail = detail;
    }
}
exports.GenerateError = GenerateError;

			},
			"src/client/panel.module.css": function (module, exports, require) {
			"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const css = "/* 生图面板样式。\n *\n * 全部数值与配色**逐条照搬**已批准的 UI 原型（ui-mockup/index.html）：\n * 颜色一律走 DSH 真实 design token，圆角走 --dsw-radius-*，字体走 --dsw-font-family。\n * 不出现任何自造色值 —— 这样深色主题自动跟随，不需要自己判断主题。\n *\n * 类名刻意与原型保持同名，便于两边对照 diff。\n */\n\n/* ---------------------------------------------------------------- 根容器 */\n\n/*\n * 自带 box-sizing。\n *\n * 原型（ui-mockup/index.html）里有一句全局 `*{box-sizing:border-box}`，\n * 所以那边 width:100% + padding 的输入框看着是对的。但**宿主没有这个全局 reset**\n * （已核对 dsh-web-frontend 的 CSS：没有 `*{box-sizing}` 规则），CSS Module 又是\n * 按文件作用域的，那句 reset 带不过来。\n *\n * 结果就是 textarea / input 的 width:100% 再加上左右 padding 会溢出容器、\n * 文字被裁。插件不该依赖宿主的全局样式，所以在这里自己声明。\n */\n.panel_panel,\n.panel_panel *,\n.panel_panel *::before,\n.panel_panel *::after {\n  box-sizing: border-box;\n}\n\n.panel_panel {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-height: 0;\n  min-width: 0;\n  overflow: hidden;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-family);\n  font-size: 14px;\n  line-height: 22px;\n}\n\n/* ---------------------------------------------------------------- 页头 */\n\n/*\n * 页头：2026-10-18 起**只占左栏宽度**。\n *\n * 老板的原话是「模型信息和配置按钮改地方，释放右边预览图片的空间」——\n * 原来 `.head` 是横跨整宽的一行、右侧还钉着「模型」chip 与「连接配置」按钮，\n * 这一行的高度是从**预览区**身上扣的。现在页头跟着左栏走（见 `.leftCol`），\n * 右栏 `.result` 从面板最顶部一路到底，预览区直接多出这一行的高度。\n *\n * 右侧动作区（`.headActions`）随之删除：「模型」chip 左栏底部本来就有一个、\n * 且那个还带下拉箭头；「连接配置」挪到左栏底部模型行旁边。\n */\n.panel_head {\n  flex: none;\n  padding: 16px 20px 0 24px;\n}\n\n.panel_headText { min-width: 0; }\n\n.panel_title {\n  font-size: 17px;\n  font-weight: 600;\n  line-height: 24px;\n}\n\n.panel_sub {\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n  margin-top: 1px;\n}\n\n\n\n/* ---------------------------------------------------------------- 控件 */\n\n.panel_btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  height: 32px;\n  padding: 0 12px;\n  border-radius: var(--dsw-radius-sm);\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-button-elevated-fill);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.panel_btn:hover:not(:disabled) { background: var(--dsw-alias-button-floating-hover); }\n\n.panel_btn:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: not-allowed;\n}\n\n.panel_btnPrimary {\n  border-color: transparent;\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n  font-weight: 500;\n}\n\n.panel_btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n\n.panel_btnPrimary:disabled {\n  background: var(--dsw-alias-button-primary-dimmed);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_btnGhost {\n  border-color: transparent;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_btnGhost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n\n.panel_btnLg { height: 40px; padding: 0 18px; font-size: 14px; border-radius: var(--dsw-radius-md); }\n.panel_btnSm { height: 28px; padding: 0 10px; font-size: 12px; }\n\n.panel_chip {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  height: 26px;\n  padding: 0 8px;\n  border-radius: var(--dsw-radius-sm);\n  border: 1px solid var(--dsw-alias-border-l1);\n  background: var(--dsw-alias-bg-multi-select);\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n}\n\n.panel_chip:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }\n.panel_chip b { color: var(--dsw-alias-label-primary); font-weight: 500; }\n\n/* ------------------------------------------------------------ 未配置引导 */\n\n.panel_guide {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin: 12px 24px 0;\n  padding: 10px 12px;\n  border-radius: var(--dsw-radius-md);\n  border: 1px solid var(--dsw-alias-state-warn-secondary);\n  background: var(--dsw-alias-state-warn-tertiary);\n  color: var(--dsw-alias-state-warn-label);\n  font-size: 13px;\n}\n\n.panel_guide > svg { flex: none; }\n.panel_guide .panel_btn { margin-left: auto; }\n\n/*\n * 宿主路由不可用 —— 与「还没配置」是两件事，不能共用一套颜色。\n * 前者是管道断了（要查插件/端口），后者是用户还没填 Key（点一下就能解决）。\n */\n.panel_guideErr {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin: 12px 24px 0;\n  padding: 10px 12px;\n  border-radius: var(--dsw-radius-md);\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 13px;\n}\n\n.panel_guideErr > svg { flex: none; }\n.panel_guideHint { margin-left: auto; color: var(--dsw-alias-label-tertiary); }\n\n/* ---------------------------------------------------------------- 主体 */\n\n.panel_body2 {\n  display: grid;\n  grid-template-columns: 372px minmax(0, 1fr);\n  flex: 1;\n  min-height: 0;\n}\n\n/*\n * 左栏：页头 + 输入区（`Composer` 自己滚，页头钉在上面不跟着滚）。\n *\n * 它是 `.body2` 的第一个 grid 项；右栏（`.result`）是第二个 —— 两栏同高同起，\n * 所以「右栏从最顶部开始」这件事是结构给的，不靠负 margin 之类的技巧。\n */\n.panel_leftCol {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  min-width: 0;\n  border-right: 1px solid var(--dsw-alias-border-l1);\n}\n\n/* ------------------------------------------------------------ 左：输入区 */\n\n.panel_composer {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 16px 20px 16px 24px;\n  min-width: 0;\n  overflow: auto;\n}\n\n.panel_field { display: flex; flex-direction: column; gap: 6px; }\n\n.panel_fieldLabel {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_fieldLabel .panel_hint {\n  font-weight: 400;\n  color: var(--dsw-alias-label-caption);\n  margin-left: auto;\n}\n\n.panel_promptWrap {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-specific-input-major);\n  overflow: hidden;\n}\n\n.panel_promptWrap:focus-within { border-color: var(--dsw-alias-state-business-primary); }\n\n.panel_prompt {\n  display: block;\n  width: 100%;\n  min-height: 118px;\n  max-height: 260px;\n  resize: vertical;\n  border: 0;\n  outline: 0;\n  padding: 10px 12px;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  line-height: 21px;\n}\n\n.panel_prompt::placeholder { color: var(--dsw-alias-markdown-placeholder); }\n\n.panel_promptTools {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 8px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n\n.panel_counter {\n  margin-left: auto;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n/* 参考图 */\n.panel_refGrid { display: flex; flex-wrap: wrap; gap: 8px; }\n\n.panel_refAdd {\n  width: 68px;\n  height: 68px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 2px;\n  border: 1px dashed var(--dsw-alias-border-l4);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  font-size: 11px;\n  cursor: pointer;\n}\n\n.panel_refAdd:hover:not(:disabled) {\n  border-color: var(--dsw-alias-brand-primary);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_refAdd:disabled { cursor: not-allowed; opacity: .5; }\n\n.panel_refThumb {\n  position: relative;\n  width: 68px;\n  height: 68px;\n  border-radius: var(--dsw-radius-sm);\n  overflow: hidden;\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.panel_refThumb .panel_rm {\n  position: absolute;\n  top: 2px;\n  right: 2px;\n  width: 18px;\n  height: 18px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border: 0;\n  border-radius: 50%;\n  background: var(--dsw-alias-bg-mask-1);\n  color: #fff;\n  font-size: 11px;\n  line-height: 1;\n  cursor: pointer;\n}\n\n.panel_refThumb .panel_tag {\n  position: absolute;\n  left: 3px;\n  bottom: 3px;\n  padding: 0 4px;\n  border-radius: 3px;\n  background: var(--dsw-alias-bg-mask-1);\n  color: #fff;\n  font-size: 10px;\n  line-height: 15px;\n}\n\n/* 参数 */\n.panel_params { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }\n\n.panel_paramLabel {\n  font-size: 11px;\n  color: var(--dsw-alias-label-tertiary);\n  margin-bottom: 4px;\n}\n\n.panel_select {\n  position: relative;\n  display: flex;\n  align-items: center;\n  height: 34px;\n  padding: 0 28px 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-button-elevated-fill);\n  font-size: 13px;\n}\n\n.panel_select:hover { border-color: var(--dsw-alias-border-l4); }\n\n.panel_select > .panel_chev {\n  position: absolute;\n  right: 8px;\n  color: var(--dsw-alias-label-tertiary);\n  display: inline-flex;\n  pointer-events: none;\n}\n\n.panel_select select {\n  appearance: none;\n  border: 0;\n  outline: 0;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  width: 100%;\n  cursor: pointer;\n}\n\n.panel_paramsNote {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  margin-top: -6px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.panel_paramsNote > svg { flex: none; }\n\n/* 参数警示（字段之间的约束 / 被裁掉的字段）—— 与普通说明区分开，用警示色 */\n.panel_paramsNoteWarn {\n  display: flex;\n  align-items: flex-start;\n  gap: 5px;\n  font-size: 11px;\n  line-height: 15px;\n  color: var(--dsw-alias-state-warning-primary, #b7791f);\n}\n\n.panel_paramsNoteWarn > svg { flex: none; margin-top: 1px; }\n\n/* 「高级」分组标题：把 seed / size / 压缩 / 流式 这几项与常态参数分开 */\n.panel_paramGroup {\n  margin-top: 2px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* 数值型参数的区间提示 */\n.panel_paramRange {\n  margin-top: 4px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n/* 开关（目前只有 `stream`），沿用 .select 的盒子度量保证参数网格不错位 */\n.panel_toggle {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  width: 100%;\n  height: 34px;\n  padding: 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-button-elevated-fill);\n  color: inherit;\n  font: inherit;\n  font-size: 13px;\n  cursor: pointer;\n}\n\n.panel_toggle:hover { border-color: var(--dsw-alias-border-l4); }\n\n.panel_toggleKnob {\n  width: 26px;\n  height: 15px;\n  border-radius: 999px;\n  background: var(--dsw-alias-border-l4);\n  position: relative;\n  flex: none;\n  transition: background .15s ease;\n}\n\n.panel_toggleKnob::after {\n  content: '';\n  position: absolute;\n  top: 2px;\n  left: 2px;\n  width: 11px;\n  height: 11px;\n  border-radius: 50%;\n  background: #fff;\n  transition: transform .15s ease;\n}\n\n.panel_toggle[aria-checked='true'] .panel_toggleKnob { background: var(--dsw-alias-state-business-primary); }\n.panel_toggle[aria-checked='true'] .panel_toggleKnob::after { transform: translateX(11px); }\n\n.panel_toggleText { color: var(--dsw-alias-label-secondary); }\n\n/* 生成 */\n.panel_actions {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  margin-top: auto;\n}\n\n.panel_genRow { display: flex; gap: 8px; }\n.panel_genRow .panel_btnPrimary { flex: 1; }\n\n/*\n * 模型行：切换模型的 chip 与「连接配置」按钮并排。\n *\n * 「连接配置」原来在整宽页头右上角（老板要求挪走，把那一行高度让给预览区）。\n * 挪到这里有个额外好处：模型与「改模型的地方」在同一行，不用跨半屏去点。\n * chip 可缩、id 省略；按钮不许被挤掉。\n */\n.panel_modelRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.panel_modelRow .panel_chip {\n  flex: 0 1 auto;\n  min-width: 0;\n}\n\n.panel_modelRow .panel_chip b {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.panel_modelRow .panel_btn { flex: none; }\n\n.panel_genMeta {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.panel_genMeta .panel_dot { color: var(--dsw-alias-state-idle-primary); }\n\n/* ------------------------------------------------------------ 右：结果区 */\n\n.panel_result {\n  display: grid;\n  grid-template-rows: minmax(0, 1fr) auto auto;\n  gap: 12px;\n  min-height: 0;\n  min-width: 0;\n  padding: 16px 24px;\n  overflow: hidden;\n}\n\n.panel_stage {\n  position: relative;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: var(--dsw-radius-lg);\n  border: 1px solid var(--dsw-alias-border-l1);\n  background: var(--dsw-alias-bg-layer-2);\n  overflow: hidden;\n}\n\n.panel_stageInner {\n  width: 100%;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 10px;\n  text-align: center;\n  padding: 20px;\n}\n\n.panel_emptyGlyph {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 56px;\n  height: 56px;\n  border-radius: var(--dsw-radius-lg);\n  background: var(--dsw-alias-bg-multi-select);\n  color: var(--dsw-alias-label-caption);\n}\n\n.panel_stageTitle { font-size: 14px; color: var(--dsw-alias-label-secondary); }\n\n.panel_stageDesc {\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n  max-width: 380px;\n  line-height: 19px;\n}\n\n/* 大图 */\n.panel_artFrame {\n  position: relative;\n  max-width: 100%;\n  max-height: 100%;\n  border-radius: var(--dsw-radius-md);\n  overflow: hidden;\n  box-shadow: 0 8px 28px var(--dsw-alias-bg-mask-2);\n  background: var(--dsw-alias-bg-multi-select);\n  /* 双击 = 用系统默认程序打开原图（老板 2026-10-18 需求）。\n     指针形状给个「这里可以点」的信号，具体动作在 title 里说清。 */\n  cursor: pointer;\n}\n\n/*\n * 真图。`object-fit: contain` —— 舞台的 aspect-ratio 是按用户选的比例设的，\n * 万一上游给的图比例不同（模型可能改比例），要完整显示而不是裁掉一角。\n */\n.panel_realImage {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: contain;\n  background: var(--dsw-alias-bg-multi-select);\n}\n\n/* 历史缩略图：这里反过来用 cover，方格要满，不然一排小图参差不齐。 */\n.panel_realThumb {\n  display: block;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.panel_costBadge {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  height: 22px;\n  padding: 0 8px;\n  border-radius: 11px;\n  background: var(--dsw-alias-bg-mask-1);\n  color: #fff;\n  font-size: 11px;\n  font-family: var(--ds-font-family-code);\n  backdrop-filter: blur(6px);\n}\n\n.panel_costBadge .panel_ok { color: var(--dsw-alias-state-success-secondary); }\n\n.panel_sizeBadge {\n  position: absolute;\n  left: 8px;\n  bottom: 8px;\n  height: 22px;\n  padding: 0 8px;\n  display: inline-flex;\n  align-items: center;\n  border-radius: 11px;\n  background: var(--dsw-alias-bg-mask-1);\n  color: #fff;\n  font-size: 11px;\n  font-family: var(--ds-font-family-code);\n}\n\n/* 生成中 */\n.panel_spinner {\n  width: 26px;\n  height: 26px;\n  border-radius: 50%;\n  border: 2px solid var(--dsw-alias-border-l4);\n  border-top-color: var(--dsw-alias-brand-primary);\n  animation: spin .8s linear infinite;\n}\n\n@keyframes spin { to { transform: rotate(360deg); } }\n\n.panel_progressWrap { width: 260px; }\n\n.panel_progressTrack {\n  height: 4px;\n  border-radius: 2px;\n  background: var(--dsw-alias-bg-skeleton);\n  overflow: hidden;\n}\n\n.panel_progressBar {\n  height: 100%;\n  width: 42%;\n  border-radius: 2px;\n  background: var(--dsw-alias-brand-primary);\n  animation: slide 1.4s var(--ds-ease-in-out) infinite;\n}\n\n@keyframes slide {\n  0% { margin-left: -42%; }\n  100% { margin-left: 100%; }\n}\n\n.panel_elapsed {\n  font-family: var(--ds-font-family-code);\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n/* 出错 */\n.panel_errGlyph {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 44px;\n  height: 44px;\n  border-radius: 50%;\n  background: var(--dsw-alias-code-diff-deleted);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.panel_errCard {\n  max-width: 460px;\n  text-align: left;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-layer-1);\n  padding: 10px 12px;\n  font-family: var(--ds-font-family-code);\n  font-size: 11.5px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n/* 结果操作条（两行：信息一行、按钮一行） */\n.panel_resultBar {\n  flex: none;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  min-width: 0;\n}\n\n.panel_resultInfo { display: flex; align-items: center; gap: 8px; min-width: 0; }\n\n.panel_resultActions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  justify-content: flex-end;\n}\n\n.panel_resultBar .panel_spacer { flex: 1; }\n\n.panel_resultMeta {\n  flex: none;\n  white-space: nowrap;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.panel_savedTag {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.panel_savedTag > svg { flex: none; }\n\n/*\n * 结果行第二行：这张图当时用的模型与参数。\n *\n * 单行 + 省略号是默认形态：模型 id 可以很长（`openai/gpt-image-2.5-flare`），\n * 参数最多十项，硬撑成一行会把整条结果栏撑破。`+N` 展开后允许换行 ——\n * 老板特意提过「注意长度和显示问题」，这里就是那一条的落点。\n */\n.panel_facts {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.panel_factsExpanded { flex-wrap: wrap; row-gap: 4px; }\n\n.panel_factModel {\n  flex: none;\n  max-width: 240px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  padding: 1px 6px;\n  border-radius: var(--dsw-radius-xs);\n  border: 1px solid var(--dsw-alias-border-l1);\n  background: var(--dsw-alias-bg-multi-select);\n  color: var(--dsw-alias-label-secondary);\n  font-family: var(--ds-font-family-code);\n}\n\n/* 与设置区不一致：不是错误，是「别拿另一个模型去重跑」的提醒，所以用 warning 而不是 error。 */\n.panel_factModelDiff {\n  border-color: var(--dsw-alias-state-warn-secondary);\n  background: var(--dsw-alias-state-warn-tertiary);\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.panel_factDiffTag { flex: none; color: var(--dsw-alias-state-warning-primary, #b7791f); }\n\n.panel_factParams {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* 展开后参数自己占满一行、可以换行，模型 chip 留在上一行。 */\n.panel_factsExpanded .panel_factParams { flex: 1 1 100%; white-space: normal; word-break: break-word; }\n\n.panel_factMore {\n  flex: none;\n  height: 18px;\n  padding: 0 6px;\n  border-radius: var(--dsw-radius-xs);\n  border: 1px solid var(--dsw-alias-border-l1);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  cursor: pointer;\n}\n\n.panel_factMore:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n/* 历史 */\n.panel_history {\n  flex: none;\n  padding-top: 12px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  min-width: 0;\n}\n\n/*\n * 历史行：图标 +「历史记录」+「最近 N 张」+ 行内提示 +「清空」。\n *\n * `white-space: nowrap` 是**必须的**（2026-10-18 复验发现的问题）：这一行里只有\n * `.notice` 能缩（它有 `min-width: 0` + 自己那层省略号），但默认所有子项 `flex-shrink: 1`\n * 都会分摊负余量 —— 一旦提示很长（实测 439px 文本 / 450px 容器，「已经保存到 C:\\…png」\n * 这种就够），「历史记录」「最近 N 张」这两个只比内容宽 0-1px 的标签就会被挤成两行，\n * 整行从 22px 变 44px，而舞台是弹性项 —— 换行多出来的高度直接从预览区扣回去，\n * 把改动①刚还给预览区的空间又吃掉一部分。nowrap 之后标签的 min-content = 整串文本，\n * 缩不动，负余量只能由提示吸收（也就是我们想要的那一个被省略）。\n */\n.panel_historyHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 8px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n}\n\n/* 图标也不许被压缩（图标没有文字可省略，压小了只会变形）。 */\n.panel_historyHead > svg { flex: none; }\n\n.panel_historyHead .panel_clear {\n  margin-left: auto;\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n  cursor: pointer;\n  background: none;\n  border: 0;\n  font: inherit;\n  padding: 0;\n}\n\n.panel_historyHead .panel_clear:hover { color: var(--dsw-alias-label-secondary); }\n\n/*\n * 行内提示（2026-10-18）。\n *\n * 它以前是浮在面板底部的一块 `.toast`（成功灰底、失败红底），老板要求搬到\n * 「历史记录 · 最近 N 张」右边、做成一档可读的小字。两条纪律：\n *  1. 字号固定 12px、单行省略、全文进 `title` —— 消息长度差得远（「已保存到\n *     C:\\…\\out\\…png」比「已取消」长十几倍），不许因此把这行撑高或撑宽。\n *     长消息会把**这一行**挤爆，所以 `.historyHead` 是 `white-space: nowrap`，\n *     负余量全部由这里（`min-width: 0` + 省略号）吸收，行高恒为 22px。\n *  2. 成功 = 次级灰、警告/失败 = 错误红；不再用整块底色抢注意力。\n *     停留时间与搬之前一样（成功 1.8s / 失败 6s），改的只是位置。\n */\n.panel_historyHead .panel_notice {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  /* 只按内容占位、需要时才缩（不是 `flex: 1 1 auto` —— 那会白占掉整行，\n     把「清空」推到最右边之外的多余空间里，长提示反而更早被省略）。 */\n  flex: 0 1 auto;\n  min-width: 0;\n  font-size: 12px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_historyHead .panel_notice svg { flex: none; }\n\n.panel_historyHead .panel_noticeText {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.panel_historyHead .panel_noticeErr { color: var(--dsw-alias-state-error-primary); }\n\n/* ------------------------------------------------------- 历史图右键菜单 */\n\n/* 透明遮罩：点别处（或右键别处）就关。比在 document 上挂监听干净，也不会漏点。 */\n.panel_ctxBackdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 70;\n}\n\n.panel_ctxMenu {\n  position: fixed;\n  z-index: 71;\n  width: 216px;\n  padding: 4px;\n  display: flex;\n  flex-direction: column;\n  border-radius: var(--dsw-radius-md);\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-overlay);\n  box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);\n}\n\n.panel_ctxItem {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 2px;\n  padding: 7px 10px;\n  border: 0;\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.panel_ctxItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }\n.panel_ctxItem:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }\n\n.panel_ctxHint {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  line-height: 14px;\n}\n\n.panel_ctxItem:disabled .panel_ctxHint { color: var(--dsw-alias-label-tertiary); }\n\n.panel_historyStrip {\n  display: flex;\n  gap: 8px;\n  overflow-x: auto;\n  padding-bottom: 4px;\n}\n\n.panel_histItem {\n  position: relative;\n  flex: none;\n  width: 76px;\n  height: 76px;\n  padding: 0;\n  border-radius: var(--dsw-radius-sm);\n  overflow: hidden;\n  border: 1.5px solid transparent;\n  background: var(--dsw-alias-bg-multi-select);\n  cursor: pointer;\n}\n\n.panel_histItem:hover { border-color: var(--dsw-alias-border-l4); }\n.panel_histItem[aria-current=\"true\"] { border-color: var(--dsw-alias-brand-primary); }\n\n.panel_histItem .panel_hcost {\n  position: absolute;\n  right: 3px;\n  bottom: 3px;\n  padding: 0 4px;\n  border-radius: 3px;\n  background: var(--dsw-alias-bg-mask-1);\n  color: #fff;\n  font-family: var(--ds-font-family-code);\n  font-size: 10px;\n  line-height: 15px;\n}\n\n/* ---------------------------------------------------------------- 弹层 */\n\n.panel_overlay {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 24px;\n  background: var(--dsw-alias-bg-mask-3);\n  z-index: 50;\n}\n\n.panel_modal {\n  width: 640px;\n  max-width: 100%;\n  max-height: 100%;\n  display: flex;\n  flex-direction: column;\n  border-radius: var(--dsw-radius-panel);\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-overlay);\n  box-shadow: 0 24px 64px var(--dsw-alias-bg-mask-3);\n  overflow: hidden;\n}\n\n.panel_modalHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 16px 20px 12px;\n}\n\n.panel_modalHead h2 { margin: 0; font-size: 15px; font-weight: 600; }\n.panel_modalHead .panel_sub { font-size: 12px; color: var(--dsw-alias-label-tertiary); }\n\n.panel_modalBody {\n  padding: 4px 20px 8px;\n  overflow: auto;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  /*\n    这两行是「高级点不开」那个 bug 的解药。\n    flex 子项的自动最小尺寸默认是内容尺寸，不写 `min-height: 0` 它就不肯收缩，\n    内容一超长就被 `.modal` 的 overflow:hidden 裁掉 —— 展开的东西直接看不见。\n  */\n  flex: 1 1 auto;\n  min-height: 0;\n  overscroll-behavior: contain;\n}\n\n.panel_modalFoot {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 20px 16px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n\n.panel_modalFoot .panel_spacer { flex: 1; }\n\n.panel_formRow {\n  display: grid;\n  grid-template-columns: 132px minmax(0, 1fr);\n  align-items: start;\n  gap: 12px;\n}\n\n.panel_formKey {\n  padding-top: 8px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_formKey .panel_req { color: var(--dsw-alias-state-error-primary); margin-left: 2px; }\n\n.panel_formCtl { display: flex; flex-direction: column; gap: 6px; min-width: 0; }\n\n.panel_input {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  height: 34px;\n  padding: 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-specific-input-major);\n}\n\n.panel_input:focus-within { border-color: var(--dsw-alias-state-business-primary); }\n\n.panel_input input {\n  width: 100%;\n  border: 0;\n  outline: 0;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n}\n\n.panel_mono { font-family: var(--ds-font-family-code); font-size: 12.5px; }\n\n.panel_formTip {\n  font-size: 11px;\n  line-height: 17px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.panel_formTip code {\n  font-family: var(--ds-font-family-code);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.panel_keyOk {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 34px;\n  padding: 0 10px;\n  border: 1px dashed var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_keyOk > svg { color: var(--dsw-alias-state-success-primary); flex: none; }\n\n.panel_keyOk .panel_badge {\n  margin-left: auto;\n  font-family: var(--ds-font-family-code);\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.panel_seg {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-multi-select);\n  border: 1px solid var(--dsw-alias-border-l1);\n}\n\n.panel_seg button {\n  flex: 1;\n  height: 28px;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 12.5px;\n  cursor: pointer;\n}\n\n.panel_seg button[aria-pressed=\"true\"] {\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n.panel_adv {\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-md);\n  overflow: hidden;\n}\n\n.panel_advTitle {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 9px 12px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n  background: var(--dsw-alias-interactive-bg-hover);\n  font-size: 13px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.panel_advTitle span {\n  margin-left: auto;\n  font-size: 11px;\n  font-weight: 400;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.panel_advBody {\n  padding: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.panel_extraJson {\n  width: 100%;\n  min-height: 76px;\n  resize: vertical;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-specific-input-major);\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--ds-font-family-code);\n  font-size: 12px;\n  line-height: 18px;\n  padding: 8px 10px;\n  outline: 0;\n  box-sizing: border-box;\n}\n\n.panel_modelList {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  max-height: 168px;\n  overflow: auto;\n}\n\n.panel_modelItem {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 7px 9px;\n  border-radius: var(--dsw-radius-sm);\n  border: 1px solid transparent;\n  cursor: pointer;\n  font-size: 12.5px;\n  background: none;\n  font-family: inherit;\n  color: inherit;\n  text-align: left;\n  width: 100%;\n}\n\n.panel_modelItem:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n.panel_modelItem[aria-selected=\"true\"] {\n  border-color: var(--dsw-alias-brand-primary);\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n.panel_modelItem .panel_id { font-family: var(--ds-font-family-code); font-size: 12px; }\n\n.panel_modelItem .panel_price {\n  margin-left: auto;\n  font-family: var(--ds-font-family-code);\n  font-size: 11px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.panel_modelItem .panel_caps { display: flex; gap: 4px; }\n\n.panel_cap {\n  font-size: 10px;\n  line-height: 15px;\n  padding: 0 4px;\n  border-radius: 3px;\n  background: var(--dsw-alias-bg-multi-select);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* 轻提示：2026-10-18 起不再浮在面板底部 —— 改挂在历史行右侧（见 `.historyHead .notice`）。\n   整套 `.toast` / `.toastErr` 规则随之下线：留着只会是没人引用的悬空样式。 */\n\n/* ---------------------------------------------------------------- 动效偏好 */\n\n@media (prefers-reduced-motion: reduce) {\n  .panel_spinner { animation: none; }\n  .panel_progressBar { animation: none; }\n}\n\n/* ------------------------------------------------------------ 错误态可滚动 */\n\n/*\n  `.stage` 是 `overflow: hidden`，错误详情一长就被裁掉且没有滚动条 ——\n  「报错看不全」的直接原因。错误态改用这一点：顶部对齐 + 自己能滚。\n*/\n.panel_stageInnerErr {\n  justify-content: flex-start;\n  overflow: auto;\n  overscroll-behavior: contain;\n  padding-top: 24px;\n}\n\n/* 错误卡片在错误态放宽到整宽：上游原文常有长 URL / JSON，460px 会折成一堆短行。 */\n.panel_errCardWide { max-width: 100%; }\n\n/* -------------------------------------------------------------- 宿主日志抽屉 */\n\n.panel_logModal { width: 860px; }\n\n/* 日志文件路径：等宽、可选中、太长就省略（title 里有全文）。 */\n.panel_logPath {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 0 20px 8px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n  min-width: 0;\n}\n\n.panel_logPath code {\n  font-family: var(--ds-font-family-code);\n  font-size: 11.5px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  min-width: 0;\n}\n\n.panel_logList {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  font-family: var(--ds-font-family-code);\n  font-size: 11.5px;\n  line-height: 17px;\n}\n\n.panel_logLine {\n  display: grid;\n  grid-template-columns: 132px minmax(0, 1fr);\n  gap: 10px;\n  padding: 4px 6px;\n  border-radius: var(--dsw-radius-md);\n  color: var(--dsw-alias-label-secondary);\n  word-break: break-word;\n}\n\n.panel_logLine:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.panel_logTime { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }\n.panel_logText { white-space: pre-wrap; }\n\n/* 警告 / 错误两档各自上色：一眼能捞出「哪几条是这次失败的」。 */\n.panel_logWarn { color: var(--dsw-alias-state-warn-label); }\n.panel_logErr { color: var(--dsw-alias-state-error-primary); }\n\n.panel_logEmpty {\n  padding: 24px 4px;\n  font-size: 12.5px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n";
const tagId = "dsh-imagegen-panel/panel";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const style = document.createElement("style");
  style.setAttribute("data-plugin-css", tagId);
  style.textContent = css;
  document.head.appendChild(style);
}
exports.default = {"panel":"panel_panel","head":"panel_head","headText":"panel_headText","title":"panel_title","sub":"panel_sub","btn":"panel_btn","btnPrimary":"panel_btnPrimary","btnGhost":"panel_btnGhost","btnLg":"panel_btnLg","btnSm":"panel_btnSm","chip":"panel_chip","guide":"panel_guide","guideErr":"panel_guideErr","guideHint":"panel_guideHint","body2":"panel_body2","leftCol":"panel_leftCol","composer":"panel_composer","field":"panel_field","fieldLabel":"panel_fieldLabel","hint":"panel_hint","promptWrap":"panel_promptWrap","prompt":"panel_prompt","promptTools":"panel_promptTools","counter":"panel_counter","refGrid":"panel_refGrid","refAdd":"panel_refAdd","refThumb":"panel_refThumb","rm":"panel_rm","tag":"panel_tag","params":"panel_params","paramLabel":"panel_paramLabel","select":"panel_select","chev":"panel_chev","paramsNote":"panel_paramsNote","paramsNoteWarn":"panel_paramsNoteWarn","paramGroup":"panel_paramGroup","paramRange":"panel_paramRange","toggle":"panel_toggle","toggleKnob":"panel_toggleKnob","toggleText":"panel_toggleText","actions":"panel_actions","genRow":"panel_genRow","modelRow":"panel_modelRow","genMeta":"panel_genMeta","dot":"panel_dot","result":"panel_result","stage":"panel_stage","stageInner":"panel_stageInner","emptyGlyph":"panel_emptyGlyph","stageTitle":"panel_stageTitle","stageDesc":"panel_stageDesc","artFrame":"panel_artFrame","realImage":"panel_realImage","realThumb":"panel_realThumb","costBadge":"panel_costBadge","ok":"panel_ok","sizeBadge":"panel_sizeBadge","spinner":"panel_spinner","progressWrap":"panel_progressWrap","progressTrack":"panel_progressTrack","progressBar":"panel_progressBar","elapsed":"panel_elapsed","errGlyph":"panel_errGlyph","errCard":"panel_errCard","resultBar":"panel_resultBar","resultInfo":"panel_resultInfo","resultActions":"panel_resultActions","spacer":"panel_spacer","resultMeta":"panel_resultMeta","savedTag":"panel_savedTag","facts":"panel_facts","factsExpanded":"panel_factsExpanded","factModel":"panel_factModel","factModelDiff":"panel_factModelDiff","factDiffTag":"panel_factDiffTag","factParams":"panel_factParams","factMore":"panel_factMore","history":"panel_history","historyHead":"panel_historyHead","clear":"panel_clear","notice":"panel_notice","noticeText":"panel_noticeText","noticeErr":"panel_noticeErr","ctxBackdrop":"panel_ctxBackdrop","ctxMenu":"panel_ctxMenu","ctxItem":"panel_ctxItem","ctxHint":"panel_ctxHint","historyStrip":"panel_historyStrip","histItem":"panel_histItem","hcost":"panel_hcost","overlay":"panel_overlay","modal":"panel_modal","modalHead":"panel_modalHead","modalBody":"panel_modalBody","modalFoot":"panel_modalFoot","formRow":"panel_formRow","formKey":"panel_formKey","req":"panel_req","formCtl":"panel_formCtl","input":"panel_input","mono":"panel_mono","formTip":"panel_formTip","keyOk":"panel_keyOk","badge":"panel_badge","seg":"panel_seg","adv":"panel_adv","advTitle":"panel_advTitle","advBody":"panel_advBody","extraJson":"panel_extraJson","modelList":"panel_modelList","modelItem":"panel_modelItem","id":"panel_id","price":"panel_price","caps":"panel_caps","cap":"panel_cap","stageInnerErr":"panel_stageInnerErr","errCardWide":"panel_errCardWide","logModal":"panel_logModal","logPath":"panel_logPath","logList":"panel_logList","logLine":"panel_logLine","logTime":"panel_logTime","logText":"panel_logText","logWarn":"panel_logWarn","logErr":"panel_logErr","logEmpty":"panel_logEmpty"};
			},
		};
		function __dshRequire(id) {
			var cached = __cache.get(id);
			if (cached !== undefined) return cached.exports;
			var factory = __modules[id];
			if (factory === undefined) throw new Error("dsh-imagegen-panel: unknown bundled module " + id);
			var record = { exports: {} };
			__cache.set(id, record);
			factory(record, record.exports, __dshModuleRequire);
			return record.exports;
		}
		// A bundled factory calling require() must reach the platform table for
		// seeded specifiers and the internal registry for everything bundled.
		function __dshModuleRequire(id) {
			if (__modules[id] !== undefined) return __dshRequire(id);
			return require(id);
		}
		// The entry module owns the bundle's public exports. Dispatching it with
		// THIS module object (rather than a fresh record) is what makes the
		// loader see the real export surface.
		var __entryFactory = __modules["src/client/index.tsx"];
		if (__entryFactory === undefined) throw new Error("dsh-imagegen-panel: entry module src/client/index.tsx is missing from the bundle");
		__cache.set("src/client/index.tsx", module);
		__entryFactory(module, exports, __dshModuleRequire);
		return module.exports;
	}
});
