---
title: Waydroid A17 NVIDIA：在 N 卡 Linux 桌面上跑硬件加速的 Android 17
categories:
  - - 技术实践
  - - 系统工程
  - - 系统编程
  - - Android
tags:
  - Android
  - Waydroid
  - NVIDIA
  - KernelSU
  - Rust
  - Arch Linux
date: 2026-10-31 20:00:00
---

[English version](/2026/10/31/技术实践/系统工程/系统编程/Android/Waydroid-A17-NVIDIA-hardware-accelerated-Android-17-on-NVIDIA-Linux/)

用 N 卡跑 Waydroid 的人大概都见过这个场面：要么软件渲染，卡得像幻灯片；要么干脆起不来。Waydroid 的图形栈默认围着 Mesa 转，Intel 和 AMD 有现成的驱动，NVIDIA 用户只能看着。

所以我做了 [Waydroid A17 NVIDIA](https://github.com/cagedbird043/waydroid-a17-nvidia)：在 Waydroid 里跑 LineageOS 24.0（Android 17），GPU、视频硬解硬编、root、桌面集成全部打通。Arch 用户一条 `yay -S waydroid-a17-nvidia-bin` 就能装。

![每个安卓应用都是一个独立的 KDE 窗口](/img/2026/10/31/multiwindow.png "每个安卓应用都是一个独立的 KDE 窗口")

<!-- more -->

---

### 1. 能做什么

- **GPU 加速**：ANGLE → NVK → NVIDIA 内核驱动，界面（HWUI）用 Vulkan 渲染。Chrome 里 WebGL、WebGPU 都能用。
- **视频硬解**：H.264、HEVC、VP9、AV1 走 NVDEC，YouTube、Chrome 和播放器自动用上。
- **视频硬编**：H.264、HEVC、AV1 走 NVENC，Chrome 的 WebCodecs 和 WebRTC 视频通话用显卡编码。
- **应用即窗口**：每个安卓应用一个 KDE 窗口，KWin 负责移动、缩放、关闭，还记得上次的位置。
- **宿主输入法**：fcitx5、ibus 直接在安卓里打字，候选框跟着光标走。
- **剪贴板和文件**：剪贴板双向同步，`~/Downloads` 在安卓里就是 `Download/Host`。
- **Root**：宿主内核加载 KernelSU，模块（Zygisk Next、LSPosed 等）都能用。
- **Google 应用**：配 WayDroid-ATV 的 GAPPS 系统镜像，Play 商店已认证。

| Chrome：全部硬件加速 | YouTube 走 NVDEC |
|---|---|
| ![chrome://gpu](/img/2026/10/31/chrome-gpu.png) | ![YouTube](/img/2026/10/31/youtube.png) |

性能方面，在我的 RTX 4060 Laptop 上：

| 测试（4K，Vulkan） | 宿主 NVIDIA 官方驱动 | Waydroid |
|---|---|---|
| Basemark GPU，Medium，离屏 | 35657 | 29369（82%） |
| 3DMark Wild Life Extreme | — | 12300–13100（约 74 FPS） |

安卓版 Basemark 只带 ETC2 纹理，NVK 要模拟，宿主用的是 BC7，所以这个对比对宿主有利。1080p 硬编每帧的 GPU 耗时：H.264 1.7–2.4 ms，HEVC 2.0 ms，AV1 1.4 ms。

---

### 2. 它是怎么跑起来的

NVIDIA 的闭源用户态驱动是给 glibc 桌面写的，Android 里用不了。这条路的关键在 [Shiro836/waydroid-nvidia](https://github.com/Shiro836/waydroid-nvidia) 的 nvidia-prolapse 模式：

- **NVK**：Mesa 的开源 NVIDIA Vulkan 驱动，在 Android 里编译。
- **Rust RM**：一个用 Rust 写的用户态 RM 客户端，直接跟宿主的 NVIDIA open 内核模块对话，替代闭源用户态库。
- **ANGLE**：把 GLES 翻译成 Vulkan，交给 NVK。
- **NVDEC / NVENC**：Codec2 组件直接驱动显卡的视频引擎。

整个 vendor 镜像里没有一个 NVIDIA 闭源文件。

上游官方只支持 Android 13（LineageOS 20）。我做的是把它搬到 Android 17：system 镜像直接用 [WayDroid-ATV](https://github.com/WayDroid-ATV) 的 LineageOS 24.0，不自己编；vendor 镜像自己编，ATV 的 A17 设备树加上移植过来的 NVIDIA 栈。之后又补了多窗口、输入法、剪贴板、文件共享、声音这些日常要用的东西，把编解码核心改写成 Rust。

---

### 3. 搬到 Android 17 踩到的坑

每一个都是「起不来」或者「起来了但不对」，挑几个有代表性的：

- **SurfaceFlinger 报 `Failed to create a valid texture`**。A17 的 minigbm 把 buffer 句柄里的 `usage` 从 `int32_t` 加宽成 `int64_t`，句柄从 35 个 int 变成 36 个，预编译的 HAL 只认 35 个。改回 `int32_t` 就好了，句柄里的 usage 只用低位。
- **HWUI 断言 `queueCount < kRequestedQueueCount`**。A17 的 HWUI 要在图形队列族上开 2 个队列：渲染线程一个，位图上传线程一个，两边并发提交。NVK 原本只报 1 个。改成 2 个队列，每个 VkQueue 本来就有独立的 GPU channel，Rust 后端不用动。
- **KernelSU 的 `ksud` 被 SIGSYS 杀掉**。Waydroid 的 LXC seccomp 拦掉了所有 `reboot(2)`，而 KernelSU 恰好用 `reboot(0xDEADBEEF, …)` 拿驱动的 fd。规则改成只放行这个魔数，别的 reboot 照样拦。
- **点一下窗口应用就关了**。A17 system 镜像里 task 服务的事务号是旧的，`setFocusedTask` 实际变成了 `removeTask`。hwcomposer 改成直接调 `cmd activity` / `cmd window`。
- **声音小得几乎听不见**。system 镜像把默认媒体音量设成 16，超过最大的 15 档会被丢弃，退回到 1/3。vendor 属性改成 15。

---

### 4. 装之前先在你的显卡上测一遍

只在一台机器上测过的东西，最怕的就是在别人机器上悄悄出错。所以安装脚本 `waydroid-nvidia-setup` 不会直接把镜像换上去：

1. 先在你的 GPU 和当前加载的内核模块上跑一组门禁测试；
2. 通过才装，你原来的官方 vendor 镜像留作备份；
3. 任何一步失败，就说明原因和办法，再把之前的镜像和配置恢复回去。

Rust RM 是按 NVIDIA 驱动版本精确匹配内核 ABI 的，不认识的版本直接拒绝运行，不会硬跑。驱动升级以后，Waydroid 会提示重跑一次 setup，在新驱动上重新过门禁。

---

### 5. 安装

Arch Linux：

```bash
yay -S waydroid-a17-nvidia-bin
```

再放入 system 镜像（[WayDroid-ATV `20261017`](https://github.com/WayDroid-ATV/waydroid-builds/releases/tag/20261017)，GAPPS 或 VANILLA）并初始化：

```bash
sudo mkdir -p /etc/waydroid-extra/images
sudo bsdtar -xf lineage-24.0-20261017-GAPPS-waydroid_x86_64-system.zip -C /etc/waydroid-extra/images system.img
sudo bsdtar -xf /usr/lib/waydroid-nvidia/vendor/waydroid-nvidia-vendor-x86_64-*.zip -C /etc/waydroid-extra/images vendor.img
sudo waydroid init -f
sudo waydroid-nvidia-setup      # 先在你的显卡上测试 vendor 镜像，通过后再装上
waydroid prop set persist.waydroid.multi_windows true
waydroid session start
```

需要 NVIDIA **open** 内核模块和 binder（binderfs）。其他发行版和 root 的配置见[项目 README](https://github.com/cagedbird043/waydroid-a17-nvidia)。

---

### 6. 顺手做的：宿主机的 VA-API 驱动

同一套 Rust RM 也能用在宿主机上。[nvrm-vaapi-driver](https://github.com/cagedbird043/nvidia-vaapi-driver)（AUR 同名）是一个 VA-API 驱动，直接经 RM 驱动 NVDEC 和 NVENC：浏览器硬解，Sunshine 用 VA-API 编码给 Moonlight 串流，都已经实测能用。

---

### 7. 限制

- 个人项目，只在一台机器上测过：RTX 4060 Laptop、NVIDIA open 驱动 615.78.08、KDE Plasma 6 Wayland、Arch Linux。
- Widevine 只有 L3，流媒体应用一般只给标清。
- 过不了 Play Integrity 的设备完整性校验，强制要求它的应用（比如银行）用不了。

欢迎 issue 和 PR。

### 致谢

没有 [Shiro836/waydroid-nvidia](https://github.com/Shiro836/waydroid-nvidia) 就没有这个项目：nvidia-prolapse 模式、NVK 与 Rust RM、ANGLE、NVDEC 组件和大部分 hwcomposer 修正都来自那里。Android 17 的系统镜像、设备树和 Waydroid 版 KernelSU 来自 [WayDroid-ATV](https://github.com/WayDroid-ATV)（supechicken）。NVENC 编码核心来自 [mickys/nvenc](https://github.com/mickys/nvenc)。也感谢 Waydroid、LineageOS、KernelSU、Mesa、ANGLE 这些项目。
