---
title: Wayland 屏幕共享劫持与注入：从 C++ 到 Rust 与沙盒绕坑记
tags:
  - Arch Linux
  - Wayland
  - PipeWire
  - Rust
  - C++
  - Bubblewrap
  - 屏幕共享
categories:
  - - 技术实践
  - - 系统工程
  - - 系统编程
date: 2026-06-16 01:30:00
---

国内的几款主流即时通讯/会议软件（如钉钉、腾讯会议）在 Linux 平台上的更新速度一向较为保守。特别是在 Wayland 会话渐成主流的今天，这些客户端由于内部仍然使用古老的 X11/XShm（X11 Shared Memory）API 进行屏幕捕捉，在 Wayland 桌面下共享屏幕时，往往只能看到一片漆黑，或者干脆静默失效。

为了打破这种尴尬，社区的前辈们（如 `xuwd1` 与 `yatli`）曾先后提出了通过 `LD_PRELOAD` 劫持 X11 共享内存 API，转而向系统 `xdg-desktop-portal` 申请 PipeWire 视频流，并把画面注入回 X11 `XImage` 空间的奇招。

本文将记录我们在此基础上的进一步探索：**将该方案用纯 Rust 重写，彻底干掉臃肿的 OpenCV 和 C++ 运行时依赖，进行极致的性能与并发锁优化，并顺手排查并解决腾讯会议在 Bubblewrap 沙盒下因 PID 隔离导致投屏失效的深水坑。**

<!-- more -->

---

## 劫持与注入：动态库欺骗的艺术

在深入 Rust 重写之前，我们先来看看这类“欺骗”工具的基本工作原理。

不管是钉钉还是腾讯会议，在 XWayland 兼容模式下运行的时候，其截屏/投屏功能底层往往是通过 `libXext.so` 中的 `XShmCreateImage`、`XShmAttach` 和 `XGetImage` 等 API 来获取屏幕画面的。

我们的注入工具以动态链接库（`.so`）的形式存在，通过 `LD_PRELOAD` 抢先于系统库加载。当主程序调用这些 API 时，它们会被我们的 Hook 库截获：

1.  **捕捉宿主容器**：在主程序调用 `XShmCreateImage` 分配共享内存图像空间（`XImage`）时，我们截获并保存该图像的句柄和共享内存信息。
2.  **Portal 握手**：通过 D-Bus 向主机的 `org.freedesktop.portal.Desktop` 发起 `Screencast` 请求。此时系统会拉起原生的屏幕/窗口选择器（Portal Picker）。
3.  **PipeWire 流接收**：用户选择屏幕后，我们获得一个 PipeWire 文件描述符（FD），并借助 `pipewire-rs` 建立视频流会话，持续接收最新的屏幕帧数据。
4.  **异步像素注入**：在后台启动一个 30 FPS 的注入线程。每当 PipeWire 收到新帧，该线程就执行颜色空间对换和缩放，然后直接将像素数据 `memcpy` 写入步骤 1 保存的 `XImage` 共享内存空间。
5.  **瞒天过海**：对于主程序而言，它在调用 `XGetImage` 等方法时，以为自己还在向 X 服务请求截屏，而实际上拿到的已经是我们从后台写入的、来自 PipeWire 的真实 Wayland 桌面图像。

---

## 从 C++ 到 Rust：追求极致的性能与健壮性

原版的 `yatli/dingtalk-wayland-screencast` 采用 C++ 编写，且为了处理图像缩放，引入了庞大的 OpenCV 库。

虽然能用，但有两个难以忍受的痛点：
*   **依赖过重**：链接了 `libstdc++.so` 和 OpenCV。在滚动更新的 Arch Linux 上，OpenCV 的 ABI 经常因版本升级而发生崩盘，导致钉钉莫名其妙闪退；而且整个库的打包体积达到了数十兆。
*   **运行时分配抖动**：每一帧的图像缩放和通道转换都伴随着临时的内存申请与释放（`malloc` / `free`），在高频（30 FPS）高分辨率下会导致 CPU 开销和内存抖动。

### 1. 彻底干掉 OpenCV
在 Rust 实现中，我们摒弃了 OpenCV，改用精简的 `resize` 库处理双线性插值缩放，用极其朴素的 in-place 指针操作进行色彩通道转换（例如 `RGBA` / `BGRA` 互换）：

```rust
// 零堆内存分配的通道转换示例
pub fn bgra_to_bgrx_inplace(data: &mut [u8]) {
    // 快速在同一个 buffer 中将第四通道置为不透明/空字节，避免重新分配内存
    for chunk in data.chunks_exact_mut(4) {
        chunk[3] = 0xFF; 
    }
}
```

这使最终编译出来的 `libdingtalk_wayland_screenshare.so` 体积**缩减到了不到 300KB**，且运行时再无外部动态库版本冲突的隐患。

### 2. 零运行时内存分配 (Zero-Allocation)
我们通过复用预分配的视频缓冲区实现了零拷贝和零动态分配。在 PipeWire 流中，每一帧的像素数据直接读取并写入预先分配好的单例 `Vec<u8>` 中。后台注入线程只在检测到源屏幕分辨率发生改变时，才会重新分配一次目标缓冲区，平时 30 FPS 循环内没有任何 `malloc` 调用：

```rust
// 通过双缓冲/读写锁复用预分配的 Frame Buffer
lazy_static! {
    static ref LATEST_FRAME: RwLock<Vec<u8>> = RwLock::new(Vec::new());
}
```

### 3. 锁粒度优化与线程解耦
在 C++ 原版中，为了保护全局状态，锁的临界区非常大，甚至会在缩放图像时阻塞住主线程，容易引发微小的 UI 卡顿。

在 Rust 重构中，我们将全局 Hook 状态（D-Bus 连接、PipeWire 会话等）与高频的视频像素缓存区进行彻底解耦。只有在获取最新帧像素时，才在极短的临界区内对共享的 `RwLock` 加读锁，复制出数据后立刻释放锁，随后在主线程外部执行插值缩放。这确保了钉钉主 UI 线程的调度绝不会被耗时的图像处理阻塞。

### 4. 符号解析兼容性
在编写 `LD_PRELOAD` 劫持库时，常规做法是使用 `RTLD_NEXT` 去寻找真实的系统库函数（如原生的 `XShmCreateImage`）。但在某些复杂的动态链接环境下，这种方法可能会因为加载顺序问题导致段错误。

我们改用显式的 `dlopen` 分别加载 `libX11.so.6` 和 `libXext.so.6`，通过其句柄显式获取原始符号，大大增强了库的健壮性。

---

## 腾讯会议与 Bubblewrap 沙盒的“深水坑”

在我们享受 Rust 重构版带来的流畅投屏时，另一个痛点暴露了出来：**腾讯会议 (`wemeet-bin`) 在 Wayland 下依然无法投屏**，点击“共享屏幕”按钮没有任何反应，控制台也一片寂静。

### 排障过程
我们阅读了腾讯会议在 Arch Linux 上的启动包装器（`/usr/bin/wemeet`），发现为了安全性及解决暗色模式下的字体颜色显示问题，打包者默认使用了 Bubblewrap (`bwrap`) 沙盒来运行腾讯会议，其核心沙盒命令如下：

```bash
exec bwrap \
    --new-session \
    --unshare-user-try --unshare-pid --unshare-uts --unshare-cgroup-try \
    ...
```

注意到其中一个关键参数：**`--unshare-pid`**。

### 原理剖析
`bwrap --unshare-pid` 会为沙盒内的进程分配一个独立的 PID 命名空间，使沙盒内的程序自以为 PID 是 1。

然而，腾讯会议自身的投屏也是基于系统级 `xdg-desktop-portal` 的 D-Bus 调用。当客户端通过 D-Bus 向 Portal 申请屏幕共享流时，Portal 守护进程会通过套接字凭证（Socket Credentials）反查请求发起方的 PID，并向 `systemd` 校验该 PID 对应的 cgroup 归属和权限，以决定是否拉起选屏弹窗。

但在启用了 `--unshare-pid` 后：
1.  沙盒内腾讯会议的真实真实 PID 被隐藏。
2.  D-Bus 传递到 Portal 的凭证 PID，在主机的 PID 命名空间中根本找不到对应的合法服务/cgroup，或者校验映射失败。
3.  Portal 认为这是非法请求，直接静默拒绝，因此选屏弹窗死活无法出现。

### 解决方案
既然找到了病灶，解决方式也非常简单：**在 `bwrap` 的运行参数中移除 `--unshare-pid`**。

我们在本地测试了移除 `--unshare-pid` 后的 `wemeet.sh` 脚本，腾讯会议立即顺利唤起了 KDE / GNOME 的系统原生选屏框，屏幕共享完美恢复！

由于该问题属于 Arch Linux 社区打包的默认沙盒行为，我们已经将该建议（Diff）整理并提交到了 AUR 社区中，以便后续所有 Linux 腾讯会议用户都能享受到开箱即用的投屏功能。

---

## 结语

在 Linux 桌面日常使用中，折腾这类商业软件的兼容性问题往往需要横跨系统编程、多线程并发、网络套接字和沙盒安全等多个维度。

将原本的 C++ Hook 替换为极致优化的 Rust 版本，不仅极大地减小了分发体积、消除了动态库升级崩盘的隐患，也让我们在实践中加深了对 Wayland/PipeWire 以及 PID 命名空间隔离机制的理解。

目前，重构后的 Rust Hook 已经开源并推送到 AUR，如果你也在 Wayland 下为钉钉屏幕共享感到困扰，不妨一试：

```bash
# Arch Linux 用户一键安装
yay -S dingtalk-wayland-screenshare-rust-git
```

*   **GitHub 项目仓库**：[cagedbird043/dingtalk-wayland-screenshare](https://github.com/cagedbird043/dingtalk-wayland-screenshare)
*   **致敬原版项目**：`yatli/dingtalk-wayland-screencast` 与 `xuwd1/wemeet-wayland-screenshare`
