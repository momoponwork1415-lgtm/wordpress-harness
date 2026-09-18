import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(".");
const upstreamRoot = resolve(
  repositoryRoot,
  "vendor/cloudflare-security-audit-skill/skills/security-audit",
);
const outputPath = resolve(
  repositoryRoot,
  "prompts/wordpress-plugin-research-cloudflare-upstream-v1.md",
);

const upstreamCommit = "c1c8a8c1471069fb0e188eeaff69b8e8db6564a8";
const instructionFiles = [
  "SKILL.md",
  "RECONNAISSANCE.md",
  "HUNTING.md",
  "ATTACK-CLASSES.md",
  "AI-AND-LLM.md",
  "CLIENT-SIDE.md",
  "CLOUD-AND-DEPLOYMENT.md",
  "DATA-ISOLATION-AND-LIFECYCLE.md",
  "DESKTOP-MOBILE-AND-LOCAL-IPC.md",
  "MEMORY-SAFETY-AND-BINARY.md",
  "PROTOCOLS-RPC-AND-MESSAGING.md",
  "RESOURCE-EXHAUSTION-AND-AVAILABILITY.md",
  "SUPPLY-CHAIN-AND-RELEASE.md",
  "WEB-PROTOCOL-AND-AUTH.md",
  "VALIDATION-AND-REPORTING.md",
  "report-schema.json",
];

const overlay = `# WordPress Plugin Research — Cloudflare upstream-derived v1

Upstream repository: https://github.com/cloudflare/security-audit-skill
Upstream commit: ${upstreamCommit}

Run the vendored Cloudflare security-audit skill below in full-audit mode as the inner Research Method for this Campaign. Preserve its reconnaissance, deterministic coverage plan, coverage-led hunting waves, coverage critics, fresh candidate validation, structured records, and independent final-record verification. The following Harness adaptations are authoritative where they conflict with the vendored text:

1. The provider-native Root is the Cloudflare parent. The immutable audit target is \`/workspace/main\`. Pinned WordPress core and other target dependencies are read-only under \`/workspace/dependencies\`; use them to close target-attributable source paths, not as separate audit targets.
2. Use the \`standard\` profile. There is no prior run input in an Independent Trial. Keep Cloudflare run files under \`/workspace/research/cloudflare-audit\`; they are private Root scratch, not Harness state, not a second product ledger, and not proof that the Target is safe.
3. The Root and at most three native subagents may be active concurrently. Schedule Cloudflare's four baseline reconnaissance assignments in batches or perform one in the Root. Preserve their distinct questions and the later fresh-eyes constraints rather than dropping an assignment.
4. This Research Grant is source-only. Do not execute target PHP, WordPress, Composer scripts, builds, tests, browsers, fixtures, or target-controlled processes. Do not access the internet. When runtime behavior is decisive, retain the exact blocker and prepare the Harness Candidate verification recipe requested after this bundle.
5. The vendored validators are retained for provenance but are not available to the sandbox and must not be reconstructed or claimed as executed. Maintain the upstream structured reasoning and scratch artifacts; the Harness validates the final Research Report at the runtime seam.
6. Cloudflare \`confirmed\` is not a Harness Verified Vulnerability. Translate every independently source-supported boundary failure into a Harness Research Candidate, preserve runtime/deployment gaps in \`unresolvedFacts\`, and leave technical confirmation to the fresh Human OS verification stage. Preserve source-grounded but incomplete routes as Research Assessments or parked Programme Leads according to the Harness instructions after this bundle.
7. Do not modify the Target, submit findings, contact maintainers, or perform external actions. Do not include upstream fix-writing or publication work in this Research Grant.
8. Finish the Cloudflare method as far as the wall-time permits, but reserve time for the Harness output contract. Return only the Harness Research Report requested after this method bundle. Do not return \`REPORT.md\`, \`findings.json\`, or \`coverage-ledger.json\` as the final provider response.

The vendored files follow verbatim. Domain companions that reconnaissance finds inapplicable may be skipped during reasoning, but their presence here must not be treated as evidence that their attack class was examined.
`;

const markdownFiles = instructionFiles.filter((filename) =>
  filename.endsWith(".md"),
);

function sectionAnchor(filename) {
  return `vendored-${filename.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}

function inlineVendoredLinks(text) {
  return markdownFiles.reduce(
    (rewritten, filename) =>
      rewritten.replaceAll(`](${filename})`, `](#${sectionAnchor(filename)})`),
    text,
  );
}

const sections = [];
for (const filename of instructionFiles) {
  const text = inlineVendoredLinks(
    await readFile(resolve(upstreamRoot, filename), "utf8"),
  );
  const body = filename.endsWith(".json")
    ? `\`\`\`json\n${text.trimEnd()}\n\`\`\``
    : text.trimEnd();
  sections.push(
    `<a id="${sectionAnchor(filename)}"></a>\n\n<!-- BEGIN vendored ${filename} @ ${upstreamCommit} -->\n\n${body}\n\n<!-- END vendored ${filename} -->`,
  );
}

await writeFile(
  outputPath,
  `${overlay.trimEnd()}\n\n${sections.join("\n\n")}\n`,
  {
    encoding: "utf8",
  },
);
