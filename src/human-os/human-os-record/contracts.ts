import type {
  HumanVerificationEnvironmentDisposition,
  HumanVerificationEnvironmentRequest,
} from "../human-verification-environment-contracts.js";

export interface HumanOsArtifactStore {
  putJson(value: unknown): Promise<string>;
  readJson(digest: string): Promise<unknown>;
}

export interface HumanVerificationEnvironmentRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly requestArtifactDigest: string;
  readonly dispositionArtifactDigest: string;
  readonly request: HumanVerificationEnvironmentRequest;
  readonly disposition: HumanVerificationEnvironmentDisposition;
}

export interface RecordEnvironmentDispositionResult {
  readonly status: "appended" | "occupied";
  readonly view: HumanVerificationEnvironmentRecordView;
}

export interface HumanOsRecord {
  readEnvironmentDisposition(
    requestDigest: string,
  ): Promise<HumanVerificationEnvironmentRecordView | undefined>;
  recordEnvironmentDisposition(
    request: HumanVerificationEnvironmentRequest,
    disposition: HumanVerificationEnvironmentDisposition,
  ): Promise<RecordEnvironmentDispositionResult>;
}

export interface OpenHumanOsRecordOptions {
  readonly databasePath: string;
  readonly artifactStore: HumanOsArtifactStore;
  readonly clock?: () => Date;
}
