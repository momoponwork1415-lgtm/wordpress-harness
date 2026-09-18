import { z } from "zod";

import { providerResearchReportSchema } from "./provider-research-report.js";

export type ProviderResearchReport = z.infer<
  typeof providerResearchReportSchema
>;

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
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
    whole === undefined ? trailingJsonObject(value) : whole,
  );
  return parsed.success ? parsed.data : undefined;
}
