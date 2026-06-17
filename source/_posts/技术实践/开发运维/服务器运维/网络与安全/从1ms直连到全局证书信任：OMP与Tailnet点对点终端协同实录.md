---
title: 从 1ms 直连到全局证书信任：OMP 与 Tailnet 点对点终端协同实录
tags:
  - Android
  - Termux
  - sing-box
  - Tailscale
  - Headscale
  - OMP
  - WebSockets
  - Systemd
  - TLS/SSL
  - 网络与安全
categories:
  - - 技术实践
  - - 开发运维
  - - 服务器运维
  - - 网络与安全
date: 2026-06-18 00:43:00
---

我一直梦想着一种真正的、没有妥协的跨终端协作编程体验。

不是那种把所有协作者强行拉伸到同一个物理分辨率下的 `tmux` 共享——在那种模式下，用手机加入电脑的会话简直是一场灾难，你必须互相迁就对方的终端布局。我想要的是：主控端（笔记本）发起会话，协作者（手机 Termux、电脑浏览器、其他终端）可以独立渲染，各自以最适合自己屏幕尺寸的排版渲染 TUI 界面，但底层的数据流、光标和 AI 提示却保持完美同步。

Oh My Pi (OMP) 提供了原生的 `/collab` 协同信道，但官方默认使用的 `wss://my.omp.sh` 公网中转服务器因为地理位置阻隔以及全球负载，延迟通常在几百毫秒以上，打起字来有明显的粘滞感。

既然我手中有一套完整的、由 Headscale 协调的私有 Tailnet 网格，我们能不能打破这堵墙，利用 P2P 直连与自建 CA 证书，在内网搭建一套 1ms 延迟、全局 TLS 强加密的独立终端协同网络？

不仅能，而且其优雅与丝滑程度，远远超出了最初的想象。

<!-- more -->

以下是这套“终极移动协同方案”从零到一的完整搭建与深夜排障实录。

---

### 架构设计：点对点直连的“漂移服务”

要实现这套协同生态，我们需要在三个端之间打通链路：
1. **主控端 (Laptop)**：启动 OMP 本地中继（Local Relay），充当 WebSocket 交换机，同时托管并分发 React 协同前端。
2. **协调端 (Headscale / hk-edge)**：用于节点发现、打洞协商以及自建 Root CA 证书签发。
3. **协作端 (Phone Termux / Web Browser)**：通过域名访问中转，通过 E2E 加密的加密二进制帧与主控端实时互动。

在传统的局域网协同中，如果直接使用明文 `ws://` 协议，现代浏览器在安全上下文（Secure Context）中会直接拦截 WSS 以外的连接。因此，我们必须为私有内网域名（例如 `collab.tailnet.cagedbird.cn`）以及内网 IP 签发可信的 SSL 证书。

---

### 第一步：TLS 根签名与内网 SAN 别名签署

因为我的 Laptop 已经在系统信任锚点 `/etc/ca-certificates/trust-source/anchors/` 中导入了自建的 `headscale-direct-root.crt`。这意味着：**只要能让这把自建 Root CA 签发一张覆盖本域名的证书，本机和整个 Tailnet 内的所有信任节点就能无警告、无绿锁报错地握手。**

然而，由于私有 IP（`100.64.0.1`）无法通过 Let's Encrypt 等公网 CA 的 HTTP-01 验证，我们只能通过 DNS-01 或者在私有 CA 侧直接手动签发。

1. 在本机生成私钥与 CSR（证书签名请求）配置文件 `/tmp/laptop-cert.conf`，这里非常关键的一点是，**必须在 Subject Alternative Name (SAN) 中同时写入内网域名、自定义服务域名以及内网 IP**：
   ```ini
   [req]
   default_bits = 2048
   prompt = no
   default_md = sha256
   req_extensions = req_ext
   distinguished_name = dn

   [dn]
   CN = laptop.tailnet.cagedbird.cn

   [req_ext]
   subjectAltName = @alt_names

   [alt_names]
   DNS.1 = laptop.tailnet.cagedbird.cn
   DNS.2 = collab.tailnet.cagedbird.cn
   IP.1 = 100.64.0.1
   ```
   然后生成 CSR。

2. 将 CSR 传输至香港服务器 `hk-edge`，使用受保护的 Root CA 密钥进行签署，生成 `/tmp/laptop-tailnet.crt` 并传回 Laptop：
   ```bash
   sudo openssl x509 -req -in /tmp/laptop-tailnet.csr \
     -CA /etc/headscale/tls-direct/rootCA.crt \
     -CAkey /etc/headscale/tls-direct/rootCA.key \
     -CAcreateserial \
     -out /tmp/laptop-tailnet.crt \
     -days 365 -sha256 \
     -extfile <(printf "subjectAltName=DNS:laptop.tailnet.cagedbird.cn,DNS:collab.tailnet.cagedbird.cn,IP:100.64.0.1")
   ```

---

### 第二步：解耦硬编码，把中转服务器升级为“双用 Web 容器”

OMP 本地中继脚本 `local-relay.ts` 在官方的最初设计中，仅在接收到 WebSocket 升级协议时工作。如果协作成员通过浏览器点开分享链接，向根目录 `/` 发起 HTTP Get 请求，服务会直接返回 `not found` (404)。而公网生产环境 `my.omp.sh` 则是在反代侧挂载了编译好的 React 前端应用（`collab-web`）。

为了防止后续拉取上游代码覆盖我们本地的改动，并且让本地中转“开箱即用”：
1. **重构启动解析器**：通过在 `local-relay.ts` 的 `parseArgs` 中加入通用的 `--tls-key` 和 `--tls-cert` 选项，将物理证书路径与 Git 追踪代码完全解耦。
2. **挂载静态文件目录**：重写了 `Bun.serve` 的 `fetch` 拦截逻辑。如果是正常的浏览器请求，且文件存在于本地编译好的 `dist/` 文件夹中，则直接通过 `Response(file)` 分发静态 React 资源，没有文件则返回 404。

部分核心代码实现：
```typescript
export function startLocalRelay(port = 0, tls?: { key?: string; cert?: string }): LocalRelay {
	const rooms = new Map<string, Room>();

	const server = Bun.serve({
		port,
		...(tls?.key && tls?.cert ? {
			tls: {
				key: Bun.file(tls.key),
				cert: Bun.file(tls.cert),
			}
		} : {}),
		fetch(req, srv): Response | Promise<Response> | undefined {
			const url = new URL(req.url);
			const match = ROOM_PATH_RE.exec(url.pathname);
			const role = url.searchParams.get("role");
			if (match && (role === "host" || role === "guest")) {
				const data: SocketData = { roomId: match[1]!, role, peerId: 0 };
				if (srv.upgrade(req, { data })) return undefined;
				return new Response("websocket upgrade required", { status: 426 });
			}

			// Serve static files from the build output directory
			const distDir = `${import.meta.dir}/../dist`;
			let filePath = url.pathname;
			if (filePath === "/" || filePath === "") filePath = "/index.html";

			const file = Bun.file(`${distDir}${filePath}`);
			return file.exists().then((exists) => {
				if (exists) {
					return new Response(file);
				}
				return new Response("not found", { status: 404 });
			});
		},
```
这不仅优雅，而且直接让本地中转变成了一个完全独立的 Web + WebSocket 服务器，不需要再在本机配置复杂的 Caddy/Nginx 反代。

---

### 第三步：利用 Systemd 绑定 443 端口

为了让域名更干净，我们希望省略链接里的端口号。但绑定小于 1024 的特权端口（如 `443`）需要 root 权限。

如果在 Systemd 用户级服务中运行，会直接报 `EACCES`。最完美的做法是：**将服务移至系统级（`/etc/systemd/system/`），以普通用户 `cagedbird` 身份运行，但通过 `AmbientCapabilities` 借用特权端口绑定权限**：

在 `/etc/systemd/system/omp-collab-relay.service` 中配置：
```ini
[Unit]
Description=OMP Local Collab Relay (TLS via Tailnet on port 443)
After=network.target

[Service]
Type=simple
User=cagedbird
Group=cagedbird
WorkingDirectory=/home/cagedbird/Projects/CagedBird-Ecosystem/tools/oh-my-pi
ExecStart=/home/linuxbrew/.linuxbrew/bin/bun packages/collab-web/scripts/local-relay.ts --port 443 --tls-key /home/cagedbird/.config/oh-my-pi/laptop-tailnet.key --tls-cert /home/cagedbird/.config/oh-my-pi/laptop-tailnet.crt
Restart=on-failure
RestartSec=5
# 关键：普通用户绑定 443 端口的特权
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```
重新加载并拉起，服务在后台完美运行在 `wss://localhost:443`！

---

### 第四步：Headscale 自定义 DNS 漂移解析

因为 Laptop 并没有运行官方的 `tailscaled`，而是通过 `sing-box` 的 `tailscale` inbound 端点接入 Headscale 控制平面。

为了能让局域网和 Tailnet 内的所有节点直接通过 `collab.tailnet.cagedbird.cn` 找到本机的中继：
1. 登录香港服务器，在 Headscale `/etc/headscale/config.yaml` 中配置 `extra_records`：
   ```yaml
   dns:
     extra_records:
       - name: collab.tailnet.cagedbird.cn
         type: A
         value: 100.64.0.1
   ```
2. 为了在本机解析生效，在 Laptop 的 `sing-box-private-prod` 配置模板的 DNS 规则中，加入了对 `*.tailnet.cagedbird.cn` 后缀的分流规则，强制将其导向 `tailscale` 的 MagicDNS 适配器进行解析：
   ```json
   {
     "domain_suffix": ["tailnet.cagedbird.cn"],
     "action": "route",
     "server": "tailnet"
   }
   ```
   推送模板并执行 `sbc update`。此时，`ping collab.tailnet.cagedbird.cn` 瞬间返回 `100.64.0.1`，DNS 通路完全闭环！

---

### 第五步：Termux 证书链信任与环境变量隔离

当我们在手机 Termux 上执行 `omp join` 时，遇到了最后一个大坑：`unable to get local issuer certificate (60)` 证书不受信任。

1. **CA 证书导入**：首先，Termux 容器内部的 CA 证书链（`/usr/etc/tls/cert.pem`）是一个独立的沙盒文件，并不会读取 Android 系统凭据。我们直接把自建的 Root CA 的公钥证书追加到 Termux 的系统证书堆栈中：
   ```bash
   curl -k https://100.64.0.1/rootCA.crt >> /data/data/com.termux/files/usr/etc/tls/cert.pem
   ```
   追加后，手机上的 `curl` 可以无警告地通过 HTTPS 验证。
2. **Node/Bun 的环境变量拦截**：由于 Termux 下的 Bun 并非标准的 Linux 发行版编译，即使更新了系统 `cert.pem`，它依然会因为 leaf 证书校验不匹配抛出 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`。
   我们必须为 Node 和 Bun 进程注入 `NODE_EXTRA_CA_CERTS` 环境变量指明 CA 路径。
   
   但是我们又**绝对不想因为局部的手机运行环境而弄脏全局托管的 `.dotfiles` 配置文件**。
   
   最优雅的做法是利用 `/usr/etc/profile.d/` 系统目录（该目录下的脚本会被 Termux 的 `/etc/profile` 自动在所有 Shell 启动时执行，且完全独立于个人的 `.dotfiles` 仓库）：
   
   在手机上创建 `/data/data/com.termux/files/usr/etc/profile.d/omp-tls.sh`：
   ```bash
   export NODE_EXTRA_CA_CERTS=/data/data/com.termux/files/usr/etc/tls/cert.pem
   ```
   新开终端会话，完美！`Bun works! Status: 200`！

---

### 终极体验：全屏协同，彻底告别 tmux！

现在，在电脑上运行 OMP 并输入 `/collab`，OMP 会生成一个极简的 WSS 链接：
`wss://collab.tailnet.cagedbird.cn/r/xxxx.xxxx`
以及一个 Web 浏览器链接：
`collab.tailnet.cagedbird.cn/#collab.tailnet.cagedbird.cn/r/xxxx.xxxx`

在手机上打开 Termux，直接 `omp join` 连上。

协作开启的那一瞬间，体验震撼至极：
- **真正的 P2P 直连延迟**：由于走的是 WireGuard 直接打洞通道，字符流的传输完全是在内网直连中飞驰，**延迟低于 20ms（同局域网下低于 1ms）**。操作感如丝般顺滑。
- **独立多维排版**：手机屏幕自动按照 Termux 的纵向屏幕宽度自适应排版，电脑端按照宽屏渲染。没有了传统终端共享中由于屏幕尺寸不同导致的折行、拉伸和黑边。你可以用大屏电脑从容写代码，同时在手机上随时随地查看最新的 AI 滚动输出并随时接手编写。

![Termux 下的实时 OMP 协同协作界面](collab-termux-screenshot.webp "Termux 下的 OMP 协作效果")

这种将点对点网络物理链路（Tailscale）、自建 Root CA 证书验证、高性能前端 Web 容器（Bun/React）以及系统级特权机制（Systemd AmbientCapabilities）融合到极致的私有协同生态，或许才是黑客眼中最酷的移动编程终极形态。
