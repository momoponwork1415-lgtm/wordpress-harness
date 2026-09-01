---
status: accepted
---

# Bind plugin identity, main file, and version at intake

Plugin identityはdirectory名または表示名ではなく、WordPress.org版を`wporg:<slug>`、premium版を正規入手provenance付き`premium:<vendor>/<product>`として名前空間化する。Target Intake Packetはこのidentityと、検証済みのmain plugin file relative pathを固定する。main fileは明示pathを検証するか、有効なplugin header候補が一つの場合だけ自動確定し、候補がゼロまたは複数ならdeferredとして推測しない。

main plugin header、request、利用可能な配布metadataのversionはSemVerと仮定しないopaque labelとして照合する。必要なversion evidenceの不足はdeferred、authoritative valueの矛盾はrejectedとし、directory名、archive名、最大らしい値で補正しない。これにより同名plugin、premium配布物、曖昧なpackageでもCampaign identityと実際にactivateするcodeを取り違えない。
