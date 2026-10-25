# dsh-offpeak-check

标题栏最左边多一个「价格」按钮：

![标题栏最左边的「价格」按钮](images/price-button.png)

点开就是今天的时段，以及此刻是原价还是五折：

![点开后的面板](images/price-panel.png)

给 DeepSeek Harness（DSH）用的一个小插件：**核对 DeepSeek 官网的峰期（标准价）时段**，和你本机记录的不一致时提醒你。

> 它只提醒，**不自动改**任何配置，也不控制计费行为。

## 它解决什么问题

DeepSeek 的 API 价格分时段：官网按 UTC 公布峰期（峰期是**标准价**，其余时段才是五折；当前是 `01:00-04:00`、`06:00-10:00`，周一至周五，中国法定节假日除外），换算成北京时间是 `09:00-12:00`、`14:00-18:00`。

官网可能改时段。你本机记录一份，它每次启动 15 秒后抓一次官网价格页对比：

- **一致** → 静默，什么都不做；
- **不一致** → 写一个 `pending` 文件 + 弹系统通知，**等你确认**；
- **抓不到**（断网、页面改版）→ 只记 `stale`，本地记录保持原样。

## 安装

**方式一：DSH 插件市场**（推荐）

设置 → 插件 → 搜索 `dsh-offpeak-check` → 安装 → **完全退出 DSH 再打开**（前端 bundle 要重新加载）。

**方式二：命令行**

```bash
npm i dsh-offpeak-check
```

或直接把这个地址填进 DSH 的插件安装入口：

```
https://registry.npmjs.org/dsh-offpeak-check/-/dsh-offpeak-check-0.2.1.tgz
```

装好后标题栏最左边会出现一个 **「价格」** 按钮，点开就是今天的时段和当前状态。

## 文件在哪

都在 DSH 主目录（`$DSH_HOME`，Windows 默认 `C:\Users\<你>\.dsh`）：

| 文件 | 作用 |
|---|---|
| `offpeak-hours.json` | 本地记录（第一次运行自动生成） |
| `offpeak-pending.json` | 发现变化时写的待确认内容 |
| `offpeak-status.json` | 最近一次核对的结果 |
| `offpeak-check.log` | 日志（每次核对一行） |

## 配置

`offpeak-hours.json`：

```json
{
  "utcOffsetMinutes": 480,
  "sourceUrl": "https://api-docs.deepseek.com/quick_start/pricing",
  "sourcePattern": "Peak hours are (.+?) UTC",
  "peak": [
    { "days": "mon-fri", "from": "09:00", "to": "12:00" },
    { "days": "mon-fri", "from": "14:00", "to": "18:00" }
  ]
}
```

- `utcOffsetMinutes`：官网是 UTC，换算到你本地时区的分钟差（北京 480、东京 540、UTC 0）。
- `sourcePattern`：在价格页 HTML 里抓时段描述的正则；页面改版时改这一条即可。
- `peak`：换算后的本地峰期，判断“现在是不是低峰”就用它。**这是唯一真相**，插件不会自己改。

## 手动使用

```bash
node <插件目录>/index.js            # 现在核对一次
node <插件目录>/index.js --now      # 只判断此刻是不是低峰（不联网）
node <插件目录>/index.js --apply    # 把 pending 应用到本地记录
```

## 限制（先说清楚）

- 只认官网价格页上那句 `Peak hours are … UTC`；页面改版就抓不到，会记 `stale`，**不会误改**你的本地记录。
- 系统通知只在 Windows 上弹；其它平台只写日志。
- 中国法定节假日本身不判断（官网写的是“except Chinese public holidays”，那是人工知识，插件不维护日历）。

## English

A small DSH plugin that checks DeepSeek's peak-pricing hours against your local copy once a day. It never edits your config by itself: on a mismatch it writes `offpeak-pending.json` and shows a toast; apply it with `node index.js --apply`.

MIT License.
