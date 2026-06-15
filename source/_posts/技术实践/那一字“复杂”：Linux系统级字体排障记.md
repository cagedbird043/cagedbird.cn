---
title: 那一字“复杂”：Linux 系统级字体排障记
date: 2026-06-16 02:00:00
tags:
  - Linux
  - Fontconfig
  - Chrome
  - 排障
  - 血压
categories:
  - 技术实践
---

有些问题，原本以为只是个小打小闹的配置微调。

就比如 Linux Chrome 下 claude.ai 网页的中文字体显示异常。按理说，写几行 Fontconfig 配置，把网页衬线字体栈（如 Georgia, Tiempos）强制重定向到无衬线的思源黑体（Noto Sans CJK SC）就完事了。

但现实永远比“按理说”要诡异得多。

重新加载了配置，重启了 Chrome，结果拉开 Claude 的页面一看，血压直接上来了：
“确实会 segfault” 里的 “实” 字，以及 “复杂时” 里的 “复杂”，在满屏清爽的思源黑体里，依然顽固地显示为带有尖锐修饰角的宋体。

更要命的是，“复杂”这两个字，在屏幕上呈现出一种极度不协调的姿态——“复”字是正常的宽字，而“杂”字却极度窄缩，挤在旁边。一宽一窄，看得人想直接砸键盘。

这已经不是简单的“没有生效”了。这是系统底层字形渲染的鬼故事。

<!-- more -->

### 阶段一：顺藤摸瓜，真凶竟是“等线”本身

我们首先怀疑是 Fontconfig 规则覆盖不够，或者 Chrome 没有正确走 Fallback。

为了彻底排查，我们写了一个 Python 脚本，直接绕过浏览器的复杂排版引擎，用 PIL 库强制加载系统里从 Windows 拷贝过来的 `等线 (Deng.ttf)` 字体文件，并把“试实瞎出确实会”几个字渲染成一张纯净的图片。

结果让我们大跌眼镜。

在导出的图片中，`瞎`、`出` 等大部分汉字确实呈现出等线字体原本的无衬线（Sans-serif）姿态，然而 **`试` 和 `实` 这两个字，在等线字体文件内部，竟然直接带有极其明显的三角形衬线角和横细竖粗的宋体特征！**

这说明了什么？这套不知从哪里下载、被塞进系统级目录 `/usr/local/share/fonts/WindowsFonts` 下的等线字体包，其内部字形库本身就是损坏的（或者是早期第三方打包者在合并不完整字库时，用宋体字形强行占位合并进去的“缝合怪”）。只要系统调了等线字体，这两个字就注定会以宋体渲染，任何 Fallback 逻辑都无济于事。

### 阶段二：一宽一窄，日文 UI 字体的“降维打击”

那“复杂”一宽一窄又是什么鬼？

我们继续使用 Headless Chrome 和 PIL 渲染对比测试，逐个排查系统里安装的其他 Windows 字体，最终在 **`Yu Gothic UI`（游黑体 UI）** 这款日文字体上抓到了现行。

在 `Yu Gothic UI` 渲染“复杂”时，诡异的一幕发生了：
* **`复`（U+52CD）**：由于它是 Simplified Chinese 简体汉字，在日语汉字（JIS 字符集）中不存在，`Yu Gothic UI` 无法渲染，Chrome 只好将其 fallback 到系统默认的**思源黑体**（呈现为正常的全角宽度）。
* **`杂`（U+6742）**：刚好被收录在日文游黑体的字符集里。而作为一款专门为日语界面设计的 Proportional UI（比例宽度）字体，`Yu Gothic UI` 内部把这个字设计得极窄。

这就导致在同一行文字中，`复` 走了思源黑体（正常宽），`杂` 走了日文字体（极窄），生生在屏幕上拼凑出了这个一宽一窄的排版惨剧。

### 阶段三：全量引入 Windows 字体包的代价

更深的病灶还在后面。

我们排查了 `/usr/local/share/fonts/WindowsFonts` 目录，发现里面林林总总躺了 149 个文件，体积高达 **373MB**。这是把整个 Windows 的 Fonts 目录一股脑塞了进来。

在 Linux 下直接这么干无异于灾难：
1. **系统界面卡顿**：KDE 系统设置中心（`systemsettings`）在启动、切换主题或打开字体配置页面时，Fontconfig 需要同步扫描并索引这 370MB+ 的复杂 TTC/TTF 字体包，直接造成 Qt/UI 线程的严重阻塞。
2. ** fallback 链混乱**：大量的日韩文比例 UI 字体、旧版点阵字体在系统底层互相冲突，导致浏览器在回退匹配时完全处于抽风状态。

### 阶段四：去伪存真，系统级字体管理的最佳实践

这一次，我们不再做头痛医头、脚痛医脚的 Workaround，而是直接“去了根”：

#### 1. 彻底物理清除冲突源
使用 root 权限，直接将系统目录下臃肿的 `/usr/local/share/fonts/WindowsFonts` 彻底删除。KDE 系统设置瞬间恢复了丝滑，切换页面再无卡顿。

#### 2. 精准白名单与用户级管理
对于本地 WPS 办公和跨平台文档交互所必需的微软兼容字体，我们制定了**白名单**。
我们直接挂载了纯净官方的 Windows 11 Enterprise LTSC 系统镜像，用 7z 提取出其中绝对干净、无损的 7 个核心中文字体（宋/黑/楷/仿宋/微软雅黑）及常用核心西文字体（Segoe UI, Arial, Times New Roman 等共 57 个文件，约 95MB），安全地放置在用户级目录下：
`~/.local/share/fonts/win-fonts/`

#### 3. 极致精简 Fontconfig
因为清理了物理冲突源，我们删除了 `fonts.conf` 中两百多行多余的特定字体强行 prepend 规则，最终只保留了一个针对 generic `serif`（衬线体）通用类的强拦截规则：

```xml
<match target="pattern">
 <test compare="eq" ignore-blanks="true" name="family" qual="any">
  <string>serif</string>
 </test>
 <edit binding="strong" mode="prepend" name="family">
  <string>Noto Sans CJK SC</string>
 </edit>
</match>
```

这是因为 Chrome 在匹配类似 `Georgia` 或 Claude 自带的 `Tiempos` 网页衬线字体时，如果发现本地没有（或有西文但无中文），会直接跳过西文 Fallback 链，直接向 Fontconfig 请求通用 `serif` 类的回退。我们在此处强行拦截并 prepend 思源黑体，完美实现了网页衬线字体栈下的中文全部渲染为干净、等宽的思源黑体。

### 阶段五：终极对决，破案 Claude.ai 网页端的“日字硬编码”

然而，故事到这里并没有彻底结束。

当我们重新载入配置，再次打开 Claude.ai 页面时，大部分中文字体确实正常了，但“复制”的“复”字居然还是呈现为诡异的窄体。

这不科学。我们直接在浏览器中打开 F12 开发者工具，选中该字并在右侧 **`计算样式 (Computed)`** 最底部查看 **`已渲染的字体 (Rendered Fonts)`**，抓到了最终的隐形元凶：
**`Noto Sans CJK JP` (Japanese)**

这极其诡异：我们在系统 Fontconfig 里已经把中文优先级提到了最高，为什么 Chrome 在渲染这个网页时，依然死死咬住日文字体不放？

#### 破案：傲慢的 CSS 硬编码

经过排查，我们终于发现了导致这桩冤案的终极真相：**根本不是浏览器的 Fallback 机制出了问题，而是 Claude.ai 网页端的前端开发人员，直接在全局 CSS 样式表里把日语字体给硬编码（Hardcode）写死了！**

在 Claude 网页端的全局样式中，用于渲染对话文本的 CSS 变量 `--font-anthropic-serif` 里，赫然写着：
`font-family: ..., "Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans CJK JP", ...;`

因为 CSS 显式指定了 `"Noto Sans CJK JP"`，浏览器便直接绕过了所有的系统默认 fallback 链，强行去请求日文字体。而日文字体为了兼顾日文排版，把“复”字设计成了不等宽的比例窄字，从而在中文上下文中制造了这起排版惨剧。

#### 终极解法：油猴脚本 + 字体分流

找到了病灶，解决起来就非常简单了。我们直接采用**“网页级 CSS 净化 + 系统级 Fontconfig 分流”**的双剑合璧方案：

1. **网页级净化（大救星脚本）**：
   安装开源油猴脚本 [claude-ai-cjk-font-fix](https://github.com/CatMe0w/claude-ai-cjk-font-fix)。
   该脚本会拦截并重写 Claude.ai 网页端的 CSS，将硬编码的日文字体彻底剔除，还原成干净的西文衬线回退栈。这样一来，浏览器在遇到中文时，就会重新老老实实地走系统的 Fontconfig fallback 逻辑。
   
2. **系统级分流（双轨制 Fallback）**：
   如果我们在系统里一刀切把所有日文字体封杀，会导致我们在阅读原生日语网页时也看不到原汁原味的日文字形（如“気”字等日语汉字风格发生变化）。因此，我们在用户级 `fonts.conf` 中设计了一套基于请求语言的动态分流规则：
   
   ```xml
   <!-- sans-serif 针对日语网页优先走 JP 变体 -->
   <match target="pattern">
    <test compare="eq" name="family">
     <string>sans-serif</string>
    </test>
    <test compare="contains" name="lang">
     <string>ja</string>
    </test>
    <edit binding="strong" mode="prepend" name="family">
      <string>Noto Sans CJK JP</string>
    </edit>
   </match>
   
   <!-- sans-serif 在其他网页下默认首选走 SC 变体 -->
   <match target="pattern">
    <test compare="eq" name="family">
     <string>sans-serif</string>
    </test>
    <test compare="not_contains" name="lang">
     <string>ja</string>
    </test>
    <edit binding="strong" mode="prepend" name="family">
     <string>Noto Sans CJK SC</string>
    </edit>
   </match>
   ```

在这套方案的加持下：
- **在 Claude 页面上**：日文字体被油猴脚本剔除，系统 Fallback 自动接管，最终以中国设计师专门调校的 `Noto Sans CJK SC` 渲染，中文字体全部恢复端端正正、完全等宽的方块字姿态。
- **在日语页面上**：由于声明了 `lang="ja"`，系统依然会精准加载原汁原味的 `Noto Sans CJK JP`，假名与日语汉字字形毫发无损。

#### 🔍 渲染效果对比

**修复前：经典的 Windows SimSun 衬线体回退效果（字形干瘪、刺眼）：**
![Windows SimSun 坏字体渲染效果](font-comparison-bad.webp "Windows SimSun 坏字体")

**修复与网页 CSS 净化后：端正、饱满、绝对等宽的思源黑体（SC）字形效果：**
![思源黑体好字体渲染效果](font-comparison-good.webp "思源黑体好字体")

### 结语

折腾完这一遭，重启 Chrome。

网页上的中文终于呈现出统一、干练、清晰的思源黑体，“试”和“实”不再带有突兀的衬线，“复杂”两个字也规规矩矩地回到了相同的宽度。

在 Linux 下折腾字体，最忌讳的就是“以多为美”。为了所谓的兼容性，把整个 Windows 字体库打包塞给 Linux，只会让本就敏感的 Fontconfig fallback 链支离破碎，甚至拖慢整个桌面环境的流畅度。

精简配置，白名单引入，强力劫持通用类。这才是 Linux 字体治理的终极之道。
