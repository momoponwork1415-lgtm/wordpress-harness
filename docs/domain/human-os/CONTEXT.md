# Human OS

Researchの主張を人間が独立に確認し、不足証拠、採否、外部行動を明示的に判断するcontext。web画面の名称ではなく、人間のwork queueとdecision systemを指す。

## Language

**Human Review Packet**:
一つのFindingについて、固定Target identity、主張、Evidence Route、Witness、Causal Control、source引用、再現手順、既知の限界をdigest固定した自己完結handoff。
_Avoid_: Report、Transcript、Finding summary

**Human Review Case**:
一つのHuman Review Packetと、それに対する人間の確認作業および判断履歴を結び付けるreview単位。
_Avoid_: Ticket、Finding

**Review Disposition**:
Human Review Caseに対する`confirmed`、`rejected`、`more-evidence-required`、`blocked`のいずれかの理由付き判断。
_Avoid_: Status、Model verdict

**Human Confirmation**:
人間が固定Target、実interface、Witness、Causal Control、引用sourceを独立に再確認したReview Disposition。
_Avoid_: Finding、Approval、External Action Authorization

**Evidence Request**:
人間がReview Dispositionを決めるために不足している観測とacceptance criterionを明示し、Researchへ返す不変な要求。
_Avoid_: Comment、Retry、Finding edit

**External Action Authorization**:
特定のreport、vendor communication、issue、PRまたは公開行為を明示的に許可する人間の判断。
_Avoid_: Human Confirmation、Programme eligibility、Implicit consent
