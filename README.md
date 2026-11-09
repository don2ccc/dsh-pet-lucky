# Lucky — DeepSeek Harness 桌宠

一只真正会动的 **3D 鹦鹉**，站在 DeepSeek Harness 窗口右下角。它会跟着你在做什么切换动作：

- 闲着的时候收着翅膀站着，轻轻呼吸晃动
- 你一开始打字，它就走起来
- AI 开始思考、干活，它就小跑
- 答案出来了，它张开翅膀飞一下再落下

可以拖动它，点一下听它说句话，右键让它"播报"。它会打瞌睡（4 分钟没动静），窗口切走再回来会欢迎你。

https://github.com/don2ccc/dsh-pet-lucky

---

## 安装

```bash
dsh plugin add github:don2ccc/dsh-pet-lucky
```

也可以用完整地址，效果一样：

```bash
dsh plugin add https://github.com/don2ccc/dsh-pet-lucky
```

不想用命令行的话，界面里也能装：**设置 → 插件 → 添加插件**，把
`github:don2ccc/dsh-pet-lucky` 填进输入框。

装完**完全退出 DeepSeek Harness 再重新打开**，鹦鹉就出现在右下角了。

卸载：

```bash
dsh plugin remove dsh-pet-lucky
```

## 要求

- DeepSeek Harness 的 Web UI（桌面版或 `dsh web`）
- 显卡支持 **WebGL 2**（2015 年之后的集显/独显基本都支持）
- **首次显示需要联网**：会从 Polyfork 的 CDN 下载 6.1 MB 的模型，之后就存在 IndexedDB 里，不再重复下载

如果 WebGL 用不了、或者模型下载失败，它会自动退回内联的 2D 立绘——**不会变成空白**，也不会拖垮界面。

## 动作对照

| 你在做什么 | 它在做什么 |
|---|---|
| 没有操作 | `Idle (folded wings)` 收翅站立 |
| 在输入框打字 | `Walk (folded wings)` 走 |
| 消息已发出、AI 在干活 | `Run (folded wings)` 跑 |
| 把它拖起来 / 答案到达 | `Fly` 张开翅膀飞 |

剪辑之间是 0.26 秒交叉淡入淡出，不是硬切。相机是 3/4 视角（方位 44°、俯角 12°），飞行时会轻微拉远，避免翅膀被切掉。

## 改台词和名字

所有可见文案在 **`tools/3d/lines.json`**，中文和英文各一套：名字、点击台词、打字时的碎碎念、唤醒/完成/重连/播报各有对应字段。加 `line9`、`line10`… 会自动发现，不用改代码。

```bash
git clone https://github.com/don2ccc/dsh-pet-lucky
cd dsh-pet-lucky
# 编辑 tools/3d/lines.json
python tools/3d/apply_lines.py     # 写回 client.js，自动备份并校验
dsh plugin add /absolute/path/to/dsh-pet-lucky   # 用本地这份替换掉线上版本
```

然后重启应用。`line1..line8` 和 `chatter1..chatter8` 是必填的，少一个脚本会拒绝写入。

想调动作快慢、机位远近、状态映射，都在 `client.js` 里的 `CLIP_SPEED` / `CAMERA` / `const sceneState` 几个常量上，`tools/3d/README.md` 有说明。改完源码用 `python tools/3d/build3d.py` 重新生成 `client.js`。

## 它是怎么实现的

```
ESP32 之类的硬件无关——纯前端插件
├── client.js          预构建产物（DSH 没有打包器，直接 __ModuleLoader__.load）
│   ├── three.js r147  内联，MIT
│   ├── GLTFLoader     内联，MIT
│   ├── 渲染器/状态机  见 tools/3d/stage.js
│   └── 2D 立绘兜底    内联 base64 WebP
├── cordis.patch.yml   把自己的 Loader 条目插进 profile 的 bundle 链
└── assets/            图标 + 兜底立绘
```

- 模型带骨骼和 7 段动画，只用其中 4 段（收翅待机、收翅走、收翅跑、飞）
- 材质换成 Lambert：这些低多边形模型用顶点色，没有环境贴图时 PBR 会发灰
- 不做 ACES 色调映射（Polyfork 官方提示：会让这类模型暗三分之一）
- 相机取景**不能用绑定姿态**：绑定姿态是张翅的（宽 1.66），收翅待机只有 0.41，按绑定姿态算相机会把鸟缩成一个点

更多实测数据（每段动画的包围盒、循环接缝、相机标定过程）在 `tools/3d/README.md`。

## 排查

**装了没反应？** 先确认真的重启了（不是刷新窗口）。插件在启动时读取，热更新不生效。

**它变成不动的 2D 图片了？** 说明 3D 那条路没走通，会退回兜底立绘。构建里带了诊断：它会往 localStorage 写一段加载日志，键名 `dsh-pet:trace`，里面能看出是 WebGL 不可用、模型下载失败、还是渲染出错。提 issue 时附上这段会很有帮助。

**第一帧要等一两秒？** 正常，首次会下载 6.1 MB 模型。之后是本地缓存。

## 致谢

- 模型 —— **Cove Parrot** by [Polyfork](https://polyfork.dev/asset/cove-parrot-17850c)，CC BY 4.0
- 3D 渲染 —— [three.js](https://threejs.org) r147，MIT

完整第三方声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## License

[MIT](LICENSE) © 2026 don2ccc
