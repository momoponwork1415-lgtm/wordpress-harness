---
status: accepted
supersedes: 0061
---

# Admit only official and probeable model transports

Model candidateは、provider公式のclient・SDK・endpointと、その用途に公式対応したsubscription、OAuth、Coding Planまたはservice credentialを使える場合だけproduction transportへ採用する。consumer credentialを抽出して独自APIへ転用せず、実行version、effective config、model、structured outputを固定し、built-in tool無効化、credential isolation、process termination、error normalizationのcapability probeを通過したTransport Eligibility Receiptを要求する。条件を満たさない候補は非公式な代替経路へ接続せず保留する。

subscriptionに対応する公式native agent processを優先し、API/service credentialを別途導入した場合だけDirect API Adapterを追加する。transport kindはNative Run開始前にAgent Runtime Profileへ固定し、auth、quotaまたはprovider failureで別transportや別modelへ自動fallbackしない。外部のoperator interfaceはtrusted control planeを操作するAdapterであり、worker transportやprovider PTYにはしない。
