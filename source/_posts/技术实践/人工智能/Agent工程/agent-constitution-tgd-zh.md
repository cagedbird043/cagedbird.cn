---
title: 先给 Agent 写一部宪法：定理驱动开发宣言
date: 2026-07-16 01:14:00
lang: zh-CN
tags:
  - AI Agent
  - 形式化方法
  - 软件工程
  - Harness
categories:
  - - 技术实践
    - 人工智能
    - Agent工程
---

先声明：「定理驱动开发」这个名字是我瞎鸡巴扯的。我写这篇文章时用 OpenAlex 精确检索了 Theorem-Guided Development 和 Theorem-Driven Development，没有找到已经成体系的同名方法。这只能说明我没查到，不能证明从来没人说过。

周围的砖更不是我烧的：Hoare Logic、Design by Contract、Property-Based Testing、模型检查、程序综合、CEGIS、Proof-Carrying Code，哪一块都比 LLM 老。我要做的只是把它们搬到 Agent 时代，围出一条权限边界。

<!-- more -->

{% post_link 技术实践/人工智能/Agent工程/agent-constitution-tgd-en 'English version' %}

## 人睡了以后，谁来盯着 Agent

我在重做 Brilliant Sort 时，先从黑盒玩法里抽出了一组规则：棋盘是有限图，采用八方向邻接；选择结果必须是同色、可移动的连通分量；锁定宝石不能移动；宝石总量和每种颜色的数量都要守恒。

这些东西确定后，具体实现反而没那么神圣。Agent 可以换算法、拆模块、重写 WASM 接口，甚至把昨天的代码全部扔掉。问题是，人睡了以后，谁来阻止它顺手把规则也「修」了？

更长的 Prompt 不够。Prompt 通常告诉 Agent 这次怎么干，我需要的是一部项目宪法：它规定哪些状态合法、哪些转移允许、什么证据才能合并，以及哪些决定 Agent 没资格做。

我把这套方法暂时叫作 Theorem-Guided Development，简称 TGD。英文用 Guided 而不是 Driven，因为定理在这里是边界，不是要求每个项目开工前先请出 Coq。

> 定理驱动开发：人类先定义系统应长期保持的性质、合法状态空间、状态转移和可观察验收条件；Agent 搜索候选实现；Harness 与 Verifier 用测试、性质检查、模型检查或机器证明排除错误候选；CI 持续重验。

严格来说，theorem 是在某个形式系统中被证明的命题。普通项目里更多的是 specification、property、invariant 和 contract。测试是实验，oracle 给出期望，verifier 作出判定。Harness 全绿是验证证据，不会因为颜色好看就升级成数学证明。「可执行定理」只是工程隐喻。

## 宪法不是宇宙真理

这套比喻里，人类拥有制宪权、修宪权和发布权；Agent 负责寻找实现，也可以提交修宪建议；Harness 驱动、记录和重放；Verifier 判断候选是否满足当前规格；CI 在后续变更中重新判决。

但 Verifier 只能判断代码是否合宪，不能判断宪法是否正常。规格把现实理解错了，Agent 完全可能交付一个严格合宪、彻底错误的系统。Jackson 在 1995 年讨论需求与规格时就指出，机器描述和现实世界问题不是同一件事[8]。

所以一部 Agent 宪法必须是局部的、带版本的、可以修订的。每条规则还应该写明适用范围和保证等级。用户真正需要什么、安全风险是否可接受、审美冲突怎么处理、是否允许发布，这些决定不能因为 Agent 跑得快就交出去。

## 这套东西哪里不新

「先写性质，再找实现」早已有完整谱系。

Hoare 在 1969 年给出了推理程序性质的公理化基础[1]；Meyer 的 Design by Contract 把前置条件、后置条件和类不变量放进模块接口[2]；QuickCheck 用随机生成输入检查程序性质，并把失败输入缩成更小的反例[3]；模型检查可以穷举有限状态模型[4]。Sketch 一类程序综合工作把循环写得更直接：规格产生候选，验证器给出反例，再继续搜索[5]。Proof-Carrying Code 则要求代码附带消费者可以检查的安全证明[6]。

Correctness-by-Construction 更是规格先行，再按保持正确性的规则逐步精化实现[7]。所以 TGD 不是新的形式理论，也没有发明「规格 → 候选 → 验证 → 反例」这个循环。

相近名字倒是已经出现过：Bakharia 在 2025 年发表了 *Iterative Proof-Driven Development LLM Prompt*[9]。「proof-driven development」已经和 LLM Prompt 放在同一个标题里；我这里谈的是更宽的代码库自治、工程 Harness 和发布权限。

Agent 时代多出来的是一个不太听话但很能干的通用执行者。它能读完整代码库、改多种语言、调用工具、跑测试，再根据失败日志重来。2026 年的 Code as Agent Harness 把工具、状态、验证和反馈循环放进统一的 Harness 视角[10]；Harnessing Code Agents for Automatic Software Verification 已经让通用代码 Agent 在 Coq kernel 的判决下根据失败反馈自动重试[11]。

因此我愿意给 TGD 单独起名的理由只有一个：规格与 Verifier 不再只是开发工具，它们开始决定 Agent 可以获得多少自治权。代码是候选解，证据才是合并许可。

## Brilliant Sort 的九条宪法

我的 C++ Core 里有 Session、Board、Command、Rules、Event 和 Dump。TypeScript 只处理输入、动画、音效和 Canvas 渲染，通过 Port 调用 WASM Core。核心条款如下：

| 条款 | 它实际是什么 | 怎么检查 |
| --- | --- | --- |
| 棋盘采用八方向邻接 | 状态模型 | 参考模型、有限图检查 |
| 选择结果是同色、可移动的连通分量 | 功能性质 | Property Test、穷举小棋盘 |
| 锁定宝石不能移动 | 转移不变量 | 生成命令序列，逐步检查 |
| 宝石总量和各颜色数量守恒 | 状态不变量 | Property Test、模型检查或证明 |
| 只有 Command 能改变 Session | 架构约束 | 封装、静态检查、集成测试 |
| C++ Core 是唯一权威状态源 | 架构决策 | 边界审查、集成测试 |
| 相同初态和命令序列产生相同 Dump | 确定性性质 | 重放测试 |
| Native 与 WASM 产生一致 Dump | 跨实现等价要求 | 差分测试 |
| 发布必须由人批准 | 权限规则 | CI 门禁和人工批准 |

Harness 很笨，反而可靠：

```text
initial-state.json + commands.json
  -> Native C++ Core -> dump.native.json
  -> WASM C++ Core   -> dump.wasm.json
  -> 比较两个 Dump，再与 expected dump 比较
  -> 输出最小失败步骤和状态差异
```

Native/WASM 跑一万组都一致，依然不是二者永远等价的证明；它只是很有用的差分证据。总量守恒、锁定不可移动等性质可以在有限模型中进一步形式化。C++ 是权威状态源则是架构选择，不是数学定理。

笔试里的 `FindConnectedMovableGems` 也不再单独写一份「标准答案」。它直接复用生产 Core 的连通分量逻辑，算法题、游戏规则和自动验收检查的是同一个实现。Command 让失败可重放，Dump 让差异可观察。Agent 夜里可以重写候选代码，但不能为了变绿去改性质、expected dump 或 Verifier，除非先申请修宪。

## 保证有等级，自治也该有等级

```text
具体样例测试
  -> Property-Based Testing
  -> 有限状态空间穷举
  -> 模型检查
  -> SMT / 演绎验证
  -> 证明助手中的机器检查证明
```

Property-Based Testing 通常只提供经验性置信度；随机跑过不等于穷尽。模型检查受状态空间爆炸限制。机器证明也只是「相对于模型和规格正确」。TGD 不要求所有项目上 Lean、Rocq、Isabelle 或 TLA+，但必须把证据叫什么说清楚。

| Level | 能力 | 成本 | Agent 自治权 |
| --- | --- | --- | --- |
| 0 | 只有样例测试 | 低 | 每步都要人盯 |
| 1 | 有局部性质和不变量 | 低到中 | 可做受限重构 |
| 2 | Command、Dump、可重放 Harness | 中 | 可自动执行和定位失败 |
| 3 | 根据反例修复并携带验证报告 | 中到高 | 可离开人类执行循环 |
| 4 | 关键状态空间经过模型检查或 SMT | 高 | 可操作高价值核心，但仍有限权 |
| 5 | 关键性质有机器检查证明 | 很高 | 可授予更大自治，发布权仍在人 |

合理的循环是：问题界定 → 状态建模 → 性质 → Oracle/Verifier → Harness → Agent 上下文 → 候选实现 → 自动执行 → 最小反例 → 修复 → 收集证据 → 人类审查 → CI 重验。不是每一步都由 Agent 负责，也不该由它负责。

## 先写十行

真要动手，不用先写一百页形式规格。建一个 `CONSTITUTION.md`，先回答这些问题：

```text
管辖范围：
权威状态源：
合法初始状态：
合法状态转移：
必须保持的不变量：
允许变化的内容：
稳定的观察与 Dump：
Oracle、Verifier 和反例格式：
Agent 可以自主做什么：
谁能修宪，谁能批准发布：
```

这份文件本身没有魔力。规则最好尽量落进类型、接口、Property Test、模型或证明里，否则它仍然只是一篇会被遗忘的散文。还要防 Agent 针对 Harness 作弊：生产代码和测试的修改权限分开，Verifier 使用独立实现，重要性质做变形测试或差分检查，修改宪法必须单独审查。

有些项目很适合这套方法：游戏核心、编译器、协议、状态机、数据转换和可重放工作流。开放式产品探索、审美创作、组织决策以及没有可靠 Oracle 的任务，硬写成定理只会制造伪精确。

最后留五条不太庄严的宣言：

1. 先定义合法世界，再让 Agent 写实现。
2. 实现可以重写；改不变量要走修宪程序。
3. 测试叫测试，证据叫证据，证明才叫证明。
4. Agent 的自治权应与验证强度、操作可逆性相匹配。
5. 人类可以离开执行循环，但必须保留制宪权和发布权。

TGD 这个名字以后也许会被更好的名字替掉，没关系。名字本来就是我瞎扯的。真正值得留下的是习惯：下次准备让 Agent 通宵之前，先给它写一部会执行、会判错、也允许人类修订的宪法。

## 研究诚实性账单

已有理论：规格、契约、不变量、性质测试、模型检查、程序综合、CEGIS、正确性构造和携证代码。重新组合：把这些机制接到通用代码 Agent、Harness、CI 和自动反例修复循环上。可能值得单独讨论的新实践：把验证强度当作 Agent 自治授权的依据，并让交付携带 Dump、重放记录、日志、哈希或机器证明。隐喻部分：「宪法」「判决」「可执行定理」。目前缺的证据：TGD 是否真的能降低缺陷率、审查成本和 Agent 越权率，还需要项目数据，不靠宣言解决。

## 参考文献

1. C. A. R. Hoare. [An Axiomatic Basis for Computer Programming](https://doi.org/10.1145/363235.363259). CACM, 1969.
2. Bertrand Meyer. [Applying “Design by Contract”](https://doi.org/10.1109/2.161279). Computer, 1992.
3. Koen Claessen, John Hughes. [QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs](https://doi.org/10.1145/351240.351266). ICFP, 2000.
4. E. M. Clarke, E. A. Emerson. [Design and Synthesis of Synchronization Skeletons Using Branching Time Temporal Logic](https://doi.org/10.1007/BFb0025774). 1981.
5. Armando Solar-Lezama et al. [Combinatorial Sketching for Finite Programs](https://doi.org/10.1145/1168857.1168907). ASPLOS, 2006.
6. George C. Necula. [Proof-Carrying Code](https://doi.org/10.1145/263699.263712). POPL, 1997.
7. Tabea Bordis et al. [Correctness-by-Construction: An Overview of the CorC Ecosystem](https://publikationen.bibliothek.kit.edu/1000162644/180049339). 2023.
8. Michael Jackson. [The World and the Machine](https://doi.org/10.1145/225014.225041). ICSE, 1995.
9. Aneesha Bakharia. [Iterative Proof-Driven Development LLM Prompt](https://doi.org/10.1145/3701716.3717811). WWW Companion, 2025.
10. Xuying Ning et al. [Code as Agent Harness](https://arxiv.org/abs/2605.18747). arXiv, 2026.
11. Shuangxiang Kan, Shuanglong Kan, Sebastian Ertel. [Harnessing Code Agents for Automatic Software Verification](https://arxiv.org/abs/2607.06341). arXiv, 2026.
