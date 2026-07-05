---
title: Unicode Snapcompact F1：我把长上下文塞进了图片里
date: 2026-07-05 23:40:00
tags:
  - AI
  - VLM
  - Benchmark
  - LongBench
  - Snapcompact
categories:
  - - 技术实践
    - 人工智能
    - 计算机视觉
    - 模型理论与实践
---

这件事一开始听起来很离谱：既然大模型的长上下文越来越贵、越来越容易浪费，那能不能把一大段 Unicode-heavy 的开发上下文，直接渲染成图片，让 VLM 去读？

不是 OCR demo，不是把一句话截图给模型玩，也不是“看起来好像能读”的主观截图。而是一个更工程化的问题：**同一份长上下文，如果纯文本是上限，那么图片载体能保留多少可用信息？**

<!-- more -->

我最后给这个实验起了个名字：

```text
Unicode Snapcompact F1 Benchmark, USF1
```

这个名字有点中二，但意思很直接：

```text
用 F1 衡量 Unicode-heavy 上下文被压进图片以后，还剩多少可恢复的任务效用。
```

先放结果图。

![USF1 v0.1 preset frontier](usf1-v0.1-frontier.png "USF1 v0.1 preset frontier")

这张图是目前整个实验最核心的一张图。横轴是 35 个 LongBench case 被渲染成多少张 2000×2000 图片，越靠左越密；纵轴是 eligible F1，越高表示越接近纯文本上限。

当前最好的质量 preset 是：

```text
zpix24-binary-2000
```

它在 Gemini 3.5 Flash 上，保留了纯文本 baseline 的 **91.0% eligible F1**，平均每张图承载大约 **7.7k chars**。另一个更密的 preset 是：

```text
zpix18-half-049-2000
```

它能做到 **11.3k chars/frame**，但 eligible F1 降到 **84.5%**。所以现在有了一个很清晰的 tradeoff：

```text
zpix24 = quality preset
zpix18 = density preset
```

## 问题不是 OCR，而是 token 浪费

最近所有人都在谈长上下文。

窗口越来越大，百万 token、千万 token，看起来像是把“遗忘”问题解决了。但工程上很快会遇到另一个问题：**上下文窗口不是垃圾桶**。

一次真实开发会话里，混着：

- 中文需求；
- 英文日志；
- 路径；
- 命令；
- 模型名；
- 版本号；
- 错误信息；
- 中途纠偏；
- 最终决策。

很多内容不是代码本体，不值得长期占着昂贵文本 token；但它又确实是“上下文记忆”的一部分，后面可能要回忆。

传统路线有三种：

1. 截断：粗暴，容易丢关键历史。
2. 总结：省 token，但会引入幻觉和语义漂移。
3. RAG：适合知识检索，不一定适合会话状态恢复。

我想试第四种：

```text
visual context compaction
```

把大段历史变成一组极高密度、模型可读的图片。文本 prompt 只保留问题和少量控制信息，长上下文主体走视觉通道。

听上去像歪门邪道。结果还真能跑。

## 第一次真正的坑：我们自己的 gold 是错的

这个实验最有价值的时刻，不是跑出了好看的图，而是发现 benchmark 自己翻车了。

一开始我拿真实 OMP 会话导出了一份 CJK-heavy archive，做了 12 条 QA。结果看起来 `zpix18` 比 `zpix24` 好。

后来我盯着一条结果，发现不对。

模型回答：

```text
我们不写论文，我们直接做实验，数据也是面向大家公开
```

gold 写的是：

```text
不写论文，直接做实验，公开数据
```

这看起来只是 F1 不高，但其实模型回答更忠实原文。更严重的是，旧 gold 里还混过一句漏掉“不”的版本：

```text
写论文，直接做实验
```

而源文真实是：

```text
我们不写论文，我们直接做实验，数据也是面向大家公开地
```

这不是小误差。这是 benchmark 裁判污染。

从这一步开始，旧数据全部作废。后来我给 QA 加了几条硬规则：

- semantic gold 必须能在源文里定位，或者明确标注为人工等价改写；
- 否定词、数量词、方向词不能省；
- LongBench track 主指标用 F1-first，`correct` 只作为保守诊断；
- text baseline 做不好的 case，不拿来评价图片压缩损失。

这次翻车反而是整个项目的转折点。没有这个纠偏，后面所有漂亮数字都不可信。

## 第二个关键发现：zpix 的阈值不是玄学

字体也不是随便挑的。

最后收敛到 `zpix`，不是因为它看起来复古，而是因为它是一个 12px 基准的 CJK 像素字体。渲染行为可以用一个很简单的比例解释：

```text
scale = font_size / 12
```

当字号是 24px：

```text
24 / 12 = 2.0
```

这是整数倍缩放。像素边界对齐，coverage 基本就是二值的：要么 0，要么 1。threshold 几乎不影响结果，所以 `zpix24` 看起来非常清楚、稳定。

当字号是 18px：

```text
18 / 12 = 1.5
```

这是半整数倍缩放。很多边缘像素会落在 0.5 coverage 上。我们的 renderer 判断是：

```rust
coverage > threshold
```

所以：

```text
threshold = 0.49 -> 0.5 像素保留
threshold = 0.50 -> 0.5 像素消失
```

这就解释了为什么 `zpix18 t0.49` 清楚，而 `t0.50` 会突然断笔。

后来我直接加了 coverage cliff analyzer。实测在真实 OMP archive 上，`zpix18` 的 `coverage=0.5` bucket 占 covered pixels 大约 **42.3%**。

所以这个不是“调参手感”，是栅格物理。

## 为什么要引入 LongBench

只用自己的 OMP 会话数据，很容易被质疑：

```text
你是不是专门调了一个对自己数据有利的 benchmark？
```

所以 v0.1 我接了 LongBench subset。

抽样规则很简单：7 个任务，每个取前 5 条，一共 35 case：

```text
multifieldqa_zh
Dureader
passage_retrieval_zh
multifieldqa_en
hotpotqa
lcc
repobench-p
```

这覆盖了中文、英文、检索、多文档 QA、代码上下文。它不是完美数据集，但作为 v0.1 很合适：公开、可复现、足够真实。

评测时有两种 carrier：

```text
text baseline: context.txt 直接作为文本给模型
image preset: context.txt 渲染成图片，只给模型图片和问题
```

注意，问题本身不是塞进图片里的。问题留在普通文本 prompt 里，只有长 context 被压缩到图片里。否则模型要先在图片里找题目，再回答问题，这测的就不是上下文压缩了。

## 为什么要有 eligible F1

LongBench 不是每一题 Gemini 3.5 Flash 都会做。

如果 text baseline 自己都答错，那么图片答错不能算“图片压缩失败”。所以我加了 baseline gate：

```text
只有 text baseline F1 >= 0.7 的 case，进入 eligible F1 主榜。
```

text baseline 做不好的 case 进入 hard / error-analysis bucket。

这一步很重要。否则你会把“模型本来不会做”的题，错怪到图片上。

最终结果：

| run | eligible F1 | eligible cases | avg F1 | correct | frames | chars/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| text-baseline | 0.9624 | 18/35 | 0.6214 | 14/35 | 0 | 0.0 |
| zpix24-binary-2000 | 0.8753 | 18/35 | 0.6228 | 12/35 | 111 | 7667.6 |
| zpix18-half-049-2000 | 0.8132 | 18/35 | 0.6088 | 10/35 | 73 | 11318.6 |

所以当前最有传播力的一句话是：

```text
在 LongBench subset 上，zpix24 图片载体保留了 91.0% 的纯文本 eligible F1。
```

这不是说图片比文本好。文本仍然是上限。

它真正说明的是：**一组 2000×2000 的 Unicode bitmap frames，已经能保留相当高比例的任务效用。**

## 三条命令复现

当前仓库在这里：

```text
https://github.com/cagedbird043/cjk-visual-context-bench
```

有了 LongBench `data.zip` 后，核心流程就是：

```bash
bun scripts/import-longbench-subset.ts \
  --raw-dir .cache/longbench/data \
  --out fixtures/longbench/usf1-v0.1-longbench-subset \
  --per-task 5
```

```bash
bun scripts/usf1-bench-run.ts \
  --manifest fixtures/longbench/usf1-v0.1-longbench-subset/manifest.json \
  --out runs/usf1-v0.1 \
  --mode image \
  --preset zpix24-binary-2000 \
  --omp-gateway \
  --model google-antigravity/gemini-3.5-flash \
  --max-tokens 220
```

```bash
bun scripts/usf1-bench-summarize.ts \
  --run-dir runs/usf1-v0.1 \
  --out runs/usf1-v0.1 \
  --baseline-threshold 0.7
```

严格说，完整复现还要跑 text baseline 和 zpix18 对照；但“导入数据、跑一个 preset、汇总结果”的骨架就是这三步。

## 这件事现在还不能吹什么

必须说清楚，现在还不能吹：

```text
真实 token 成本已经降低了多少
```

因为不同厂商的图片 token 计费方式不一样。现在我只报告可复现的 carrier proxy：

```text
frames
chars/frame
eligible F1 retention
```

真正的 token usage / cost accounting 要等后面接入 provider-reported image tokens 或可靠估算。

也不能说它已经可以直接替代所有长上下文。代码 exact、路径、hash、密钥、patch 这类 byte-exact 信息，仍然需要文本锚点或 raw fallback。图片适合承载大块语义上下文，不应该被拿来背所有精确值责任。

## 后面想做什么

我觉得这个方向已经不是玩具了。

下一步最值得做的是三件事：

1. **多模型表**：Gemini 3.5 Flash 只是第一行。后面可以加入 GPT-5.5 vision、Claude vision、Qwen/InternVL。
2. **token usage**：加真实 provider token 或统一估算，做 `F1 per 1k token`。
3. **OMP 集成**：把 `zpix24-binary-2000` 作为 quality preset，`zpix18-half-049-2000` 作为 density preset，接到真正的 snapcompact 流程里。

我最喜欢这个实验的一点是，它不是在说“视觉模型会 OCR”。

它在问一个更工程的问题：

```text
长上下文压缩，应该按窗口大小炫耀，还是按每 token 能保留多少可用任务效用来衡量？
```

如果未来大家都开始限制 token 浪费，这个问题会越来越现实。

这次先把图画出来，把 benchmark 跑起来，把第一个 frontier 点钉住。后面再让更多模型上榜。
