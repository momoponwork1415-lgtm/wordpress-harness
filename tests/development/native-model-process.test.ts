import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { runNativeModelProcess } from "../../src/infrastructure/native-model-process.js";

describe("Native Model Process", () => {
  it("retains bounded stdout when a process times out", async () => {
    const result = await runNativeModelProcess({
      executablePath: process.execPath,
      args: [
        "-e",
        'process.stdout.write("partial-thread-event\\n"); setInterval(() => {}, 1_000);',
      ],
      workingDirectory: tmpdir(),
      environment: process.env,
      timeoutMs: 100,
      maxOutputBytes: 64 * 1024,
    });

    expect(result).toMatchObject({
      kind: "timed-out",
      stdout: "partial-thread-event\n",
    });
  });
});
