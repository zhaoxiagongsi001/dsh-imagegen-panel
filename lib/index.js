import { chmod, mkdir, readFile, rename, writeFile, copyFile, appendFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { join } from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

// ---- src/config-store.ts ----
/**
 * 宿主侧配置存储（阶段 3）。
 *
 * 位置：`<用户主目录>/.dsh/dsh-imagegen-panel/config.json`
 *
 * 为什么**不**用 `.dsh/dsh-imagegen/`：那个目录已经被内置 `dsh-image-gen` 插件占用
 * （`templates/` + `template-images/`，约 1.6 GB）。把我们的 `config.json` 混进去，
 * 一旦内置插件哪天也读同名文件就会互相踩 —— 插件各占一个目录是更省心的边界。
 *
 * 为什么 Key 存宿主：明文只在宿主进程里出现。HTTP 路由只回 `hasKey` + 掩码
 * `keyHint`，明文永不下发到浏览器 —— 这是阶段 3 的负面验收项。
 *
 * 读盘策略：**不做内存缓存**。每次 GET 都重新读文件，代价是一个几 KB 的读，
 * 换来的是「磁盘文件就是唯一真相」—— 手改文件立刻生效，也不用担心半年前
 * 缓存住的值覆盖用户的新配置。
 */
/** 允许的协议取值。 */
const PROTOCOLS = ['openrouter', 'openai', 'gemini', 'custom'];
/** 允许的输出格式。 */
const OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'svg'];
/** 配置文件格式版本，供将来迁移用。 */
const CONFIG_VERSION = 1;
/** 超时秒数的允许区间。 */
const MIN_TIMEOUT_SEC = 5;
const MAX_TIMEOUT_SEC = 3600;
/** 未配置时的默认值。宿主是权威；客户端 `defaults.ts` 那份只为首帧打底。 */
const DEFAULT_SETTINGS = {
    protocol: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3-pro-image',
    // 默认另存到本机「图片」目录。旧版本硬编码成作者本机的一个绝对路径，既泄漏本机结构，
    // 在其他用户的机器上也是个不存在的目录（自动另存必然失败）。
    autoSaveDir: path.join(homedir(), 'Pictures', 'dsh-imagegen'),
    extraJson: '{\n  "background": "opaque",\n  "output_compression": 90,\n  "provider": { "sort": "price" }\n}',
    timeoutSec: 180,
    outputFormat: 'png',
};
/**
 * 本插件的数据根目录。
 *
 * `DSH_IMAGEGEN_HOME` 覆盖只为一个目的存在：`scripts/host-check.mjs` 要在一个临时
 * 目录里跑完整的落盘往返，不能碰老板的真实配置。生产路径不受影响。
 * @returns 绝对路径。
 */
function imagegenHome() {
    const override = process.env.DSH_IMAGEGEN_HOME;
    if (typeof override === 'string' && override.trim() !== '')
        return path.resolve(override);
    return path.join(homedir(), '.dsh', 'dsh-imagegen-panel');
}
/** 配置文件绝对路径（含明文 Key）。 */
function configFilePath() {
    return path.join(imagegenHome(), 'config.json');
}
/** 历史索引绝对路径（阶段 5 写入，阶段 3 只读）。 */
function historyIndexPath() {
    return path.join(imagegenHome(), 'index.json');
}
/** 出图落盘目录（阶段 5 使用）。 */
function imageOutDir() {
    return path.join(imagegenHome(), 'out');
}
/** 是否属于允许的协议。 */
function isProtocol(value) {
    return typeof value === 'string' && PROTOCOLS.includes(value);
}
/** 是否属于允许的输出格式。 */
function isOutputFormat(value) {
    return typeof value === 'string' && OUTPUT_FORMATS.includes(value);
}
/** 一个非空字符串？ */
function isFilledString(value) {
    return typeof value === 'string' && value.trim() !== '';
}
/**
 * 把任意来源（磁盘文件、PUT body）的字段宽松地收敛成 Settings。
 *
 * 宽松是刻意的：磁盘上的文件可能被手改过，一个错字段不该让整个面板起不来 ——
 * 非法值退回默认值，整体永远返回一份可直接使用的配置。
 * @param raw - 未知来源的对象。
 * @returns 完整的 Settings。
 */
function coerceSettings(raw) {
    const source = (typeof raw === 'object' && raw !== null ? raw : {});
    const timeout = typeof source.timeoutSec === 'number' && Number.isFinite(source.timeoutSec)
        ? Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, Math.round(source.timeoutSec)))
        : DEFAULT_SETTINGS.timeoutSec;
    return {
        protocol: isProtocol(source.protocol) ? source.protocol : DEFAULT_SETTINGS.protocol,
        baseUrl: isFilledString(source.baseUrl) ? source.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
        model: isFilledString(source.model) ? source.model.trim() : DEFAULT_SETTINGS.model,
        autoSaveDir: isFilledString(source.autoSaveDir) ? source.autoSaveDir.trim() : DEFAULT_SETTINGS.autoSaveDir,
        extraJson: typeof source.extraJson === 'string' ? source.extraJson : DEFAULT_SETTINGS.extraJson,
        timeoutSec: timeout,
        outputFormat: isOutputFormat(source.outputFormat) ? source.outputFormat : DEFAULT_SETTINGS.outputFormat,
    };
}
/**
 * 校验浏览器提交的配置增量。
 *
 * 只接受**出现过的**字段（PUT 语义），出现的字段必须合法 —— 这里拒绝而不是静默
 * 纠正，因为用户就在弹层里，报错能让他当场改；静默改写只会让「我明明填了」变成一个谜。
 * 手工编辑磁盘文件走的是另一条宽松路径（{@link coerceSettings}）。
 * @param raw - PUT body 里的 `config` 对象。
 * @returns 通过则给出增量，否则给出可展示的原因。
 */
function validatePatch(raw) {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, code: 'bad-config', message: 'config 必须是一个对象' };
    }
    const source = raw;
    const patch = {};
    if ('protocol' in source) {
        if (!isProtocol(source.protocol)) {
            return { ok: false, code: 'bad-protocol', message: `协议只能是 ${PROTOCOLS.join(' / ')}` };
        }
        patch.protocol = source.protocol;
    }
    if ('baseUrl' in source) {
        const value = source.baseUrl;
        if (!isFilledString(value)) {
            return { ok: false, code: 'bad-base-url', message: 'Base URL 不能为空' };
        }
        let parsed;
        try {
            parsed = new URL(value.trim());
        }
        catch {
            return { ok: false, code: 'bad-base-url', message: `Base URL 不是合法地址：${value.trim()}` };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { ok: false, code: 'bad-base-url', message: 'Base URL 必须是 http(s) 地址' };
        }
        patch.baseUrl = value.trim().replace(/\/+$/, '');
    }
    if ('model' in source) {
        if (!isFilledString(source.model)) {
            return { ok: false, code: 'bad-model', message: '默认模型不能为空' };
        }
        patch.model = source.model.trim();
    }
    if ('autoSaveDir' in source) {
        if (!isFilledString(source.autoSaveDir)) {
            return { ok: false, code: 'bad-auto-save-dir', message: '自动保存目录不能为空' };
        }
        patch.autoSaveDir = source.autoSaveDir.trim();
    }
    if ('extraJson' in source) {
        const value = source.extraJson;
        if (typeof value !== 'string') {
            return { ok: false, code: 'bad-extra-json', message: '额外参数必须是字符串' };
        }
        if (value.trim() !== '') {
            let parsed;
            try {
                parsed = JSON.parse(value);
            }
            catch (error) {
                return {
                    ok: false,
                    code: 'bad-extra-json',
                    message: `额外参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
                };
            }
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return { ok: false, code: 'bad-extra-json', message: '额外参数必须是一个 JSON 对象' };
            }
        }
        patch.extraJson = value;
    }
    if ('timeoutSec' in source) {
        const value = source.timeoutSec;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return { ok: false, code: 'bad-timeout', message: '超时必须是数字（秒）' };
        }
        if (value < MIN_TIMEOUT_SEC || value > MAX_TIMEOUT_SEC) {
            return {
                ok: false,
                code: 'bad-timeout',
                message: `超时需在 ${MIN_TIMEOUT_SEC}–${MAX_TIMEOUT_SEC} 秒之间`,
            };
        }
        patch.timeoutSec = Math.round(value);
    }
    if ('outputFormat' in source) {
        if (!isOutputFormat(source.outputFormat)) {
            return { ok: false, code: 'bad-output-format', message: `输出格式只能是 ${OUTPUT_FORMATS.join(' / ')}` };
        }
        patch.outputFormat = source.outputFormat;
    }
    return { ok: true, patch };
}
/**
 * 读配置。
 *
 * 文件不存在 = 首次使用，返回默认值（不写盘，避免「装完插件就凭空多一个文件」）。
 * 文件损坏 = 改名备份 + 返回默认值：宁可用户重填一次，也不要让面板卡在报错上，
 * 同时**不销毁**原始内容，方便事后查。
 * @returns 配置 + 明文 Key + 是否存在。
 */
async function readConfig() {
    const file = configFilePath();
    let text;
    try {
        text = await readFile(file, 'utf8');
    }
    catch {
        return { settings: { ...DEFAULT_SETTINGS }, apiKey: '', existed: false };
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        const backupPath = `${file}.corrupt-${Date.now()}`;
        try {
            await rename(file, backupPath);
        }
        catch {
            // 备份失败不影响返回默认值。
        }
        return { settings: { ...DEFAULT_SETTINGS }, apiKey: '', existed: false, backupPath };
    }
    const source = (typeof parsed === 'object' && parsed !== null ? parsed : {});
    const apiKey = typeof source.apiKey === 'string' ? source.apiKey : '';
    return { settings: coerceSettings(source), apiKey, existed: true };
}
/**
 * 落盘配置（原子写：先写同目录临时文件再 rename）。
 *
 * 为什么原子：这个进程和用户的手可能同时碰这个文件；`rename` 在同分区上是原子的，
 * 于是任何时刻读到的都是「旧的完整版本」或「新的完整版本」，不会读到半截 JSON。
 * @param settings - 完整配置。
 * @param apiKey - 明文 Key（空串 = 未配置）。
 */
async function writeConfig(settings, apiKey) {
    const home = imagegenHome();
    await mkdir(home, { recursive: true });
    const payload = {
        version: CONFIG_VERSION,
        updatedAt: new Date().toISOString(),
        apiKey,
        ...settings,
    };
    const file = configFilePath();
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
    // 权限收紧（best-effort）。Windows 上 chmod 基本是空操作 —— NTFS 的实际 ACL
    // 不由 POSIX mode 表达。真正的保护是「这台机器只有老板一个用户 + 文件在个人目录
    // 下」，README 里已经写明，不要在这里假装做到了。
    try {
        await chmod(home, 0o700);
        await chmod(file, 0o600);
    }
    catch {
        // 不影响功能。
    }
}
/**
 * Key 掩码。
 *
 * 保留头部 6 位（`sk-or-` 这种前缀不足以还原 Key）+ 尾部 4 位，让用户能对上号，
 * 但任何拿到掩码的人都复原不出明文。
 * @param apiKey - 明文 Key。
 * @returns 掩码；未配置时是空串。
 */
function maskKey(apiKey) {
    if (apiKey === '')
        return '';
    const head = apiKey.slice(0, 6);
    const tail = apiKey.length > 12 ? apiKey.slice(-4) : '';
    return `${head}••••••••${tail}`;
}
/**
 * 组装下发给浏览器的配置视图。
 *
 * **唯一**允许离开宿主进程的配置形态 —— 明文 Key 在返回类型里根本没有位置，
 * 所以「不小心回传明文」在类型上就写不出来。
 * @param settings - 配置字段。
 * @param apiKey - 明文 Key（只用来算 hasKey / keyHint）。
 * @returns 可安全下发的视图。
 */
function publicConfig(settings, apiKey) {
    return {
        ...settings,
        hasKey: apiKey !== '',
        keyHint: maskKey(apiKey),
    };
}

// ---- src/draft-store.ts ----
/**
 * 面板草稿（阶段 9）。
 *
 * 位置：`<用户主目录>/.dsh/dsh-imagegen-panel/draft.json`
 *
 * 为什么需要它：面板状态原来只活在模块作用域里 —— 切面板能留住，**重启 DSH 就全没了**。
 * 而「首次进入生图插件时，上次生成成功就给我空的、上次写了没生成就留着」这条规则
 * 需要一个跨重启的判据：既要那份没生成的草稿，也要「最后一次成功生成用的是哪句提示词」。
 * 所以落盘三件事：
 *   1. 草稿本体（提示词 + 核心四项参数 + 模型驱动表单那些额外字段）；
 *   2. `lastGeneratedPrompt` —— 最后一次**成功生成**用的提示词；
 *   3. 更新时间。
 *
 * 判「这份草稿是不是未生成的」**不在这里做**：宿主只负责如实存取，
 * 规则（含空串、前后空白怎么算）集中在前端一处，免得两边各有一套「脏」的定义。
 *
 * 三个刻意的决定：
 *  - **宽松收敛**：磁盘文件可能被手改过，一个坏字段不该让面板起不来 ——
 *    非法值退回默认，整体永远返回一份能直接用的草稿。
 *  - **只存文本，不存参考图**：参考图是几 MB 的 data URL，落盘会让这份小 JSON 变成
 *    一块二进制垃圾场；界面上如实显示「参考图 N 张」就够了。
 *  - **原子写**：临时文件 + rename，避免写到一半断电留下半个 JSON。
 */
/** 草稿文件格式版本，供将来迁移用。 */
const DRAFT_VERSION = 1;
/** 提示词的长度上限（面板输入框自己限 4000，这里放宽到 20000 只为兜住手改的文件）。 */
const MAX_DRAFT_PROMPT = 20000;
/** 单个额外字段取值的长度上限。 */
const MAX_DRAFT_VALUE = 200;
/** 额外字段最多记多少个（模型的参数表最多 10 项，32 已经非常宽松）。 */
const MAX_DRAFT_EXTRA = 32;
/** 草稿文件的绝对路径。 */
function draftFilePath() {
    return path.join(imagegenHome(), 'draft.json');
}
/** 一份空草稿（还没有任何草稿时用它打底）。 */
function emptyPanelDraft() {
    return {
        version: DRAFT_VERSION,
        prompt: '',
        params: { aspectRatio: '', resolution: '', count: '1', quality: '' },
        extra: {},
        lastGeneratedPrompt: '',
        updatedAt: 0,
    };
}
/** 一个可用的字符串（非字符串时给兜底）。提示词这类**只认字符串**：数字没有意义。 */
function draftText(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}
/**
 * 一个标量 → 字符串。
 *
 * 参数与额外字段走这条：与宿主侧解析生成请求时的口径一致（数字/布尔一律字符串化），
 * 免得「张数 42」这种数字在草稿里被当成坏值丢掉。
 */
function draftScalar(value, max) {
    if (typeof value === 'string')
        return value.slice(0, max);
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'boolean')
        return String(value);
    return '';
}
/**
 * 把任意来源（磁盘文件、PUT body）的字段宽松地收敛成一份草稿。
 * @param raw - 未知来源的对象。
 * @returns 完整的草稿（字段缺失时用空值补齐）。
 */
function coercePanelDraft(raw) {
    const base = emptyPanelDraft();
    const source = (typeof raw === 'object' && raw !== null ? raw : {});
    const rawParams = (typeof source.params === 'object' && source.params !== null ? source.params : {});
    const params = {
        aspectRatio: draftScalar(rawParams.aspectRatio, 64),
        resolution: draftScalar(rawParams.resolution, 64),
        count: draftScalar(rawParams.count, 16) === '' ? base.params.count : draftScalar(rawParams.count, 16),
        quality: draftScalar(rawParams.quality, 64),
    };
    const extra = {};
    if (typeof source.extra === 'object' && source.extra !== null) {
        for (const [key, value] of Object.entries(source.extra)) {
            if (Object.keys(extra).length >= MAX_DRAFT_EXTRA)
                break;
            if (key === '' || key.length > 64)
                continue;
            const text = draftScalar(value, MAX_DRAFT_VALUE);
            if (text === '')
                continue;
            extra[key] = text;
        }
    }
    return {
        version: DRAFT_VERSION,
        prompt: draftText(source.prompt, MAX_DRAFT_PROMPT),
        params,
        extra,
        // 上限与提示词一致：它本来就是「上一句提示词」。
        lastGeneratedPrompt: draftText(source.lastGeneratedPrompt, MAX_DRAFT_PROMPT),
        updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
    };
}
/**
 * 读草稿。
 * @returns 草稿；文件不存在或已损坏时返回 `undefined`（调用方按「还没有草稿」处理）。
 */
async function readPanelDraft() {
    let text;
    try {
        text = await readFile(draftFilePath(), 'utf8');
    }
    catch {
        return undefined;
    }
    try {
        return coercePanelDraft(JSON.parse(text));
    }
    catch {
        return undefined;
    }
}
/**
 * 写草稿（原子写：临时文件 + rename）。
 * @param draft - 要落盘的草稿（`updatedAt` 由这里覆盖成当前时间）。
 * @returns 落盘后的草稿（含新的 `updatedAt`）。
 */
async function writePanelDraft(draft) {
    const next = { ...coercePanelDraft(draft), version: DRAFT_VERSION, updatedAt: Date.now() };
    const file = draftFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temp, file);
    return next;
}

// ---- src/http.ts ----
/** 一次请求体的大小上限。配置是几十个字段的小 JSON，1 MB 已经非常宽松。 */
const MAX_BODY_BYTES = 1024 * 1024;
/**
 * 一个 JSON 响应。
 *
 * 调用方一律返回 200/4xx/5xx 加上 `{ ok: boolean }` 标记，让前端只读一处语义，
 * 不必在业务代码里散落 HTTP 状态码判断。
 * @param res - 响应对象。
 * @param status - HTTP 状态码。
 * @param body - 可序列化的响应体（**绝不能含明文 Key**）。
 */
function writeJson(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
    });
    res.end(JSON.stringify(body));
}
/**
 * 只允许本机浏览器访问。
 *
 * 三条独立判据，任何一条不满足就拒绝：
 *   1. 对端地址必须是环回（`127.0.0.1` / `::1`）；
 *   2. `Host` 头必须解析成环回主机名（挡住 DNS 重绑定）；
 *   3. `Origin` 若存在，必须与 `Host` 同源 —— 别的网页即便能连到本机端口，
 *      也读不到我们的响应。
 * @param req - 请求。
 * @returns 是否放行。
 */
function isLoopbackRequest(req) {
    const address = req.socket?.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')
        return false;
    const host = req.headers.host;
    if (typeof host !== 'string')
        return false;
    let hostUrl;
    try {
        hostUrl = new URL(`http://${host}`);
    }
    catch {
        return false;
    }
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') {
        return false;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === hostUrl.host;
    }
    catch {
        return false;
    }
}
/**
 * 读一个 JSON 请求体。
 * @param req - 请求。
 * @param maxBytes - 超过即放弃（默认 {@link MAX_BODY_BYTES}）。
 * @returns 解析出的对象；读不出/超限/不是对象时返回 undefined。
 */
async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > maxBytes)
            return undefined;
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return undefined;
    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/** 统一的 403 文案（loopback 围栏拦下时）。 */
function forbiddenBody() {
    return { ok: false, code: 'forbidden', message: '这些接口只接受本机同源请求' };
}
/** 统一的 405 文案。 */
function methodBody(method) {
    return { ok: false, code: 'method-not-allowed', message: `不支持的方法：${method ?? '未知'}` };
}
/** 统一的 400 文案（请求体读不出来时）。 */
function badRequestBody() {
    return { ok: false, code: 'bad-request', message: '请求体不是合法 JSON，或超过了大小上限' };
}

// ---- src/image-store.ts ----
/**
 * 出图落盘与历史索引（阶段 4）。
 *
 * 目录：`~/.dsh/dsh-imagegen-panel/out/`（图片）+ `index.json`（索引，最新在前）。
 *
 * 两个刻意的决定：
 *  1. **索引与文件分开放**：图片是二进制大块，索引是每次列表都要读的小 JSON。
 *     混在一起会让「打开面板读历史」变成「读一堆图」。
 *  2. **尺寸从字节里量，不猜**：上游只给「1K / 2K」这种档位，不给像素。界面上
 *     `1536 × 864` 这种角标必须是量出来的 —— 按比例估算是编数据，一旦和真图对不上
 *     就是在骗用户。所以这里解析 PNG/JPEG/WebP 的文件头拿真实宽高（约 40 行）。
 */
/** 索引里保留的最大条数（最新的在前）。 */
const MAX_INDEX_ENTRIES = 200;
/** 媒体类型 → 扩展名。 */
function extensionOf(mediaType) {
    switch (mediaType) {
        case 'image/jpeg': return 'jpg';
        case 'image/webp': return 'webp';
        case 'image/svg+xml': return 'svg';
        default: return 'png';
    }
}
/** 模型 id → 文件名里那一段（`google/gemini-3-pro-image` → `gemini-3-pro-image`）。 */
function slugOf(model) {
    const tail = model.split('/').pop() ?? model;
    return tail.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 48) || 'image';
}
/** 时间戳 → `2026-10-10_0037`。 */
function stamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
// --------------------------------------------------------- 尺寸（从文件头量）
/** PNG：IHDR 里的宽高（big-endian）。 */
function measurePng(buffer) {
    if (buffer.length < 24)
        return undefined;
    if (buffer.readUInt32BE(0) !== 0x89504e47)
        return undefined;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
/** JPEG：扫到 SOFn 段取宽高。 */
function measureJpeg(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
        return undefined;
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = buffer[offset + 1];
        // 填充字节与无载荷的标记
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
            offset += 2;
            continue;
        }
        const length = buffer.readUInt16BE(offset + 2);
        const isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
            return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
    }
    return undefined;
}
/** WebP：VP8X / VP8L / VP8 三种块各有一套宽高编码。 */
function measureWebp(buffer) {
    if (buffer.length < 30)
        return undefined;
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP')
        return undefined;
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
        const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        return { width, height };
    }
    if (chunk === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') {
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
        };
    }
    return undefined;
}
/**
 * 从图片字节里量出真实像素尺寸。
 * @param buffer - 文件字节。
 * @returns `1536 × 864`；认不出的格式返回空串（宁可空着，也不要编一个数）。
 */
function measureSize(buffer) {
    const size = measurePng(buffer) ?? measureJpeg(buffer) ?? measureWebp(buffer);
    if (size === undefined || size.width <= 0 || size.height <= 0)
        return '';
    return `${size.width} × ${size.height}`;
}
// --------------------------------------------------------------- 索引读写
/** 读索引（最新在前）。文件不存在/损坏都返回空数组。 */
async function readImageIndex() {
    let text;
    try {
        text = await readFile(historyIndexPath(), 'utf8');
    }
    catch {
        return [];
    }
    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((item) => typeof item === 'object' && item !== null
            && typeof item.id === 'string'
            && typeof item.fileName === 'string');
    }
    catch {
        return [];
    }
}
/** 写索引（原子写：临时文件 + rename）。 */
async function writeImageIndex(entries) {
    const file = historyIndexPath();
    const temp = `${file}.tmp`;
    await writeFile(temp, `${JSON.stringify(entries.slice(0, MAX_INDEX_ENTRIES), null, 2)}\n`, 'utf8');
    await rename(temp, file);
}
/**
 * 就地更新索引里的一条（用来记 `autoSavedPath` 这类事后才知道的字段）。
 * @param id - 图片 id。
 * @param patch - 要合并进去的字段。
 * @returns 更新后的条目；id 不存在时 undefined。
 */
async function patchIndexEntry(id, patch) {
    const index = await readImageIndex();
    const at = index.findIndex((entry) => entry.id === id);
    if (at < 0)
        return undefined;
    const next = { ...index[at], ...patch };
    index[at] = next;
    await writeImageIndex(index);
    return next;
}
/** 去掉路径末尾的斜杠（`\` 或 `/`）。 */
function trimTrailingSlash(value) {
    return value.trim().replace(/[\\/]+$/u, '');
}
/**
 * 把已落盘的图再复制一份到指定目录。
 *
 * 两个用途：① 出图后自动另存到工作区目录（A8 的后半句）；
 * ② 面板上「保存」按钮的手动保存。目标目录不存在会自动创建。
 * @param entry - 索引条目。
 * @param directory - 目标目录（不是完整文件路径）。
 * @returns 落地后的完整路径。
 */
async function copyImageTo(entry, directory) {
    const dir = trimTrailingSlash(directory);
    if (dir === '')
        throw new Error('目标目录为空');
    // 与 out/ 是同一个目录时不必复制 —— 返回原路径，免得把「同一份文件」写成两条记录。
    if (dir.toLowerCase() === trimTrailingSlash(imageOutDir()).toLowerCase())
        return entry.savedPath;
    const target = `${dir}\\${entry.fileName}`;
    await mkdir(dir, { recursive: true });
    await copyFile(entry.savedPath, target);
    return target;
}
/**
 * 把一张图写进 `out/` 并更新索引。
 * @param input - 图片与元数据。
 * @returns 索引条目。
 */
async function saveGeneratedImage(input) {
    const outDir = imageOutDir();
    await mkdir(outDir, { recursive: true });
    const buffer = Buffer.from(input.b64, 'base64');
    const now = new Date();
    const suffix = input.sequence > 0 ? `_${input.sequence + 1}` : '';
    const fileName = `${stamp(now)}_${slugOf(input.model)}${suffix}.${extensionOf(input.mediaType)}`;
    const savedPath = `${outDir}\\${fileName}`;
    await writeFile(savedPath, buffer);
    const entry = {
        id: `gen-${now.getTime().toString(36)}-${input.sequence}-${Math.random().toString(36).slice(2, 6)}`,
        savedPath,
        fileName,
        mediaType: input.mediaType,
        bytes: buffer.length,
        size: measureSize(buffer),
        ...input.cost === undefined ? {} : { cost: input.cost },
        seconds: input.seconds,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        model: input.model,
        createdAt: now.getTime(),
        // 参数快照与实发字段：老条目里没有它们，界面按「升级前的记录」降级显示。
        ...input.params === undefined ? {} : { params: input.params },
        ...input.sentFields === undefined ? {} : { sentFields: input.sentFields },
        ...input.referenceCount === undefined ? {} : { referenceCount: input.referenceCount },
        ...input.batchCount === undefined ? {} : { batchCount: input.batchCount },
    };
    const index = await readImageIndex();
    index.unshift(entry);
    await writeImageIndex(index);
    return entry;
}
/** 按 id 找一张图。 */
async function findImage(id) {
    const index = await readImageIndex();
    return index.find((entry) => entry.id === id);
}
/**
 * 读一张图的字节（给 `GET /image/<id>` 用）。
 * @param entry - 索引条目。
 * @returns 字节；文件已被删掉时返回 undefined。
 */
async function readImageBytes(entry) {
    try {
        return await readFile(entry.savedPath);
    }
    catch {
        return undefined;
    }
}
/**
 * 索引条目 → 下发给前端的形状。
 *
 * `imageUrl` 是**相对路径**（不带前导斜杠）：客户端用 `apiPath()` 锚在
 * `document.baseURI` 上解析，反代挂在前缀下也能取到图。
 * @param entry - 索引条目。
 * @returns 前端可直接渲染的对象。
 */
function toClientImage(entry) {
    return {
        id: entry.id,
        imageUrl: `dsh-imagegen/image/${entry.id}`,
        size: entry.size,
        ...entry.cost === undefined ? {} : { cost: entry.cost },
        seconds: entry.seconds,
        prompt: entry.prompt,
        aspectRatio: entry.aspectRatio,
        resolution: entry.resolution,
        createdAt: entry.createdAt,
        savedPath: entry.savedPath,
        ...entry.autoSavedPath === undefined ? {} : { autoSavedPath: entry.autoSavedPath },
        model: entry.model,
        bytes: entry.bytes,
        // ---- 这次补上的「当时用了什么」：点历史图回填参数、结果行显示模型与参数都要它。
        // 老条目里没有这些键，前端按「升级前的记录」降级（只回填提示词与比例/分辨率）。
        ...entry.params === undefined ? {} : { params: entry.params },
        ...entry.sentFields === undefined ? {} : { sentFields: entry.sentFields },
        ...entry.referenceCount === undefined ? {} : { referenceCount: entry.referenceCount },
        ...entry.batchCount === undefined ? {} : { count: entry.batchCount },
    };
}

// ---- src/openrouter.ts ----
/**
 * OpenRouter 图像接口适配层（阶段 4）。
 *
 * 官方文档与 2026-10-10 实测（`.ref/probe-openrouter.mjs`）确认的事实：
 *
 * | 端点 | 鉴权 | 内容 |
 * |---|---|---|
 * | `GET  {base}/images/models` | **公开**（无需 Key） | 59 个模型；每个带 `architecture`、`supported_parameters`、`supports_streaming`、`endpoints` 链接。**没有定价** |
 * | `GET  {base}/images/models/<id>/endpoints` | **公开** | 每个 provider 的权威 `supported_parameters` + `pricing` + `allowed_passthrough_parameters` |
 * | `POST {base}/images` | **要 Key** | 请求 `{model, prompt, n, resolution, aspect_ratio, quality, output_format, input_references, …}`；响应 `{created, data:[{b64_json, media_type}], usage:{cost,…}}` |
 *
 * `supported_parameters` 的值是**能力描述符**：`{type:'enum', values:[…]}` /
 * `{type:'range', min, max}` / `{type:'boolean'}`。**key 缺失 = 不支持** ——
 * 这条规矩是整个插件的核心约束（PLAN 硬约束 3），所以这里的 `sanitizeBody()`
 * 就是它的执行者：模型不声明的字段，一个都不往上送。
 *
 * 定价形状（实测）：`pricing` 是数组，元素 `{billable, unit, cost_usd, variant?}`。
 * `unit: 'image'` 时按张计价，可能带 `variant`（分辨率档位）；`unit: 'token'` 时
 * 是 token 价（`billable: 'output_image'` 那项才是出图成本）。
 */
/** 模型列表的缓存时长；`DSH_IMAGEGEN_MODELS_TTL_MS=0` 可关掉（自检用）。 */
function modelsTtlMs() {
    const raw = process.env.DSH_IMAGEGEN_MODELS_TTL_MS;
    if (raw === undefined || raw.trim() === '')
        return 10 * 60 * 1000;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 10 * 60 * 1000;
}
let cache;
/** 清掉模型缓存（换 Base URL 或测试用）。 */
function clearModelsCache() {
    cache = undefined;
}
// --------------------------------------------------------------- 纯函数
/** 是否是对象。 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 取字符串数组（`{type:'enum', values:[…]}`）。 */
function enumValues(spec) {
    if (spec === undefined || !Array.isArray(spec.values))
        return [];
    return spec.values.filter((item) => typeof item === 'string');
}
/** 把 `{type:'range', min, max}` 展开成张数候选。 */
function rangeValues(spec, cap) {
    if (spec === undefined)
        return [];
    const min = typeof spec.min === 'number' ? Math.max(1, Math.round(spec.min)) : 1;
    const max = typeof spec.max === 'number' ? Math.min(cap, Math.round(spec.max)) : min;
    if (max < min)
        return [];
    const out = [];
    for (let value = min; value <= max; value += 1)
        out.push(String(value));
    return out;
}
/**
 * `input_references` 的**网关全局上限**（官方 OpenAPI `maxItems: 16`）。
 *
 * 为什么模型自己的 `max` 不够用：两者会打架。实测
 * `tencent/hy-image-v3.5-preview` 声明 `input_references: {min:0, max:20}`，
 * 而 OpenAPI 的 `ImageGenerationRequest.input_references.maxItems` 写死 **16**。
 * 模型级枚举网关**不校验**（越界值透传 provider），但全局 `maxItems` **是校验的**
 * （400 ZodError、全有或全无计费）。所以能真的发出去的张数是
 * `min(模型声明, 16)` —— 发 17 张换回来的是一次失败。
 */
const GLOBAL_MAX_REFERENCES = 16;
/**
 * 参考图的张数区间。
 *
 * `min >= 1` 的模型是**改图专用**（实测 5 个：`ming-image-0.1-design-layer` 必须 1 张、
 * `recraft-v4-styles` 四兄弟必须 ≥1）—— 不给参考图就是非法请求，面板必须自己拦住。
 * `{type:'boolean'}` 这种没有数值的描述符按「最多 1 张」处理（保守，不虚报额度）。
 *
 * **上限一律按 {@link GLOBAL_MAX_REFERENCES} 收敛**：模型声明得再宽，网关也只收 16 张。
 * 原始声明值由 {@link declaredReferencesFrom} 单独取，用来向用户解释差额。
 * @param spec - `input_references` 的描述符。
 * @returns `{min, max}`；不支持时 `{0, 0}`。
 */
function referencesFrom(spec) {
    const declared = declaredReferencesFrom(spec);
    return { min: declared.min, max: Math.min(declared.max, GLOBAL_MAX_REFERENCES) };
}
/**
 * 模型**自己声明**的参考图区间（未按全局上限收敛）。
 * @param spec - `input_references` 的描述符。
 * @returns 原始 `{min, max}`；不支持时 `{0, 0}`。
 */
function declaredReferencesFrom(spec) {
    if (spec === undefined)
        return { min: 0, max: 0 };
    if (spec.type === 'boolean')
        return { min: 0, max: 1 };
    const min = typeof spec.min === 'number' && spec.min > 0 ? Math.round(spec.min) : 0;
    const max = typeof spec.max === 'number' && spec.max > 0 ? Math.round(spec.max) : 0;
    return { min, max: Math.max(min, max) };
}
/**
 * 由 `supported_parameters` 生成面板要的参数候选值。
 *
 * **没有硬编码的候选值**：每一项都来自上游声明，key 缺失就是空数组
 * （面板侧会退化成「保持当前值」，而不是给一个假的候选表）。
 * @param params - 模型的 supported_parameters。
 * @returns 五项候选值。
 */
function optionsFrom(params) {
    return {
        aspectRatio: enumValues(params.aspect_ratio),
        resolution: enumValues(params.resolution),
        count: rangeValues(params.n, 10),
        quality: enumValues(params.quality),
        outputFormat: enumValues(params.output_format),
    };
}
/**
 * 字段规格表 —— 这张表 + 上游的 `supported_parameters` 共同决定界面。
 *
 * **只列模型级请求字段**：`input_references` 由参考图槽单独承载（它不是一行下拉），
 * `provider` / `user` / `session_id` 是全局字段（对所有模型都合法，与模型能力无关），
 * 它们都不在这张表里。
 *
 * 这张表是 2026-10-10 对 **全部 59 个真实模型**逐个扫描后定的：
 * `GET /images/models` 与逐 endpoint 的 `supported_parameters` 里，
 * 一共只出现过 10 个键：`input_references` `aspect_ratio` `n` `resolution`
 * `output_format` `seed` `background` `quality` `output_compression` `size`。
 * 表里没有、上游也没声明的字段，面板一律不显示、也绝不发送。
 */
const FIELD_SPECS = [
    {
        name: 'aspect_ratio',
        label: '比例',
        control: 'select',
        valueType: 'string',
        group: 'output',
        clearable: false,
        default: '1:1',
        hint: '取值就是该模型声明的那些，没有 `auto` 的模型别硬填 auto。',
    },
    {
        name: 'resolution',
        label: '分辨率',
        control: 'select',
        valueType: 'string',
        group: 'output',
        clearable: false,
        default: '1K',
        hint: '标准化档位，具体像素由 provider 换算。',
    },
    {
        name: 'size',
        label: '尺寸',
        control: 'text',
        valueType: 'string',
        group: 'output',
        clearable: true,
        default: '',
        hint: '档位（512 / 768 / 1K / 1.5K / 2K / 4K）或像素（2048x2048）。给像素时它是权威值，别再同时给比例/分辨率（会 400）。',
        // 官方口径就是这两种写法。上游描述符是 boolean（没有值域），不自己拦一道
        // 的话任何手滑的字符串都会被打上去。
        pattern: '^(512|768|1K|1\\.5K|2K|4K|[0-9]{2,5}x[0-9]{2,5})$',
    },
    {
        name: 'n',
        label: '张数',
        control: 'count',
        valueType: 'integer',
        group: 'output',
        clearable: false,
        default: '1',
        hint: '上游可以返回比 n 更少的张数。',
    },
    {
        name: 'quality',
        label: '质量',
        control: 'select',
        valueType: 'string',
        group: 'output',
        clearable: false,
        default: 'auto',
        hint: '官方全局 6 档，但**每个模型只收自己声明的那几档**（有的只有 low/medium）。',
    },
    {
        name: 'output_format',
        label: '输出格式',
        control: 'select',
        valueType: 'string',
        group: 'output',
        clearable: false,
        default: 'png',
        hint: '矢量模型只收 svg、`riverflow-v2.5-fast` 只收 jpeg —— 以本模型的枚举为准。',
    },
    {
        name: 'background',
        label: '背景',
        control: 'select',
        valueType: 'string',
        group: 'output',
        clearable: false,
        default: 'auto',
        hint: 'transparent 要求输出格式是 png 或 webp，否则会被上游忽略。',
    },
    {
        name: 'output_compression',
        label: '压缩',
        control: 'number',
        valueType: 'integer',
        group: 'advanced',
        clearable: true,
        default: '',
        hint: '0–100，只对 jpeg/webp 生效，png 忽略；留空 = 用上游默认。',
    },
    {
        name: 'seed',
        label: '随机种子',
        control: 'number',
        valueType: 'integer',
        group: 'advanced',
        clearable: true,
        default: '',
        hint: '留空 = 每次随机（**默认就该留空**，填死会让每次出图都一样）；填了也只是「尽量」复现。',
    },
];
/** `stream` 不在 `supported_parameters` 里，它由顶层 `supports_streaming` 表达。 */
const STREAM_FIELD = {
    name: 'stream',
    label: '流式预览',
    control: 'toggle',
    valueType: 'boolean',
    group: 'advanced',
    clearable: false,
    default: 'false',
    hint: '只有原生支持 SSE 的通道真支持（目前是 OpenAI 系）；其余忽略这个标志。',
};
/** 该字段的候选值里挑一个能用的默认值（声明的默认值不在候选里时退第一个）。 */
function defaultValueOf(field, values, min) {
    if (field.clearable && field.default === '')
        return '';
    if (field.control === 'select' || field.control === 'count') {
        if (field.default !== '' && values.includes(field.default))
            return field.default;
        return values[0] ?? '';
    }
    if (field.control === 'number')
        return field.default;
    return field.default;
}
/**
 * 由模型的 `supported_parameters` 生成界面参数表。
 *
 * **只输出该模型真的声明了的字段** —— key 缺失 = 不支持，不发也不显示。
 * 这条规矩的代价是界面会随模型变，收益是用户不会再看到一堆「选了也没用」的下拉。
 * @param params - 该模型的 `supported_parameters`（模型级与 endpoint 级并集）。
 * @param supportsStreaming - 顶层 `supports_streaming`。
 * @returns 该模型可配置的参数，顺序与 {@link FIELD_SPECS} 一致。
 */
function parametersFrom(params, supportsStreaming) {
    const out = [];
    for (const field of FIELD_SPECS) {
        const spec = params[field.name];
        if (spec === undefined)
            continue;
        const next = { ...field };
        if (field.control === 'select') {
            const values = enumValues(spec);
            // 声明了字段但描述符不是 enum（例如 `size: {type:'boolean'}`）→ 退回自由文本，
            // 而不是给一个空下拉。宁可让用户手填，也不能假装我们知道候选值。
            if (values.length === 0) {
                next.control = 'text';
                next.clearable = true;
                next.default = '';
            }
            else {
                next.values = values;
                next.default = defaultValueOf(field, values, undefined);
            }
        }
        else if (field.control === 'count') {
            const values = rangeValues(spec, 10);
            if (values.length === 0)
                continue;
            next.values = values;
            next.min = Number(values[0]);
            next.max = Number(values[values.length - 1]);
            next.default = values.includes(field.default) ? field.default : values[0];
        }
        else if (field.control === 'number') {
            // `range` 描述符给的是**值域**；`boolean` 描述符（`seed` 是这种）没有值域，
            // 那就只给一个输入框，不在前端编造上下限 —— 交给上游判定。
            if (spec.type === 'range') {
                if (typeof spec.min === 'number')
                    next.min = Math.round(spec.min);
                if (typeof spec.max === 'number')
                    next.max = Math.round(spec.max);
            }
            next.default = defaultValueOf(field, [], next.min);
        }
        out.push(next);
    }
    if (supportsStreaming)
        out.push({ ...STREAM_FIELD });
    return out;
}
/** 能力标签（弹层里那几个小 chip）。 */
function capsFrom(model, params) {
    const caps = [];
    const refs = referencesFrom(params.input_references);
    if (refs.max > 0)
        caps.push(refs.min > 0 ? '改图必填底图' : '图生图');
    else
        caps.push('仅文生图');
    const architecture = isRecord(model.architecture) ? model.architecture : {};
    const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
    if (outputs.includes('text'))
        caps.push('图文双出');
    const ratios = enumValues(params.aspect_ratio).length;
    if (ratios > 0)
        caps.push(`${ratios} 种比例`);
    const resolutions = enumValues(params.resolution);
    if (resolutions.length > 0)
        caps.push(`分辨率 ${resolutions.join('/')}`);
    const qualities = enumValues(params.quality).length;
    if (qualities > 0)
        caps.push(`${qualities} 档质量`);
    if (model.supports_streaming === true)
        caps.push('流式');
    return caps;
}
/**
 * 解析 `GET /images/models` 的响应。
 * @param payload - 上游 JSON。
 * @returns 模型候选（没有 id 的条目丢弃）。
 */
function parseImageModels(payload) {
    const models = [];
    const params = new Map();
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    for (const item of data) {
        if (!isRecord(item))
            continue;
        const id = typeof item.id === 'string' ? item.id : '';
        if (id === '')
            continue;
        const supported = isRecord(item.supported_parameters)
            ? item.supported_parameters
            : {};
        params.set(id, supported);
        const references = referencesFrom(supported.input_references);
        const streaming = item.supports_streaming === true;
        models.push({
            id,
            caps: capsFrom(item, supported),
            // 定价不在列表接口里，得单独拉 /endpoints —— 面板选中模型后再补。
            price: '',
            supportsReferences: references.max > 0,
            references,
            options: optionsFrom(supported),
            // 列表接口就带了 `supported_parameters` 与 `supports_streaming`，所以参数表
            // 在这里就能算出来 —— 用户切模型时立刻看到正确的参数行，不用等第二次请求。
            parameters: parametersFrom(supported, streaming),
            supportsStreaming: streaming,
        });
    }
    return { models, params };
}
/** 把美元金额格式化成人看的样子（定价位数不固定，所以按量级选小数位）。 */
function formatUsd(value) {
    if (value === 0)
        return '$0';
    if (value >= 1)
        return `$${value.toFixed(2)}`;
    if (value >= 0.01)
        return `$${value.toFixed(3)}`;
    if (value >= 0.0001)
        return `$${value.toFixed(4)}`;
    return `$${value.toFixed(6)}`;
}
/**
 * 从定价数组里算一句人话。
 *
 * 优先「按张」（`unit: 'image'`）；有 `variant`（分辨率档位）时优先匹配当前分辨率，
 * 匹配不上就取最便宜的那档 —— 报价宁可偏低也别虚高，虚高会让人不敢用。
 * 没有按张定价时退回出图 token 价。
 * @param pricing - 一个 endpoint 的 pricing 数组。
 * @param resolution - 当前分辨率档位（可空）。
 * @returns 如 `$0.041/张`、`$0.00012/token`；算不出时空串。
 */
function priceFrom(pricing, resolution) {
    if (!Array.isArray(pricing))
        return '';
    const entries = pricing.filter(isRecord);
    const perImage = entries.filter((entry) => entry.unit === 'image' && typeof entry.cost_usd === 'number');
    if (perImage.length > 0) {
        const wanted = typeof resolution === 'string' ? resolution.toLowerCase() : '';
        const matched = wanted === ''
            ? undefined
            : perImage.find((entry) => typeof entry.variant === 'string' && entry.variant.toLowerCase() === wanted);
        // 「最便宜」只在正价里挑：上游有些档位挂着 `cost_usd: 0`（多半是还没定价，
        // 不是免费）。拿 0 当最便宜会把报价显示成 `$0`，那是在骗用户。
        const positive = perImage.filter((entry) => entry.cost_usd > 0);
        const pool = positive.length > 0 ? positive : perImage;
        const chosen = matched ?? pool.reduce((best, entry) => (entry.cost_usd < best.cost_usd ? entry : best));
        return `${formatUsd(chosen.cost_usd)}/张${typeof chosen.variant === 'string' ? `（${chosen.variant}）` : ''}`;
    }
    const outputTokens = entries.filter((entry) => entry.billable === 'output_image' && typeof entry.cost_usd === 'number');
    if (outputTokens.length > 0) {
        const cheapest = outputTokens.reduce((best, entry) => (entry.cost_usd < best.cost_usd ? entry : best));
        return `${formatUsd(cheapest.cost_usd)}/token（出图）`;
    }
    return '';
}
/** 合并两个参数描述符（跨 provider 取并集）。 */
function unionSpec(left, right) {
    if (left === undefined)
        return right;
    if (right === undefined)
        return left;
    if (left.type === 'enum' || right.type === 'enum') {
        const values = [];
        for (const value of [...enumValues(left), ...enumValues(right)]) {
            if (!values.includes(value))
                values.push(value);
        }
        return { type: 'enum', values };
    }
    if (left.type === 'range' || right.type === 'range') {
        const leftMin = typeof left.min === 'number' ? left.min : Number.POSITIVE_INFINITY;
        const rightMin = typeof right.min === 'number' ? right.min : Number.POSITIVE_INFINITY;
        const leftMax = typeof left.max === 'number' ? left.max : Number.NEGATIVE_INFINITY;
        const rightMax = typeof right.max === 'number' ? right.max : Number.NEGATIVE_INFINITY;
        return { type: 'range', min: Math.min(leftMin, rightMin), max: Math.max(leftMax, rightMax) };
    }
    return { type: 'boolean' };
}
/**
 * 解析 `GET /images/models/<id>/endpoints`，合并出该模型的权威能力与定价。
 * @param payload - 上游 JSON。
 * @param resolution - 当前分辨率档位，用于挑对应档位的报价。
 * @returns 能力明细。
 */
function parseCapabilities(payload, resolution) {
    const endpoints = isRecord(payload) && Array.isArray(payload.endpoints) ? payload.endpoints : [];
    const providers = [];
    const passthrough = [];
    const providerOptions = [];
    let merged = {};
    let price = '';
    /** 任一 endpoint 原生支持 SSE 就算支持。 */
    let streaming = false;
    /** 参考图的跨 provider 交集（见下方注释）；`undefined` = 还没有 provider 表态。 */
    let refMin = 0;
    let refMax;
    /** 模型声明的原始上限（未按全局 `maxItems` 收敛），供界面解释差额。 */
    let refDeclaredMax = 0;
    for (const endpoint of endpoints) {
        if (!isRecord(endpoint))
            continue;
        const name = typeof endpoint.provider_name === 'string' ? endpoint.provider_name : '';
        if (name !== '' && !providers.includes(name))
            providers.push(name);
        if (endpoint.supports_streaming === true)
            streaming = true;
        const slug = typeof endpoint.provider_slug === 'string' ? endpoint.provider_slug : '';
        const allowed = Array.isArray(endpoint.allowed_passthrough_parameters)
            ? endpoint.allowed_passthrough_parameters.filter((item) => typeof item === 'string')
            : [];
        // `provider.options` 的键是 **slug**（实测带区域/variant 后缀，同族还各不相同：
        // flux.2-pro 是 `black-forest-labs`，flux.2-max 是 `black-forest-labs/us-3`）。
        // 所以只能在拿到 endpoints 之后才知道该填什么，不能照抄文档示例。
        if (slug !== '' && allowed.length > 0 && !providerOptions.some((item) => item.slug === slug)) {
            providerOptions.push({ slug, name: name === '' ? slug : name, params: allowed });
        }
        for (const item of allowed) {
            if (!passthrough.includes(item))
                passthrough.push(item);
        }
        const supported = isRecord(endpoint.supported_parameters)
            ? endpoint.supported_parameters
            : {};
        const next = { ...merged };
        for (const [key, spec] of Object.entries(supported))
            next[key] = unionSpec(merged[key], spec);
        merged = next;
        // 参考图张数**取交集**（只在与声明了 `input_references` 的 provider 之间取），
        // 与上面参数候选值的「取并集」相反：比例/分辨率是给用户挑的范围，多一个不亏；
        // 而参考图数量是硬约束 —— 取并集会让面板放行一个某个 provider 必拒的张数。
        // 完全不声明这个键的 provider 不参与：那只说明「它对此没有说法」，
        // 而模型级（列表接口）已经表态支持了，不该被一个沉默的 endpoint 归零。
        if (supported.input_references !== undefined) {
            // 模型声明的原始上限（未收敛）—— 跨 provider 取最大，用来解释与全局上限的差额。
            refDeclaredMax = Math.max(refDeclaredMax, declaredReferencesFrom(supported.input_references).max);
            const refs = referencesFrom(supported.input_references);
            if (refMax === undefined) {
                refMin = refs.min;
                refMax = refs.max;
            }
            else {
                refMin = Math.max(refMin, refs.min);
                refMax = Math.min(refMax, refs.max);
            }
        }
        // 多 provider 时取第一个能算出报价的（同一模型各 provider 价差通常很小，
        // 真要精确比价得看 order/sort 配置，那是阶段 6 的事）。
        if (price === '')
            price = priceFrom(endpoint.pricing, resolution);
    }
    const references = refMax === undefined
        ? { min: 0, max: 0 }
        : { min: refMin, max: Math.max(refMin, refMax) };
    return {
        model: isRecord(payload) && typeof payload.id === 'string' ? payload.id : '',
        price,
        supportsReferences: references.max > 0,
        caps: capsFrom({}, merged),
        providers,
        passthrough,
        providerOptions,
        available: endpoints.length > 0,
        references,
        referencesDeclaredMax: refDeclaredMax,
        options: optionsFrom(merged),
        parameters: parametersFrom(merged, streaming),
        supportsStreaming: streaming,
    };
}
/** 面板参数里的中文质量档 → OpenRouter 的英文枚举。 */
const QUALITY_ALIASES = {
    自动: 'auto',
    高: 'high',
    中: 'medium',
    低: 'low',
    极高: 'xhigh',
    最高: 'max',
};
/**
 * 归一化质量档。
 *
 * 面板的历史默认值是中文（「高」），而 OpenRouter 只认 `auto/low/medium/high` ——
 * 不归一化就会把「高」原样发上去，换回一个 400。
 * @param value - 面板给的值。
 * @returns 英文枚举；认不出来时返回空串（调用方据此丢弃该字段）。
 */
function normalizeQuality(value) {
    const trimmed = value.trim();
    if (trimmed === '')
        return '';
    if (trimmed in QUALITY_ALIASES)
        return QUALITY_ALIASES[trimmed];
    return ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(trimmed.toLowerCase())
        ? trimmed.toLowerCase()
        : '';
}
/**
 * 该描述符接受这个取值吗。
 *
 * `enum` 严格比对；`range` / `boolean` 或没有 `values` 的按「不限制」放行 ——
 * 上游对取值不做校验（实测：给只收 `["svg"]` 的模型发 `output_format:"png"`，
 * 网关只报了 `n` 的问题，这两个字段一字未提），越界值会**原样透传给 provider**，
 * 换回一个被忽略的字段或者一次 502。所以值级校验只能我们自己做。
 * @param spec - 参数描述符。
 * @param value - 待发值。
 * @returns 是否允许。
 */
function allowsValue(spec, value) {
    if (spec === undefined || spec.type !== 'enum')
        return true;
    const values = enumValues(spec);
    return values.length === 0 || values.includes(value);
}
/** 把张数夹进 `n` 声明的区间。 */
function clampCount(spec, value) {
    if (spec === undefined)
        return value;
    const min = typeof spec.min === 'number' ? Math.max(1, Math.round(spec.min)) : 1;
    const max = typeof spec.max === 'number' ? Math.max(min, Math.round(spec.max)) : Number.POSITIVE_INFINITY;
    return Math.min(max, Math.max(min, value));
}
/**
 * 把「其它整数参数」夹进它声明的区间。
 *
 * 与 {@link clampCount} 的区别：**下限不硬提** —— `output_compression` 的合法值从 0 开始，
 * 用张数那套会把 0 改成 1。描述符不是 `range`（例如 `seed` 的 `{type:'boolean'}`）
 * 就不夹：上游没给值域，我们也不编一个。
 * @param spec - 参数描述符。
 * @param value - 待发值（已取整）。
 * @returns 收敛后的值。
 */
function clampExtraNumber(spec, value) {
    if (spec === undefined || spec.type !== 'range')
        return value;
    const min = typeof spec.min === 'number' ? Math.round(spec.min) : Number.NEGATIVE_INFINITY;
    const max = typeof spec.max === 'number' ? Math.round(spec.max) : Number.POSITIVE_INFINITY;
    return Math.min(max, Math.max(min, value));
}
/** 把描述符还原成一句人话（用于 `dropped` 里的原因说明）。 */
function describeSpec(spec) {
    if (spec === undefined)
        return '未知';
    if (spec.type === 'enum')
        return enumValues(spec).join('/') || '枚举';
    if (spec.type === 'range') {
        const min = typeof spec.min === 'number' ? spec.min : '?';
        const max = typeof spec.max === 'number' ? spec.max : '?';
        return `${min}–${max}`;
    }
    return '上游声明的取值';
}
/**
 * 组装 `POST /images` 的请求体。
 *
 * **两级规矩**：
 * 1. 键级 —— 模型没声明的字段一个都不发（key 缺失 = 不支持）。把不支持的字段
 *    发上去，上游要么 400、要么静默忽略 —— 前者让用户困惑，后者更糟：用户以为自己选了。
 * 2. 值级 —— 模型声明了但取值不在它的枚举/区间里，**也不发**（并如实记入 `dropped`）。
 *    上游网关只校验全局 schema（`output_format` 只要是 png/jpeg/webp/svg 就放行），
 *    不看每个模型自己的枚举，所以诸如「给只收 svg 的向量模型发 png」不会被拦下 ——
 *    它会被透传给 provider，换回一个被忽略的字段或一次 502。
 *
 * `extraJson` 最后合并，且**不许覆盖 model/prompt**（那是本次请求的身份）。
 * @param input - 本次生成参数。
 * @param context - 模型能力与配置。
 * @returns 请求体；`dropped` 列出被裁掉的字段，便于日志与自检。
 */
function buildImageRequest(input, context) {
    const { params } = context;
    const spec = (key) => params?.[key];
    const supports = (key) => params === undefined || params[key] !== undefined;
    const dropped = [];
    /**
     * 被配置里那段「额外参数」JSON **覆盖掉**的字段名。
     *
     * 与 `dropped` 是相反的两件事：`dropped` 是「没发出去」，这里是「发出去了、
     * 但不是面板上那个值」。不区分开的话，用户永远查不出「我明明选了 80」。
     */
    const overridden = [];
    const body = {
        model: input.model,
        prompt: input.prompt,
    };
    if (input.count > 1 || supports('n')) {
        if (supports('n')) {
            const wanted = clampCount(spec('n'), input.count);
            body.n = wanted;
            if (wanted !== input.count)
                dropped.push(`n（该模型只允许 ${wanted} 张）`);
        }
        else if (input.count > 1) {
            dropped.push('n');
        }
    }
    if (input.aspectRatio !== '') {
        if (!supports('aspect_ratio'))
            dropped.push('aspect_ratio');
        else if (!allowsValue(spec('aspect_ratio'), input.aspectRatio))
            dropped.push(`aspect_ratio（该模型不支持 ${input.aspectRatio}）`);
        else
            body.aspect_ratio = input.aspectRatio;
    }
    if (input.resolution !== '') {
        if (!supports('resolution'))
            dropped.push('resolution');
        else if (!allowsValue(spec('resolution'), input.resolution))
            dropped.push(`resolution（该模型不支持 ${input.resolution}）`);
        else
            body.resolution = input.resolution;
    }
    const quality = normalizeQuality(input.quality);
    if (quality !== '') {
        if (!supports('quality'))
            dropped.push('quality');
        else if (!allowsValue(spec('quality'), quality))
            dropped.push(`quality（该模型不支持 ${quality}）`);
        else
            body.quality = quality;
    }
    else if (input.quality.trim() !== '') {
        dropped.push('quality（无法识别）');
    }
    // 输出格式：**本次请求里模型驱动表单选的那个优先**（它才是按该模型枚举来的），
    // 配置里的 `outputFormat` 退居「默认值 / 非 OpenRouter 协议」的角色。
    const outputFormat = input.extra?.['output_format'] ?? context.outputFormat;
    if (outputFormat !== '') {
        if (!supports('output_format'))
            dropped.push('output_format');
        else if (!allowsValue(spec('output_format'), outputFormat)) {
            dropped.push(`output_format（该模型只支持 ${enumValues(spec('output_format')).join('/') || '其它格式'}）`);
        }
        else
            body.output_format = outputFormat;
    }
    // ---- 模型驱动表单里的其它字段（`background` / `output_compression` / `seed` /
    //      `size` / `stream`）。规矩与上面完全一致：模型没声明就不发；声明了但取值
    //      不在枚举/区间里，也不发（并如实记进 `dropped`）。
    for (const [key, raw] of Object.entries(input.extra ?? {})) {
        if (key === 'output_format')
            continue;
        const value = typeof raw === 'string' ? raw.trim() : '';
        // 空串 = 用户没填（`seed` / `size` / `output_compression` 允许留空），
        // 这是「不发这个字段」，不是「发一个空值」。
        if (value === '')
            continue;
        const field = FIELD_SPECS.find((item) => item.name === key) ?? (key === 'stream' ? STREAM_FIELD : undefined);
        if (field === undefined) {
            // 面板只会提交它还认识、且该模型声明过的字段；能走到这里说明是外部构造的请求体。
            dropped.push(`${key}（不是模型级请求字段）`);
            continue;
        }
        // `stream` 是唯一的例外：它的「声明」在顶层 `supports_streaming` 上，
        // 不在 `supported_parameters` 里，所以要按另一路判。
        const declared = key === 'stream'
            ? context.supportsStreaming === true
            : supports(key);
        if (!declared) {
            dropped.push(key === 'stream' ? 'stream（该模型没有原生流式通道）' : key);
            continue;
        }
        if (field.valueType === 'boolean') {
            // 开关只在「开」的时候发：`stream:false` 与不发这个字段在语义上等价，
            // 少发一个字段就少一处能被上游挑剔的地方。
            if (value === 'true')
                body[key] = true;
            continue;
        }
        if (field.valueType === 'integer') {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
                dropped.push(`${key}（不是数字）`);
                continue;
            }
            const rounded = Math.round(parsed);
            // 注意**不能**复用 `clampCount()`：那个函数把下限硬提到 1（对「张数」是对的，
            // 因为 0 张没有意义），而 `output_compression` 的合法下限就是 0。
            const clamped = clampExtraNumber(spec(key), rounded);
            body[key] = clamped;
            if (clamped !== rounded)
                dropped.push(`${key}（超出该模型允许的 ${describeSpec(spec(key))}，已收敛为 ${clamped}）`);
            continue;
        }
        if (!allowsValue(spec(key), value)) {
            dropped.push(`${key}（该模型不支持 ${value}）`);
            continue;
        }
        // `size` 这种「描述符没值域」的字段只能靠本地形状校验兜住 —— 上游不会拦，
        // 它只会把这个字符串透传给 provider，换回一个被忽略的字段或一次 502。
        if (field.pattern !== undefined && !new RegExp(field.pattern).test(value)) {
            dropped.push(`${key}（格式不对：应是档位如 2K，或像素如 2048x2048）`);
            continue;
        }
        body[key] = value;
    }
    if (input.references.length > 0) {
        if (supports('input_references')) {
            const refs = referencesFrom(spec('input_references'));
            if (refs.max === 0) {
                // 声明了这个键、但区间是 0/0（实测 `inclusionai/ming-image-0.1-design` 就是）
                // —— 那是「明确不接受参考图」，不是「没限制」。
                dropped.push('input_references（该模型不接受参考图）');
            }
            else if (input.references.length > refs.max) {
                // 不发超出上限的那些：上游对 per-model 上限同样不校验，多出来的会让
                // provider 拒掉整次请求（502）。截断 + 如实回报，比整次失败好。
                dropped.push(`input_references（该模型最多 ${refs.max} 张，已只用前 ${refs.max} 张）`);
                body.input_references = input.references.slice(0, refs.max).map((url) => ({ type: 'image_url', image_url: { url } }));
            }
            else {
                body.input_references = input.references.map((url) => ({ type: 'image_url', image_url: { url } }));
            }
        }
        else {
            dropped.push('input_references（该模型不支持参考图）');
        }
    }
    // 额外参数最后合并：用户显式写的东西优先，但不许改掉 model/prompt。
    //
    // ⚠️ 它可能覆盖面板上**看得见**的同名字段 —— 本机默认配置里就写着
    // `output_compression: 90` 与 `background: "opaque"`，而那两个字段原来没有界面、
    // 现在有了。覆盖照旧生效（配置是用户显式写的，优先级最高），但必须**如实记下来**：
    // 否则用户会在面板上选 80、实际发 90 —— 这正是「以为设上了」的老毛病。
    if (context.extraJson.trim() !== '') {
        try {
            const extra = JSON.parse(context.extraJson);
            if (isRecord(extra)) {
                for (const [key, value] of Object.entries(extra)) {
                    if (key === 'model' || key === 'prompt')
                        continue;
                    if (key in body)
                        overridden.push(key);
                    body[key] = value;
                }
            }
        }
        catch {
            // 配置在写入时已经校验过 JSON；这里静默跳过（生成不该因为一段额外参数崩掉）。
        }
    }
    return { body, dropped, overridden };
}
/**
 * 解析 `POST /images` 的响应。
 * @param payload - 上游 JSON。
 * @returns 图片数组与花费；结构不成形时 images 为空。
 */
function parseGeneration(payload) {
    const out = { images: [] };
    if (!isRecord(payload))
        return out;
    if (isRecord(payload.usage) && typeof payload.usage.cost === 'number') {
        out.cost = payload.usage.cost;
        out.usage = payload.usage;
    }
    const data = Array.isArray(payload.data) ? payload.data : [];
    for (const item of data) {
        if (!isRecord(item))
            continue;
        const b64 = typeof item.b64_json === 'string' ? item.b64_json : '';
        if (b64 === '')
            continue;
        out.images.push({
            b64,
            mediaType: typeof item.media_type === 'string' && item.media_type !== '' ? item.media_type : 'image/png',
        });
    }
    return out;
}
/** 把一条 Zod 问题翻成一句人话。 */
function describeIssue(issue) {
    const parts = Array.isArray(issue.path) ? issue.path.filter((item) => typeof item === 'string' || typeof item === 'number') : [];
    const name = parts.length > 0 ? parts.join('.') : '请求体';
    switch (issue.code) {
        case 'too_small': return `${name} 必须 ≥ ${issue.minimum ?? '?'}`;
        case 'too_big': return `${name} 必须 ≤ ${issue.maximum ?? '?'}`;
        case 'invalid_value': return `${name} 的取值不在允许范围内`;
        case 'invalid_type': return `${name} 的类型不对`;
        case 'unrecognized_keys': return `${name} 里有上游不认识的字段`;
        default: return `${name}：${issue.message ?? '校验失败'}`;
    }
}
/**
 * 试图解开 ZodError 的 `message`。
 *
 * 400 的 `error.message` **本身是一段 JSON 字符串**（实测），原样展示就是一坨
 * 转义字符，用户看不懂。这里尝试二次解析，成功就把每条问题翻成人话；失败返回
 * undefined，由调用方退回原文（**绝不吞掉上游信息**）。
 * @param message - `error.message` 原文。
 * @returns 每行一条的可读文本；解不开时 undefined。
 */
function describeZodError(message) {
    let issues;
    try {
        issues = JSON.parse(message);
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(issues))
        return undefined;
    const lines = issues.filter(isRecord).map((issue) => describeIssue(issue)).filter((line) => line !== '');
    return lines.length > 0 ? lines.join('\n') : undefined;
}
/**
 * 把上游的报错转成一句能直接展示给用户的话。
 *
 * **不做美化转述**：OpenRouter 的原文（402 余额不足、429 限流、模型不存在…）
 * 比我们编的更有用。只在前面补一个 HTTP 状态，方便用户贴给别人看。
 * 唯一的加工是 400 的 ZodError：它的 `message` 是转义 JSON，翻成人话再展示。
 * @param status - HTTP 状态码。
 * @param text - 响应体原文。
 * @returns 可展示文本。
 */
function describeUpstreamError(status, text) {
    const trimmed = text.trim();
    if (trimmed !== '') {
        try {
            const parsed = JSON.parse(trimmed);
            if (isRecord(parsed)) {
                const error = parsed.error;
                if (isRecord(error) && typeof error.message === 'string' && error.message !== '') {
                    const friendly = error.name === 'ZodError' ? describeZodError(error.message) : undefined;
                    return `HTTP ${status}\n${friendly ?? error.message}`;
                }
                if (typeof error === 'string' && error !== '')
                    return `HTTP ${status}\n${error}`;
                if (typeof parsed.message === 'string' && parsed.message !== '')
                    return `HTTP ${status}\n${parsed.message}`;
            }
        }
        catch {
            // 不是 JSON：原样带出去。
        }
        return `HTTP ${status}\n${trimmed.slice(0, 2000)}`;
    }
    return `HTTP ${status}（上游没有返回内容）`;
}
// --------------------------------------------------------------- 网络调用
/** 拼接 base 与路径（base 可能带或不带尾斜杠）。 */
function joinUrl(baseUrl, path) {
    return `${baseUrl.replace(/\/+$/, '')}${path}`;
}
/** 读一个上游 JSON（GET）。 */
async function getJson(url, signal) {
    const response = await fetch(url, {
        headers: { accept: 'application/json' },
        ...signal === undefined ? {} : { signal },
    });
    const text = await response.text();
    if (!response.ok) {
        const error = new Error(describeUpstreamError(response.status, text));
        error.status = response.status;
        throw error;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`上游返回了非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
    }
}
/** 探测可用性时的单条超时与并发度。 */
const PROBE_TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 6;
/**
 * 把外部信号与一个超时合成一个。
 *
 * 不用 `AbortSignal.any`：那要求运行环境与 tsconfig 的 lib 都认识它，手写这几行
 * 不挑环境，语义也一目了然。
 * @param signal - 外部信号（可空）。
 * @param ms - 毫秒超时。
 * @returns 合成信号 + 清理函数。
 */
function withTimeout(signal, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, ms);
    const onAbort = () => { controller.abort(); };
    if (signal !== undefined) {
        if (signal.aborted)
            controller.abort();
        else
            signal.addEventListener('abort', onAbort, { once: true });
    }
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        },
    };
}
/** 探测可用性的开关：`DSH_IMAGEGEN_SKIP_AVAILABILITY=1` 可整体跳过（排查用）。 */
function skipAvailabilityProbe() {
    return process.env.DSH_IMAGEGEN_SKIP_AVAILABILITY === '1';
}
/**
 * 剔掉目录里**没有可服务通道**的模型。
 *
 * 为什么必须单独探一次：`/images/models` 的条目里**没有任何「有没有通道」的信号**
 * （`ImageModelListItem` 只有 architecture / supported_parameters / endpoints 链接），
 * 而目录里确实躺着 `meta/muse-image` 这种 `endpoints: []` 的模型 —— 选中它生成必失败，
 * 报价还是空的。只有逐个拉 `/endpoints` 才知道谁是真的死的。
 *
 * **失败即放行**：超时 / 报错 / 被限流一律当作「有通道」。探测本身的问题绝不能
 * 把一个能用的模型从列表里删掉 —— 那比多显示一个坏条目严重得多。
 * @param baseUrl - 上游基础地址。
 * @param models - 目录里的模型。
 * @param signal - 取消。
 * @returns 保留下来的模型。
 */
async function dropUnservedModels(baseUrl, models, signal) {
    const served = models.map(() => true);
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= models.length)
                return;
            const gate = withTimeout(signal, PROBE_TIMEOUT_MS);
            try {
                const payload = await getJson(joinUrl(baseUrl, `/images/models/${models[index].id}/endpoints`), gate.signal);
                const endpoints = isRecord(payload) && Array.isArray(payload.endpoints) ? payload.endpoints : [];
                // 只有「拿到 200、且明确是空数组」才算死条目；其余情况都不动它。
                served[index] = endpoints.length > 0;
            }
            catch {
                // 失败即放行。
            }
            finally {
                gate.dispose();
            }
        }
    };
    const size = Math.max(1, Math.min(PROBE_CONCURRENCY, models.length));
    await Promise.all(Array.from({ length: size }, () => worker()));
    return models.filter((_model, index) => served[index] === true);
}
/**
 * 拉模型目录（带缓存）。
 * @param baseUrl - 形如 `https://openrouter.ai/api/v1`。
 * @param signal - 取消。
 * @param force - 忽略缓存。
 * @returns 模型候选与各自的 supported_parameters。
 */
async function getImageModels(baseUrl, signal, force = false) {
    const ttl = modelsTtlMs();
    if (!force && cache !== undefined && cache.baseUrl === baseUrl && Date.now() - cache.at < ttl) {
        return { models: cache.models, params: cache.params };
    }
    const payload = await getJson(joinUrl(baseUrl, '/images/models'), signal);
    const parsed = parseImageModels(payload);
    const models = skipAvailabilityProbe() ? parsed.models : await dropUnservedModels(baseUrl, parsed.models, signal);
    if (ttl > 0) {
        cache = { at: Date.now(), baseUrl, models, params: parsed.params };
    }
    return { models, params: parsed.params };
}
/** 拉一个模型的权威能力与定价。 */
async function getModelCapabilities(baseUrl, modelId, resolution, signal) {
    // 模型 id 里有斜杠（`google/gemini-3-pro-image`），直接拼进路径 —— 上游就是这么设计的。
    const payload = await getJson(joinUrl(baseUrl, `/images/models/${modelId}/endpoints`), signal);
    return parseCapabilities(payload, resolution);
}
/**
 * 发一次生成请求（协议无关：URL / 请求头 / 请求体 / 响应解析都由调用方给）。
 *
 * 取消与超时都靠 `AbortSignal`：调用方把「客户端断开」与「超时」两个信号合成一个传进来。
 * 这里把 abort 的两种原因分开报 —— 「用户点了取消」和「上游太慢」对用户是两件事。
 * @param options - 计划（URL/头/体/解析器）+ 信号 + 是否因超时而中断。
 * @returns 归一化结果。
 */
async function postGeneration(options) {
    const started = Date.now();
    let response;
    try {
        response = await fetch(options.url, {
            method: 'POST',
            headers: options.headers,
            body: JSON.stringify(options.body),
            signal: options.signal,
        });
    }
    catch (error) {
        if (options.signal.aborted) {
            return options.timedOut()
                ? { kind: 'timeout', message: `上游在超时时间内没有响应（可在「高级」里调大超时）` }
                : { kind: 'aborted' };
        }
        return { kind: 'error', status: 0, message: `连不上上游：${error instanceof Error ? error.message : String(error)}` };
    }
    const text = await response.text();
    if (!response.ok) {
        return { kind: 'error', status: response.status, message: describeUpstreamError(response.status, text) };
    }
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
        return { kind: 'error', status: response.status, message: `上游返回了非 JSON：${text.slice(0, 400)}` };
    }
    const parsed = options.parse(payload);
    if (parsed.images.length === 0) {
        return {
            kind: 'error',
            status: response.status,
            message: `上游返回里没有图片数据（这个协议的响应里没有 base64 图片）。原始响应：${text.slice(0, 600)}`,
        };
    }
    return { kind: 'ok', parsed, elapsedSec: Math.max(1, Math.round((Date.now() - started) / 1000)) };
}

// ---- src/log-store.ts ----
/**
 * 宿主侧日志：进程内环形缓冲 + 按天落盘。
 *
 * 为什么需要它：插件跑在 DSH 宿主的**主进程**里，`console.log` 的去处是那个进程的
 * stdout —— 从桌面版 GUI 启动时根本没有人接这根管子。实测（2026-10-10）：
 *
 *  - `%APPDATA%\@deepseek-ai\dsh-desktop\logs\` 存在但是**空的**；
 *  - 全盘没有任何近期 `.log` 文件在增长；
 *  - DSH 侧也没有叫「控制台」的界面（侧栏只有会话/终端，那里看不到宿主进程的 stdout）。
 *
 * 所以旧文案「宿主侧日志在 DSH 控制台」等于让老板去一个不存在的地方找东西。这里把
 * 日志变成两处**能真看到**的东西：面板里的抽屉（读内存缓冲）和磁盘上的文件。
 *
 * 三条纪律：
 *   1. **绝不抛错**。日志本身失败不能让一次出图失败，落盘失败只降级成 console.error。
 *   2. **绝不写明文 Key**。所有文本过一遍 {@link redactSecrets}。
 *   3. **有界**。缓冲 400 条、单条 8 KB，参考图的 data URL 由调用方先摘要再传进来。
 */
/** 与 `src/index.ts` 同一个前缀，避免日志里出现两种标识。 */
const LOG = '[dsh-imagegen-panel]';
/** 缓冲上限：一次出图最多写几条，400 条足够覆盖好几轮排查。 */
const MAX_ENTRIES = 400;
/** 单条上限：上游返回体可能很长，截断后再进缓冲，避免一份日志吃掉几十 MB。 */
const MAX_TEXT = 8000;
/** 环形缓冲（越靠后越新）。 */
const buffer = [];
/** 递增序号。 */
let seq = 0;
/** 落盘链：把并发的 append 串成一条，避免同一文件交叉写。 */
let writeChain = Promise.resolve();
/** 落盘失败只提示一次（目录被清理时不该刷屏）。 */
let fileFailureReported = false;
/**
 * 两位补零。
 *
 * 名字带 `log` 前缀不是啰嗦：`scripts/build.mjs` 把宿主侧的每个模块**拼进同一个
 * 作用域**，顶层重名会直接构建失败（实测 `stamp` / `pad` 与 `image-store.ts` 撞过）。
 */
function logPad(value) {
    return String(value).padStart(2, '0');
}
/** `2026-10-10 18:42:03`（本地时间，老板在 GMT+8，日志要能直接对表）。 */
function logStamp(date) {
    return `${date.getFullYear()}-${logPad(date.getMonth() + 1)}-${logPad(date.getDate())} `
        + `${logPad(date.getHours())}:${logPad(date.getMinutes())}:${logPad(date.getSeconds())}`;
}
/** 日期文件名（按本地时区分天）。 */
function logDateKey(date) {
    return `${date.getFullYear()}-${logPad(date.getMonth() + 1)}-${logPad(date.getDate())}`;
}
/** 日志目录：`~/.dsh/dsh-imagegen-panel/logs/`。 */
function logDir() {
    return path.join(imagegenHome(), 'logs');
}
/**
 * 今天的日志文件绝对路径。
 * @param date - 默认当前时间（测试里可注入）。
 * @returns 绝对路径。
 */
function logFilePath(date = new Date()) {
    return path.join(logDir(), `host-${logDateKey(date)}.log`);
}
/**
 * 抹掉文本里的密钥。
 *
 * 调用方本来就不该把 Key 传进来，这里是**最后一道网**：日志会被复制粘贴到别处，
 * 一次疏忽的代价比一句正则大得多。
 * @param text - 原始文本。
 * @returns 掩码后的文本。
 */
function redactSecrets(text) {
    return text
        // `sk-or-v1-…` / `sk-…`：保留前 6 位便于辨认是哪一把，其余抹掉。
        .replace(/\b(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]{6,}/gu, '$1***')
        .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/giu, '$1***');
}
/** 把任意附加信息变成一句可读文本。 */
function describe(extra) {
    if (extra === undefined)
        return '';
    if (extra instanceof Error) {
        const stack = typeof extra.stack === 'string' ? extra.stack.split('\n').slice(0, 3).join(' | ') : '';
        return stack === '' ? extra.message : `${extra.message}（${stack}）`;
    }
    if (typeof extra === 'string')
        return extra;
    try {
        return JSON.stringify(extra);
    }
    catch {
        return String(extra);
    }
}
/**
 * 写一条宿主日志。
 *
 * 三处同时写：内存缓冲（面板抽屉读它）、磁盘文件（关了面板也能查）、
 * 以及原来的 `console`（从终端跑 `dsh` 时行为与改动前一致）。
 * @param level - 级别。
 * @param message - 主文本。
 * @param extra - 附加信息（Error / 对象 / 字符串），会自动展开成一行。
 * @returns 刚写入的那条（`at` 已带时间）。
 */
function hostLog(level, message, extra) {
    const tail = describe(extra);
    const raw = tail === '' ? message : `${message} ${tail}`;
    const text = redactSecrets(raw).slice(0, MAX_TEXT);
    const now = new Date();
    const entry = { seq: ++seq, at: logStamp(now), level, text };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES)
        buffer.splice(0, buffer.length - MAX_ENTRIES);
    // 镜像到 console：终端起 dsh 时仍能实时看到（行为与改造前一致）。
    if (level === 'error')
        console.error(`[dsh-imagegen-panel] ${text}`);
    else if (level === 'warn')
        console.warn(`[dsh-imagegen-panel] ${text}`);
    else
        console.log(`[dsh-imagegen-panel] ${text}`);
    // 落盘：串行追加，失败只报不抛 —— 日志写不进去不该让出图失败。
    const line = `${entry.at} [${level}] ${text}\n`;
    const file = logFilePath(now);
    writeChain = writeChain
        .then(async () => {
        await mkdir(logDir(), { recursive: true });
        await appendFile(file, line, 'utf8');
    })
        .catch((error) => {
        // 数据目录被整体删掉（自检收尾、用户清理）时静默跳过：那已经不是「日志写不进去」，
        // 而是「这份日志本来就没有存在的必要」，报出来只会淹没真正的错误。
        if (error.code === 'ENOENT')
            return;
        // 其余失败只报一行、只报一次：重复刷栈会把真正的错误淹掉。
        if (!fileFailureReported) {
            fileFailureReported = true;
            console.error(`${LOG} 日志落盘失败（${file}）：${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return entry;
}
/**
 * 等落盘链排空。
 *
 * 两个用途：自检要断言「文件里真的有内容」；进程退出前也可以调一次，
 * 免得最后几条日志还在异步队列里就没了。
 */
async function flushLogs() {
    await writeChain;
}
/**
 * 读最近若干条。
 * @param limit - 取最后 N 条（默认 200，上限 {@link MAX_ENTRIES}）。
 * @returns 新的在前。
 */
function recentLogs(limit = 200) {
    const size = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)));
    return buffer.slice(-size).reverse();
}
/**
 * 把日志导成纯文本（「下载日志」用）。
 * @param limit - 取最后 N 条。
 * @returns 每行一条，时间正序。
 */
function logsAsText(limit = MAX_ENTRIES) {
    const size = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)));
    return buffer.slice(-size).map((entry) => `${entry.at} [${entry.level}] ${entry.text}`).join('\n');
}
/** 缓冲里的条数（health 路由自检用）。 */
function logCount() {
    return buffer.length;
}
/** 只清内存缓冲（磁盘文件保留 —— 那是排查记录，不该被一次点击抹掉）。 */
function clearLogBuffer() {
    buffer.length = 0;
}

// ---- src/open-file.ts ----
/**
 * 用**系统默认程序**打开一个本地文件（宿主半边）。
 *
 * 为什么是 Explorer 而不是自己解析文件关联：
 * 本机 `assoc .png` 说 `Honeyview.png`，而 HKCU 的 UserChoice 是 Windows 照片 ——
 * 双击走的是后者。自己读关联表只会得到「以为打开了、其实开的是另一个程序」。
 * Explorer 就是双击走的那条路，只有它的解析和用户预期一致。
 *
 * 实现照抄 `@deepseek-ai/dsh-native-command` 的 `path-opener`（Windows 分支的等价副本）：
 * 插件的模块解析够不着 DSH 安装目录里的 `@deepseek-ai/*` 包，所以没法直接 import，
 * 但那份实现里的三条硬约束都是踩出来的坑，一条都不能省：
 *
 *  1. **不能给 Explorer 裸路径**。Explorer 解析自己的命令行、在逗号和等号处切字段，
 *     路径里出现这两个字符会静默打开别的东西 —— 先转成文件 URI，再把这两个字符转义。
 *  2. **不能对非 ASCII 做百分号编码**。Explorer 拒绝文件 URI 里编码过的非 ASCII，
 *     会掉头去打开「文档」文件夹；字面字符它反而认。所以纯非 ASCII 的转义序列要还原。
 *  3. **Explorer 回 1 是成功**。它把请求委派给已经在跑的 desktop 进程后就是退出码 1，
 *     按失败处理会把每次成功的打开都报成错误。
 *
 * 失败判据（与 DSH 官方同义）：看护窗口内退出且码不对 = 失败；窗口到了还在跑 = 已经
 * 交出去，算成功，进程留着不杀。
 */
/** Explorer 委派给已在运行的 desktop 进程后的退出码：请求已被 shell 接手。 */
const DELEGATED_EXIT_CODE = 1;
/**
 * 等待打开器退出的看护窗口（毫秒）。
 *
 * 这不是「打开要多久」的预算，而是**早失败**的窗口：正常的打开器把请求交给 shell
 * 之后立刻就退出了，所以窗口到了还没退出只可能是它转去干别的事 —— 那是成功。
 */
const OPEN_WATCH_MS = 10_000;
/**
 * 把一个路径编码成 Explorer 能完整收到的目标（见文件头的三条约束）。
 * @param windowsPath - Windows 绝对路径。
 * @returns 文件 URI 形式的目标，逗号与等号已转义、非 ASCII 保持字面量。
 */
function explorerTarget(windowsPath) {
    // 官方那份写的是 `pathToFileURL(p, { windows: true })`，但 Node 的 `pathToFileURL`
    // 只接受一个参数（多传的会被忽略），所以这里不传第二个 —— 实测 7 类路径（驱动器绝对、
    // 正斜杠、UNC、`\\?\`、`\\?\UNC\`、尾空格、`..`）两边输出逐字相同。
    const href = pathToFileURL(windowsPath).href;
    return href
        // 一串「每个字节都 ≥ 0x80」的转义合起来是一个非 ASCII 字符，还原成字面量。
        .replace(/(?:%[89A-F][0-9A-F])+/giu, (escaped) => decodeURIComponent(escaped))
        .replaceAll(',', '%2C')
        .replaceAll('=', '%3D');
}
/**
 * 跑一条打开命令，把「已交出去」与「真失败」分开。
 * @param command - 可执行文件（PATH 名或绝对路径）。
 * @param args - argv（绝不经 shell 拼接）。
 * @param acceptDelegatedExit - 是否把退出码 1 当成功。**只有 Windows 的 Explorer 需要**：
 *   它把请求转交给已在运行的 desktop 进程后就是退出码 1；而 `open` 与 `xdg-open`
 *   失败时也回 1 —— 对它们豁免就等于把真失败报成成功（官方实现同样只在 Explorer
 *   分支豁免 1，macOS/Linux 分支没有这条）。
 * @returns 命令已交出去时 resolve；真失败时 reject。
 */
function runOpener(command, args, acceptDelegatedExit = false) {
    return new Promise((resolve, reject) => {
        const opening = new Promise((opened, failed) => {
            execFile(command, args, { windowsHide: false }, (error) => {
                if (error === null) {
                    opened();
                    return;
                }
                const code = error.code;
                if (acceptDelegatedExit && code === DELEGATED_EXIT_CODE) {
                    opened();
                    return;
                }
                failed(error);
            });
        });
        // 看护窗口：到点仍没退出 = 已经交出去了，按成功结案；子进程不杀（它可能正在
        // 弹窗口），后到的失败结果被吞掉，因为请求早就答复了。
        const watch = setTimeout(() => {
            opening.catch(() => { });
            resolve();
        }, OPEN_WATCH_MS);
        opening.then(() => { clearTimeout(watch); resolve(); }, (error) => { clearTimeout(watch); reject(error instanceof Error ? error : new Error(String(error))); });
    });
}
/**
 * 自检用的干跑开关：值为 `1` 时只走完调用方自己的校验，不碰桌面。
 *
 * 为什么要有这条缝：离线自检（`scripts/host-check.mjs`）要覆盖「校验通过之后」的
 * 响应形状，但不能每次跑自检都在老板机器上弹一个看图器窗口。真机上**确实弹窗口**
 * 那一步由 `live-check` 与人工点击覆盖 —— 这里的干跑不改变生产行为，不设这个
 * 环境变量时走的还是原路。
 */
const DRY_RUN_ENV = 'DSH_IMAGEGEN_OPEN_DRY_RUN';
/**
 * 用系统默认程序打开一个文件。
 *
 * 调用方负责先确认「这个路径确实存在、且是允许打开的那个」—— 这里只负责交给桌面。
 * @param target - 本地绝对路径。
 * @returns `opened` = 已交给桌面；`dry-run` = 自检干跑，**没有**真的打开（调用方据此
 *   写日志，免得日志里出现一条「已打开」而实际什么都没发生）。
 */
async function openWithDefaultApp(target) {
    if (process.env[DRY_RUN_ENV] === '1')
        return 'dry-run';
    if (process.platform === 'win32') {
        await runOpener('explorer.exe', [explorerTarget(target)], true);
        return 'opened';
    }
    if (process.platform === 'darwin') {
        await runOpener('open', [target]);
        return 'opened';
    }
    await runOpener('xdg-open', [target]);
    return 'opened';
}

// ---- src/providers.ts ----
/**
 * 协议适配层（阶段 6）。
 *
 * 四种协议各自的**端点、鉴权头、请求体形状、响应形状**都不一样，但面板只认一件事：
 * 「给我一段提示词，还我一张图」。所以这里把差异全部收敛到两个纯函数：
 *
 *   `planGeneration()`  面板参数 → { URL, 请求头, 请求体, 响应形状 }
 *   `parseProviderResponse()`  上游响应 → { 图片, 花费 }
 *
 * | 协议 | 出图端点 | 鉴权 | 响应 |
 * |---|---|---|---|
 * | `openrouter` | `POST {base}/images` | `Authorization: Bearer` | `data[].b64_json` |
 * | `openai` | `POST {base}/images/generations` | `Authorization: Bearer` | `data[].b64_json` |
 * | `gemini` | `POST {base}/models/{model}:generateContent` | `x-goog-api-key` | `candidates[].content.parts[].inlineData` |
 * | `custom` | `POST {base}/images`（原样透传） | `Authorization: Bearer` | `data[].b64_json`（兼容 `images[].b64`） |
 *
 * **能力表只有 OpenRouter 有**（它的 `supported_parameters` 是权威的）。其他协议下
 * `params` 传 undefined，`buildImageRequest` 就退化成「只发核心字段 + 额外参数」——
 * 这是刻意的：没有能力表就不要假装知道模型支持什么。
 */
/** Bearer 头。 */
function bearer(apiKey) {
    return { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${apiKey}` };
}
/** 合并「额外参数」到请求体（不许覆盖 model/prompt）。 */
function mergeExtra(body, extraJson) {
    if (extraJson.trim() === '')
        return;
    try {
        const parsed = JSON.parse(extraJson);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return;
        for (const [key, value] of Object.entries(parsed)) {
            if (key === 'model' || key === 'prompt')
                continue;
            body[key] = value;
        }
    }
    catch {
        // 配置写入时已校验过 JSON；这里静默跳过。
    }
}
/**
 * 把面板的比例映射成 OpenAI 的 `size`。
 *
 * OpenAI 只认几个固定尺寸（`1024x1024` / `1536x1024` / `1024x1536` / `auto`），
 * 拿不到对应关系时给 `auto` 让上游自己决定，而不是编一个尺寸发上去。
 * @param aspectRatio - 面板选的比例。
 * @returns OpenAI 的 size 值；空串表示不发这个字段。
 */
function sizeForOpenAI(aspectRatio) {
    switch (aspectRatio) {
        case '1:1': return '1024x1024';
        case '3:2':
        case '16:9':
        case '4:3':
        case '5:4':
        case '21:9': return '1536x1024';
        case '2:3':
        case '9:16':
        case '3:4':
        case '4:5':
        case '9:21': return '1024x1536';
        default: return 'auto';
    }
}
/** 从 data URL 里取 base64 与媒体类型。 */
function splitDataUrl(value) {
    const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/su.exec(value);
    if (match === null)
        return undefined;
    const data = match[2];
    // 参考图一律是 base64（Composer 用 FileReader.readAsDataURL 读的）。
    return { mediaType: match[1], data: data.includes(';base64,') ? data.split(';base64,').pop() : data };
}
/**
 * Gemini 的 `generateContent` 计划。
 *
 * 与另外三种协议差别最大：提示词进 `contents[].parts[].text`，参考图进
 * `parts[].inline_data`，张数走 `generationConfig.candidateCount`。
 * @param input - 本次生成参数。
 * @param settings - 协议与配置。
 * @param apiKey - 明文 Key（只在这里拼进请求头）。
 * @returns 执行计划。
 */
function geminiPlan(input, settings, apiKey) {
    const parts = [{ text: input.prompt }];
    const dropped = [];
    for (const reference of input.references) {
        const split = splitDataUrl(reference);
        if (split === undefined) {
            dropped.push('input_references（不是 data URL，Gemini 只吃 inline_data）');
            continue;
        }
        parts.push({ inline_data: { mime_type: split.mediaType, data: split.data } });
    }
    const generationConfig = { responseModalities: ['IMAGE'] };
    if (input.count > 1)
        generationConfig.candidateCount = input.count;
    // Gemini 没有 resolution / aspect_ratio / quality 这套参数名。
    if (input.aspectRatio !== '')
        dropped.push('aspect_ratio（Gemini 不支持）');
    if (input.resolution !== '')
        dropped.push('resolution（Gemini 不支持）');
    if (input.quality.trim() !== '')
        dropped.push('quality（Gemini 不支持）');
    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig,
    };
    mergeExtra(body, settings.extraJson);
    return {
        url: joinUrl(settings.baseUrl, `/models/${input.model}:generateContent`),
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-goog-api-key': apiKey },
        body,
        shape: 'gemini',
        dropped,
        // gemini / openai 这两条路自己组装请求体，没有「面板字段」可被覆盖。
        overridden: [],
    };
}
/** OpenAI 兼容协议的 `images/generations` 计划。 */
function openaiPlan(input, settings, apiKey) {
    const body = {
        model: input.model,
        prompt: input.prompt,
        response_format: 'b64_json',
    };
    const dropped = [];
    if (input.count > 1)
        body.n = input.count;
    const size = sizeForOpenAI(input.aspectRatio);
    if (size !== '')
        body.size = size;
    const quality = normalizeQuality(input.quality);
    if (quality !== '')
        body.quality = quality;
    if (input.references.length > 0) {
        // OpenAI 的图生图走另一个端点（`/images/edits`，multipart 上传），本阶段不做。
        dropped.push('input_references（OpenAI 图生图走 /images/edits，本版未接）');
    }
    if (input.resolution !== '')
        dropped.push('resolution（OpenAI 用 size，不用分辨率档位）');
    mergeExtra(body, settings.extraJson);
    return {
        url: joinUrl(settings.baseUrl, '/images/generations'),
        method: 'POST',
        headers: bearer(apiKey),
        body,
        shape: 'openai',
        dropped,
        overridden: [],
    };
}
/**
 * 组装一次生成的执行计划。
 * @param input - 面板参数。
 * @param settings - 协议与配置（Base URL / 输出格式 / 额外参数）。
 * @param apiKey - 明文 Key。
 * @param params - 该模型的 `supported_parameters`（**只有 OpenRouter 有**，其余传 undefined）。
 * @returns 执行计划。
 */
function planGeneration(input, settings, apiKey, params) {
    if (settings.protocol === 'gemini')
        return geminiPlan(input, settings, apiKey);
    if (settings.protocol === 'openai')
        return openaiPlan(input, settings, apiKey);
    // openrouter 与 custom 共用 `POST {base}/images`：
    // 前者按能力表裁剪字段，后者没有能力表（用户自建网关），就只发核心字段 + 额外参数。
    const built = buildImageRequest(input, {
        params: settings.protocol === 'openrouter' ? params : undefined,
        outputFormat: settings.outputFormat,
        extraJson: settings.extraJson,
        ...settings.supportsStreaming === undefined ? {} : { supportsStreaming: settings.supportsStreaming },
    });
    return {
        url: joinUrl(settings.baseUrl, '/images'),
        method: 'POST',
        headers: bearer(apiKey),
        body: built.body,
        shape: 'openai',
        dropped: built.dropped,
        overridden: built.overridden,
    };
}
/**
 * 解析 Gemini 的 `generateContent` 响应。
 *
 * 兼容 camelCase（`inlineData`，官方 REST 返回这个）与 snake_case（`inline_data`）。
 * @param payload - 上游 JSON。
 * @returns 图片数组（Gemini 不给单价，所以 cost 恒为 undefined）。
 */
function parseGeminiGeneration(payload) {
    const out = { images: [] };
    if (typeof payload !== 'object' || payload === null)
        return out;
    const source = payload;
    const candidates = Array.isArray(source.candidates) ? source.candidates : [];
    for (const candidate of candidates) {
        if (typeof candidate !== 'object' || candidate === null)
            continue;
        const content = candidate.content;
        if (typeof content !== 'object' || content === null)
            continue;
        const parts = content.parts;
        if (!Array.isArray(parts))
            continue;
        for (const part of parts) {
            if (typeof part !== 'object' || part === null)
                continue;
            const record = part;
            const inline = record.inlineData ?? record.inline_data;
            if (typeof inline !== 'object' || inline === null)
                continue;
            const image = inline;
            const data = typeof image.data === 'string' ? image.data : '';
            if (data === '')
                continue;
            const mediaType = typeof image.mimeType === 'string'
                ? image.mimeType
                : typeof image.mime_type === 'string' ? image.mime_type : 'image/png';
            out.images.push({ b64: data, mediaType });
        }
    }
    return out;
}
/**
 * 按形状解析响应。
 * @param shape - 计划里声明的响应形状。
 * @param payload - 上游 JSON。
 * @param parseOpenAI - OpenAI 系（`data[].b64_json`）的解析器。
 * @returns 图片与花费。
 */
function parseProviderResponse(shape, payload, parseOpenAI) {
    return shape === 'gemini' ? parseGeminiGeneration(payload) : parseOpenAI(payload);
}

// ---- src/forge.ts ----
/**
 * 读 prompt-forge 的提示词模板（宿主侧）。
 *
 * 为什么要有这个模块：生图面板上的「优化提示词」按钮想直接用
 * `dsh-prompt-forge` 里那个叫「文生图优化」的 preset，而 prompt-forge 的
 * `POST /api/dsh-prompt-forge/optimize` **要求调用方自己把 system 文本传进去**
 * （它的注释写得很清楚：preset-vs-main 的解析在浏览器侧完成，宿主不重新推导配置）。
 * 所以这里负责把那段文本取出来，交给前端去调 prompt-forge 的 SSE 路由。
 *
 * ## 为什么是「深度搜索」而不是按字段名取
 *
 * 第一版按 `configEditor.configuration()[].entry.name === 'dsh-prompt-forge'` 找，
 * 真机上直接回「没找到 prompt-forge」——`configuration()` 大概率只覆盖「通过配置编辑器
 * 改过的行」，返回的是空数组。与其继续猜 Loader Entry / SettingsDescriptor 的字段名
 * （它们不是我们自己的类型，随时可能变），不如**按语义找**：
 *
 * > 谁能给出一份「带 `presets` 数组、且其中某个 preset 叫『文生图优化』」的配置，
 * > 就是它。
 *
 * 两个来源都试：`settings.describe()`（官方设置服务，客户端渲染表单就用它，带值）
 * 和 `configEditor.configuration()`（配置编辑器，带 override/inherited）。形状不认识
 * 没关系，深度搜索只认 `presets` 这个键。最后还有一层保险：直接读 profile 的 patch 文件。
 */
/** 生图面板固定用的模板名 —— 老板拍板写死这一个。 */
const FORGE_PRESET_NAME = '文生图优化';
/** 深度搜索的上限，防止在巨型对象上跑飞。 */
const MAX_DEPTH = 8;
/** 速写里**只回长度**的字段名（提示词正文、密钥）。 */
const REDACT_KEYS = new Set(['system', 'mainSystemPrompt', 'apiKey', 'key', 'token', 'secret']);
/** 从一份配置里挑出 presets 数组。 */
function presetsOf(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === 'object' && item !== null)
        .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : '',
        system: typeof item.system === 'string' ? item.system : '',
    }))
        .filter((preset) => preset.system.trim() !== '');
}
/** 名字匹配：先精确，再包含（老板把模板改名成「文生图优化 v2」也还能用）。 */
function matchPreset(presets, wanted) {
    return presets.find((preset) => preset.name.trim() === wanted)
        ?? presets.find((preset) => preset.name.includes(wanted));
}
/** 从一个对象里取字符串字段（浅层，两个来源的 provider/model 都在浅层）。 */
function stringField(source, key) {
    if (source === null || typeof source !== 'object')
        return '';
    const value = source[key];
    return typeof value === 'string' ? value : '';
}
/**
 * 在任意结构里找「带目标模板的 presets 数组」。
 * @param value - 任意 JSON 结构。
 * @param wanted - 目标模板名。
 * @param stats - 顺路收集诊断信息。
 * @param depth - 当前深度。
 * @returns 命中的模板与它所在配置里的渠道/模型。
 */
function deepFindPreset(value, wanted, stats, depth = 0) {
    if (depth > MAX_DEPTH || value === null || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = deepFindPreset(item, wanted, stats, depth + 1);
            if (hit !== undefined)
                return hit;
        }
        return undefined;
    }
    const record = value;
    // 命中点：这个对象自己带 presets。
    if (record.presets !== undefined) {
        const presets = presetsOf(record.presets);
        if (presets.length > 0) {
            stats.scanned += 1;
            for (const preset of presets)
                stats.names.push(preset.name);
            const found = matchPreset(presets, wanted);
            if (found !== undefined) {
                return {
                    preset: found,
                    provider: stringField(record, 'provider'),
                    model: stringField(record, 'model'),
                };
            }
        }
    }
    for (const nested of Object.values(record)) {
        const hit = deepFindPreset(nested, wanted, stats, depth + 1);
        if (hit !== undefined)
            return hit;
    }
    return undefined;
}
/** 从任意值里窄化出可用的服务面。 */
function asSource(value, method) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const candidate = value;
    return typeof candidate[method] === 'function' ? candidate : undefined;
}
/**
 * 收集能读配置的宿主服务。
 * @param ctx - 插件上下文。
 * @returns 每个来源的名字与它返回的原始结构（读不到就跳过）。
 */
function collectConfigSources(ctx) {
    const sources = [];
    const settings = asSource(ctx.get('settings'), 'describe');
    if (settings?.describe !== undefined) {
        try {
            sources.push({ name: 'settings.describe()', value: settings.describe() });
        }
        catch { /* 换下一个来源 */ }
    }
    const editor = asSource(ctx.get('configEditor'), 'configuration');
    if (editor?.configuration !== undefined) {
        try {
            sources.push({ name: 'configEditor.configuration()', value: editor.configuration() });
        }
        catch { /* 同上 */ }
    }
    return sources;
}
// --------------------------------------------------------------- 兜底：直接读 patch 文件
/**
 * 兜底来源：profile 的 `cordis.patch.yml`。
 *
 * **为什么需要它**：上面两个服务到底带不带「生效值」取决于 DSH 版本 ——
 * `settings.describe()` 更像「把 schema 投成表单」，`configEditor.configuration()`
 * 可能只覆盖「通过配置编辑器改过的行」（真机上它就没给出 prompt-forge 那一行，
 * 于是第一版直接回了「没找到 prompt-forge」）。而这份文件是**确定的**：
 * profile 的 patch 里就存着 `presets` 数组。
 *
 * 只在服务都读不到时才走这条路 —— 它是保险，不是主路。
 */
/** 找 patch 文件：`<home>/.dsh/profiles/<profile>/cordis.patch.yml`。 */
function defaultPatchPaths() {
    const base = join(homedir(), '.dsh', 'profiles');
    let profiles;
    try {
        profiles = readdirSync(base);
    }
    catch {
        return [];
    }
    return profiles
        .map((name) => join(base, name, 'cordis.patch.yml'))
        .filter((file) => existsSync(file));
}
/** 一行前面的空格数。 */
function indentOf(line) {
    return (line.match(/^\s*/u) ?? [''])[0].length;
}
/** YAML 块标量 → 文本（`|` 保留换行，`>` 折成空格）。 */
function blockScalar(lines, keyIndex) {
    const keyLine = lines[keyIndex] ?? '';
    const folded = keyLine.includes('>');
    const base = indentOf(keyLine);
    const body = [];
    for (let index = keyIndex + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.trim() === '') {
            body.push('');
            continue;
        }
        if (indentOf(line) <= base)
            break;
        body.push(line.slice(Math.min(line.length, base + 2)));
    }
    if (!folded)
        return body.join('\n').trim();
    const out = [];
    for (const line of body) {
        if (line === '') {
            out.push('\n');
            continue;
        }
        const last = out[out.length - 1];
        out.push(last === undefined || last === '\n' || last.endsWith(' ') ? line : ` ${line}`);
    }
    return out.join('').trim();
}
/**
 * 从一个 patch 文件里抠出 prompt-forge 那一行的 `presets` / `provider` / `model`。
 * @param file - patch 文件路径。
 * @returns 抠出来的片段；没有 prompt-forge 那一行时返回 undefined。
 */
function readPatchRow(file) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    }
    catch {
        return undefined;
    }
    const lines = text.split(/\r?\n/u);
    const nameAt = lines.findIndex((line) => /^\s*name:\s*["']?dsh-prompt-forge["']?\s*$/u.test(line));
    if (nameAt < 0)
        return undefined;
    /**
     * 这一行（列表项）的边界。
     *
     * YAML 列表项里 `id:` / `name:` / `config:` 是**同一缩进**的兄弟节点，
     * 所以「行」的判定不能按「缩进大于 name 行」来 —— 那会在下一行的 `config:` 处立刻停住，
     * 一行都收不到（第一版就是这么错的）。正确规则：从 name 行往后收，直到遇见
     * 缩进更小的下一个列表项（`- `）。
     */
    const memberIndent = indentOf(lines[nameAt] ?? '');
    const block = [];
    for (let index = nameAt + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.trim() === '') {
            block.push(line);
            continue;
        }
        if (indentOf(line) < memberIndent && /^\s*-\s/u.test(line))
            break;
        if (indentOf(line) < memberIndent)
            break;
        block.push(line);
    }
    const row = {};
    const presetsAt = block.findIndex((line) => /^\s*presets:\s*$/u.test(line));
    if (presetsAt >= 0) {
        const listIndent = indentOf(block[presetsAt] ?? '');
        const presets = [];
        let current;
        for (let index = presetsAt + 1; index < block.length; index += 1) {
            const line = block[index] ?? '';
            if (line.trim() === '')
                continue;
            if (indentOf(line) <= listIndent)
                break;
            const itemMatch = /^\s*-\s*id:\s*(.+)$/u.exec(line);
            if (itemMatch !== null) {
                if (current !== undefined)
                    presets.push(current);
                current = { id: itemMatch[1].trim(), name: '', system: '' };
                continue;
            }
            if (current === undefined)
                continue;
            const nameMatch = /^\s*name:\s*(.+)$/u.exec(line);
            if (nameMatch !== null) {
                current.name = nameMatch[1].trim();
                continue;
            }
            if (/^\s*system:\s*[|>]-?\s*$/u.test(line)) {
                current.system = blockScalar(block, index);
                // 块标量的正文已经吃掉，跳到它结束的位置。
                const base = indentOf(line);
                while (index + 1 < block.length) {
                    const next = block[index + 1] ?? '';
                    if (next.trim() !== '' && indentOf(next) <= base)
                        break;
                    index += 1;
                }
            }
        }
        if (current !== undefined)
            presets.push(current);
        const usable = presets.filter((preset) => preset.system.trim() !== '');
        if (usable.length > 0)
            row.presets = usable;
    }
    for (const key of ['provider', 'model']) {
        for (const line of block) {
            const match = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'u').exec(line);
            if (match !== null) {
                row[key] = match[1].trim().replace(/^["']|["']$/gu, '');
                break;
            }
        }
    }
    return Object.keys(row).length > 0 ? row : undefined;
}
/** 把 patch 文件也当成来源（值就是抠出来的那一行）。 */
function collectPatchSources(paths) {
    const sources = [];
    for (const file of paths) {
        const row = readPatchRow(file);
        if (row !== undefined)
            sources.push({ name: `patch:${file}`, value: row });
    }
    return sources;
}
/**
 * 结构速写：只回键名 / 类型 / 长度，不回长文本。
 *
 * 给 `GET /dsh-imagegen/preset?debug=1` 用 —— 万一真机上还是找不到模板，
 * 这一个请求就能看出两个服务到底回了什么形状，不用再来一轮「改代码 → 重启 → 猜」。
 * @param value - 任意结构。
 * @param depth - 当前深度（超过 3 层就截断）。
 * @returns 可安全打印的速写。
 */
function outlineOf(value, depth = 0) {
    if (depth > 5)
        return '…';
    if (value === null)
        return null;
    if (Array.isArray(value)) {
        return {
            kind: 'array',
            length: value.length,
            // 采样前 3 个：只给 1 个的话，命中行排在第二个就看不见了（真踩过）。
            sample: value.slice(0, 3).map((item) => outlineOf(item, depth + 1)),
        };
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            // 提示词正文与密钥一律只回长度：自查接口不该把别人的 prompt / key 吐出来。
            if (REDACT_KEYS.has(key) && typeof item === 'string') {
                out[key] = `<${key} ${item.length} 字>`;
                continue;
            }
            out[key] = outlineOf(item, depth + 1);
        }
        return out;
    }
    if (typeof value === 'string')
        return value.length > 60 ? `<string ${value.length} 字>` : value;
    return typeof value;
}
/**
 * 找 prompt-forge 的「文生图优化」模板。
 *
 * 来源顺序：`settings.describe()` → `configEditor.configuration()` → profile 的 patch 文件。
 * 前两个是正经的宿主服务，第三个是保险（前两个都读不到时才会用到）。
 * @param ctx - 插件上下文（要 `ctx.get('settings')` / `ctx.get('configEditor')`）。
 * @param presetName - 要找的模板名。
 * @param patchPaths - 覆盖 patch 文件候选（自检用；省略时按 `~/.dsh/profiles/*` 找）。
 * @returns 找到的模板，或一个说明为什么没找到的结果。
 */
function findForgePreset(ctx, presetName = FORGE_PRESET_NAME, patchPaths) {
    const services = collectConfigSources(ctx);
    const stats = { scanned: 0, names: [] };
    for (const source of services) {
        const hit = deepFindPreset(source.value, presetName.trim(), stats);
        if (hit !== undefined)
            return { kind: 'ok', ...hit };
    }
    // 服务里没有 → 兜底读 patch 文件（它一定有这段文本）。
    const patches = collectPatchSources(patchPaths ?? defaultPatchPaths());
    for (const source of patches) {
        const hit = deepFindPreset(source.value, presetName.trim(), stats);
        if (hit !== undefined)
            return { kind: 'ok', ...hit };
    }
    if (services.length === 0 && patches.length === 0)
        return { kind: 'no-service' };
    // 去重，别把同一个模板名报两遍。
    return { kind: 'no-preset', available: [...new Set(stats.names)], scanned: stats.scanned };
}

// ---- src/index.ts ----
/**
 * dsh-imagegen-panel —— 宿主半边（host half）。
 *
 * 阶段 4 的职责：**真出图**。Key 只在宿主进程里出现，浏览器只拿到图片 id 与路径。
 *
 * 挂的路由（全部 loopback-only，见 `src/http.ts` 的围栏）：
 *
 * | 路径 | 方法 | 作用 |
 * |---|---|---|
 * | `/dsh-imagegen/config`       | GET | 回配置：**只有 `hasKey` + 掩码 `keyHint`，明文永不下发** |
 * | `/dsh-imagegen/config`       | PUT | 收配置（明文 Key 只在这一跳里）→ 校验 → 落盘 → 只回掩码 |
 * | `/dsh-imagegen/models`       | GET | 代理 `GET {base}/images/models`（公开接口，无需 Key） |
 * | `/dsh-imagegen/capabilities` | GET | 代理 `GET {base}/images/models/<id>/endpoints`：权威能力 + 定价 |
 * | `/dsh-imagegen/generate`     | POST | 宿主发 `POST {base}/images`（绕开 CORS，Key 不进浏览器） |
 * | `/dsh-imagegen/history`      | GET | 读索引（最新在前） |
 * | `/dsh-imagegen/open`         | POST | 用**系统默认程序**打开某张图的本地原图（结果行「打开」/ 历史图右键菜单） |
 * | `/dsh-imagegen/image/<id>`   | GET | **prefix** 路由：把落盘的图喂给浏览器 |
 * | `/dsh-imagegen/health`       | GET | 自查：路由是否挂上、配置在哪、Key 有没有、存了几张 |
 * | `/dsh-imagegen/logs`        | GET | 宿主侧日志（面板里的「查看日志」抽屉）；`?format=text` 直接下载 |
 * | `/dsh-imagegen/logs`        | DELETE | 只清内存缓冲（磁盘上的日志文件保留 —— 那是排查记录） |
 * | `/dsh-imagegen/draft`       | GET | 面板草稿（提示词/参数/上次成功生成用的提示词）；没有草稿文件时 `draft: null` |
 * | `/dsh-imagegen/draft`       | PUT | 收草稿 → 宽松收敛 → 原子落盘 → 回落盘后的草稿 |
 *
 * 存储：`~/.dsh/dsh-imagegen-panel/`（`config.json` + `index.json` + `draft.json` + `out/` + `logs/`）。
 *
 * 失败策略：**apply 绝不抛错**。插件从 apply 抛出会让 cordis fiber 进 FAILED，
 * 连带整个 web 启动一起挂掉 —— 一个配错的生图插件不该让老板的 GUI 起不来。
 * 挂不上路由就退化成「面板报『宿主路由不可用』」，其余功能照常。
 */
// 注意：这里的相对 import 必须写成**单行** —— scripts/build.mjs 的宿主打包器
// 逐行扫描 `import … from '…'` 来找依赖图，多行 import 不会被内联（构建还会"成功"，
// 只在运行时报模块找不到）。这是那个手写 bundler 的一个真实约束，别改回去。
/** 插件名。Cordis 用它做日志与去重标识。 */
const name = 'dsh-imagegen-panel';
/** 没有 web carrier 就没有这条管道 —— 它是唯一硬依赖。 */
const inject = ['webServer'];
/**
 * 路由表。
 *
 * 导出它是为了让 `scripts/host-check.mjs` 能对「客户端实际打的路径」与
 * 「宿主实际挂的路径」做一次字面比对 —— 两边写死同一个字符串是这类插件
 * 最常见的静默故障（路由挂了，前端 404，界面只表现为「没反应」）。
 */
const API = {
    config: '/dsh-imagegen/config',
    models: '/dsh-imagegen/models',
    capabilities: '/dsh-imagegen/capabilities',
    generate: '/dsh-imagegen/generate',
    history: '/dsh-imagegen/history',
    save: '/dsh-imagegen/save',
    /**
     * 用系统默认程序打开某张图的**本地原图**。
     *
     * 「打开」只能由宿主做：浏览器最多下载或新开一个标签页，起不来老板的看图工具。
     * 只认索引里的 id（不接受任意路径），所以这条路由开不了索引之外的文件。
     */
    open: '/dsh-imagegen/open',
    /**
     * 读 prompt-forge 的「文生图优化」模板文本。
     *
     * 面板上的「优化提示词」按钮要拿这段 system 文本去调 prompt-forge 自己的
     * `POST /api/dsh-prompt-forge/optimize`（那条路由要求调用方传 system）。
     */
    preset: '/dsh-imagegen/preset',
    health: '/dsh-imagegen/health',
    /**
     * 宿主侧日志。
     *
     * 存在的理由：桌面版 DSH **没有可见的宿主控制台**（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\`
     * 是空目录，界面上也没有「控制台」入口）。把日志塞进一个打不开的终端等于没写 ——
     * 这条路由 + 面板里的抽屉才是老板真能看到日志的地方，另外日志同时落盘到
     * `~/.dsh/dsh-imagegen-panel/logs/host-<日期>.log`，多个进程/重启后也查得到。
     */
    logs: '/dsh-imagegen/logs',
    /**
     * 面板草稿（提示词 / 参数）。
     *
     * 存在理由：面板状态只在一次 DSH 运行里活着，重启就回到初始值 —— 于是
     * 「上次写了没生成，这次进来要留着」这条规则无从判断。这条路由把草稿
     * （连同「最后一次成功生成用的提示词」）落到 `<数据目录>/draft.json`。
     */
    draft: '/dsh-imagegen/draft',
    /**
     * **prefix** 路由：后面接 `/` + 图片 id。
     *
     * ⚠️ 注册时**绝不能带尾斜杠**：webServer 的 prefix 匹配规则是
     * `pathname === prefix || pathname.startsWith(prefix + '/')` ——
     * 写成 `/dsh-imagegen/image/` 就变成要求路径里出现 `//`，于是
     * `/dsh-imagegen/image/<id>` 永远匹配不上，请求落到 SPA 兜底并回 404。
     * （2026-10-10 实测踩到：面板里图全裂、`/image/<id>` 回 404 且 content-type 为空。）
     */
    image: '/dsh-imagegen/image',
};
/** 生成请求体的上限：参考图是 data URL，几 MB 很正常（配置 PUT 用 http.ts 的 1 MB）。 */
const GENERATE_BODY_BYTES = 32 * 1024 * 1024;
/**
 * 草稿请求体的上限。
 *
 * 草稿就是一句提示词 + 一小组参数，正常情况下几 KB。给到 256 KB 是为了让「提示词
 * 特别长」这种合法情况不至于被当成坏请求拒掉 —— 但它仍是个明确的上限，
 * 免得面板侧出 bug 时把整块内存写进这个小 JSON。
 */
const DRAFT_BODY_BYTES = 256 * 1024;
/**
 * 日志前缀现在由 `src/log-store.ts` 的 `hostLog()` 统一拼。
 *
 * 原来这里有一个 `const LOG`，改成 hostLog 之后就没用了 —— 留着会让人以为
 * 「还有别的路径在打日志」，那正是这次要消灭的歧义。
 */
/**
 * 登记一条路由，失败只记日志。
 *
 * 重复注册同一个 (kind, path) 会抛 —— 热重载没清干净、或别的插件占了同一个
 * 路径时，我们要的是「少一条路由」，不是「apply 抛出 → GUI 起不来」。
 * @param disposers - 收集清理函数。
 * @param webServer - webServer 服务面。
 * @param route - 路由定义。
 * @param label - 出错时打印的标识。
 */
function safeRegister(disposers, webServer, route, label) {
    try {
        disposers.push(webServer.register(route));
    }
    catch (error) {
        hostLog('warn', `路由 ${label} 挂载失败：`, error);
    }
}
/** 请求路径（去掉 query）。 */
function pathnameOf(req) {
    try {
        return new URL(req.url ?? '/', 'http://dsh.invalid').pathname;
    }
    catch {
        return req.url ?? '/';
    }
}
/** 一句可展示的失败。 */
function failure(code, message) {
    return { ok: false, code, message };
}
// ------------------------------------------------------------------ 处理器
/** `GET /dsh-imagegen/config` —— 回配置（无明文 Key）。 */
async function handleConfigRead(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const current = await readConfig();
    writeJson(res, 200, {
        ok: true,
        config: publicConfig(current.settings, current.apiKey),
    });
}
/** `PUT /dsh-imagegen/config` —— 收配置、落盘、只回掩码。 */
async function handleConfigWrite(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'PUT') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const body = await readJsonBody(req);
    if (body === undefined) {
        writeJson(res, 400, badRequestBody());
        return;
    }
    const validated = validatePatch(body.config);
    if (!validated.ok) {
        writeJson(res, 400, failure(validated.code, validated.message));
        return;
    }
    // Key 的三态：换（body.apiKey 非空）、清（clearKey）、不动（都不给）。
    const current = await readConfig();
    let apiKey = current.apiKey;
    if (body.clearKey === true)
        apiKey = '';
    if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '')
        apiKey = body.apiKey.trim();
    const settings = { ...current.settings, ...validated.patch };
    try {
        await writeConfig(settings, apiKey);
    }
    catch (error) {
        // 落盘失败必须让用户知道 —— 否则「保存成功」的提示会变成谎言。
        writeJson(res, 500, failure('write-failed', `配置落盘失败：${error instanceof Error ? error.message : String(error)}`));
        return;
    }
    writeJson(res, 200, { ok: true, config: publicConfig(settings, apiKey) });
}
/**
 * `GET /dsh-imagegen/models` —— 代理上游模型目录。
 *
 * 这个上游接口是**公开**的（实测：不带 Key 也 200），所以面板在填 Key 之前就能
 * 看到有哪些模型、各自支持什么参数 —— 这正好符合「先挑模型再配 Key」的实际顺序。
 */
async function handleModels(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const current = await readConfig();
    if (current.settings.protocol !== 'openrouter') {
        // 其他协议**没有**等价的能力表（OpenAI 的 `/models` 把聊天模型也混在一起，
        // Gemini 的模型列表也没有图像参数声明）。这里不猜、不编，直接说清楚 ——
        // 面板会把这句 note 显示出来，用户就知道该手填模型 id。
        writeJson(res, 200, {
            ok: true,
            models: [],
            note: `「${current.settings.protocol}」协议没有图像模型能力表，请在「连接配置」里手动填写模型 id`,
        });
        return;
    }
    const force = (req.url ?? '').includes('refresh=1');
    try {
        const { models } = await getImageModels(current.settings.baseUrl, undefined, force);
        writeJson(res, 200, { ok: true, source: `${current.settings.baseUrl}/images/models`, models });
    }
    catch (error) {
        writeJson(res, 502, failure('upstream', `拉模型列表失败：${error instanceof Error ? error.message : String(error)}`));
    }
}
/** `GET /dsh-imagegen/capabilities?model=<id>&resolution=<tier>` —— 权威能力与定价。 */
async function handleCapabilities(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    const model = url.searchParams.get('model') ?? '';
    const resolution = url.searchParams.get('resolution') ?? undefined;
    if (model.trim() === '') {
        writeJson(res, 400, failure('bad-model', '缺少 model 参数'));
        return;
    }
    const current = await readConfig();
    if (current.settings.protocol !== 'openrouter') {
        // 能力表只有 OpenRouter 有。其他协议回 501，客户端会静默忽略（面板退回
        // 「用模型列表里那份候选值」或直接保持当前值）—— 不编一份假能力表。
        writeJson(res, 501, failure('capabilities-unsupported', `「${current.settings.protocol}」协议没有能力表接口`));
        return;
    }
    try {
        const capabilities = await getModelCapabilities(current.settings.baseUrl, model.trim(), resolution);
        writeJson(res, 200, { ok: true, capabilities });
    }
    catch (error) {
        writeJson(res, 502, failure('upstream', `拉模型能力失败：${error instanceof Error ? error.message : String(error)}`));
    }
}
/** `GET /dsh-imagegen/history` —— 读索引。 */
async function handleHistory(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const index = await readImageIndex();
    writeJson(res, 200, { ok: true, images: index.map(toClientImage) });
}
/** `GET /dsh-imagegen/image/<id>` —— 把落盘的图喂给浏览器。 */
async function handleImage(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const path = pathnameOf(req);
    // 前缀不带尾斜杠，所以先剥掉分隔用的 `/` 才是 id。
    const id = decodeURIComponent(path.slice(API.image.length).replace(/^\/+/u, ''));
    if (id === '') {
        writeJson(res, 400, failure('bad-id', '缺少图片 id'));
        return;
    }
    const entry = await findImage(id);
    if (entry === undefined) {
        writeJson(res, 404, failure('not-found', `索引里没有这张图：${id}`));
        return;
    }
    const bytes = await readImageBytes(entry);
    if (bytes === undefined) {
        writeJson(res, 404, failure('file-missing', `索引里有记录但文件不在了：${entry.savedPath}`));
        return;
    }
    res.writeHead(200, {
        'content-type': entry.mediaType,
        'content-length': String(bytes.length),
        // 文件名带时间戳、内容不会变，可以长期缓存。
        'cache-control': 'private, max-age=31536000, immutable',
        'referrer-policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
}
/**
 * 允许从请求体 `request.extra` 里透传到上游的字段白名单。
 *
 * 就是字段规格表那几项（`aspect_ratio` / `resolution` / `size` / `n` / `quality` /
 * `output_format` / `background` / `output_compression` / `seed`）+ `stream`。
 * 白名单是**必须的**：请求体是前端来的，没有它就能顺手塞 `provider` 或覆盖
 * `model` / `prompt` —— 那等于把路由权交给了浏览器。
 */
const EXTRA_FIELDS = new Set([...FIELD_SPECS.map((item) => item.name), STREAM_FIELD.name]);
/** 解析并校验一次生成请求。 */
function readGenerateInput(body) {
    const request = typeof body.request === 'object' && body.request !== null ? body.request : {};
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (prompt === '')
        return { ok: false, code: 'empty-prompt', message: '提示词是空的' };
    const model = typeof request.model === 'string' ? request.model.trim() : '';
    if (model === '')
        return { ok: false, code: 'bad-model', message: '没有选模型' };
    const rawCount = typeof request.count === 'number' && Number.isFinite(request.count) ? Math.round(request.count) : 1;
    const count = Math.min(10, Math.max(1, rawCount));
    const references = Array.isArray(request.references)
        ? request.references.filter((item) => typeof item === 'string' && item.startsWith('data:'))
        : [];
    // 模型驱动表单收集的其它字段（`background` / `seed` / `size` / `stream` …）。
    // 只收字符串，且**只在这个白名单里收** —— 请求体是前端来的，不能让它顺手把
    // `model` / `prompt` / `provider` 这类身份与路由字段塞进来。
    const extra = {};
    if (typeof request.extra === 'object' && request.extra !== null) {
        for (const [key, value] of Object.entries(request.extra)) {
            if (!EXTRA_FIELDS.has(key))
                continue;
            if (typeof value === 'string')
                extra[key] = value;
            else if (typeof value === 'number' && Number.isFinite(value))
                extra[key] = String(value);
            else if (typeof value === 'boolean')
                extra[key] = String(value);
        }
    }
    return {
        ok: true,
        input: {
            prompt,
            model,
            aspectRatio: typeof request.aspectRatio === 'string' ? request.aspectRatio : '',
            resolution: typeof request.resolution === 'string' ? request.resolution : '',
            count,
            quality: typeof request.quality === 'string' ? request.quality : '',
            references,
            ...Object.keys(extra).length === 0 ? {} : { extra },
        },
    };
}
/**
 * 把要发给上游的请求体压成一行可读摘要。
 *
 * 这是「看不全」问题的核心补丁：老板看到的只有上游那句 `HTTP 400 …`，
 * 看不到我们**到底发了什么**。摘要里：
 *  - 短标量原样列出（`aspect_ratio="16:9"`）；
 *  - 长字符串只留长度（参考图的 data URL 有几十万字符，正文既没用又危险）；
 *  - 数组/对象只留形状。
 *
 * **绝不包含 headers** —— 那里面有 `Authorization: Bearer <明文 Key>`。
 * @param body - `planGeneration` 造出来的请求体。
 * @returns 形如 `model="…" · prompt="…" · aspect_ratio="16:9"` 的一行。
 */
function summarizeBody(body) {
    const parts = [];
    for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') {
            parts.push(value.length <= 60 ? `${key}=${JSON.stringify(value)}` : `${key}=<${value.length} 字符>`);
        }
        else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
            parts.push(`${key}=${JSON.stringify(value)}`);
        }
        else if (Array.isArray(value)) {
            parts.push(`${key}=[${value.length} 项]`);
        }
        else if (typeof value === 'object') {
            parts.push(`${key}={${Object.keys(value).join(',')}}`);
        }
    }
    return parts.join(' · ');
}
/**
 * 从**实发请求体**里取出「这张图到底是用什么参数生出来的」。
 *
 * 为什么不用面板值：面板值可能被配置里那段「额外参数」JSON 覆盖（本机默认配置里就写着
 * `output_compression: 90`），也可能因为该模型不声明而被裁掉。历史记录上显示面板值
 * 就等于在骗人 —— 老板要的是「当时用的参数」，那就是这一份。
 *
 * 排除三个字段：
 *  - `model` / `prompt` —— 它们各自有专门的列，不混进参数里；
 *  - `input_references` —— 参考图是几 MB 的 data URL，只记张数（见 `referenceCount`）。
 * @param body - `planGeneration` 造出来的请求体。
 * @returns 键 = 请求体字段名，值已字符串化（长值截断，`provider` 这类对象存紧凑 JSON）。
 */
function collectSentFields(body) {
    const skip = new Set(['model', 'prompt', 'input_references']);
    const out = {};
    for (const [key, value] of Object.entries(body)) {
        if (skip.has(key))
            continue;
        if (typeof value === 'string') {
            out[key] = value.length <= 120 ? value : `${value.slice(0, 120)}…`;
            continue;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            out[key] = String(value);
            continue;
        }
        if (value === null || typeof value !== 'object')
            continue;
        const text = JSON.stringify(value) ?? '';
        out[key] = text.length <= 120 ? text : `${text.slice(0, 120)}…`;
    }
    return out;
}
/**
 * `POST /dsh-imagegen/generate` —— 真出图。
 *
 * 配置**一律以磁盘为准**（不采信请求体里那份）：Key、Base URL、超时、输出格式、
 * 额外参数都从宿主侧读，前端那份只是它自己的显示状态。这样即使面板上开着一份
 * 过期配置，也不会拿旧参数去发请求。
 */
async function handleGenerate(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'POST') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const body = await readJsonBody(req, GENERATE_BODY_BYTES);
    if (body === undefined) {
        // 这条路由的 400 有**一个特别常见的原因**：参考图的 base64 把请求体撑爆了。
        // 通用的「不是合法 JSON，或超过了大小上限」会把人引去查 JSON —— 这句直接点名。
        writeJson(res, 400, failure('bad-request', `请求体读不出来：不是合法 JSON，或超过了 ${Math.round(GENERATE_BODY_BYTES / (1024 * 1024))} MB 上限`
            + '。绝大多数情况是参考图太大（参考图以 base64 随请求体发送，体积会膨胀约 4/3）——'
            + '先移除一两张，或换小一点的图再试。'));
        return;
    }
    const parsedInput = readGenerateInput(body);
    if (!parsedInput.ok) {
        writeJson(res, 400, failure(parsedInput.code, parsedInput.message));
        return;
    }
    const input = parsedInput.input;
    const current = await readConfig();
    if (current.apiKey === '') {
        writeJson(res, 400, failure('no-key', '还没配置 API Key —— 打开「连接配置」填一把再生成'));
        return;
    }
    // 该模型声明了哪些参数：key 缺失 = 不支持，一个都不发。
    // **只有 OpenRouter 有能力表**；其他协议下 params 保持 undefined，适配层就只发核心字段。
    let params;
    let supportsStreaming;
    if (current.settings.protocol === 'openrouter') {
        try {
            const models = await getImageModels(current.settings.baseUrl);
            params = models.params.get(input.model);
            // `stream` 不在 `supported_parameters` 里 —— 它在目录条目的顶层
            // `supports_streaming` 上，得从模型列表里单独取一次。
            supportsStreaming = models.models.find((item) => item.id === input.model)?.supportsStreaming;
        }
        catch (error) {
            // 拉不到模型目录不致命：退化成「只发核心字段，交给上游校验」。
            hostLog('warn', '拉模型目录失败，本次生成不做字段裁剪：', error);
            params = undefined;
        }
    }
    const plan = planGeneration(input, {
        protocol: current.settings.protocol,
        baseUrl: current.settings.baseUrl,
        outputFormat: current.settings.outputFormat,
        extraJson: current.settings.extraJson,
        ...supportsStreaming === undefined ? {} : { supportsStreaming },
    }, current.apiKey, params);
    /**
     * 「这次生成用了什么」，两套值分开存：
     *  - {@link paramSnapshot}：**面板上**的取值 → 点历史记录时回填参数区用它；
     *  - {@link collectSentFields} 的结果：**真正发出去**的字段 → 结果行显示用（含配置覆盖）。
     * 两者都进索引，所以同一张图既能「还原我的设置」，也能如实说「实际发了什么」。
     */
    const paramSnapshot = {
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        count: input.count,
        quality: input.quality,
        extra: input.extra ?? {},
    };
    const sentFieldMap = collectSentFields(plan.body);
    /**
     * 本次生成的诊断行。
     *
     * 跟着失败响应一起回给面板 —— 这就是「看不全」的正解：面板不再只有上游那一句话，
     * 而是把「我当时发了什么、裁掉了什么、日志在哪」一并摊开。所有行都**不含明文 Key、
     * 不含参考图 data URL 正文**（只记张数与字节数，整个字符串会过 log-store 的脱敏网）。
     */
    const diagnostics = [];
    const refBytes = input.references.reduce((sum, item) => sum + item.length, 0);
    // 取消与超时合成一个信号：客户端断开（面板上点「取消」）与上游太慢是两件事，
    // 用 timedOut 标记区分，报错文案才说得清。
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = Math.max(5, current.settings.timeoutSec) * 1000;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    req.on('close', () => { controller.abort(); });
    diagnostics.push(`模型：${input.model}（协议 ${current.settings.protocol}）`);
    diagnostics.push(`参数：比例 ${input.aspectRatio || '默认'} · 分辨率 ${input.resolution || '默认'} · `
        + `张数 ${input.count} · 质量 ${input.quality || '默认'} · 输出格式 ${current.settings.outputFormat}`);
    diagnostics.push(`参考图：${input.references.length} 张${refBytes > 0 ? `（共 ${refBytes} 字符 data URL，日志只记长度）` : ''}`);
    diagnostics.push(`上游地址：POST ${plan.url}`);
    const sentFields = summarizeBody(plan.body);
    diagnostics.push(`实际发送：${sentFields === '' ? '（空请求体）' : sentFields}`);
    if (plan.dropped.length > 0)
        diagnostics.push(`被裁掉（该模型不支持）：${plan.dropped.join('、')}`);
    // 「发出去了、但不是我选的那个值」——配置里那段「额外参数」JSON 会覆盖同名字段。
    // 不单独说一句的话，用户看着面板上的 80、实际发的是 90，永远查不出来。
    if (plan.overridden.length > 0) {
        diagnostics.push(`被「额外参数」覆盖（连接配置里那段 JSON 优先级更高）：${plan.overridden.join('、')}`);
    }
    diagnostics.push(`宿主日志文件：${logFilePath()}`);
    hostLog('info', `生成开始：${input.model} · ${input.aspectRatio || '默认比例'} · ${input.resolution || '默认分辨率'} · ${input.count} 张 · 参考图 ${input.references.length} 张`);
    hostLog('info', `实际发送：${sentFields === '' ? '（空请求体）' : sentFields}`);
    if (plan.dropped.length > 0)
        hostLog('warn', `本次生成裁掉了不支持的字段：${plan.dropped.join('、')}`);
    if (plan.overridden.length > 0)
        hostLog('warn', `这些字段被「额外参数」覆盖了：${plan.overridden.join('、')}`);
    try {
        const outcome = await postGeneration({
            url: plan.url,
            headers: plan.headers,
            body: plan.body,
            parse: (payload) => parseProviderResponse(plan.shape, payload, parseGeneration),
            signal: controller.signal,
            timedOut: () => timedOut,
        });
        if (outcome.kind === 'aborted') {
            // 客户端已经走了，写不写都行；写一个明确的结局便于 curl/日志排查。
            hostLog('info', '本次生成被取消（客户端断开或点了「取消」）');
            writeJson(res, 499, { ...failure('aborted', '已取消'), diagnostics });
            return;
        }
        if (outcome.kind === 'timeout') {
            hostLog('error', `上游超时（${current.settings.timeoutSec}s）：${outcome.message}`);
            writeJson(res, 504, { ...failure('timeout', outcome.message), diagnostics });
            return;
        }
        if (outcome.kind === 'error') {
            // 上游拒绝：把它的原话写进宿主日志 —— 面板上那句是同一份文本，但日志能留档。
            hostLog('error', `上游拒绝（HTTP ${outcome.status}）：${outcome.message}`);
            writeJson(res, outcome.status >= 400 && outcome.status < 600 ? outcome.status : 502, { ...failure('upstream', outcome.message), diagnostics });
            return;
        }
        // 落盘：n>1 时全部写进 out/ 与索引，返回第一张给面板（多图浏览是阶段 5）。
        const saved = [];
        for (const [index, image] of outcome.parsed.images.entries()) {
            saved.push(await saveGeneratedImage({
                b64: image.b64,
                mediaType: image.mediaType,
                model: input.model,
                prompt: input.prompt,
                aspectRatio: input.aspectRatio,
                resolution: input.resolution,
                seconds: outcome.elapsedSec,
                ...outcome.parsed.cost === undefined ? {} : { cost: outcome.parsed.cost },
                sequence: index,
                params: paramSnapshot,
                sentFields: sentFieldMap,
                referenceCount: input.references.length,
                batchCount: outcome.parsed.images.length,
            }));
        }
        // 自动另存一份到工作区目录（A8 的后半句）。**失败不致命**：图已经在 out/ 里了，
        // 自动另存只是多一份方便找；这里绝不因为「另一个目录写不进去」就把出图判成失败。
        const autoSaveDir = current.settings.autoSaveDir;
        if (autoSaveDir.trim() !== '') {
            for (const entry of saved) {
                try {
                    const path = await copyImageTo(entry, autoSaveDir);
                    if (path !== entry.savedPath)
                        await patchIndexEntry(entry.id, { autoSavedPath: path });
                }
                catch (error) {
                    hostLog('warn', `自动另存到 ${autoSaveDir} 失败（图仍在 out/）：`, error);
                }
            }
        }
        // 重新读一次索引：自动另存刚写进去的 autoSavedPath 要回给前端。
        const byId = new Map((await readImageIndex()).map((entry) => [entry.id, entry]));
        const result = saved.map((entry) => toClientImage(byId.get(entry.id) ?? entry));
        const cost = outcome.parsed.cost;
        hostLog('info', `出图成功：${result.length} 张 · 首张 id=${result[0]?.id ?? '—'} · 耗时 ${outcome.elapsedSec}s`
            + `${cost === undefined ? '' : ` · 费用 $${cost.toFixed(4)}`}`);
        writeJson(res, 200, {
            ok: true,
            image: result[0],
            images: result,
            count: result.length,
            dropped: plan.dropped,
            overridden: plan.overridden,
            elapsedSec: outcome.elapsedSec,
            diagnostics,
        });
    }
    catch (error) {
        hostLog('error', '出图过程抛出异常：', error);
        writeJson(res, 500, {
            ...failure('generate-failed', `出图失败：${error instanceof Error ? error.message : String(error)}`),
            diagnostics,
        });
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * `POST /dsh-imagegen/save` —— 手动保存一份到指定目录。
 *
 * 面板上的「保存」按钮走这里：默认落到配置里的「自动保存目录」，也可以带 `target` 指定。
 * 刻意只接受**目录**而不是完整路径：让宿主决定文件名，避免用户给一个没有扩展名的路径
 * 之后自己都认不出是什么格式。
 */
async function handleSave(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'POST') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const body = await readJsonBody(req);
    if (body === undefined) {
        writeJson(res, 400, badRequestBody());
        return;
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (id === '') {
        writeJson(res, 400, failure('bad-id', '缺少图片 id'));
        return;
    }
    const entry = await findImage(id);
    if (entry === undefined) {
        writeJson(res, 404, failure('not-found', `索引里没有这张图：${id}`));
        return;
    }
    const current = await readConfig();
    const target = typeof body.target === 'string' && body.target.trim() !== ''
        ? body.target.trim()
        : current.settings.autoSaveDir;
    if (target.trim() === '') {
        writeJson(res, 400, failure('no-target', '没有指定目标目录，配置里的「自动保存目录」也是空的'));
        return;
    }
    try {
        const savedPath = await copyImageTo(entry, target);
        await patchIndexEntry(id, { autoSavedPath: savedPath });
        writeJson(res, 200, { ok: true, savedPath });
    }
    catch (error) {
        writeJson(res, 500, failure('save-failed', `保存失败：${error instanceof Error ? error.message : String(error)}`));
    }
}
/**
 * `POST /dsh-imagegen/open` —— 用系统默认程序打开某张图的**本地原图**。
 *
 * 面板结果行的「打开」按钮与历史图的右键菜单共用这条路由。为什么不在浏览器里开：
 * 浏览器只能下载或新开标签页，没法让老板的看图工具起来 —— 真正的「打开」必须由宿主
 * 交给桌面 shell（是 Explorer 而不是自己解析关联，理由见 `src/open-file.ts`）。
 *
 * 只认索引里的 id，所以这条路由开不了索引之外的文件；这比「传一个路径参数」少一整类
 * 攻击面（本机任何网页都打得通 loopback 端口，见 `src/http.ts` 的围栏）。
 */
async function handleOpen(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'POST') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const body = await readJsonBody(req);
    if (body === undefined) {
        writeJson(res, 400, badRequestBody());
        return;
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (id === '') {
        writeJson(res, 400, failure('bad-id', '缺少图片 id'));
        return;
    }
    const entry = await findImage(id);
    if (entry === undefined) {
        writeJson(res, 404, failure('not-found', `索引里没有这张图：${id}`));
        return;
    }
    // 升级前的索引条目只有 id/fileName、没有 savedPath。不先判类型的话，下面那句 stat
    // 会以 ERR_INVALID_ARG_TYPE 失败，最后被归成「文件已经不在磁盘上了：undefined」——
    // 道理上没错，但看不出真正的原因。
    if (typeof entry.savedPath !== 'string' || entry.savedPath === '') {
        writeJson(res, 410, failure('no-local-path', `这条记录没有本地路径（升级前的索引条目）：${id}`));
        return;
    }
    // 「索引还在、文件没了」是常态化的一种状态（老板清过 out/、或手工删过图）。
    // 必须给人话，而不是把 ENOENT 原样端出去。
    try {
        const info = await stat(entry.savedPath);
        if (!info.isFile()) {
            writeJson(res, 410, failure('not-a-file', `这张图的路径不是文件：${entry.savedPath}`));
            return;
        }
    }
    catch {
        writeJson(res, 410, failure('file-missing', `这张图的文件已经不在磁盘上了：${entry.savedPath}`));
        return;
    }
    try {
        const outcome = await openWithDefaultApp(entry.savedPath);
        // 干跑（只给自检用）也要在日志里留下痕迹 —— 否则「日志说已打开、屏幕上什么都没
        // 发生」就成了一个查不出来的怪事。
        hostLog('info', outcome === 'dry-run'
            ? `（干跑）没有真的打开：${entry.savedPath}`
            : `已用系统默认程序打开：${entry.savedPath}`);
        writeJson(res, 200, { ok: true, path: entry.savedPath });
    }
    catch (error) {
        hostLog('error', `打开失败：${entry.savedPath}`, error);
        writeJson(res, 500, failure('open-failed', `打开失败：${error instanceof Error ? error.message : String(error)}`));
    }
}
/**
 * `GET/PUT /dsh-imagegen/draft` —— 面板草稿。
 *
 * 与 `/config` 分开是刻意的：配置是**用户显式保存**的（还带明文 Key），草稿是
 * 边打字边自动落的。混在一个文件里，一次「保存配置」就可能顺手把草稿区覆盖成
 * 半截状态 —— 而且 Key 与草稿的读写频率、失败容忍度都完全不同。
 *
 * 语义：
 *  - `GET`：回草稿（没有文件时 `draft: null`），另回一次文件路径便于排查；
 *  - `PUT`：收 `{ draft: {...} }`，宽松收敛后原子落盘，回**落盘后**的草稿（含新时间戳）。
 *
 * 落盘失败必须回 500：草稿悄悄丢会让老板以为「我写的还在」，下次进面板发现没了。
 */
async function handleDraft(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method === 'GET') {
        const draft = await readPanelDraft();
        writeJson(res, 200, { ok: true, draft: draft ?? null, path: draftFilePath() });
        return;
    }
    if (req.method !== 'PUT') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const body = await readJsonBody(req, DRAFT_BODY_BYTES);
    if (body === undefined) {
        writeJson(res, 400, badRequestBody());
        return;
    }
    try {
        const saved = await writePanelDraft(coercePanelDraft(body.draft));
        writeJson(res, 200, { ok: true, draft: saved, path: draftFilePath() });
    }
    catch (error) {
        hostLog('warn', '草稿落盘失败：', error);
        writeJson(res, 500, failure('write-failed', `草稿落盘失败：${error instanceof Error ? error.message : String(error)}`));
    }
}
/**
 * `GET /dsh-imagegen/preset` —— 回 prompt-forge 的「文生图优化」模板文本。
 *
 * 只读、不带任何参数：模板名在 `src/forge.ts` 里写死（老板拍板：对生图插件来说
 * 就是固定用这一个）。失败时把「为什么读不到」说清楚 —— 这个按钮依赖另一个插件，
 * 静默失败最难查。
 * @param ctx - 插件上下文（要 `ctx.get('configEditor')`）。
 * @param req - HTTP 请求。
 * @param res - HTTP 响应。
 */
async function handlePreset(ctx, req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    /**
     * `?patch=<file.yml>` 覆盖兜底用的 patch 文件；`?patch=none` 表示**不读 patch**
     * （自检要能在一个没有真实 profile 的环境里验「服务读不到」那条路）。
     * 只接受 `.yml` 结尾的路径：这条路由虽然是 loopback-only，也没必要让它能读任意文件。
     */
    const query = new URL(req.url ?? '/', 'http://dsh.invalid');
    const patchParam = query.searchParams.get('patch');
    const patchPaths = patchParam === null
        ? undefined
        : patchParam.trim() === '' || patchParam.trim() === 'none'
            ? []
            : patchParam.trim().endsWith('.yml') ? [patchParam.trim()] : undefined;
    // `?debug=1`：把各个配置来源的**结构速写**回出来（只回键名/类型/长度，不回长文本）。
    // 这个按钮依赖另一个插件的配置，真机出问题时最怕「改代码 → 重启 → 再猜」的循环。
    if ((req.url ?? '').includes('debug=1')) {
        const sources = [...collectConfigSources(ctx), ...collectPatchSources(patchPaths ?? defaultPatchPaths())];
        writeJson(res, 200, {
            ok: true,
            debug: sources.length === 0
                ? '一个配置来源都读不到（settings / configEditor / patch 文件都没有）'
                : sources.map((source) => ({ name: source.name, outline: outlineOf(source.value) })),
        });
        return;
    }
    const result = findForgePreset(ctx, undefined, patchPaths);
    if (result.kind === 'no-service') {
        writeJson(res, 501, failure('no-config-editor', '宿主没有可读配置的服务（settings / configEditor / patch 文件都没有），读不到 prompt-forge 的模板'));
        return;
    }
    if (result.kind === 'no-preset') {
        const tail = result.available.length > 0
            ? `（扫到 ${result.scanned} 处模板配置，现有模板：${result.available.join('、')}）`
            : `（扫到 ${result.scanned} 处模板配置，没有一处带这个模板；加 ?debug=1 可看宿主回了什么结构）`;
        writeJson(res, 404, failure('preset-missing', `没找到名为「${FORGE_PRESET_NAME}」的模板${tail}`));
        return;
    }
    writeJson(res, 200, {
        ok: true,
        name: result.preset.name,
        system: result.preset.system,
        provider: result.provider,
        model: result.model,
        /** 前端要打的那条路由（prompt-forge 自己的，同源）。 */
        optimizeRoute: '/api/dsh-prompt-forge/optimize',
    });
}
/**
 * `GET /dsh-imagegen/logs` —— 宿主侧日志。
 *
 * 两个用途：
 *  - 面板里的「查看日志」抽屉（默认 JSON：`{ ok, entries, file, dir, count }`）；
 *  - `?format=text` 把整份日志当附件下载下来 —— 要贴给别人看或者存档时最省事。
 *
 * `DELETE` 只清**内存缓冲**：磁盘上那份是排查记录，不该被一次误点抹掉。
 */
async function handleLogs(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method === 'DELETE') {
        clearLogBuffer();
        hostLog('info', '内存里的日志缓冲已清空（磁盘上的日志文件保留）');
        writeJson(res, 200, { ok: true, cleared: true });
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const url = new URL(req.url ?? '/', 'http://dsh.invalid');
    const asked = Number(url.searchParams.get('limit') ?? '');
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(400, Math.round(asked)) : 200;
    const file = logFilePath();
    if (url.searchParams.get('format') === 'text') {
        const text = logsAsText(limit);
        const fileName = file.split(/[\\/]/u).pop() ?? 'host.log';
        res.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'content-disposition': `attachment; filename="${fileName}"`,
            'cache-control': 'no-store',
        });
        res.end(text === '' ? '（宿主日志为空：插件加载后还没有写过任何一条）\n' : `${text}\n`);
        return;
    }
    writeJson(res, 200, {
        ok: true,
        entries: recentLogs(limit),
        file,
        dir: logDir(),
        count: logCount(),
    });
}
/**
 * 等宿主日志落盘排空。
 *
 * 日志是**异步追加**的（一条日志不该拖慢一次出图），所以「刚写完就去看文件」可能
 * 还看不到最后几条。自检要断言文件内容、将来要做「关闭前冲刷」时都调它。
 * 只用 `export function` 而不是 `export { … } from`：宿主打包器是手写的，
 * 只认本文件里的声明。
 */
async function flushHostLogs() {
    await flushLogs();
}
/** `GET /dsh-imagegen/health` —— 自查用。 */
async function handleHealth(req, res) {
    if (!isLoopbackRequest(req)) {
        writeJson(res, 403, forbiddenBody());
        return;
    }
    if (req.method !== 'GET') {
        writeJson(res, 405, methodBody(req.method));
        return;
    }
    const current = await readConfig();
    const index = await readImageIndex();
    const draft = await readPanelDraft();
    writeJson(res, 200, {
        ok: true,
        plugin: name,
        home: imagegenHome(),
        configPath: configFilePath(),
        outDir: imageOutDir(),
        configExists: current.existed,
        hasKey: current.apiKey !== '',
        protocol: current.settings.protocol,
        model: current.settings.model,
        images: index.length,
        logFile: logFilePath(),
        logLines: logCount(),
        // 草稿：真机验收要能确认「落盘的草稿」和面板上看到的一致（重启前后都能查）。
        draftPath: draftFilePath(),
        hasDraft: draft !== undefined,
        draftUpdatedAt: draft?.updatedAt ?? 0,
    });
}
// -------------------------------------------------------------------- 挂载
/**
 * `config` 一个路径要同时吃 GET 与 PUT。
 *
 * `webServer.register` 的键是 (kind, path)，同一个路径只能登记一次 ——
 * 所以按方法分派这件事必须发生在处理器内部，而不是靠挂两条同路径的路由
 * （那会抛「duplicate route」）。
 */
async function handleConfigWriteRead(req, res) {
    if (req.method === 'PUT')
        return handleConfigWrite(req, res);
    return handleConfigRead(req, res);
}
/**
 * 宿主半边的挂载点。
 * @param ctx - 宿主插件上下文；这里只用到 `webServer`。
 */
function apply(ctx) {
    try {
        ctx.inject(['webServer'], (sctx) => {
            // 同一个 try/catch 要放进回调里：依赖已就绪时回调是同步跑的，但 cordis 也
            // 可能在依赖稍后才满足时异步调用它 —— 那时外层的 try 已经退栈了。
            try {
                sctx.effect(() => {
                    const disposers = [];
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.config, handler: handleConfigWriteRead }, 'config');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.models, handler: handleModels }, 'models');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.capabilities, handler: handleCapabilities }, 'capabilities');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.generate, handler: handleGenerate }, 'generate');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.history, handler: handleHistory }, 'history');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.save, handler: handleSave }, 'save');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.open, handler: handleOpen }, 'open');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.preset, handler: (req, res) => handlePreset(sctx, req, res) }, 'preset');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.health, handler: handleHealth }, 'health');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.logs, handler: handleLogs }, 'logs');
                    safeRegister(disposers, sctx.webServer, { kind: 'exact', path: API.draft, handler: handleDraft }, 'draft');
                    safeRegister(disposers, sctx.webServer, { kind: 'prefix', path: API.image, handler: handleImage }, 'image');
                    hostLog('info', `已挂载 ${disposers.length} 条路由，数据目录 ${imagegenHome()}，日志目录 ${logDir()}`);
                    // 卸载时反序释放（后挂的先撤），与登记顺序对称。
                    return () => {
                        for (const dispose of disposers.reverse()) {
                            try {
                                dispose();
                            }
                            catch (error) {
                                hostLog('warn', '路由卸载失败：', error);
                            }
                        }
                    };
                }, 'dsh-imagegen-panel: routes');
            }
            catch (error) {
                hostLog('warn', 'webServer 路由挂载失败，面板将提示「宿主路由不可用」：', error);
            }
        });
    }
    catch (error) {
        hostLog('warn', '无法注入 webServer：', error);
    }
}
/**
 * 导出给 `scripts/host-check.mjs`。
 *
 * 交给 Explorer 的目标怎么编码，是这个功能里唯一「写错了也不报错、只会安静地打开
 * 另一个东西」的部分（逗号、等号、非 ASCII 三个坑），所以它必须能被离线断言。
 */


export { name, inject, apply, API, parseImageModels, parseCapabilities, priceFrom, normalizeQuality, buildImageRequest, measureSize, FIELD_SPECS, getImageModels, findForgePreset, FORGE_PRESET_NAME, explorerTarget, flushHostLogs };
