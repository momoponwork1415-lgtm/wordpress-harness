import { openBootstrapExploration } from "./bootstrap-exploration.js";

export type {
  AttemptExecutionResultRef,
  Exploration,
  ExplorationBootstrapPolicy,
  ExplorationDecision,
  ExplorationDecisionInput,
  ExplorationPolicyRef,
  ExplorationStateRef,
  FinderAttemptResult,
  FocusArea,
  OpenExplorationOptions,
  SourceBoundHypothesis,
  WorkLease,
  WorkWavePlan,
  WorkWaveRef,
} from "./contracts.js";

export const openExploration = openBootstrapExploration;
