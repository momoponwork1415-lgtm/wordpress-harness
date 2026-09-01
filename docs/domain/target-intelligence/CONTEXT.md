# Target Intelligence

WordPress ecosystemの観測から、調査価値と取得可能性を評価し、oracle-freeなResearchへ渡せる対象を選ぶcontext。

## Language

**Intelligence Source**:
plugin directory、vulnerability intelligence、利用統計等、Target Observationの出所となる情報源。
_Avoid_: Feed、API

**Target Observation**:
取得時刻とIntelligence Sourceに結び付いた、plugin、version、利用状況、更新状況等についての不変な観測。
_Avoid_: Current fact、Target metadata

**Selection Fact**:
調査優先度または取得可否の判断に利用でき、prospective Researchへ渡しても既知脆弱性を示さない観測事実。
_Avoid_: Signal、Score input

**Oracle Fact**:
既知の脆弱version、patch、CVE、advisory narrative等、prospective Researchへ渡すと発見能力の評価を汚染する情報。
_Avoid_: Selection Fact、Sensitive metadata

**Selection Policy**:
許可範囲、取得可能性、expected research value、鮮度からTarget Candidateを選ぶversion固定した判断基準。
_Avoid_: Ranking formula、Research priority

**Target Candidate**:
Selection Policyを満たす可能性があり、取得または人間reviewの対象になったpluginとversionの組。
_Avoid_: Target Snapshot、Finding candidate

**Selection Receipt**:
Target Candidateを採用、保留、拒否した結論を、使用したSelection Fact、policy version、理由に結び付けた記録。
_Avoid_: Score、Approval

**Target Acquisition**:
選ばれたplugin sourceと配布metadataを、provenanceを失わずResearchへ受け渡せる状態にする行為。
_Avoid_: Download、Campaign setup

**Target Intake Packet**:
取得したsource、version、provenance、Selection Receiptを結び、Oracle Factを除外したResearch向けの不変handoff。
_Avoid_: Target Snapshot、Raw intelligence
