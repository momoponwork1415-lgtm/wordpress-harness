# WordPress Harness

WordPressプラグインを対象に、AIによる調査対象の提案、ソースコード探索、候補ごとの動的検証、プログラム別の対象範囲判定、提出前の人間承認をつなぐ調査基盤です。

> **Do not optimize for sinks. Optimize for broken security semantics.**
>
> **Harness owns authority, evidence, isolation and limits; agents own research decisions.**

探索は一つの連続した流れです。AIがソースコードに基づく具体的な次の手を持つ間は、同じCheckpointから人間の操作なしで続けます。調べる価値のある経路がなくなった時だけ停止し、候補があれば人間の採否判断へ渡します。Harnessは担当エージェント数、探索の波、深さ、脆弱性の種類、読むファイル、固定評価表を決めません。未認証SQLインジェクションや格納型XSSは、RCEへ発展しなくても候補です。

探索エージェントはgVisor内で動かします。対象ソースは読み取り専用で、書き込めるのは作業領域だけです。候補の再現手順はGit外の非公開ストレージへ保存し、人間の承認後に新しい使い捨てWordPress環境で一度だけ実行します。技術的に確認できた脆弱性と、各報奨金プログラムの対象範囲は別々に記録します。プロバイダーやモデルを暗黙に切り替えることはありません。

## はじめに

```bash
pnpm install
pnpm check
pnpm build

node dist/cli.js campaign conduct-approved \
  --database .private/research.sqlite \
  --input .private/approved-target-campaign-request.json \
  --docker /usr/bin/docker \
  --image sha256:<immutable-image-id> \
  --source /absolute/path/to/read-only/source \
  --dependency-source wordpress=/absolute/path/to/read-only/wordpress-core \
  --provider-config /absolute/path/to/provider-config \
  --scratch .private/scratch \
  --research-prompt .private/research-prompt.md

node dist/cli.js campaign inspect \
  --database .private/research.sqlite \
  --campaign <campaign-id>
```

この通常経路は、人間が承認した対象、実行直前の観測、対象の受入情報、Campaign方針、WordPress本体などの依存ソース、脅威の前提、プログラム上の探索境界を一つのrequestへ結び付けます。正確なschemaは[`src/target-intelligence/approved-target-campaign/contracts.ts`](src/target-intelligence/approved-target-campaign/contracts.ts)、探索schemaとprompt digest helperは[`src/research/agent-led/contracts.ts`](src/research/agent-led/contracts.ts)にあります。`--dependency-source`のmount名はrequestと一致させます。実行環境は封印済みの`agentRuntimeProfile.kind`から選びます。探索試験ではGrokを優先し、利用できなければCampaignを`incomplete`として残します。

非公開の対象ソース、prompt、プロバイダー出力、認証情報、payload、実行記録、未公開の発見事項はGit外へ置きます。対象のautoload、Composer script、WordPress bootstrapをホスト上で実行しません。

## ドキュメント

- [ドキュメント案内](docs/README.md) — 全体図、処理順、用語、設計の入口
- [コードベース案内](docs/CODEBASE-GUIDE.md) — 変更箇所、Interface、Behavior Test
- [開発規則](AGENTS.md) — リポジトリ全体の規則
