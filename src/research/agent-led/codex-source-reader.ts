import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createInterface } from "node:readline";

const readableRoots = ["/workspace/main", "/workspace/dependencies"] as const;
const maximumLineLength = 8_000;

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function integerValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(Math.max(value, minimum), maximum)
    : fallback;
}

function shortened(line: string): string {
  return line.length <= maximumLineLength
    ? line
    : `${line.slice(0, maximumLineLength)}…`;
}

async function sealedPath(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("Expected a non-empty source path.");
  }
  const candidate = await realpath(resolve("/workspace", value));
  if (
    !readableRoots.some(
      (root) => candidate === root || candidate.startsWith(`${root}${sep}`),
    )
  ) {
    throw new Error("The requested path is outside the sealed sources.");
  }
  return candidate;
}

async function listFiles(argumentsValue: unknown): Promise<string> {
  const args = objectValue(argumentsValue);
  const root = await sealedPath(args.path ?? "/workspace/main");
  const maximum = integerValue(args.maximum, 1_000, 1, 4_000);
  const contains = typeof args.contains === "string" ? args.contains : "";
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0 && files.length < maximum) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pending.push(path);
      if (
        entry.isFile() &&
        (contains.length === 0 || path.includes(contains))
      ) {
        files.push(path);
      }
      if (files.length >= maximum) break;
    }
  }
  return files.join("\n");
}

async function readText(argumentsValue: unknown): Promise<string> {
  const args = objectValue(argumentsValue);
  const path = await sealedPath(args.path);
  if (!(await stat(path)).isFile()) throw new Error("Expected a source file.");
  const lines = (await readFile(path, "utf8")).split("\n");
  const start = integerValue(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
  const requestedEnd = integerValue(
    args.endLine,
    start + 399,
    start,
    Number.MAX_SAFE_INTEGER,
  );
  const end = Math.min(requestedEnd, start + 399, lines.length);
  return lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}:${shortened(line)}`)
    .join("\n");
}

async function searchText(argumentsValue: unknown): Promise<string> {
  const args = objectValue(argumentsValue);
  if (
    typeof args.query !== "string" ||
    args.query.length === 0 ||
    args.query.length > 256
  ) {
    throw new Error("Expected a literal query of at most 256 characters.");
  }
  const root = await sealedPath(args.path ?? "/workspace/main");
  const caseSensitive = args.caseSensitive !== false;
  const query = caseSensitive ? args.query : args.query.toLowerCase();
  const maximum = integerValue(args.maximum, 200, 1, 1_000);
  const pending = [root];
  const matches: string[] = [];
  while (pending.length > 0 && matches.length < maximum) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pending.push(path);
      if (!entry.isFile()) continue;
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch {
        continue;
      }
      for (const [index, line] of text.split("\n").entries()) {
        const haystack = caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(query)) {
          matches.push(`${path}:${index + 1}:${shortened(line)}`);
        }
        if (matches.length >= maximum) break;
      }
      if (matches.length >= maximum) break;
    }
  }
  return matches.join("\n");
}

const tools = [
  {
    name: "list_files",
    description:
      "List files recursively within the sealed target or dependency sources.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        contains: { type: "string" },
        maximum: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_text",
    description: "Read at most 400 numbered lines from a sealed source file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "integer" },
        endLine: { type: "integer" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_text",
    description: "Search sealed source files for a literal string.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        caseSensitive: { type: "boolean" },
        maximum: { type: "integer" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
] as const;

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request: Record<string, unknown>;
  try {
    request = objectValue(JSON.parse(line));
  } catch {
    continue;
  }
  const params = objectValue(request.params);
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion:
          typeof params.protocolVersion === "string"
            ? params.protocolVersion
            : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "sealed-source-reader", version: "1.0.0" },
      },
    });
    continue;
  }
  if (request.method === "notifications/initialized") continue;
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools } });
    continue;
  }
  if (request.method === "tools/call") {
    try {
      const name = params.name;
      const argumentsValue = params.arguments;
      const text =
        name === "list_files"
          ? await listFiles(argumentsValue)
          : name === "read_text"
            ? await readText(argumentsValue)
            : name === "search_text"
              ? await searchText(argumentsValue)
              : undefined;
      if (text === undefined) throw new Error("Unknown source-reader tool.");
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text }] },
      });
    } catch (error: unknown) {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : "Tool failed.",
            },
          ],
        },
      });
    }
    continue;
  }
  if (request.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "Method not found." },
    });
  }
}
