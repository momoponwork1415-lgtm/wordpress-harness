import type { AIReproductionResult } from "./ai-reproduction-contracts.js";
import type { AIReproductionRecord } from "./human-os-record/contracts.js";

export interface LegacyPacketAIReproductionReader {
  read(attemptId: string): Promise<AIReproductionResult | undefined>;
}

export interface OpenLegacyPacketAIReproductionReaderOptions {
  readonly record: Pick<AIReproductionRecord, "readAIReproductionResult">;
}

class DefaultLegacyPacketAIReproductionReader implements LegacyPacketAIReproductionReader {
  readonly #record: OpenLegacyPacketAIReproductionReaderOptions["record"];

  constructor(options: OpenLegacyPacketAIReproductionReaderOptions) {
    this.#record = options.record;
  }

  async read(attemptId: string): Promise<AIReproductionResult | undefined> {
    return (await this.#record.readAIReproductionResult(attemptId))?.result;
  }
}

export function openLegacyPacketAIReproductionReader(
  options: OpenLegacyPacketAIReproductionReaderOptions,
): LegacyPacketAIReproductionReader {
  return new DefaultLegacyPacketAIReproductionReader(options);
}
