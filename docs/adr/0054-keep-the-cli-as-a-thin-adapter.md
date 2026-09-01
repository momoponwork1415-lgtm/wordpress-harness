---
status: accepted
---

# Keep the CLI as a thin adapter

operator CLIは一つのcommandとsubcommand群で構成し、argv parsing、result rendering、exit status以外のCampaign logicを持たないthin adapterとする。orchestration、validation、Ledger、Workspace、Model Execution、Verificationは同じmodule interfaceをtestと将来UIへ公開し、command fileごとの保存規則またはlifecycle分岐を作らない。
