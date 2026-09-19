import { z } from "zod";

import { providerResearchReportSchema } from "./provider-research-report.js";

export type ProviderResearchReport = z.infer<
  typeof providerResearchReportSchema
>;

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    for (const repaired of [
      repairOneRedundantObjectComma(value),
      repairOneKnownTopLevelKey(value),
      repairOnePrematureItemArrayClosure(value),
      repairMissingEvidenceSummaryClosure(value),
      repairOnePrematureTopLevelClosureBeforeDecision(value),
      repairOneMissingFinalObjectClosure(value),
    ]) {
      if (repaired === undefined) continue;
      try {
        return JSON.parse(repaired) as unknown;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

function repairOnePrematureTopLevelClosureBeforeDecision(
  value: string,
): string | undefined {
  const malformed = '},"decision":';
  const containers: string[] = [];
  let insideString = false;
  let escaped = false;
  const matches: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
      continue;
    }
    if (
      character === "}" &&
      containers.length === 1 &&
      containers[0] === "{" &&
      value.startsWith(malformed, index)
    ) {
      matches.push(index);
    }
    if (character === "{" || character === "[") {
      containers.push(character);
    } else if (character === "}" || character === "]") {
      containers.pop();
    }
  }
  const index = matches.length === 1 ? matches[0] : undefined;
  return index === undefined
    ? undefined
    : `${value.slice(0, index)}${value.slice(index + 1)}`;
}

function repairOneRedundantObjectComma(value: string): string | undefined {
  const containers: string[] = [];
  let insideString = false;
  let escaped = false;
  let previousSignificant: string | undefined;
  let repairs = 0;
  let repaired = "";
  for (const character of value) {
    if (insideString) {
      repaired += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
      previousSignificant = character;
      repaired += character;
      continue;
    }
    if (
      character === "," &&
      previousSignificant === "," &&
      containers.at(-1) === "{"
    ) {
      repairs += 1;
      if (repairs > 1) return undefined;
      continue;
    }
    repaired += character;
    if (/\s/.test(character)) continue;
    if (character === "{" || character === "[") {
      containers.push(character);
    } else if (character === "}" || character === "]") {
      containers.pop();
    }
    previousSignificant = character;
  }
  return repairs === 1 ? repaired : undefined;
}

function repairOnePrematureItemArrayClosure(value: string): string | undefined {
  const malformed = '}]}],"controlAssessments":';
  const repairedBoundary = '}],"controlAssessments":';
  const matches: number[] = [];
  let insideString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
      continue;
    }
    if (value.startsWith(malformed, index)) matches.push(index);
  }
  if (matches.length === 0 || matches.length > 64) return undefined;
  let repaired = value;
  for (const index of [...matches].reverse()) {
    repaired = `${repaired.slice(0, index)}${repairedBoundary}${repaired.slice(index + malformed.length)}`;
  }
  return repaired;
}

function repairOneMissingFinalObjectClosure(value: string): string | undefined {
  const containers: string[] = [];
  let insideString = false;
  let escaped = false;
  let mismatched = false;
  for (const character of value) {
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
    } else if (character === "{" || character === "[") {
      containers.push(character);
    } else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (containers.pop() !== expected) mismatched = true;
    }
  }
  if (
    insideString ||
    mismatched ||
    containers.length !== 1 ||
    containers[0] !== "{"
  ) {
    return undefined;
  }
  const trimmed = value.trimEnd();
  return `${trimmed}}${value.slice(trimmed.length)}`;
}

function repairMissingEvidenceSummaryClosure(
  value: string,
): string | undefined {
  const malformed = '],"candidates":';
  const matches: number[] = [];
  let insideString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
      continue;
    }
    if (value.startsWith(malformed, index)) matches.push(index);
  }
  const index = matches.length === 1 ? matches[0] : undefined;
  return index === undefined
    ? undefined
    : `${value.slice(0, index + 1)}}${value.slice(index + 1)}`;
}

const reportTopLevelKeys = [
  "schemaVersion",
  "evidenceSummary",
  "candidates",
  "assessments",
  "parkedProgrammeLeads",
  "decision",
] as const;

function repairOneKnownTopLevelKey(value: string): string | undefined {
  const containers: string[] = [];
  let insideString = false;
  let escaped = false;
  let previousSignificant: string | undefined;
  let repairs = 0;
  let repaired = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (insideString) {
      repaired += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        insideString = false;
      }
      continue;
    }
    if (character === '"') {
      insideString = true;
      previousSignificant = character;
      repaired += character;
      continue;
    }
    const topLevelKeyPosition =
      containers.length === 1 &&
      containers[0] === "{" &&
      (previousSignificant === "{" || previousSignificant === ",");
    if (topLevelKeyPosition && !/\s/.test(character)) {
      const key = reportTopLevelKeys.find((candidate) => {
        if (!value.startsWith(candidate, index)) return false;
        let delimiterIndex = index + candidate.length;
        while (/\s/.test(value[delimiterIndex] ?? "")) delimiterIndex += 1;
        return value[delimiterIndex] === ":";
      });
      if (key !== undefined) {
        repairs += 1;
        if (repairs > 1) return undefined;
        repaired += `"${key}"`;
        index += key.length - 1;
        previousSignificant = '"';
        continue;
      }
    }
    repaired += character;
    if (/\s/.test(character)) continue;
    if (character === "{" || character === "[") {
      containers.push(character);
    } else if (character === "}" || character === "]") {
      containers.pop();
    }
    previousSignificant = character;
  }
  return repairs === 1 ? repaired : undefined;
}

function trailingJsonObject(value: string): unknown {
  const text = value.trim();
  if (!text.endsWith("}")) return undefined;
  let depth = 0;
  let insideString = false;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === '"') {
      let precedingBackslashes = 0;
      for (
        let escapeIndex = index - 1;
        escapeIndex >= 0 && text[escapeIndex] === "\\";
        escapeIndex -= 1
      ) {
        precedingBackslashes += 1;
      }
      if (precedingBackslashes % 2 === 0) insideString = !insideString;
      continue;
    }
    if (insideString) continue;
    if (character === "}") {
      depth += 1;
      continue;
    }
    if (character !== "{") continue;
    depth -= 1;
    if (depth === 0) return parseJson(text.slice(index));
    if (depth < 0) return undefined;
  }
  return undefined;
}

function normalizeOmittedCandidateDelta(value: unknown): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.hasOwn(value, "candidates")
  ) {
    return value;
  }
  return { ...value, candidates: [] };
}

export function promptedJsonResearchPrompt(
  prompt: string,
  providerName: string,
): string {
  return `${prompt}

${providerName} final Research Report JSON Schema:
${JSON.stringify(z.toJSONSchema(providerResearchReportSchema))}

Use the source tools for the investigation before producing the final answer. At the end, return exactly one JSON object matching this schema in the response text. Do not wrap it in Markdown or add prose outside the JSON object.`;
}

export function parsePromptedJsonResearchReport(
  value: string,
): ProviderResearchReport | undefined {
  const whole = parseJson(value);
  const parsed = providerResearchReportSchema.safeParse(
    normalizeOmittedCandidateDelta(
      whole === undefined ? trailingJsonObject(value) : whole,
    ),
  );
  return parsed.success ? parsed.data : undefined;
}
