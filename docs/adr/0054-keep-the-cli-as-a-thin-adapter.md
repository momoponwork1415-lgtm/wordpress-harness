---
status: accepted
---

# CLIを薄いAdapterに保つ

operator CLIはargv parsing、result rendering、exit statusだけを所有するthin Adapterとする。Campaign lifecycle、保存規則またはprovider選択をcommand fileへ複製せず、Testや将来のUIと同じModule Interfaceを呼ぶ。複数の入口でResearch semanticsが分岐することを防ぐためである。
