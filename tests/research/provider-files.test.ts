import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProviderCredentialFiles } from "../../src/research/agent-led/provider-files.js";

const temporaryDirectories: string[] = [];
const syntheticSecret = "synthetic-provider-credential";
const credentialText = JSON.stringify({ access_token: syntheticSecret });

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "provider-files-"));
  temporaryDirectories.push(root);
  const source = join(root, "source");
  const destination = join(root, "destination");
  await Promise.all([mkdir(source), mkdir(destination)]);
  return { root, source, destination };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Provider credential files", () => {
  it("copies only declared credentials and removes them without removing session state", async () => {
    const { source, destination } = await workspace();
    await Promise.all([
      writeFile(join(source, "auth.json"), credentialText),
      writeFile(join(source, "agent_id"), "synthetic-agent-identity\n"),
      writeFile(join(source, "settings.json"), "{}"),
      writeFile(join(destination, "session.json"), "{}"),
    ]);
    const credentials = new ProviderCredentialFiles(["auth.json", "agent_id"]);

    await credentials.copyTo(source, destination);

    expect((await readdir(destination)).sort()).toEqual([
      "agent_id",
      "auth.json",
      "session.json",
    ]);
    expect(await readFile(join(destination, "auth.json"), "utf8")).toBe(
      credentialText,
    );
    expect((await stat(join(destination, "auth.json"))).mode & 0o777).toBe(
      0o600,
    );

    await credentials.removeFrom(destination);

    expect(await readdir(destination)).toEqual(["session.json"]);
    expect(await readFile(join(source, "auth.json"), "utf8")).toBe(
      credentialText,
    );
    const redact = credentials.redact;
    expect(
      redact(`failure: ${syntheticSecret}, synthetic-agent-identity`),
    ).toBe("failure: [REDACTED], [REDACTED]");
  });

  it("can remove a partial copy while retaining its diagnostic redaction", async () => {
    const { source, destination } = await workspace();
    await writeFile(join(source, "auth.json"), credentialText);
    const credentials = new ProviderCredentialFiles(["auth.json", "missing"]);

    await expect(credentials.copyTo(source, destination)).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
    await credentials.removeFrom(destination);

    expect(await readdir(destination)).toEqual([]);
    expect(credentials.redact(`failure: ${credentialText}`)).toBe(
      "failure: [REDACTED]",
    );
  });

  it("refuses to overwrite a destination credential", async () => {
    const { source, destination } = await workspace();
    await writeFile(join(source, "auth.json"), credentialText);
    await writeFile(join(destination, "auth.json"), "existing-test-value");
    const credentials = new ProviderCredentialFiles(["auth.json"]);

    await expect(credentials.copyTo(source, destination)).rejects.toMatchObject(
      {
        code: "EEXIST",
      },
    );
    expect(await readFile(join(destination, "auth.json"), "utf8")).toBe(
      "existing-test-value",
    );
  });

  it("refuses a credential source outside its bound directory", async () => {
    const { root, source, destination } = await workspace();
    const outside = join(root, "outside.json");
    await writeFile(outside, credentialText);
    await symlink(outside, join(source, "auth.json"));
    const credentials = new ProviderCredentialFiles(["auth.json"]);

    await expect(credentials.copyTo(source, destination)).rejects.toThrow(
      "Provider credential is outside the bound directory",
    );
    expect(await readdir(destination)).toEqual([]);
  });

  it("reports a credential removal failure to the state owner", async () => {
    const { destination } = await workspace();
    await mkdir(join(destination, "auth.json"));
    const credentials = new ProviderCredentialFiles(["auth.json"]);

    await expect(credentials.removeFrom(destination)).rejects.toThrow();
  });
});
