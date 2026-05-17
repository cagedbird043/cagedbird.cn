---
title: Android sing-box FCM 稳定连接实录：托管模式、分应用代理与 VPN 绕过陷阱
tags:
  - Android
  - sing-box
  - SFA
  - FCM
  - DNS
  - VPN
  - 网络排障
  - Mice-Tailor-Infra
categories:
  - - 技术实践
  - - 开发运维
  - - 服务器运维
  - - 网络与安全
date: 2026-05-18 01:30:00
---

我折腾 FCM 的初衷很简单：让 Android 手机上所有需要 Google 推送的应用，在国内网络、Wi-Fi、移动数据、代理和直连之间都能稳定收到消息。

这件事听起来像是“把 `geosite-googlefcm` 直连”就完了。真正做起来才发现，Android VPNService、SFA 的托管模式、分应用代理、系统层的“允许应用绕过 VPN”、Google 官方 GMS、microG、IPv6、DNS hosts、TCP 5228 长连接，全都能掺一脚。

最后真正稳定下来的组合反而有点反直觉：

> **开启 SFA 的分应用代理和托管模式，让托管模式自动绕过中国应用；同时关闭 Android 系统的“允许应用绕过 VPN”。**

这篇记录一下完整排障过程，以及最后留下来的配置形态。

<!-- more -->

## 目标：不是“能连一次”，而是让 FCM 长连接稳定

FCM 的关键不在于某一次 `ping mtalk.google.com` 能不能通，而在于系统里是否能长期维持到 Google FCM 服务器的 TCP 连接。常见端口是：

```text
5228 / 5229 / 5230
```

我想要的是这样的运行形态：

- Android 上只跑一个 SFA / sing-box VPN；
- 国内应用仍然自动直连，不要全家桶都过代理；
- Google FCM 可以默认直连，直连抽风时可以手动切到代理；
- DNS、路由、订阅、hosts 更新都由 sing-box 统一管理；
- 尽量不要再靠外部 hosts 更新脚本、Root 模块或系统级魔法。

为了做到这个，我自己的 sing-box fork 里已经有两个关键增强：

1. Clash 订阅 provider，方便全平台直接吃机场订阅；
2. hosts remote provider，让 sing-box 内核自己定时拉取 FCM hosts。

第二个能力让 FCM hosts 可以像 rule-set 一样由 sing-box 自动更新，不需要额外维护 systemd timer、Magisk/KernelSU 模块或者手写脚本。

## 第一轮误判：以为 IPv6 放开就万事大吉

排障中最容易误判的是 IPv6。

我一开始观察到：移动数据下 IPv6 似乎很稳，而 FCM hosts 工厂因为云端环境问题暂时产不出可靠 IPv6。直觉上会想：那就把 Android VPN 里的 IPv6 放开，让 FCM 的 AAAA 记录正常走运营商 IPv6，IPv4 再由 hosts provider 兜底。

于是我试过类似这样的方向：

```json
{
  "dns": {
    "strategy": "prefer_ipv4"
  },
  "inbounds": [
    {
      "type": "tun",
      "address": [
        "172.19.0.1/30",
        "fdfe:dcba:9876::1/126"
      ]
    }
  ]
}
```

结果很快翻车：普通 Google HTTPS 开始不稳定。

诊断结果非常典型：

```text
curl -4 https://www.google.com    OK
curl -6 https://www.google.com    TLS 失败
curl    https://www.google.com    跟着 IPv6 一起失败
```

`ping6` 能通并不代表 TLS 能稳定通。更麻烦的是，只要 VPN 里给了 IPv6，很多应用会非常积极地选 IPv6。`prefer_ipv4` 并不能阻止应用或系统栈自己偏向 IPv6。

所以最后我放弃了“全局 IPv6 解禁”。当前稳定策略是：

```json
{
  "dns": {
    "strategy": "ipv4_only"
  },
  "inbounds": [
    {
      "type": "tun",
      "address": ["172.19.0.1/30"]
    }
  ]
}
```

这听起来保守，但对我的现实网络来说，它是稳定的。

## 第二轮排障：网络明明通，为什么官方 GMS 不稳？

真正把问题看清楚，是靠 adb 里只做网络诊断。

当时我没有去点 UI，也没有乱改手机，只查了几类信息：

```bash
adb shell ip -br addr
adb shell ip route
adb shell ip -6 route
adb shell dumpsys connectivity
adb shell ping -c 3 mtalk.google.com
adb shell ping6 -c 3 mtalk.google.com
adb shell 'for p in 5228 5229 5230; do nc -z -w 5 mtalk.google.com $p; echo $?; done'
adb shell ss -tnpe
```

几个事实很快浮出来。

### 1. FCM IPv4 实际是通的

`mtalk.google.com` 能解析到 hosts provider 给出的 IPv4，5228/5229/5230 也能连通：

```text
mtalk.google.com:5228 rc=0
mtalk.google.com:5229 rc=0
mtalk.google.com:5230 rc=0
```

这说明问题不是“FCM 服务器完全不可达”。

### 2. microG 已经建立了 FCM 长连接

`ss -tnpe` 能看到类似：

```text
ESTAB [::ffff:172.19.0.1]:40484 -> [::ffff:108.177.125.188]:5228 uid:10395
```

对应包名是：

```text
uid 10395 = app.revanced.android.gms
```

也就是 microG / ReVanced GMS 的 FCM 长连接已经存在，而且走的是 sing-box TUN。

### 3. 官方 GMS 没有对应 socket

官方 Google Play services 的 uid 是：

```text
uid 10121 = com.google.android.gms
```

但当时并没有看到它维持 5228/5229/5230 的连接。

这就把问题从“网络不可达”变成了另一个问题：

> 官方 GMS 在当前 VPN / DNS / 分应用代理环境下，没有成功建立或维持 FCM 长连接。

microG 能稳，不代表官方 GMS 一定稳。官方 GMS 的网络选择、重连策略、后台状态和系统 VPN 行为之间的关系更复杂。

## 最关键的坑：不要把系统 VPN bypass 和 SFA 托管模式混在一起

最终真正稳定的配置不是某个 Google IP，也不是某个神奇节点，而是 Android VPN 设置里的一个控制权问题。

成功组合是：

```text
SFA 开启 TUN
SFA 开启分应用代理
SFA 开启托管模式
托管模式自动绕过全部中国应用
关闭 Android 系统的“允许应用绕过 VPN”
```

这个结论非常反直觉。

很多人看到“中国应用要直连”，第一反应是打开系统 VPN 设置里的“允许应用绕过 VPN”。但我的实测结果正好相反：

> **中国应用是否直连，应该交给 SFA / sing-box 的托管模式和规则系统；不要再让 Android 系统层额外允许应用绕过 VPN。**

原因并不复杂：

- SFA 托管模式已经有一套分应用接管和绕过逻辑；
- Android 系统层的 VPN bypass 又是一套独立逻辑；
- 两套控制面叠在一起时，谁接管、谁绕过、谁保留长连接，会变得不清楚；
- FCM 这种长连接服务最怕控制权在系统和 VPN 应用之间摇摆。

关闭“允许应用绕过 VPN”之后，SFA 成为唯一控制面。中国应用仍然可以由托管模式自动绕过，而 FCM/GMS 相关连接不会莫名其妙逃离 VPNService 的可观测路径。

这一步完成后，FCM 终于稳定了。

## 最终保留的 sing-box 配置形态

### 1. DNS 保持 IPv4-only

```json
{
  "dns": {
    "strategy": "ipv4_only",
    "reverse_mapping": true
  }
}
```

这不是说 IPv6 永远不好，而是我的当前路径里，普通 Google IPv6 的 HTTPS/TLS 不可靠。既然应用只要看到 IPv6 就容易选它，那就不要在 VPN 里给全局 IPv6。

### 2. FCM hosts provider 只接管 A 查询

```json
{
  "type": "hosts",
  "tag": "hosts",
  "providers": [
    {
      "type": "remote",
      "tag": "fcm-hosts-next",
      "url": "https://miceworld.top/fcm-hosts-next/fcm_dual.hosts",
      "path": "cache/hosts/fcm_dual.hosts",
      "update_interval": "3h",
      "http_client": "download-direct"
    }
  ]
}
```

DNS rule：

```json
{
  "preferred_by": "hosts",
  "query_type": ["A"],
  "action": "route",
  "server": "hosts"
}
```

这表示：FCM 的 A 记录由我的 `fcm-hosts-next` 数据源兜底。

### 3. FCM 不再硬编码直连，而是专门做一个 selector

这是后来加上的关键操作。以前我把 FCM 写死到直连：

```json
{
  "rule_set": ["geosite-googlefcm"],
  "outbound": "🇨🇳 国内直连"
}
```

现在改成专用选择器：

```json
{
  "tag": "📨 FCM",
  "type": "selector",
  "outbounds": [
    "🇨🇳 国内直连",
    "🔰 节点选择",
    "🇯🇵 JP s4 Fast",
    "🇳🇱 EU s5",
    "🇺🇸 LA s3",
    "🇺🇸 LA s2",
    "🇺🇸 LA s1",
    "📦 Bulk s801"
  ],
  "default": "🇨🇳 国内直连"
}
```

路由规则：

```json
{
  "rule_set": ["geosite-googlefcm"],
  "outbound": "📨 FCM"
}
```

这样默认仍然直连。如果哪天直连 FCM 抽风，可以在 Web UI 里把 `📨 FCM` 单独切到 `🔰 节点选择` 或某个具体节点，而不影响其他 Google 服务。

这个设计比“FCM 永远直连”更稳，也比“所有 Google 都代理”更细。

## 最终 Android 侧设置

最终让我稳定的手机侧设置可以概括成：

```text
SFA:
  - 开启 TUN
  - 开启分应用代理
  - 开启托管模式
  - 托管模式自动绕过中国应用

Android 系统 VPN 设置:
  - 关闭“允许应用绕过 VPN”

sing-box 配置:
  - dns.strategy = ipv4_only
  - FCM hosts provider 只接管 A 查询
  - geosite-googlefcm -> 📨 FCM selector
  - 📨 FCM 默认直连，必要时手动切代理
```

我现在的结论是：**不要让 Android 系统和 SFA 同时争夺“谁来决定应用是否绕过 VPN”的控制权。**

如果要用 SFA 的托管模式，就让它成为唯一控制面。

## 这次排障留下的几个判断

### 1. `ping` 通不代表 FCM 稳

FCM 关键是 TCP 5228/5229/5230 长连接。ICMP 只能证明很少一部分事实。

### 2. IPv6 能 ping 通不代表 HTTPS 稳

这次普通 Google IPv6 就是典型例子：`ping6` 看起来没问题，但 TLS 连接会断。只要应用偏向 IPv6，实际体验就会坏。

### 3. `prefer_ipv4` 不一定有用

对很多 Android 应用来说，只要系统/VPN 暴露了 IPv6，它们就可能积极选 IPv6。`prefer_ipv4` 不是强约束。

### 4. microG 稳不代表官方 GMS 稳

microG 和官方 GMS 的网络行为不完全一样。microG 能连上 5228，只能证明网络路径有可能是通的，不能证明官方 GMS 一定会按同样方式工作。

### 5. 分流控制面越少越稳定

这次真正的转折点是关闭 Android 系统层的 VPN bypass，把分应用代理和中国应用绕过都交给 SFA 托管模式。

## 结语：少一个控制面，多一分稳定

这次排障最后不是赢在某个神奇 IP，也不是赢在某个代理节点，而是赢在控制权收敛。

我以前总觉得 Android VPN 设置里的“允许应用绕过 VPN”是一个方便的逃生口。但在 SFA 托管模式下，它更像是另一个不透明控制面。它让部分应用可能绕过 VPN，让长连接行为变得不可观测，也让“到底是谁在接管这个包”变成玄学。

关掉它以后，事情反而简单了：

```text
中国应用是否直连：交给 SFA 托管模式
FCM 是否直连/代理：交给 📨 FCM selector
DNS hosts 如何更新：交给 sing-box hosts provider
普通外网如何走：交给 sing-box route
```

这是我喜欢的系统状态：控制面少，路径清楚，出了问题能查。

现在手机上的 FCM 已经稳定连上了。折腾了这么久，终于从“玄学推送”变成了一个可以解释、可以复现、可以维护的网络系统。
