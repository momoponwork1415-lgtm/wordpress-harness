---
status: accepted; Finder role and count mechanics superseded by ADR 0125
---

# Keep Finder methods free behind a deterministic Evidence Shell

> Finder数だけは[ADR 0116](0116-use-four-finder-slots-per-depth-wave.md)により最大4へ変更された。以下の「最大3個」はこのADR採択時の履歴である。

Finderへ`entry-forward`、`sink-backward`、`state-chain`等の固定手順を実行させない。これらは重複を避ける開始時のlensまたは観測用labelに限り、FinderはimmutableなTarget Snapshot全体から独立したattack/research idea familyを作り、読む順序、pivot、機能間の接続、不足linkの追跡を自由に決める。

Harnessが決定論的に所有するのはTarget、隔離、予算、最大並列数、source provenance、typed artifact、fresh Verification、記録、停止である。source navigationはmanifest-boundな`list / search / read`を最小核とし、Surface Map、symbol、call graphは探索を助ける任意のenrichmentとcoverage artifactにする。Surface Mapの完成度またはnode存在を、探索開始や新しいsource-bound route提出の必須条件にしない。

脆弱性探索の主経路はraw sourceに対するmodel reasoningと、Snapshot-boundな`glob / grep / read`である。Surface Map、AST、Semgrep、CodeQL、個別scriptは候補seed、coverage、発見済みpatternの横展開、regressionへ補助的に使い、それらのnon-matchを安全またはclosureの証拠にしない。Map外pathは常に探索可能で、Map nodeを持たないsource-anchored candidateも取込めなければならない。

Mapあり/なしのoracle-separated benchmarkで、Map提示が探索範囲またはmodel attentionを狭め、raw-source Finderよりrecallを落とす状態が繰り返される場合、Surface MapをFinder inputから廃止する。廃止後もoffline coverageと後段pattern expansionには利用できる。Map completionを実戦投入のcritical pathへ戻さない。

Defaultの最初のDiscovery Waveは`raw-source` Context Profileとし、Surface Map excerpt、node priority、AST-derived routeをFinderへ見せない。独立familyがterminal artifactを作った後にだけ、別の`map-assisted-coverage` Waveが未探索surfaceを探せる。後段Map agentは候補とcoverage debtを追加できるが、raw-source routeを削除、downgrade、またはnon-matchだけで反証できない。PHPのstring hook、dynamic callback、conditional include、magic method、cross-request database state、PHP/HTML/browser parser境界等、ASTが表現しないpathも常にin-scopeである。

一つのWork WaveではRoot Plannerが最大3個の独立idea familyを割り当てる。Finder同士は会話せず、Wave BarrierへHypothesis、Route Fragment、Falsifier、Unknown、Coverageを返す。freshなRoot Synthesizerがそれらを統合し、Adversarial Criticが成立しないhopとoracle的補完を指摘する。成立routeはIndependent Verificationへ、不足linkは具体的な次Waveへ送り、新しいsource-bound evidenceが尽きるか有限budgetが終了するまで反復する。chain接続の意味判断を決定論的scriptで代替しない。

Approach Familyはdurable registryへmechanism、surface、round、evidence、状態、blocked理由、reopen条件を記録する。同じideaの言い換えを多様性と数えず、有望度だけで全枠を一familyへ集中させない。blocked familyは具体的な新mechanismまたは新source evidenceがある場合だけ再開する。dependencyが不足する場合はFinderが任意cloneせず、versionと理由を持つDependency WishlistをTarget Intakeへ返し、pin/digest固定した次Snapshotで調べる。

旧Promptの最低6時間と`/flag`はproduction規則にしない。Campaign Budget Profileは最大時間をhard ceilingとして強制するが、下限時間またはtoken消費目標を置かない。全familyのterminal化、連続Waveの新証拠なし、Criticによる新mechanismなし、coverage debtとdependency gapの記録からevidence-backed closureへ先に到達すれば終了する。known-positive benchmarkだけがflag相当の肯定解motivationを使用できる。未知Targetはsite-wide compromiseをNorth Starとして優先するが、その存在をFinderへ保証しない。

設計責任は、Anthropic Defending Code Reference Harnessから高水準taskと自由なsource追跡、Semgrep Defending Code Harnessからisolated independent runとfresh executable verification、OpenAI Codex Securityからdurable workflow、coverage、partial result、phase separationを採る。wp2shell/CDCから独立idea family、missing-link pursuit、root synthesis、反復のmotivationを抽出する。Wordfence ArgusはNorth Starと10設計原則だけを参照し、非公開の内部構造を推測しない。

この判断はADR 0106の固定Strategy portfolioを置き換える。ADR 0112の「Analysis Unitはseedでありscopeではない」は維持し、repository inventoryをSurface Map非依存で取得できることを追加する。
