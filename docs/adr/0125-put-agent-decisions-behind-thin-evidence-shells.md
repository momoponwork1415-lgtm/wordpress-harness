---
status: accepted
---

# Put agent decisions behind thin evidence shells

Target Selection、Research、Independent Validationでは、HarnessがAIの判断手順を固定stage、role、rubric、ranking ruleまたはprovider-neutralなtool DSLとして再実装しない。Harnessは入力、権限、Budgetとruntime identityを固定し、Receipt、evidence、terminal stateとfailureを検査して記録する。AIはsourceからTargetの優先順位、仮説、読む順序、native subagent、candidate、継続、停止と反証方法を決める。

Researchのexternal seamは一Campaignを所有する`conduct / inspect`だけにし、その内側でNative Agent Runtimeをprovider固有Adapterとして呼ぶ。callerへFinder、Wave、Depth、Approach Family、CriticまたはValidation Queueを公開せず、provider内部のagent topologyも共通Interfaceへ写さない。これによりHarnessは研究判断ではなくauthority、evidenceとfailure semanticsへ集中できる。

具体的でsource-boundな次手があればRoot Agentが継続し、有望なactionable frontierがなければ理由付きで停止する。SQLi、Stored XSS、authorization failure等はRCEへ伸びなくてもValidation Candidateになれる。Independent Validationだけが`source-validated` Findingを生成し、Findingの有無とCoverage completionは分離する。

旧role orchestration、legacy replay、feature flagまたは未使用Adapterは現行binaryへ残さず、Git tagと旧storageで復元する。安全隔離、append-only record、provenance、外部Budget enforcementと人間のexternal-action gateはthin evidence shellの一部として維持する。
