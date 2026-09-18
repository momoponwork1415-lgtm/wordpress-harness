# wp2shell と現行 Research loop の差分

Status: primary-source comparison and runtime observation, checked 2026-09-18

## 結論

現行方式はwp2shellの研究手法を[WordPress Plugin Research v3](../../prompts/wordpress-plugin-research-v3.md)へ取り入れた。Daybreak、Opus、GLM、Grokの全てでnative subagentの実利用例を確認済みだが、下記の実測はv2導入前で、通常は一つのfan-out waveの後、約10〜22分で`stop`していた。v3が明示する反復round、adversarial double-checkとcontrol challengeが実行上も定着したかは再評価が必要である。

調査時点ではprovider間の制御と観測も揃っていなかった。最新DaybreakはRootごとに3体を起動する一方、source上には`multi_agent=false`が残り、OpusとGLMでは子agentがさらにagentを起動して最大同時4体を超えた。2026-09-10に全providerのRuntimeをRoot込み最大4体へ修正し、Claude Code / GLMとGrokはspawn depthも1へ制限した。一方、Opus、GLM、GrokのReceiptは実際にagentを使っても`activity.subagents=null`となる例があり、利用数の観測は未解決である。

wp2shell promptから持ち込まないのは、task固有のpositive oracle、RCE / `/flag`到達の強制と最低6時間の指定である。1時間ごとのHuman Review、read-only sandbox、fresh Candidate Verificationは、prompt techniqueをprospective Campaignとして安全に運用する外側のProduct boundaryである。

一次資料は、著者がfolder構成とexact promptを掲載した[wp2shellの記事](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)と、記事から直接参照されるOpenAIの[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)である。

## 照合結果

| Concern | wp2shellで実際に指示されたこと | 現行Research | 判定 |
| --- | --- | --- | --- |
| Root / subagent | multi-agentを積極的に使い、同時最大4体。approach familyを分散し、Rootが反復的にsynthesize、challenge、redirect、new roundを起動する。具体的bugはadversarial agentで二重確認する。 | v3 Promptは積極的なnative subagent利用、最大4体、Rootだけの起動、反復synthesis / challenge / redirect / new round、adversarial double-checkを明記した（`prompts/wordpress-plugin-research-v3.md:18-28`）。各Runtimeも同じresource ceilingを強制する。 | **Promptと上限は一致。** fan-outの利用数をReceiptへ正確に残す観測は未解決。 |
| 多様性と反復 | diverse portfolioを始め、収束したfamilyを別routeへ戻す。失敗した最初のwaveで止めず、blocked routeは新 mechanismがある時だけ再開し、複数roundを回す。 | v3 Promptは明示的なfamily registry、収束時のredirect、一routeによる支配の禁止、新機構だけによるblocked route再開、incompatible routeの複数round維持、遅いcross-pollination、first-wave failure後のfresh idea投入を明記した（`prompts/wordpress-plugin-research-v3.md:20-28,40`）。 | **Promptは一致。** v3 Campaignの実測が必要。 |
| 停止条件 | 「現在のapproachが失敗した」だけでreturnせず、新しいroundを続ける。give upまで最低6時間。 | 1 Grantは最大1時間。agentはreport用に最大5分を残し、active frontierがあれば`continue`、なければ`stop`できる。Report v2は`stop`のbasisに加えて、調査領域のsource evidenceと未調査領域を要求するが、探索完了の証明にはしない。 | **1時間Human Reviewは意図的。早期stopは重大差。** 最新Daybreak completed Rootは2.8〜18.4分、平均10.3分。GLM 4件は11〜19.5分、Grokのrich runは15.8〜19分で終了した。1時間はreview時点ではなく上限になっている。 |
| Oracle / goal | 「脆弱性が存在する」と保証し、typical MySQL productionでpre-authからRCE、最終successは`/flag` readと教える。 | 脆弱性の存在を仮定せず、ordinary deploymentでunauth / Subscriber / CustomerからFile、Options、RCE、Admin ATO / PE、Stored XSS、SQLi等を探索する。列挙impactへの完全なrouteをsuccessとし、RCE昇格を必須にしない（`prompts/wordpress-plugin-research-v3.md:3-16`）。 | **明示的な除外。** positive oracleとRCE / `/flag`到達の強制は未知Targetのprospective Researchへ持ち込まない。 |
| TargetとDependency | latest stable WordPressを`main/`へ置き`.git`を削除。空のwritable `third_party/`を用意し、必要ならPHP / MySQL等のsourceをcloneしてchainを調べられる。 | pluginを`/workspace/main`、事前にpinnedしたWordPress core等を`/workspace/dependencies/*`へread-only mountする（`src/research/agent-led/gvisor-agent-sandbox.ts:988-1025`）。Dependencyはreferenceで、Findingはpluginへ帰属させる（`docs/adr/0128-provide-pinned-dependency-source-to-research.md:5-11`）。 | **意図的だがrecall-sensitive。** 再現性と安全性は上がるが、run中に未準備のdependency sourceを取得してchainを伸ばすwp2shellの自由度はない。必要なcompanion / core sourceをCampaign作成時に漏れなくpinできることが前提になる。 |
| Tool / sandbox | 記事は`third_party/`へclone可能とし、sourceを読むよう指示する。Prompt単体ではhost権限やsandboxを制限していない。 | runsc、read-only root、capability全drop、Target / Dependency read-only、scratchだけwriteable、webなし（`src/research/agent-led/gvisor-agent-sandbox.ts:988-1025`）。Codexはshellを無効化し、source toolはlist / read / literal searchの3種だけ（`src/research/agent-led/codex-native-agent-runtime.ts:420-465`、`src/research/agent-led/codex-source-reader.ts:137-181`）。 | **意図的な安全強化。** raw-source-firstとは一致するが、wp2shellと同じtool freedomではない。とくにdependency取得、複雑なlocal解析、独自scriptによる横断調査はできない。 |
| OOS primitive | intermediate bugもchain候補として追い、authentication bypass等をつないでRCEへ進める。programme scopeによるparkingはない。 | v3 Promptはintermediate bugをeligible impactへchainする探索を要求する。Programme Boundary上で、focused source review後も具体的edgeがないexcluded primitiveだけはparkし、新しいsource evidenceがmissing edgeを供給すれば再開する（`prompts/wordpress-plugin-research-v3.md:28-36`）。 | **研究要素をProduct boundaryへ適応。** chain探索を保持しつつ、根拠のないOOS推論はParked Leadとして記録する。 |
| Context / continuation | 著者はlong runの出力でSQLiを確認し、人間がstock WordPressで実行確認した後、RCEへ昇格できるか追加で質問し、約4時間後にchainを得た。単一promptだけの完全無人runではない。 | Root conversationとscratchをopaque checkpointとして保存し、exact input / runtime / sourceが同じ時だけ同一sessionをresumeする（`src/research/agent-led/gvisor-agent-sandbox.ts:600-731,1076-1113`）。Human Reviewはcheckpointとnext actionへbindされる（`src/research/agent-led/contracts.ts:363-421,488-521`）。 | **よく対応し、durabilityは強い。** timeout時にcheckpointを回収できなければ`incomplete`とする点も、結果消失をnegativeにしない改善である。 |
| 出力とVerification | running outputを人間が読み、stock instanceでadmin email readを確認。その後に同じ研究をRCEへ延長し、人間が翌日chainを解読してreportを作った。fresh source-only validatorは記事にない。 | Research Report v2でResearch Assessment、control-challenged Candidate、parked Leadとcontinue / stopを返す。Human Candidate Review後、admitされたCandidateだけをfresh runtimeで一度検証し、`runtime-confirmed`だけがVerified Vulnerabilityになる。 | **意図的なassurance強化。** wp2shellの再現ではなくproduct workflowへの拡張。strict reportが探索終了やinvalid-outputを増やさないかは別に実測する必要がある。 |

## Provider別の実測

調査時点のprivate execution evidenceを集計した。脆弱性内容ではなく探索topologyだけを記す。

| Provider | native subagent | round / synthesis | 実測上の問題 |
| --- | --- | --- | --- |
| Daybreak / Codex | 最新50件batchで35 Rootが各3体、計105 spawn。Rootは子とmessage / waitで統合する。 | ほぼ全て一つの初期wave。30件が`stop`を返し、completed Rootの平均は10.3分。 | 旧実測では上限内。現在はmulti-agentを明示的に有効化し、primaryを除く同時threadを3へ固定した。3体終了後の新waveは未確認。 |
| Opus / Claude Code | 四つのprivate prospective Campaignで複数Grantと多数の子を利用。registryとRootの再読も実在。 | この実測群ではwp2shellに最も近く、resume後の追加roundもある。 | 旧実測では同時上限超過があった。現在は同時3 subagent、spawn depth 1へ固定した。Receiptの`subagents=null`と早期stop / invalid-outputは未解決。 |
| GLM 5.3 / Claude Code | private prospective Campaignのrepresentative runで3〜6体。一件は4 routeとdurable registryを使用。 | 通常は一つのfan-out。一件だけnested agentを含む追加分解があった。 | 旧実測では6体同時の例があった。現在は同時3 subagent、spawn depth 1へ固定した。Receiptの`subagents=null`と早期stopは未解決。 |
| Grok 4.6 Build | TranslatePress runで4 routeへ即時fan-outし、Rootも並行してsourceを読んだ。 | 一つのwaveを回収して統合。 | 現在は同時3 subagent、spawn depth 1、超過時failへ固定した。rich resultのDB未記録、`invalid-output`、Receiptの`subagents=null`は未解決。 |

Opus / GLMのadapterはprovider envelopeの任意`subagent_stats`だけを信頼するため、実transcriptがあっても`null`になり得る（`src/research/agent-led/claude-code-native-agent-runtime.ts:790-837`）。Daybreakはtool transcriptから数える実装を持つ（`src/research/agent-led/codex-native-agent-runtime.ts:83-198`）。

## 結果保存上の追加不一致

wp2shellではlong runの出力を人間が読み、そこから同じ研究を継続した。現行Opusでは、正常に終わったrunのCandidateまたはParked Leadが過去と同じIDで内容を変更すると、completed Receiptを簡易`invalid-output` Receiptへ置換する（`src/research/agent-led/research-campaigns.ts:803-840`）。この置換でreport、usage、正規Checkpoint参照が失われる。

private prospective Campaignの一件では約26.7分、公開CVEを使ったTranslatePress評価では約22.8分の最終runがこの経路に入った。物理transcriptとcheckpoint directoryは残るため手動回収はできるが、DBからの通常resumeはできない。timeout時はCheckpointを残す実装（`src/research/agent-led/gvisor-agent-sandbox.ts:1163-1187`）と比べても不整合であり、意図的なwp2shell差分ではなく保存bugである。

## Prompt量

Base Promptは30行だが、Threat Context、Programme Boundary、binding、timebox、transport条件を加えたDaybreak実投入例は61行、12,028文字だった。Opus実例も約11〜12KBである。GLMとGrokはさらにJSON SchemaをPrompt本文へ追加する（`src/research/agent-led/claude-code-native-agent-runtime.ts:284-285`、`src/research/agent-led/grok-native-agent-runtime.ts:60-74`）。wp2shellのexact promptよりかなり大きく、impactとexclusionの反復がidea generationを狭めるかはablation対象である。

## wp2shellから保持できている核

- raw sourceからfirst-principlesで読む。changelog、Git history、internet上の既知脆弱性へ頼らない（`src/research/agent-led/gvisor-agent-sandbox.ts:405-423`）。
- sink checklistではなく、broken security semanticsとrouteをAgent自身が選ぶ（`prompts/wordpress-plugin-research-v3.md:20-30`）。
- diverse route、blocked route、途中primitive、counterevidenceをRoot conversation側で扱い、Harnessへ固定role / wave / classとして実装しない（`docs/adr/0125-put-agent-decisions-behind-thin-evidence-shells.md:5-13`）。
- 一件のprimitive / Candidateで必ず探索を終えず、残るactive frontierとfresh approachを追う（`prompts/wordpress-plugin-research-v3.md:38-40`）。

## 現在の実装と残る観測課題

completed Native RunのCandidate identityまたはProgramme Boundaryにsemantic conflictがある場合、現在はcompleted Receipt、raw Report、usageとCheckpointを保持し、digest-boundなResearch Admission Failureを同じtransactionへ追記する。失敗したrunのCandidate / LeadだけをCampaign集約から除外するため、過去に観測した「completed resultをfailureへ置換する」不一致は解消した。

残る観測課題は、全providerのsubagent利用数と親子関係、v3 Promptでdivergent route・adversarial challenge・Root synthesis・追加roundが実際に起きるか、早期stopとPrompt量、事前pinするdependencyの不足がrecallへ与える影響である。これらの有限workと受入条件はGitHub Issueを正本にする。

要するに、wp2shellの研究手法はv3 Promptへ取り込んだ。持ち込まないのは`positive oracle + RCE / /flag到達の強制 + 最低6時間`である。現在の主要な不確実性は、**v3が反復roundとして実行されるか、subagent活動を十分に観測できるか、Prompt量とsource worldの境界がrecallへどう影響するか**である。
