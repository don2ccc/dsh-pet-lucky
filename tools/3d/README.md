# Desk pet — 3D 鹦鹉桌宠

`client.js` 是**预构建产物**，被 DSH 的 `window.__ModuleLoader__` 直接加载，没有打包器。
里面内联了 three.js r147、经典 GLTFLoader、渲染代码和 2D 兜底图；模型运行时从 Polyfork
CDN 拉取（CORS `*`）并缓存在 IndexedDB。任何一环失败都会静默退回 2D 贴图，不会空掉。

Credit: Cove Parrot by Polyfork (https://polyfork.dev/asset/cove-parrot-17850c), CC BY 4.0.

## 状态 → 动画

| 界面上的状态 | sceneState | GLB clip |
|---|---|---|
| 什么都没发生 | `idle` | `Idle (folded wings)` |
| 你在输入框打字 | `walk` | `Walk (folded wings)` |
| AI 在干活（回合进行中） | `run` | `Run (folded wings)` |
| 被拖动 / 答案到达 | `fly` | `Fly` |

判定在 `client.js` 里 `const sceneState = ...` 一段，优先级：拖动 > 干活 > 播报脉冲 > 打字 > 待机。

## 改台词 / 改名字

所有可见文案在 `lines.json`，`zh` 和 `en` 各一套。

```bash
python apply_lines.py          # 写回 client.js（自动备份 + 校验）
# 然后完全退出并重开 DeepSeek Harness
```

| 字段 | 作用 |
|---|---|
| `name` | 悬停时显示的桌宠名字 |
| `aria` / `hint` | 无障碍标签 / 悬停提示 |
| `line1..lineN` | 点它一下随机说一句；加到 `line9`、`line10`… 会自动发现 |
| `chatter1..N` | 打字时它碎碎念（同样可加） |
| `lineSent` / `lineDone` | 你发出消息 / 回合完成 |
| `lineWake` / `lineReturn` / `lineReconnect` / `lineBroadcast` | 打瞌睡被碰醒 / 窗口回来 / 重连 / 右键播报 |

`line1..line8`、`chatter1..chatter8` 必填，少一个脚本拒绝写入。气泡 `max-width` 约 13em（字号约 12px），中文一句建议 ≤14 字。
`meta.zh.title` / `meta.zh.description` 会写进 `locale/*.json`，那是插件列表里的名称与简介。

## 目录

| 路径 | 说明 |
|---|---|
| `client.js` | 构建产物，**不要手改**（改完会被下次构建覆盖） |
| `lines.json` | 台词与名字的唯一来源 |
| `stage.js` | 3D 渲染器源码（相机、灯光、材质、剪辑切换都在这里） |
| `build3d.py` | 拼装 `client.js`：内联 three/GLTFLoader/stage，注入 `lines.json` 的文案 |
| `apply_lines.py` | 只改台词：把 `lines.json` 写回已安装的 `client.js` + `locale/*.json` |
| `extract_lines.py` | 反向操作：从 `client.js` 导出一份 `lines.json` |
| `fetch.py` | 重新下载 three.js / GLTFLoader / GLB 到 `cache/`（缓存丢了才需要） |
| `verify3d.cjs` | 用真实 three.js 解析 GLB、跑每个 clip、量位姿包围盒和循环接缝 |
| `final_cam.cjs` | 复算相机常量（方位角 44°、俯角 12°、四档距离） |
| `inspect_bundle.cjs` | 按外壳的方式加载构建产物，验证 three/GLTFLoader/clip 表都还在 |
| `read_trace.py` | 读运行期诊断（`client.js` 会把加载过程写进 localStorage） |
| `verify_install.ps1` | 校验 profile 里是真 Junction 且哈希一致（需 `-ExecutionPolicy Bypass`） |
| `cache/` | three.js、GLTFLoader、GLB，构建用，别删 |
| `../backup/client-2d.js` | **3D 构建的基底**（提供 UI 逻辑与 2D 兜底图），别删 |
| `../backup/client-before-lines.json` | 改台词前的完整备份，用于回滚 |

## 重新构建

```bash
python fetch.py         # 仅当 cache/ 缺失
python build3d.py       # -> build/client.js
node inspect_bundle.cjs build/client.js
# 覆盖 client.js 后重启应用
```

## 实测数据（决定了几何与相机）

```
clips : Idle(open/folded) 5.4s, Walk(...) 1.1s, Run(...) 0.68s, Fly 3s
mesh  : 8892 顶点, COLOR_0 顶点色, 70 骨骼, 1 材质
位姿包围盒（脚在 y=0）:
  idle 0.41 × 1.00 × 1.30    walk 0.46 × 0.99 × 1.34
  run  0.43 × 0.97 × 1.40    fly  1.78 × 0.81 × 1.62（比待机高 0.21）
四段剪辑都是原地循环：t=duration 与 t=0 位姿差 0.0000
```

由此得出三条必须遵守的结论：

- **取景不能用绑定姿态**：绑定姿态是张翅的（宽 1.66），idle 收翅只有 0.41，按绑定姿态算相机会把站着的鸟缩成一个点。
- **不能正对着拍**：正对时收翅的鸟宽 0.41 / 高 1.00，细成一根棍；所以相机在方位角 44°、俯角 12°。
- **机位按状态微调**：四段一起装下需要 4.13，但收翅的三种状态用 ~3.55 让桌宠更大，飞行时平滑拉远到 4.15，避免切掉翅膀。
