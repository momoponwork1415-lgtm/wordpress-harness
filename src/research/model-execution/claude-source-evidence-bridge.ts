import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type {
  SourceEvidenceReceipt,
  SourceEvidenceReceiptV2,
} from "../source-mapping/source-evidence-contracts.js";
import type { AttemptSourceEvidence } from "./contracts.js";

const desiredRelationSchema = z.enum([
  "definition",
  "usage",
  "caller",
  "callee",
  "wrapper",
  "guard",
  "state",
  "source-range",
]);

const sourceSearchInputSchema = z.strictObject({
  literal: z.string().min(1).max(256),
  paths: z.array(z.string().min(1).max(4096)).min(1).optional(),
  desiredRelation: desiredRelationSchema,
  reason: z.string().min(1).max(1024),
});

const sourceListInputSchema = z.strictObject({
  prefix: z.string().min(1).max(4096).optional(),
  reason: z.string().min(1).max(1024),
});

const sourceReadInputSchema = z
  .strictObject({
    path: z.string().min(1).max(4096),
    fileDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    desiredRelation: desiredRelationSchema,
    reason: z.string().min(1).max(1024),
  })
  .refine((input) => input.endLine >= input.startLine, {
    message: "Source range end must not precede its start",
    path: ["endLine"],
  });

const v2ScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("root") }),
  z.strictObject({
    kind: z.literal("directory"),
    path: z.string().min(1).max(4096),
  }),
]);

const sourceListInputV2Schema = z.strictObject({
  selector: z
    .strictObject({
      scope: v2ScopeSchema,
      traversal: z.enum(["children", "recursive"]),
    })
    .optional(),
  cursor: z.string().min(1).max(16_384).optional(),
  reason: z.string().min(1).max(1024),
});

const sourceSearchInputV2Schema = z.strictObject({
  selector: z
    .strictObject({
      literal: z.string().min(1).max(256),
      scope: z.discriminatedUnion("kind", [
        ...v2ScopeSchema.options,
        z.strictObject({
          kind: z.literal("files"),
          paths: z.array(z.string().min(1).max(4096)).min(1),
        }),
      ]),
    })
    .optional(),
  cursor: z.string().min(1).max(16_384).optional(),
  reason: z.string().min(1).max(1024),
});

const sourceReadInputV2Schema = z.strictObject({
  selector: z
    .strictObject({
      path: z.string().min(1).max(4096),
      fileDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    })
    .optional(),
  cursor: z.string().min(1).max(16_384).optional(),
  reason: z.string().min(1).max(1024),
});

const researchCheckpointInputSchema = z.strictObject({
  subject: z.record(z.string(), z.unknown()),
});

export const claudeSourceEvidenceToolNames = [
  "mcp__source_evidence__source_list",
  "mcp__source_evidence__source_search",
  "mcp__source_evidence__source_read",
] as const;

export interface ClaudeSourceEvidenceBridge {
  readonly mcpConfigPath: string;
  readonly allowedToolNames: readonly string[];
  observedConnection(): boolean;
  close(): Promise<void>;
}

export type ClaudeSourceEvidenceToolObservation =
  | {
      readonly kind: "model-tool-started";
      readonly toolName: string;
      readonly toolOrdinal: number;
    }
  | {
      readonly kind: "model-tool-completed";
      readonly toolName: string;
      readonly toolOrdinal: number;
      readonly resultStatus:
        | "completed"
        | "identity-mismatch"
        | "invalid-query"
        | "truncated"
        | "not-found"
        | "partial"
        | "policy-denied"
        | "budget-exhausted";
      readonly receiptDigest?: string;
    }
  | {
      readonly kind: "model-tool-failed";
      readonly toolName: string;
      readonly toolOrdinal: number;
      readonly reason: "tool-call-threw";
    };

export interface ClaudeSourceEvidenceToolObserver {
  observe(event: ClaudeSourceEvidenceToolObservation): void;
}

function toolResult(receipt: SourceEvidenceReceipt | SourceEvidenceReceiptV2): {
  content: [{ type: "text"; text: string }];
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: receipt.value.result.status,
          receiptDigest: receipt.ref.digest,
          response: receipt.response,
        }),
      },
    ],
  };
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
}

function matchesBearerCredential(
  authorization: string | undefined,
  bearerToken: string,
): boolean {
  const expected = Buffer.from(`Bearer ${bearerToken}`);
  const observed = Buffer.from(authorization ?? "");
  return (
    expected.byteLength === observed.byteLength &&
    timingSafeEqual(expected, observed)
  );
}

export async function openClaudeSourceEvidenceBridge(
  sourceEvidence: AttemptSourceEvidence,
  toolObserver?: ClaudeSourceEvidenceToolObserver,
): Promise<ClaudeSourceEvidenceBridge> {
  let connectionObserved = false;
  let toolOrdinal = 0;
  const observe = (event: ClaudeSourceEvidenceToolObservation): void => {
    try {
      toolObserver?.observe(event);
    } catch {
      // Observability must not change source evidence collection.
    }
  };
  const runSourceTool = async (
    toolName: string,
    query: () => Promise<SourceEvidenceReceipt | SourceEvidenceReceiptV2>,
  ): Promise<SourceEvidenceReceipt | SourceEvidenceReceiptV2> => {
    const ordinal = (toolOrdinal += 1);
    observe({
      kind: "model-tool-started",
      toolName,
      toolOrdinal: ordinal,
    });
    try {
      const receipt = await query();
      observe({
        kind: "model-tool-completed",
        toolName,
        toolOrdinal: ordinal,
        resultStatus: receipt.value.result.status,
        receiptDigest: receipt.ref.digest,
      });
      return receipt;
    } catch (error: unknown) {
      observe({
        kind: "model-tool-failed",
        toolName,
        toolOrdinal: ordinal,
        reason: "tool-call-threw",
      });
      throw error;
    }
  };
  const runCheckpointTool = async (
    checkpoint: () => Promise<unknown>,
  ): Promise<unknown> => {
    const toolName = "checkpoint_research";
    const ordinal = (toolOrdinal += 1);
    observe({
      kind: "model-tool-started",
      toolName,
      toolOrdinal: ordinal,
    });
    try {
      const result = await checkpoint();
      observe({
        kind: "model-tool-completed",
        toolName,
        toolOrdinal: ordinal,
        resultStatus: "completed",
      });
      return result;
    } catch (error: unknown) {
      observe({
        kind: "model-tool-failed",
        toolName,
        toolOrdinal: ordinal,
        reason: "tool-call-threw",
      });
      throw error;
    }
  };
  const handler = createMcpHandler(() => {
    connectionObserved = true;
    const server = new McpServer({
      name: "wordpress-harness-source-evidence",
      version: "1.0.0",
    });
    const annotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } as const;
    server.registerTool(
      "source_list",
      {
        description:
          "List manifest-bound files in the admitted immutable Target Snapshot, optionally below a normalized directory prefix. This is navigation evidence, not proof of reachability or safety.",
        inputSchema:
          sourceEvidence.schemaVersion === 2
            ? sourceListInputV2Schema
            : sourceListInputSchema,
        annotations,
      },
      async (input: unknown) => {
        if (sourceEvidence.schemaVersion === 2) {
          const { selector, cursor, reason } =
            sourceListInputV2Schema.parse(input);
          return toolResult(
            await runSourceTool("source_list", () =>
              sourceEvidence.query({
                kind: "source-list",
                ...(selector === undefined ? {} : { selector }),
                ...(cursor === undefined ? {} : { cursor }),
                reason,
              }),
            ),
          );
        }
        const { prefix, reason } = sourceListInputSchema.parse(input);
        return toolResult(
          await runSourceTool("source_list", () =>
            sourceEvidence.query({
              kind: "list-snapshot-files",
              schemaVersion: 1,
              subject: prefix === undefined ? {} : { prefix },
              desiredRelation: "inventory",
              reason,
            }),
          ),
        );
      },
    );
    server.registerTool(
      "source_search",
      {
        description:
          "Search an exact literal in the admitted immutable Target Snapshot. Returns source anchors and a durable receipt; it does not prove reachability or safety.",
        inputSchema:
          sourceEvidence.schemaVersion === 2
            ? sourceSearchInputV2Schema
            : sourceSearchInputSchema,
        annotations,
      },
      async (input: unknown) => {
        if (sourceEvidence.schemaVersion === 2) {
          const { selector, cursor, reason } =
            sourceSearchInputV2Schema.parse(input);
          return toolResult(
            await runSourceTool("source_search", () =>
              sourceEvidence.query({
                kind: "source-search",
                ...(selector === undefined ? {} : { selector }),
                ...(cursor === undefined ? {} : { cursor }),
                reason,
              }),
            ),
          );
        }
        const { literal, paths, desiredRelation, reason } =
          sourceSearchInputSchema.parse(input);
        return toolResult(
          await runSourceTool("source_search", () =>
            sourceEvidence.query({
              kind: "search-snapshot",
              schemaVersion: 1,
              subject: {
                literal,
                scope:
                  paths === undefined
                    ? { kind: "snapshot" }
                    : { kind: "paths", paths },
              },
              desiredRelation,
              reason,
            }),
          ),
        );
      },
    );
    server.registerTool(
      "source_read",
      {
        description:
          "Read a line range from one manifest-bound source file using its digest. Returns untrusted Target source and a durable receipt.",
        inputSchema:
          sourceEvidence.schemaVersion === 2
            ? sourceReadInputV2Schema
            : sourceReadInputSchema,
        annotations,
      },
      async (input: unknown) => {
        if (sourceEvidence.schemaVersion === 2) {
          const { selector, cursor, reason } =
            sourceReadInputV2Schema.parse(input);
          return toolResult(
            await runSourceTool("source_read", () =>
              sourceEvidence.query({
                kind: "source-read",
                ...(selector === undefined ? {} : { selector }),
                ...(cursor === undefined ? {} : { cursor }),
                reason,
              }),
            ),
          );
        }
        const {
          path,
          fileDigest,
          startLine,
          endLine,
          desiredRelation,
          reason,
        } = sourceReadInputSchema.parse(input);
        return toolResult(
          await runSourceTool("source_read", () =>
            sourceEvidence.query({
              kind: "read-source-range",
              schemaVersion: 1,
              subject: {
                path,
                fileDigest,
                startLine,
                endLine,
              },
              desiredRelation,
              reason,
            }),
          ),
        );
      },
    );
    if (sourceEvidence.checkpoint !== undefined) {
      const checkpointResearch = sourceEvidence.checkpoint;
      server.registerTool(
        "checkpoint_research",
        {
          description:
            "Durably checkpoint one source-bound research subject before continuing exploration. This records a candidate, fragment, or gap; it does not validate a Finding.",
          inputSchema: researchCheckpointInputSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (input: unknown) => {
          const { subject } = researchCheckpointInputSchema.parse(input);
          const checkpoint = await runCheckpointTool(() =>
            checkpointResearch(subject),
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  checkpoint,
                }),
              },
            ],
          };
        },
      );
    }
    return server;
  });
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const bearerToken = randomBytes(32).toString("hex");
  const httpServer = createServer((request, response) => {
    if (
      !validateHost(request, response) ||
      !validateOrigin(request, response)
    ) {
      return;
    }
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (!matchesBearerCredential(request.headers.authorization, bearerToken)) {
      response.writeHead(401, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32_000, message: "Unauthorized" },
          id: null,
        }),
      );
      return;
    }
    const requestWithDefaults = Object.assign(request, {
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });
    void nodeHandler(requestWithDefaults, response);
  });

  let configDirectory: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(0, "127.0.0.1", () => {
        httpServer.off("error", onError);
        resolve();
      });
    });
    const address = httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Source Evidence bridge did not bind a TCP port");
    }
    configDirectory = await mkdtemp(
      join(tmpdir(), "wordpress-harness-claude-mcp-"),
    );
    await chmod(configDirectory, 0o700);
    const mcpConfigPath = join(configDirectory, "mcp.json");
    await writeFile(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          source_evidence: {
            type: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: { Authorization: `Bearer ${bearerToken}` },
            alwaysLoad: true,
          },
        },
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    const privateConfigDirectory = configDirectory;

    return {
      mcpConfigPath,
      allowedToolNames: [
        ...claudeSourceEvidenceToolNames,
        ...(sourceEvidence.checkpoint === undefined
          ? []
          : ["mcp__source_evidence__checkpoint_research"]),
      ],
      observedConnection: () => connectionObserved,
      close: async () => {
        try {
          await closeHttpServer(httpServer);
        } finally {
          try {
            await handler.close();
          } finally {
            await rm(privateConfigDirectory, { force: true, recursive: true });
          }
        }
      },
    };
  } catch (error: unknown) {
    await closeHttpServer(httpServer).catch(() => undefined);
    await handler.close().catch(() => undefined);
    if (configDirectory !== undefined) {
      await rm(configDirectory, { force: true, recursive: true });
    }
    throw error;
  }
}
