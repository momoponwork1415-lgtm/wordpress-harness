---
status: accepted
---

# Keep Discovery read-only and tool-flexible

Discovery workerにはcode search、構文解析、call graph、Semgrep等の静的補助と、Hypothesisに必要な小さな解析toolの作成を許可する。ただし書込み先はAttempt専用scratchに限定し、Target Snapshotの変更、plugin code実行、WordPress runtime、HTTP/browser probingを禁止する。固定SAST engineを全Focus Areaの必須stageにせず、dynamic executionは独立Verifierだけが所有する。
