import { canonicalJson } from "../acquisition/canonical-json.js";
import {
  normalizedProgrammePolicySchema,
  programmeEligibilitySchema,
  programmePolicyConflictSignalSchema,
  type ProgrammePolicySourceAdapter,
  type ProgrammePolicySourceContent,
} from "../programme-intelligence/contracts.js";
import {
  wordfenceProgrammePageDocumentSchema,
  wordfenceProgrammeSourceKindSchema,
  type CreateWordfenceProgrammeAdaptersOptions,
  type WordfenceProgrammePageAdapter,
  type WordfenceProgrammePageDocument,
  type WordfenceProgrammeSourceKind,
} from "./contracts.js";

const sourceOrder: readonly WordfenceProgrammeSourceKind[] = [
  "programme",
  "terms",
  "report-form",
  "payout",
  "promotion",
  "monthly-report",
];

function sourceId(kind: WordfenceProgrammeSourceKind): string {
  const ordinal = sourceOrder.indexOf(kind) + 1;
  return `programme:wordfence:0${ordinal}-${kind}`;
}

function conflictSignal() {
  return programmePolicyConflictSignalSchema.parse({
    kind: "programme-policy-conflict",
    schemaVersion: 1,
  });
}

function hasEligibilityConflict(
  authoritative: NonNullable<
    WordfenceProgrammePageDocument["assertions"]["eligibility"]
  >,
  asserted: NonNullable<
    WordfenceProgrammePageDocument["assertions"]["eligibility"]
  >,
): boolean {
  const keys = [
    "assets",
    "vulnerabilityClasses",
    "attackerRoles",
    "activeInstallThreshold",
    "researcherTiers",
    "exclusions",
    "conditions",
    "limits",
  ] as const;
  return keys.some(
    (key) =>
      asserted[key] !== undefined &&
      canonicalJson(asserted[key]) !== canonicalJson(authoritative[key]),
  );
}

async function normalizePages(
  pages: readonly WordfenceProgrammePageAdapter[],
  sources: readonly ProgrammePolicySourceContent[],
): Promise<unknown> {
  const documents: WordfenceProgrammePageDocument[] = [];
  for (const expectedKind of sourceOrder) {
    const page = pages.find(
      (candidate) => candidate.sourceKind === expectedKind,
    );
    const content = sources.find(
      (candidate) => candidate.sourceId === sourceId(expectedKind),
    );
    if (page === undefined || content === undefined) {
      throw new Error("Wordfence Programme required source is missing");
    }
    const document = wordfenceProgrammePageDocumentSchema.parse(
      await page.parse(content.bytes),
    );
    if (document.sourceKind !== expectedKind) {
      throw new Error("Wordfence Programme source binding is invalid");
    }
    if (
      expectedKind !== "monthly-report" &&
      document.assertions.monthlyAggregates !== undefined
    ) {
      throw new Error("Wordfence monthly aggregates have an invalid source");
    }
    documents.push(document);
  }

  const programme = documents[0];
  if (programme === undefined) {
    throw new Error("Wordfence Programme source is missing");
  }
  const eligibilityResult = programmeEligibilitySchema.safeParse(
    programme.assertions.eligibility,
  );
  if (
    !eligibilityResult.success ||
    eligibilityResult.data.conditions === undefined ||
    eligibilityResult.data.limits === undefined ||
    !eligibilityResult.data.limits.some(
      (limit) => limit.key === "pending-submission-cap",
    ) ||
    programme.assertions.programmeOpportunityBand === undefined ||
    programme.assertions.rewardFactors === undefined
  ) {
    throw new Error("Wordfence Programme source is incomplete");
  }

  for (const document of documents.slice(1)) {
    if (
      document.assertions.eligibility !== undefined &&
      hasEligibilityConflict(
        eligibilityResult.data,
        document.assertions.eligibility,
      )
    ) {
      return conflictSignal();
    }
    if (
      document.assertions.programmeOpportunityBand !== undefined &&
      document.assertions.programmeOpportunityBand !==
        programme.assertions.programmeOpportunityBand
    ) {
      return conflictSignal();
    }
    if (
      document.assertions.rewardFactors !== undefined &&
      canonicalJson(document.assertions.rewardFactors) !==
        canonicalJson(programme.assertions.rewardFactors)
    ) {
      return conflictSignal();
    }
  }

  const routes = new Map<
    string,
    NonNullable<
      WordfenceProgrammePageDocument["assertions"]["rewardRoutes"]
    >[number]
  >();
  for (const document of documents) {
    for (const route of document.assertions.rewardRoutes ?? []) {
      const existing = routes.get(route.id);
      if (
        existing !== undefined &&
        canonicalJson(existing) !== canonicalJson(route)
      ) {
        return conflictSignal();
      }
      routes.set(route.id, route);
    }
  }
  if (routes.size === 0) {
    throw new Error("Wordfence reward route is missing");
  }
  const currencies = new Set(
    [...routes.values()].map((route) => route.currency),
  );
  if (currencies.size !== 1) {
    return conflictSignal();
  }
  const currency = [...currencies][0];
  if (currency === undefined) {
    throw new Error("Wordfence reward currency is missing");
  }
  if (
    [...routes.values()].some(
      (route) =>
        !route.terms.some(
          (term) => term.key === "payout-guaranteed" && term.value === false,
        ),
    )
  ) {
    throw new Error("Wordfence payout must remain an estimate");
  }

  const promotion = documents.find(
    (document) => document.sourceKind === "promotion",
  );
  const promotionRoutes = promotion?.assertions.rewardRoutes;
  if (
    promotionRoutes === undefined ||
    !promotionRoutes.some(
      (route) =>
        route.kind === "time-limited-promotion" &&
        route.terms.some((term) => term.key === "promotion-start") &&
        route.terms.some((term) => term.key === "promotion-end"),
    )
  ) {
    throw new Error("Wordfence promotion source is incomplete");
  }

  const monthlyReport = documents.find(
    (document) => document.sourceKind === "monthly-report",
  );
  const monthlyAggregates = monthlyReport?.assertions.monthlyAggregates;
  if (monthlyAggregates === undefined) {
    throw new Error("Wordfence monthly aggregate is missing");
  }
  if (
    monthlyAggregates.some(
      (aggregate) => aggregate.reward.currency !== currency,
    )
  ) {
    return conflictSignal();
  }

  return normalizedProgrammePolicySchema.parse({
    programmeIdentity: "programme:wordfence",
    eligibility: eligibilityResult.data,
    programmeOpportunityBand: programme.assertions.programmeOpportunityBand,
    rewardEstimateInput: {
      kind: "finding-only-reward-estimate-input",
      currency,
      factors: programme.assertions.rewardFactors,
      routes: [...routes.values()].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
    },
    monthlyAggregates,
  });
}

export function createWordfenceProgrammeAdapters(
  options: CreateWordfenceProgrammeAdaptersOptions,
): readonly ProgrammePolicySourceAdapter[] {
  const pages = [...options.pages];
  for (const page of pages) {
    wordfenceProgrammeSourceKindSchema.parse(page.sourceKind);
  }
  if (
    pages.length !== sourceOrder.length ||
    sourceOrder.some(
      (kind) => pages.filter((page) => page.sourceKind === kind).length !== 1,
    )
  ) {
    throw new Error("Wordfence Programme requires exactly six source pages");
  }
  return sourceOrder.map((kind) => {
    const page = pages.find((candidate) => candidate.sourceKind === kind);
    if (page === undefined) {
      throw new Error("Wordfence Programme required source is missing");
    }
    return {
      sourceId: sourceId(kind),
      programmeIdentity: "programme:wordfence",
      sourceUrl: page.sourceUrl,
      parserVersion: page.parserVersion,
      retrieve: () => page.retrieve(),
      parse: (_bytes, sources) => {
        if (sources === undefined) {
          throw new Error("Wordfence Programme source context is missing");
        }
        return normalizePages(pages, sources);
      },
    };
  });
}
