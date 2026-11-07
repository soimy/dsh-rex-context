# dsh-rex-context

把 [Rex](https://www.superlogical.com/rex) 给 agent harness 装的 SessionStart hook 移植到 dsh：在 Rex 终端里启动的 dsh 会话，system prompt 里自动多一段「你在 Rex 里、这是你的 session/pane、怎么用 rex 命令」。

文本不是抄的，是**每次启动时从本机 rex CLI 现取**的，所以 Rex 升级后措辞自动跟随。

## 它做什么

dsh 在 Rex 终端内启动（`REX_SESSION` / `REX_BLOCK` 存在）时，插件在启动阶段执行 Rex 给 claude/codex 装的 hook 的同一条命令：

```sh
rex __internal session-start --agent dsh-tui --feature-session-naming=false --autostart=false
```

把输出注册成一个 system prompt 段（`rex-terminal`，order 70），内容包含：

- 当前 `REX_SERVER` / `REX_SESSION` / `REX_BLOCK`，以及用 `-s` / `-b` 选中它们的用法；
- `rex whoami --json` 这条自检命令；
- rex 能做什么（开 session、开 tab、分 pane、跑命令、读输出、跨机器 `rex -S HOST`）；
- rex skill 的入口（`rex skill show`）。

不在 Rex 里启动 → 什么都不做，零干扰。

## 为什么不用 hook

Rex 的集成对 claude/codex 是「skill + SessionStart hook」两件套。dsh 没有 SessionStart hook 机制，但插件可以在启动时注册 system prompt 段——等价，且少一个 shell 调用点。

**状态上报不归这个插件管**：Rex 的 idle/working/blocked/done/error 来自 OSC 7501 Program Status Protocol，dsh-tui 自己已经在发（`lib/types/ink/termio/osc7501.js`），再包一层 hook 只会多一个更差的来源。

## 安装

```sh
# 本地目录（开发用，软链，改完重启 dsh-tui 即生效）
dsh plugin --profile dsh-tui add /path/to/dsh-rex-context

# GitHub
dsh plugin --profile dsh-tui add github:soimy/dsh-rex-context
```

装完重启 dsh-tui。system prompt 是进程启动时组装的，已有会话不会热更新。

## 验证

```sh
node index.js   # self-check：无 Rex env 不注册、有 env 注册唯一一段、CLI 失败回退静态文本
```

在不带 Rex 的普通终端里跑，应当直接打印 `dsh-rex-context self-check ok`（不访问 rex）。

## 行为

| 情况 | 结果 |
| --- | --- |
| 不在 Rex 里（无 `REX_*`） | 不注册任何段 |
| 在 Rex 里，rex CLI 可用 | 用 CLI 实时输出 |
| rex 不在 PATH / 超过 3s / `__internal` 变动 | 回退内置静态文本 |

`--feature-session-naming=false`：不替 agent 改 Rex session 名（多个 harness 共用同一 session 时避免互相改名）。想要和 claude/codex 完全一致，去掉该 flag 即可。

`--autostart=false`：只连正在运行的 Rex server，绝不因为一次 prompt 组装而拉起新 server。

## 已知边界

- `rex __internal session-start` 是 Rex 的私有命令，随版本可能改名或挪位置。失效时插件静默回退静态文本，不会让 dsh 起不来。
- 测试版本：Rex 0.1.0 (build 1853)，rex CLI `0.0.1793890641-gaf0c20`。
- 插件只在 dsh 启动时读一次 env，Rex 中途重启/换 session 需要重启 dsh-tui。

## License

MIT
