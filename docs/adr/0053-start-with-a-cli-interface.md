---
status: accepted
---

# Start with a CLI interface

初期operator interfaceはCLIと人間可読なstatus/inspection reportに限定し、Web UI、常駐dashboard、独自consoleを作らない。必要な操作はCampaignの`prepare`、`start`、`resume`、`status`、`inspect`、`stop`とし、将来UIはResearch Ledger projectionを読むadapterとして追加できる形にする。
