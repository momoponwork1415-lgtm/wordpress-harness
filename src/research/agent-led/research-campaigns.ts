import Database from "better-sqlite3";
import { z } from "zod";

import {
  canonicalDigest,
  encodeCanonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  campaignInterruptionSchema,
  campaignInputSchema,
  nativeRunReceiptSchema,
  type CampaignInput,
  type CampaignOutcomeRef,
  type CampaignQuery,
  type CampaignStatus,
  type NativeAgentRuntime,
  type NativeRunReceipt,
  type OpenResearchCampaignsOptions,
  type ResearchCampaigns,
  type ResearchCampaignView,
  type SealedNativeRun,
} from "./contracts.js";

const jsonValueSchema = z.json();

const eventRowSchema = z.object({
  kind: z.enum([
    "campaign.defined",
    "native-run.recorded",
    "campaign.interrupted",
  ]),
  occurred_at: z.string(),
  payload_json: z.string(),
  payload_digest: z.string(),
});

const campaignDefinedPayloadSchema = z.strictObject({
  input: campaignInputSchema,
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const nativeRunRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  receipt: nativeRunReceiptSchema,
});

const campaignInterruptedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  interruption: campaignInterruptionSchema,
});

type EventRow = z.infer<typeof eventRowSchema>;

export class AgentLedCampaignConflictError extends Error {
  constructor(readonly campaignId: string) {
    super(
      `Agent-led Campaign input conflicts with stored input: ${campaignId}`,
    );
    this.name = "AgentLedCampaignConflictError";
  }
}

export class AgentLedCampaignNotFoundError extends Error {
  constructor(readonly campaignId: string) {
    super(`Agent-led Campaign not found: ${campaignId}`);
    this.name = "AgentLedCampaignNotFoundError";
  }
}

function encode(value: unknown): string {
  return encodeCanonicalJson(jsonValueSchema.parse(value));
}

function decodeJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function statusFor(receipt: NativeRunReceipt): CampaignStatus {
  if (receipt.terminal !== "completed") return "incomplete";
  return receipt.report.decision.kind === "stop"
    ? "coverage-closed"
    : "research-continues";
}

function hasRunBudget(
  input: CampaignInput,
  nativeRuns: readonly NativeRunReceipt[],
): boolean {
  const wallTimeMs = nativeRuns.reduce(
    (total, receipt) => total + receipt.usage.wallTimeMs,
    0,
  );
  const estimatedCostUsd = nativeRuns.reduce(
    (total, receipt) => total + (receipt.usage.estimatedCostUsd ?? 0),
    0,
  );
  return (
    nativeRuns.length < input.budgetEnvelope.maxNativeRuns &&
    wallTimeMs < input.budgetEnvelope.maxWallTimeMs &&
    estimatedCostUsd < input.budgetEnvelope.maxEstimatedCostUsd
  );
}

function outcomeFor(view: ResearchCampaignView): CampaignOutcomeRef {
  return {
    kind: view.kind,
    schemaVersion: view.schemaVersion,
    campaignId: view.campaignId,
    inputDigest: view.inputDigest,
    status: view.status,
  };
}

class SqliteResearchCampaigns implements ResearchCampaigns {
  readonly #database: Database.Database;
  readonly #runtime: NativeAgentRuntime;
  readonly #clock: () => Date;

  constructor(options: OpenResearchCampaignsOptions) {
    this.#database = new Database(options.databasePath);
    this.#runtime = options.runtime;
    this.#clock = options.clock ?? (() => new Date());
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS agent_led_research_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        campaign_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        UNIQUE (campaign_id, campaign_sequence)
      ) STRICT;
    `);
  }

  async conduct(candidateInput: CampaignInput): Promise<CampaignOutcomeRef> {
    const input = campaignInputSchema.parse(candidateInput);
    const inputDigest = canonicalDigest(input);
    const existing = this.#readView(input.campaignId);
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) {
        throw new AgentLedCampaignConflictError(input.campaignId);
      }
      if (existing.status !== "research-continues") {
        return outcomeFor(existing);
      }
    } else {
      this.#append(input.campaignId, "campaign.defined", {
        input,
        inputDigest,
      });
    }

    let view = this.#requireView(input.campaignId);
    while (
      view.status === "research-continues" &&
      hasRunBudget(input, view.nativeRuns)
    ) {
      const ordinal = view.nativeRuns.length + 1;
      const run: SealedNativeRun = {
        kind: "sealed-native-research-run",
        schemaVersion: 1,
        runId: `${input.campaignId}:native:${ordinal}`,
        campaignId: input.campaignId,
        campaignInputDigest: inputDigest,
        targetSnapshot: input.targetSnapshot,
        promptSet: input.promptSet,
        agentRuntimeProfile: input.agentRuntimeProfile,
        permissionProfile: input.permissionProfile,
        budgetEnvelope: input.budgetEnvelope,
        history: view.nativeRuns.flatMap((receipt) =>
          receipt.terminal === "completed"
            ? [{ runId: receipt.runId, report: receipt.report }]
            : [],
        ),
      };
      const startedAt = this.#clock();
      let receipt: NativeRunReceipt;
      try {
        const returnedReceipt = await this.#runtime.execute(run);
        const decoded = nativeRunReceiptSchema.safeParse(returnedReceipt);
        if (decoded.success) {
          receipt = decoded.data;
        } else {
          const completedAt = this.#clock();
          receipt = {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "invalid-output",
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            usage: {
              wallTimeMs: Math.max(
                0,
                completedAt.getTime() - startedAt.getTime(),
              ),
            },
            activity: { subagents: 0, tools: [] },
            failure: {
              summary:
                "Native Agent Runtime returned an unsupported output schema.",
            },
          };
        }
      } catch {
        const completedAt = this.#clock();
        receipt = {
          schemaVersion: 1,
          runId: run.runId,
          runtimeProfileDigest: run.agentRuntimeProfile.digest,
          terminal: "provider-failed",
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          usage: {
            wallTimeMs: Math.max(
              0,
              completedAt.getTime() - startedAt.getTime(),
            ),
          },
          activity: { subagents: 0, tools: [] },
          failure: {
            summary: "Native Agent Runtime failed before returning a receipt.",
          },
        };
      }
      if (
        receipt.runId !== run.runId ||
        receipt.runtimeProfileDigest !== run.agentRuntimeProfile.digest
      ) {
        const completedAt = this.#clock();
        receipt = {
          schemaVersion: 1,
          runId: run.runId,
          runtimeProfileDigest: run.agentRuntimeProfile.digest,
          terminal: "invalid-output",
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          usage: {
            wallTimeMs: Math.max(
              0,
              completedAt.getTime() - startedAt.getTime(),
            ),
          },
          activity: { subagents: 0, tools: [] },
          failure: {
            summary:
              "Native Run Receipt did not match the sealed Campaign binding.",
          },
        };
      }
      this.#append(input.campaignId, "native-run.recorded", {
        inputDigest,
        receipt,
      });
      view = this.#requireView(input.campaignId);
    }

    if (
      view.status === "research-continues" &&
      !hasRunBudget(input, view.nativeRuns)
    ) {
      this.#append(input.campaignId, "campaign.interrupted", {
        inputDigest,
        interruption: {
          reason: "budget-exhausted",
          summary:
            "The Native Run budget ended with an actionable frontier remaining.",
        },
      });
      view = this.#requireView(input.campaignId);
    }

    return outcomeFor(view);
  }

  async inspect(query: CampaignQuery): Promise<ResearchCampaignView> {
    return this.#requireView(query.campaignId);
  }

  close(): void {
    this.#database.close();
  }

  #append(campaignId: string, kind: EventRow["kind"], payload: unknown): void {
    const payloadJson = encode(payload);
    const nextSequence = this.#database
      .prepare(
        `SELECT COALESCE(MAX(campaign_sequence), 0) + 1 AS next_sequence
         FROM agent_led_research_events
         WHERE campaign_id = ?`,
      )
      .pluck()
      .get(campaignId);
    const sequence = z.number().int().positive().parse(nextSequence);
    this.#database
      .prepare(
        `INSERT INTO agent_led_research_events (
           campaign_id, campaign_sequence, kind, occurred_at,
           payload_json, payload_digest
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaignId,
        sequence,
        kind,
        this.#clock().toISOString(),
        payloadJson,
        canonicalDigest(payload),
      );
  }

  #readRows(campaignId: string): readonly EventRow[] {
    return z.array(eventRowSchema).parse(
      this.#database
        .prepare(
          `SELECT kind, occurred_at, payload_json, payload_digest
             FROM agent_led_research_events
             WHERE campaign_id = ?
             ORDER BY campaign_sequence ASC`,
        )
        .all(campaignId),
    );
  }

  #readView(campaignId: string): ResearchCampaignView | undefined {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;

    const first = rows[0];
    if (first === undefined || first.kind !== "campaign.defined") {
      throw new Error(
        `Agent-led Campaign definition is missing: ${campaignId}`,
      );
    }
    const definitionValue = decodeJson(first.payload_json);
    if (canonicalDigest(definitionValue) !== first.payload_digest) {
      throw new Error(
        `Agent-led Campaign definition digest mismatch: ${campaignId}`,
      );
    }
    const definition = campaignDefinedPayloadSchema.parse(definitionValue);
    if (
      definition.input.campaignId !== campaignId ||
      canonicalDigest(definition.input) !== definition.inputDigest
    ) {
      throw new Error(
        `Agent-led Campaign definition binding mismatch: ${campaignId}`,
      );
    }

    const nativeRuns: NativeRunReceipt[] = [];
    let interruption: z.infer<typeof campaignInterruptionSchema> | undefined;
    for (const row of rows.slice(1)) {
      const value = decodeJson(row.payload_json);
      if (canonicalDigest(value) !== row.payload_digest) {
        throw new Error(
          `Agent-led Campaign event digest mismatch: ${campaignId}`,
        );
      }
      if (row.kind === "native-run.recorded") {
        const event = nativeRunRecordedPayloadSchema.parse(value);
        if (event.inputDigest !== definition.inputDigest) {
          throw new Error(`Native Run input binding mismatch: ${campaignId}`);
        }
        nativeRuns.push(event.receipt);
        continue;
      }
      if (row.kind === "campaign.interrupted") {
        const event = campaignInterruptedPayloadSchema.parse(value);
        if (event.inputDigest !== definition.inputDigest) {
          throw new Error(
            `Campaign interruption input binding mismatch: ${campaignId}`,
          );
        }
        if (interruption !== undefined) {
          throw new Error(`Duplicate Campaign interruption: ${campaignId}`);
        }
        interruption = event.interruption;
        continue;
      }
      throw new Error(`Unsupported agent-led Campaign event: ${row.kind}`);
    }
    const latest = nativeRuns.at(-1);

    return {
      kind: "agent-led-campaign-outcome",
      schemaVersion: 1,
      campaignId,
      inputDigest: definition.inputDigest,
      status:
        interruption === undefined
          ? latest === undefined
            ? "research-continues"
            : statusFor(latest)
          : "incomplete",
      input: definition.input,
      nativeRuns,
      ...(interruption === undefined ? {} : { interruption }),
    };
  }

  #requireView(campaignId: string): ResearchCampaignView {
    const view = this.#readView(campaignId);
    if (view === undefined) throw new AgentLedCampaignNotFoundError(campaignId);
    return view;
  }
}

export function openResearchCampaigns(
  options: OpenResearchCampaignsOptions,
): ResearchCampaigns {
  return new SqliteResearchCampaigns(options);
}
