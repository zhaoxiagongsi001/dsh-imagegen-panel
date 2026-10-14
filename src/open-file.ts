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
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Explorer 委派给已在运行的 desktop 进程后的退出码：请求已被 shell 接手。 */
const DELEGATED_EXIT_CODE = 1

/**
 * 等待打开器退出的看护窗口（毫秒）。
 *
 * 这不是「打开要多久」的预算，而是**早失败**的窗口：正常的打开器把请求交给 shell
 * 之后立刻就退出了，所以窗口到了还没退出只可能是它转去干别的事 —— 那是成功。
 */
const OPEN_WATCH_MS = 10_000

/**
 * 把一个路径编码成 Explorer 能完整收到的目标（见文件头的三条约束）。
 * @param windowsPath - Windows 绝对路径。
 * @returns 文件 URI 形式的目标，逗号与等号已转义、非 ASCII 保持字面量。
 */
export function explorerTarget(windowsPath: string): string {
  // 官方那份写的是 `pathToFileURL(p, { windows: true })`，但 Node 的 `pathToFileURL`
  // 只接受一个参数（多传的会被忽略），所以这里不传第二个 —— 实测 7 类路径（驱动器绝对、
  // 正斜杠、UNC、`\\?\`、`\\?\UNC\`、尾空格、`..`）两边输出逐字相同。
  const href = pathToFileURL(windowsPath).href
  return href
    // 一串「每个字节都 ≥ 0x80」的转义合起来是一个非 ASCII 字符，还原成字面量。
    .replace(/(?:%[89A-F][0-9A-F])+/giu, (escaped) => decodeURIComponent(escaped))
    .replaceAll(',', '%2C')
    .replaceAll('=', '%3D')
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
function runOpener(command: string, args: string[], acceptDelegatedExit = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const opening = new Promise<void>((opened, failed) => {
      execFile(command, args, { windowsHide: false }, (error) => {
        if (error === null) {
          opened()
          return
        }
        const code = (error as NodeJS.ErrnoException & { code?: unknown }).code
        if (acceptDelegatedExit && code === DELEGATED_EXIT_CODE) {
          opened()
          return
        }
        failed(error)
      })
    })

    // 看护窗口：到点仍没退出 = 已经交出去了，按成功结案；子进程不杀（它可能正在
    // 弹窗口），后到的失败结果被吞掉，因为请求早就答复了。
    const watch = setTimeout(() => {
      opening.catch(() => {})
      resolve()
    }, OPEN_WATCH_MS)

    opening.then(
      () => { clearTimeout(watch); resolve() },
      (error: unknown) => { clearTimeout(watch); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/**
 * 自检用的干跑开关：值为 `1` 时只走完调用方自己的校验，不碰桌面。
 *
 * 为什么要有这条缝：离线自检（`scripts/host-check.mjs`）要覆盖「校验通过之后」的
 * 响应形状，但不能每次跑自检都在老板机器上弹一个看图器窗口。真机上**确实弹窗口**
 * 那一步由 `live-check` 与人工点击覆盖 —— 这里的干跑不改变生产行为，不设这个
 * 环境变量时走的还是原路。
 */
const DRY_RUN_ENV = 'DSH_IMAGEGEN_OPEN_DRY_RUN'

/**
 * 用系统默认程序打开一个文件。
 *
 * 调用方负责先确认「这个路径确实存在、且是允许打开的那个」—— 这里只负责交给桌面。
 * @param target - 本地绝对路径。
 * @returns `opened` = 已交给桌面；`dry-run` = 自检干跑，**没有**真的打开（调用方据此
 *   写日志，免得日志里出现一条「已打开」而实际什么都没发生）。
 */
export async function openWithDefaultApp(target: string): Promise<'opened' | 'dry-run'> {
  if (process.env[DRY_RUN_ENV] === '1') return 'dry-run'
  if (process.platform === 'win32') {
    await runOpener('explorer.exe', [explorerTarget(target)], true)
    return 'opened'
  }
  if (process.platform === 'darwin') {
    await runOpener('open', [target])
    return 'opened'
  }
  await runOpener('xdg-open', [target])
  return 'opened'
}
