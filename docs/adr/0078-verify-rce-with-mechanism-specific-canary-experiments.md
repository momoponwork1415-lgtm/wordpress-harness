---
status: accepted
---

# Verify RCE with mechanism-specific canary experiments

RCEを一つの汎用shell Experimentで検証せず、初期mechanismを`executable-upload`、`command-injection`、`dynamic-php-execution`、`object-injection-gadget`に分けたtyped Experiment Planで扱う。Verifierの外部interfaceは`verify(Hypothesis, TargetSnapshot) -> VerificationRecord`のままにし、mechanism固有のsetup、trigger、observation、cleanupはExperiment Broker内部のadapterへ隠す。

各PlanはCampaignRunnerが生成する一回限りのnonce、許可する最小effect、観測方法、success criterion、Causal Controlの差分を開始前に固定する。Witnessは使い捨てVerification Lab内のHTTP response、broker-collected output、またはExperiment専用pathへのnonce書込みで観測し、reverse shell、interactive command channel、host access、外部egress、実dataの取得、Lab破棄後のpersistenceを使わない。

arbitrary file uploadまたはfile writeだけではRCEと判定しない。対象runtimeで攻撃者が制御したPHPまたはcommandが実行され、nonce effectが観測され、同じLab Baselineから作ったsibling Causal Controlでそのeffectが消える場合だけRCE Witnessとする。各adapterはvulnerable positive、patched negative、benign functional controlで同じinterfaceからtestする。
