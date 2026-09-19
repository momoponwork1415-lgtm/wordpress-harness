# Domain文書

codebaseを調べるengineering skillが、このrepositoryのdomain文書をどう読むかを定める。

## 調査前に読むもの

- repository rootの**`CONTEXT-MAP.md`** — contextごとの`CONTEXT.md`を示す。作業対象に関係するものだけ読む。
- repository rootの**`CONTEXT.md`** — Research contextの用語集。
- **`docs/adr/`** — 作業対象に関係するADRだけ読む。このrepositoryはsystem全体で一つのADR directoryを使い、context別のADR directoryを作らない。

これらのfileが存在しない場合は、指摘や先回りした作成提案をせず、そのまま進める。`/domain-modeling` skillは、用語や判断が実際に確定した時だけ必要な文書を作る。

## File構成

このrepositoryは、rootに`CONTEXT-MAP.md`を持つ**multi-context**構成である。Contextはpackageではなくbounded contextなので、各用語集はpackageの`src/`横ではなく`docs/domain/`に置く。

```
/
├── CONTEXT-MAP.md          ← index of the three contexts
├── CONTEXT.md              ← glossary for the Research context
├── docs/
│   ├── adr/                ← system-wide decisions
│   └── domain/
│       ├── target-intelligence/CONTEXT.md
│       └── human-os/CONTEXT.md
└── src/
```

## Repository固有のgate

`pnpm docs:check`は、すべての相対Markdown linkが存在するfileを指すことを要求する。

## 用語集の語を使う

Issue title、refactor提案、仮説、test名などでdomain概念を使う場合、ownerの`CONTEXT.md`が定義した語を使う。用語集が避けている同義語へずらさない。

必要な概念が用語集にない場合、projectが使わない語を作っていないか見直す。実際の不足なら`/domain-modeling`の対象として記録する。

## ADRとの矛盾を明示する

出力が既存ADRと矛盾する場合、黙って上書きせず明示する。

> _Contradicts ADR 0125 (put agent decisions behind thin evidence shells) — but worth reopening because…_

このrepositoryは旧ADRを編集せず、新しいADRで判断を置き換える。どのADRを置き換えるかを示す。
