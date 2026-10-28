# FrameFlow Local

一个本地运行的 AI 视频前期工作台，把“选题候选 → 人工入选 → Codex 拆解 → 制作输入包”连接起来。它不会替你消耗视频平台额度、生成成片或自动发布。

## 工作流

1. Muse 或其他 Agent 把候选 Markdown 写入指定的 Obsidian 文件夹。
2. FrameFlow 自动扫描候选，并在网页中显示平台、发布日期、点赞和评论。
3. 你点击“入选并拆解”后，工作台调用本机 Codex CLI 分析参考视频。
4. 工作台生成精简制作包：参考视频、你的素材清单、定妆照提示词和视频提示词。
5. 你把这些输入带到任意图片或视频生成网站完成制作。

Muse、Codex 与可选的 Hypit 方法都由每位使用者在自己的电脑上配置；仓库不包含账号、Token、私人 Vault 或历史数据库。

## 运行要求

- Python 3.10+
- 可选：Codex CLI（不配置时仍可浏览演示候选，但不能执行 AI 拆解）
- 可选：Obsidian Vault
- 无 Python 第三方依赖

## 快速开始

```bash
git clone https://github.com/littlecy1011/frameflow.git
cd frameflow
cp .env.example .env.local
python3 app.py
```

浏览器打开 <http://127.0.0.1:8094>。macOS 也可以双击 `start.command`。

如果 `.env.local` 中不填写 Vault 路径，应用会使用仓库内的 `demo-vault/`，方便先查看完整界面。

## 接入 Muse 或其他选题 Agent

在 `.env.local` 中设置：

```dotenv
AI_VIDEO_VAULT_ROOT=/absolute/path/to/your/Obsidian Vault
```

让 Agent 只向以下目录投递 Markdown：

```text
<Vault>/00_Inbox/Muse视频选题/
```

最小候选格式可参考 `demo-vault/00_Inbox/Muse视频选题/示例候选.md`。工作台只负责读取这个约定目录，不包含 Muse 账号或连接器。

## 接入 Codex

应用会优先使用 `AI_VIDEO_CODEX_BIN`，否则尝试识别 macOS ChatGPT Desktop 内置 Codex CLI 或系统 PATH 中的 `codex`：

```dotenv
AI_VIDEO_CODEX_BIN=/absolute/path/to/codex
```

Codex 以只读沙箱分析候选；制作包的文件写回由本地工作台完成。只有用户点击“入选并拆解”才会启动任务。

## 可选：接入 Hypit 方法

不配置 Hypit 时，工作台使用内置导演方法生成 Brief、Treatment、素材职责和提示词。若你本机已安装 Hypit skill，可设置：

```dotenv
AI_VIDEO_HYPIT_SKILL=/absolute/path/to/hypit/SKILL.md
AI_VIDEO_HYPIT_BIN=/absolute/path/to/hypit
```

这只是前期导演方法接入，不会自动提交视频生成。

## 配置项

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `AI_VIDEO_VAULT_ROOT` | Obsidian Vault 绝对路径 | `demo-vault/` |
| `AI_VIDEO_CODEX_BIN` | Codex CLI 路径 | 自动发现 |
| `AI_VIDEO_HYPIT_SKILL` | 可选 Hypit skill 路径 | 内置导演方法 |
| `AI_VIDEO_HYPIT_BIN` | 可选 Hypit 可执行文件 | 自动发现 |
| `AI_VIDEO_SCAN_SECONDS` | 候选扫描间隔 | `5` |
| `AI_VIDEO_CODEX_TIMEOUT` | Codex 单次拆解超时（秒） | `900` |

## 检查

```bash
python3 app.py --check
python3 -m unittest discover -s tests
```

## 隐私与安全

- 只监听 `127.0.0.1`，默认不暴露到局域网或互联网。
- `.env.local`、运行数据库和本地制作数据均被 Git 忽略。
- 不自动发布，不与外部社交账号互动，不自动消费生成平台额度。
- 上传 GitHub 前仍建议检查 `git status --short --ignored`。

## 目录

```text
app.py                 本地 HTTP 服务与任务队列
static/                网页界面
tests/                 单元测试
demo-vault/            可公开的演示候选
data/                  本地数据库（不提交）
analysis_schema.json   Codex 结构化输出约束
```

## License

MIT
