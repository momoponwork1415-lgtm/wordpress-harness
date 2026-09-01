---
status: accepted
---

# Use Brizy Stored XSS as the first public Boundary Pair

最初のpublic end-to-end Boundary Pairは、Brizy Page Builder 2.8.11までのunauthenticated stored XSS via `fileUpload` field valueとする。vulnerable positiveを2.8.11、actual patched negativeを2.8.12とし、同じform/fileUpload surfaceの正常機能をbenign controlとして人間が先に再現して固定する。

このCaseで、unauthenticated HTTP input、永続化、被害browser contextまでのsource route、browser script executionのobjective Witness、同じLab Baselineから作ったsibling Causal Controlを通す。positiveだけがFinding promotion gateを満たし、patched negativeでは同じcauseが消え、benign controlでは正常機能が維持されなければならない。

Case identity、vulnerable/patched/benign role、advisory、expected resultはbenchmark graderだけが保持し、Mapper、Finder、Verifier、Skepticにはneutral IDと通常のplugin artifactだけを渡す。changelog、CVE、advisory、patch narrativeをworker inputからmaskする既存decisionを維持する。

この選択はDiscovery scopeをStored XSSへ限定しない。最初に実装するtyped Experiment adapterとpublic acceptance oracleをbrowser Witnessに絞るだけである。
