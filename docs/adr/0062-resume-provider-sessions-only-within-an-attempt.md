---
status: accepted
---

# Resume provider sessions only within an Attempt

CLI session resumeは、同じWork Leaseを実行する一つのAttempt内で、429、5xx、接続切断など分類済みのtransient provider failureから回復する場合だけ許可する。一回のprocess invocationを`Segment`と呼び、初回launchと各resumeへ単調増加するsegment ordinalを付ける。

各Segmentはlaunch前のintent、provider session ref、Model Profile、Target Snapshot、Prompt Set、Work Lease、reserved budget、開始・終了理由、usage、stdout/stderr artifactをResearch Ledgerへ結び付ける。resumeは同じmodel、effort、tool policy、sandbox、frozen inputsを再構成できる場合だけ行い、profile固有の回数・wall・usage ceilingを外側のsupervisorが強制する。

独立したrun、Mapper/FinderからVerifierへのhandoff、VerifierからSkepticへのhandoff、別Work Leaseではsessionを再利用しない。これらはfresh Attemptとし、正規化artifactだけを入力にする。

orchestrator crash後、open Attemptにdurableなsession refと完全なSegment receiptがあり、providerが安全なresumeを提供する場合は、同じAttemptの次Segmentとして再開できる。それ以外は元Attemptを`orphaned`にし、新しいAttempt IDでWork Leaseを再割当する。CLI session自体をCampaign stateの正本にしない。
