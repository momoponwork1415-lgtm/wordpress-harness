---
status: accepted
---

# Gate global learning

LearnerがCampaign evidenceから生成したLesson、rule、prompt変更はLesson Proposalとして保存し、自動でglobal production policyへ反映しない。Campaign内の次iterationではlocal evidenceに基づくFocusとpriorityの更新を許すが、別Campaignへ影響する変更はDevelopment CohortとSealed Evaluation Cohortを通過した後だけLessonへ昇格させる。単一Caseへの過学習とfalse ruleの自己強化を防ぐためである。
