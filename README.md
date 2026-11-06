# dsh-plugin-deepseek-balance

English | [中文](#中文)

A DSH profile plugin: one status line at the right end of the composer dock showing the
DeepSeek total balance, whether the current hour is peak or off-peak pricing, and a
countdown to the next price switch.

![Composer status bar showing the balance and the peak/off-peak countdown](assets/screenshot.png)

## Install

1. Store the API key in the profile's credential service as `DEEPSEEK_API_KEY`.
2. In an agent session, run `plugin_manager` with `action: install_bundle` and
   `target: https://github.com/wzy816/dsh-plugin-deepseek-balance` (a checkout path
   works too).

## What it does

- **Total balance** — granted + topped up, read from
  `GET https://api.deepseek.com/user/balance` with the profile key. The key stays on
  the Host: the Client half only polls a same-origin snapshot on `/_dsh/deepseek-balance`.
- **Peak / off-peak + countdown** — peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to
  Friday, excluding Chinese public holidays ([timor.tech](https://timor.tech/api/holiday)).
  Everything else is off-peak. Holidays are cached per year, and the next switch is exact.
- **Hover** for the next switch time, the reason (holiday / weekend / window), the peak
  windows and holiday-data status; **click** to refresh immediately.

## Configuration

```yaml
- id: dsh-plugin-deepseek-balance
  name: dsh-plugin-deepseek-balance
  config:
    apiKeyRef: DEEPSEEK_API_KEY   # credential reference
    balanceTtlSeconds: 60         # balance cache and refresh cadence
    holidayTtlSeconds: 21600      # 6h holiday cache
```

`apiBase`, `holidayApiBase` and `requestTimeoutMs` are configurable too.

## Notes

- Renders only while a conversation is open (the composer dock slot is session-scoped).
- The package ships an original SVG icon (`icon.svg`, exported as `./icon`): a yuan coin inside a
  two-tone pricing ring, warm for peak hours and cool for off-peak hours.
- The snapshot route accepts loopback / this machine's own Host headers only.

---

# 中文

[English](#dsh-plugin-deepseek-balance) | 中文

一个 DSH 配置档插件：在输入框状态栏右侧显示一行信息，包含 DeepSeek 总余额、当前是峰时
还是谷时，以及距离下一次价格切换的倒计时。

![输入框状态栏中的余额与峰谷倒计时](assets/screenshot.png)

## 安装

1. 在配置档的凭据服务中存入 API Key，引用名为 `DEEPSEEK_API_KEY`。
2. 在 agent 会话里调用 `plugin_manager`，`action: install_bundle`，
   `target: https://github.com/wzy816/dsh-plugin-deepseek-balance`（也可以填本地目录）。

## 功能

- **总余额** —— 赠送余额 + 充值余额，用配置档内的 Key 读取
  `GET https://api.deepseek.com/user/balance`。Key 只留在 Host 侧，浏览器只轮询同源快照
  `/_dsh/deepseek-balance`。
- **峰时 / 谷时 + 倒计时** —— 峰时为 UTC 01:00–04:00 与 06:00–10:00，周一至周五，且排除
  中国法定节假日（数据来自 [timor.tech](https://timor.tech/api/holiday)）；其余时间为谷时。
  节假日数据按年缓存，下次切换时刻精确到窗口边界。
- **悬停**查看下次切换时间、当前峰/谷原因（节假日 / 周末 / 窗口外）、峰时时段和节假日数据
  状态；**点击**立即刷新。

## 配置

```yaml
- id: dsh-plugin-deepseek-balance
  name: dsh-plugin-deepseek-balance
  config:
    apiKeyRef: DEEPSEEK_API_KEY   # 凭据引用名
    balanceTtlSeconds: 60         # 余额缓存与刷新间隔
    holidayTtlSeconds: 21600      # 节假日缓存（6 小时）
```

`apiBase`、`holidayApiBase`、`requestTimeoutMs` 也可配置。

## 说明

- 仅在打开会话时显示（该插槽是会话作用域）。
- 包内包含自绘 SVG 图标（`icon.svg`，导出为 `./icon`）：双色价格环中的 ¥ 硬币，暖色表示峰时、
  冷色表示谷时。
- 快照路由只接受回环地址或本机 Host 头。
