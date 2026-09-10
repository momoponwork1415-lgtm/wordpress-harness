---
status: accepted
supersedes: 0129
---

# Place human reviews between Research grants and Independent Validation

一回のResearch Native RunをResearch Grantとし、AIが具体的なsource-bound next actionを返しても次のGrantを自動開始しない。Harnessはexact Campaign input、terminal run、Checkpoint、Candidate、parked Programme Leadとnext actionへdigest-bindしたHuman Research Continuation Reviewを要求し、人間が`continue-research`を選んだ時だけ同じCheckpointから次のGrantを開始する。人間が`proceed-to-candidate-review`を選べるのはCandidateが存在する場合だけとする。

Researchを終える時もCandidateを直ちにIndependent Validationへ渡さない。全Candidateへ一つのHuman Candidate Reviewを要求し、`advance-to-independent-validation`だけをfresh Validationへ進める。`return-to-research`が一件でもあればValidationを開始せずResearchへ戻し、programme OOSとscope ambiguityは記録したままValidationしない。人間のreasonはResearch promptへ渡さず、明示されたsource-bound next actionだけを渡す。

これにより一時間程度の実行単位で探索品質、実際のimpact、Programme適合性と残りの調査価値をCodexまたはClaude Codeから確認できる。代償として無人の連続探索は行わず、レビュー待ち時間が増える。Independent Validationをactive Discoveryへ割り込ませずfreshに保つ原則は維持する。
