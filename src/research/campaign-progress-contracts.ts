export type CampaignProgressRole =
  | "finder"
  | "root-planner"
  | "root-evaluator"
  | "root-synthesizer"
  | "adversarial-critic"
  | "validator";

export interface CampaignProgressCount {
  readonly started: number;
  readonly completed: number;
  readonly active: number;
}

export interface CampaignProgressUsage {
  readonly measurement: "reported" | "partial";
  readonly modelAttempts: number;
  readonly reportedModelAttempts: number;
  readonly modelTurns: number;
  readonly modelTokens: {
    readonly input: number;
    readonly cacheCreation: number;
    readonly cacheRead: number;
    readonly output: number;
    readonly total: number;
  };
  readonly estimatedCostUsd: number;
  readonly source: {
    readonly queries: number;
    readonly scanBytes: number;
    readonly responseBytes: number;
  };
}

export interface CampaignProgressView {
  readonly kind: "progress";
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly status: "prepared" | "running" | "completed";
  readonly ledgerHead: number;
  readonly counts: {
    readonly runs: CampaignProgressCount;
    readonly attempts: CampaignProgressCount;
    readonly checkpoints: {
      readonly total: number;
      readonly hypotheses: number;
      readonly routeFragments: number;
      readonly frontierGaps: number;
    };
    readonly verifications: CampaignProgressCount & {
      readonly finding: number;
      readonly disproved: number;
      readonly blocked: number;
    };
    readonly depthIterations: number;
  };
  readonly activeAttempts: readonly {
    readonly attemptId: string;
    readonly role: CampaignProgressRole;
    readonly startedAt: string;
  }[];
  readonly activeVerifications: readonly {
    readonly verificationId: string;
    readonly startedAt: string;
  }[];
  readonly usage: CampaignProgressUsage;
  readonly lastDurableEvent: {
    readonly sequence: number;
    readonly kind: string;
    readonly occurredAt: string;
  };
}

export interface CampaignProgressSubjectRef {
  readonly kind: "progress";
}
