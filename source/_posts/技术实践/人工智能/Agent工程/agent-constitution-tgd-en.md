---
title: "Write a Constitution for Your Agent: A Theorem-Guided Development Manifesto"
date: 2026-07-16 01:15:00
lang: en
tags:
  - AI Agent
  - Formal Methods
  - Software Engineering
  - Harness
categories:
  - - 技术实践
    - 人工智能
    - Agent工程
---

A disclaimer before the manifesto: I made up the name Theorem-Guided Development. It may be bullshit. When I ran exact OpenAlex searches for “Theorem-Guided Development” and “Theorem-Driven Development,” I found no established method under either name. That means I did not find one, not that nobody has ever used the words.

I did not invent the machinery either. Hoare logic, Design by Contract, property-based testing, model checking, program synthesis, CEGIS, and proof-carrying code are all older than LLMs. I am borrowing those parts to draw an authorization boundary around a coding agent.

<!-- more -->

{% post_link 技术实践/人工智能/Agent工程/agent-constitution-tgd-zh '中文版' %}

## Who watches the agent after I go to sleep?

While rebuilding Brilliant Sort from black-box observations, I wrote down the rules before the implementation. The board is a finite graph with eight-neighbor adjacency. A selection must be a connected component of movable gems with the same color. Locked gems cannot move. The total number of gems, and the count of each color, must be conserved.

Once those decisions existed, the code became less sacred. An agent could replace the graph algorithm, split modules, rewrite the WASM boundary, or throw away yesterday's implementation. One problem remained: after I went to sleep, what stopped it from “fixing” the rules along with the code?

A longer prompt was not enough. A prompt usually tells an agent how to perform the current task. I wanted a project constitution: a definition of legal states, permitted transitions, required evidence, and decisions the agent is not authorized to make.

I call the idea Theorem-Guided Development, or TGD. I chose *guided* rather than *driven* because the theorem is a boundary, not a demand to invoke Coq before every pull request.

> Theorem-Guided Development starts by defining persistent properties, legal states, transitions, and observable acceptance conditions. An agent searches for candidate implementations. A harness and verifier reject candidates using tests, property checks, model checking, or machine-checked proofs. CI keeps checking after the merge.

Strictly speaking, a theorem is a proposition proved in a formal system. Most projects begin with specifications, properties, invariants, and contracts. Tests are experiments. An oracle supplies an expected result; a verifier decides whether a candidate satisfies a condition. A green harness is evidence, not a mathematical proof. “Executable theorem” is an engineering metaphor.

## A constitution is not a law of nature

In this metaphor, humans keep constituent, amendment, and release authority. Agents search for implementations and may propose amendments. The harness drives, records, and replays executions. The verifier checks candidates against the current specification. CI repeats the judgment as the system changes.

The verifier can tell whether the code is constitutional. It cannot tell whether the constitution is sane. A bad specification can produce software that is perfectly compliant and completely wrong. Michael Jackson's distinction between the world and the machine is still the relevant warning: a machine specification is not the real-world problem it attempts to describe [8].

An agent constitution must therefore be local, versioned, and amendable. Each clause needs a scope and an evidence level. What users actually need, whether a safety risk is acceptable, how to resolve value conflicts, and whether to release are not implementation chores to delegate simply because the agent is fast.

## What is old here

The proposition-first approach has a long history.

Hoare gave an axiomatic basis for reasoning about program properties in 1969 [1]. Design by Contract put preconditions, postconditions, and class invariants at module boundaries [2]. QuickCheck tested properties over generated inputs and shrank failures into useful counterexamples [3]. Model checking explored finite-state models [4]. Systems such as Sketch made the candidate-verifier-counterexample loop explicit [5]. Proof-Carrying Code required code to arrive with a safety proof that a consumer could check [6]. Correctness-by-Construction starts from a specification and refines it through correctness-preserving steps [7].

TGD is not a new formal theory. It did not invent the loop:

```text
specification -> candidate -> verification -> counterexample -> new candidate
```

A nearby name already exists. Bakharia's 2025 paper is titled *Iterative Proof-Driven Development LLM Prompt* [9]. “Proof-driven development” and an LLM prompt already share a title; my scope is broader repository autonomy, engineering harnesses, and release authority.

What changed is the executor. A general coding agent can inspect a repository, edit several languages, operate tools, run checks, and try again after a failure. *Code as Agent Harness* describes tools, state, verification, and feedback as parts of a harness [10]. *Harnessing Code Agents for Automatic Software Verification* goes further: general code agents retry from failure feedback while the Coq kernel makes the final judgment [11].

That is the only reason I think TGD deserves a name. The specification and verifier are no longer just development aids. They determine how much autonomy the agent may receive. Code is a candidate solution; evidence is the merge permit.

## Nine clauses for Brilliant Sort

The C++ Core contains `Session`, `Board`, `Command`, `Rules`, `Event`, and `Dump`. TypeScript handles input, animation, audio, and Canvas rendering through a Port to the WASM Core.

| Clause | What it really is | Possible check |
| --- | --- | --- |
| The board uses eight-neighbor adjacency | State model | Reference model, finite-graph check |
| A selection is a same-color movable component | Functional property | Property test, exhaustive small boards |
| Locked gems never move | Transition invariant | Generated command sequences |
| Total and per-color counts are conserved | State invariant | Property test, model check, or proof |
| Only `Command` may mutate `Session` | Architectural constraint | Encapsulation, static and integration checks |
| The C++ Core is the sole state authority | Architectural decision | Boundary review, integration checks |
| The same initial state and commands yield the same `Dump` | Determinism property | Replay test |
| Native and WASM produce the same `Dump` | Cross-implementation equivalence requirement | Differential test |
| A human approves release | Authority rule | CI gate and explicit approval |

The harness is intentionally boring:

```text
initial-state.json + commands.json
  -> Native C++ Core -> dump.native.json
  -> WASM C++ Core   -> dump.wasm.json
  -> compare both Dumps and the expected Dump
  -> report the smallest failing step and state difference
```

Ten thousand matching Native/WASM runs do not prove universal equivalence. They are useful differential evidence. Conservation and locked-gem behavior can be formalized over a bounded model. “C++ is the authority” is an architectural choice, not a theorem.

The interview function `FindConnectedMovableGems` does not need a separate toy implementation. It can reuse the production Core's connected-component logic, so the algorithm exercise, game rule, and acceptance harness inspect the same code. `Command` makes failures replayable; `Dump` makes differences observable.

The agent may rewrite a candidate implementation overnight. It may not edit the property, expected Dump, or verifier merely to make the run green. That requires an amendment request.

## Evidence and autonomy have levels

```text
example tests
  -> property-based testing
  -> exhaustive finite-state exploration
  -> model checking
  -> SMT / deductive verification
  -> machine-checked proof in a proof assistant
```

Property-based testing normally gives empirical confidence, not exhaustive proof. Model checking faces state-space explosion. A machine proof is still only relative to its model and specification. TGD does not require Lean, Rocq, Isabelle, or TLA+ everywhere. It does require honest labels.

| Level | Capability | Cost | Agent autonomy |
| --- | --- | --- | --- |
| 0 | Example tests only | Low | Human watches each step |
| 1 | Local properties and invariants | Low to medium | Restricted refactoring |
| 2 | Replayable `Command`, stable `Dump`, automated harness | Medium | Automatic execution and failure localization |
| 3 | Counterexample-driven repair with evidence reports | Medium to high | Human may leave the execution loop |
| 4 | Key state spaces checked by a model checker or SMT | High | More authority over valuable core logic |
| 5 | Machine-checked proofs for critical properties | Very high | Greater autonomy; release authority remains human |

A practical loop is short enough to remember:

```text
frame problem -> model state -> define properties -> build verifier/harness
-> package agent context -> implement -> execute -> extract counterexample
-> repair -> collect evidence -> human review -> CI re-verification
```

The human, agent, harness, verifier, and CI do not own the same decisions. Treating them as interchangeable defeats the point.

## Start with ten lines

You do not need a hundred-page formal specification. Create `CONSTITUTION.md` and answer these questions first:

```text
Jurisdiction:
Authoritative state source:
Legal initial states:
Legal state transitions:
Invariants that must hold:
What may change:
Stable observations and Dumps:
Oracle, verifier, and counterexample format:
Actions the agent may take without approval:
Who may amend this file, and who may release:
```

The Markdown file has no magic. Push its clauses into types, APIs, property tests, models, and proofs wherever the cost makes sense. Otherwise it is only prose waiting to be forgotten.

Also assume that an agent may overfit the harness. Separate permissions for production and verification code. Use an independent verifier for important properties. Add metamorphic or differential checks. Review constitutional amendments separately from implementation patches.

This approach fits rule-heavy cores, compilers, protocols, state machines, data transformations, and replayable workflows. It fits poorly when the work is open-ended product discovery, aesthetic judgment, organizational policy, or anything without a credible oracle. Turning ambiguity into fake mathematics does not remove the ambiguity.

My five deliberately unsolemn articles are:

1. Define the legal world before asking an agent to implement it.
2. Implementations may be replaced; changing an invariant requires amendment.
3. A test is a test, evidence is evidence, and only a proof is a proof.
4. Agent autonomy should match verification strength and operational reversibility.
5. Humans may leave the execution loop, but must retain amendment and release authority.

Someone may find a better name than TGD. Good. I made the name up anyway. The useful habit is smaller: before letting an agent work through the night, give it a constitution that can execute, produce counterexamples, and be amended by a human.

## Research honesty ledger

Existing theory supplies specifications, contracts, invariants, property testing, model checking, synthesis, CEGIS, correctness-by-construction, and proof-carrying code. The recombination connects those mechanisms to general coding agents, harnesses, CI, and automated repair. The potentially useful new engineering practice is to make verification strength an authorization policy and to ship replay traces, Dumps, logs, hashes, or machine proofs with the artifact. “Constitution,” “judgment,” and “executable theorem” are metaphors. TGD still lacks empirical evidence that it reduces defects, review cost, or agent overreach across real projects.

## References

1. C. A. R. Hoare. [An Axiomatic Basis for Computer Programming](https://doi.org/10.1145/363235.363259). CACM, 1969.
2. Bertrand Meyer. [Applying “Design by Contract”](https://doi.org/10.1109/2.161279). *Computer*, 1992.
3. Koen Claessen and John Hughes. [QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs](https://doi.org/10.1145/351240.351266). ICFP, 2000.
4. E. M. Clarke and E. A. Emerson. [Design and Synthesis of Synchronization Skeletons Using Branching Time Temporal Logic](https://doi.org/10.1007/BFb0025774). 1981.
5. Armando Solar-Lezama et al. [Combinatorial Sketching for Finite Programs](https://doi.org/10.1145/1168857.1168907). ASPLOS, 2006.
6. George C. Necula. [Proof-Carrying Code](https://doi.org/10.1145/263699.263712). POPL, 1997.
7. Tabea Bordis et al. [Correctness-by-Construction: An Overview of the CorC Ecosystem](https://publikationen.bibliothek.kit.edu/1000162644/180049339). 2023.
8. Michael Jackson. [The World and the Machine](https://doi.org/10.1145/225014.225041). ICSE, 1995.
9. Aneesha Bakharia. [Iterative Proof-Driven Development LLM Prompt](https://doi.org/10.1145/3701716.3717811). WWW Companion, 2025.
10. Xuying Ning et al. [Code as Agent Harness](https://arxiv.org/abs/2605.18747). arXiv, 2026.
11. Shuangxiang Kan, Shuanglong Kan, and Sebastian Ertel. [Harnessing Code Agents for Automatic Software Verification](https://arxiv.org/abs/2607.06341). arXiv, 2026.
