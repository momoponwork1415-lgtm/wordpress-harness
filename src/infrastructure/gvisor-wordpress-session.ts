import { randomUUID } from "node:crypto";

import { z } from "zod";

export interface ContainerProcessRequest {
  readonly executable: "docker";
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface ContainerProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ContainerProcessRunner {
  run(request: ContainerProcessRequest): Promise<ContainerProcessResult>;
}

export interface GvisorWordPressImages {
  readonly database: string;
  readonly wordpress: string;
  readonly wordpressCli: string;
}

export interface GvisorWordPressPluginSource {
  readonly sourceDirectory: string;
  readonly pluginSlug: string;
}

export interface GvisorWordPressWorker {
  readonly image: string;
  readonly mounts: readonly {
    readonly sourcePath: string;
    readonly containerPath: string;
  }[];
  readonly environment: readonly string[];
  readonly command: readonly string[];
  readonly timeoutMs: number;
}

export interface GvisorWordPressRuntimeObservation {
  readonly wordpress: string;
  readonly php: string;
  readonly database: string;
  readonly webServer: string;
}

export interface GvisorWordPressSession {
  readonly labId: string;
  runWordPressCli(command: readonly string[]): Promise<string>;
  runWorker(worker: GvisorWordPressWorker): Promise<string>;
  observeRuntime(): Promise<GvisorWordPressRuntimeObservation>;
  dispose(): Promise<boolean>;
}

export interface EstablishGvisorWordPressSessionOptions {
  readonly processRunner: ContainerProcessRunner;
  readonly images: GvisorWordPressImages;
  readonly plugins: readonly GvisorWordPressPluginSource[];
  readonly canonicalConfiguration?: {
    readonly locale: "en_US";
    readonly timezone: "UTC";
  };
}

const ipv4AddressSchema = z.string().refine((value) => {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/u.test(octet)) return false;
      const number = Number(octet);
      return number >= 0 && number <= 255;
    })
  );
}, "Lab container address must be an IPv4 address");

export class GvisorWordPressSessionError extends Error {
  readonly phase: "setup" | "activation" | "health";

  constructor(phase: "setup" | "activation" | "health") {
    super(`gVisor WordPress session ${phase} failed`);
    this.name = "GvisorWordPressSessionError";
    this.phase = phase;
  }
}

async function run(
  processRunner: ContainerProcessRunner,
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<ContainerProcessResult> {
  return processRunner.run({ executable: "docker", args, timeoutMs });
}

async function requireOutput(
  processRunner: ContainerProcessRunner,
  args: readonly string[],
  phase: "setup" | "activation" | "health",
  timeoutMs = 60_000,
): Promise<string> {
  const result = await run(processRunner, args, timeoutMs);
  if (result.exitCode !== 0) throw new GvisorWordPressSessionError(phase);
  return result.stdout;
}

interface SessionResources {
  readonly network: string;
  readonly volume: string;
  readonly databaseContainer: string;
  readonly wordpressContainer: string;
}

async function disposeResources(
  processRunner: ContainerProcessRunner,
  resources: SessionResources,
): Promise<boolean> {
  const containers = await run(processRunner, [
    "rm",
    "--force",
    resources.databaseContainer,
    resources.wordpressContainer,
  ]);
  const resourcesRemoved = await Promise.all([
    run(processRunner, ["volume", "rm", "--force", resources.volume]),
    run(processRunner, ["network", "rm", resources.network]),
  ]);
  const removed =
    containers.exitCode === 0 &&
    resourcesRemoved.every((result) => result.exitCode === 0);
  if (removed) return true;

  const remaining = await Promise.all([
    run(processRunner, ["container", "inspect", resources.databaseContainer]),
    run(processRunner, ["container", "inspect", resources.wordpressContainer]),
    run(processRunner, ["volume", "inspect", resources.volume]),
    run(processRunner, ["network", "inspect", resources.network]),
  ]);
  return remaining.every((result) => result.exitCode !== 0);
}

class DefaultGvisorWordPressSession implements GvisorWordPressSession {
  readonly labId: string;
  readonly #processRunner: ContainerProcessRunner;
  readonly #images: GvisorWordPressImages;
  readonly #resources: SessionResources;
  readonly #databaseAddress: string;
  readonly #wordpressAddress: string;
  readonly #databasePassword: string;
  readonly #adminPassword: string;
  #disposed = false;

  constructor(input: {
    readonly labId: string;
    readonly processRunner: ContainerProcessRunner;
    readonly images: GvisorWordPressImages;
    readonly resources: SessionResources;
    readonly databaseAddress: string;
    readonly wordpressAddress: string;
    readonly databasePassword: string;
    readonly adminPassword: string;
  }) {
    this.labId = input.labId;
    this.#processRunner = input.processRunner;
    this.#images = input.images;
    this.#resources = input.resources;
    this.#databaseAddress = input.databaseAddress;
    this.#wordpressAddress = input.wordpressAddress;
    this.#databasePassword = input.databasePassword;
    this.#adminPassword = input.adminPassword;
  }

  async runWordPressCli(command: readonly string[]): Promise<string> {
    this.#requireActive();
    return requireOutput(
      this.#processRunner,
      this.#wpCliArgs(command),
      "health",
    );
  }

  async runWorker(worker: GvisorWordPressWorker): Promise<string> {
    this.#requireActive();
    const args = [
      "run",
      "--rm",
      "--runtime=runsc",
      "--network",
      this.#resources.network,
      "--shm-size=1g",
      "--add-host",
      `wordpress:${this.#wordpressAddress}`,
    ];
    for (const mount of worker.mounts) {
      args.push("--volume", `${mount.sourcePath}:${mount.containerPath}:ro`);
    }
    for (const environment of [
      ...worker.environment,
      "WORDPRESS_BASE_URL=http://wordpress",
      "WORDPRESS_ADMIN_USER=harness-admin",
      `WORDPRESS_ADMIN_PASSWORD=${this.#adminPassword}`,
    ]) {
      args.push("--env", environment);
    }
    args.push(worker.image, ...worker.command);
    return requireOutput(this.#processRunner, args, "health", worker.timeoutMs);
  }

  async observeRuntime(): Promise<GvisorWordPressRuntimeObservation> {
    this.#requireActive();
    const [wordpress, php, database, webServer] = await Promise.all([
      this.runWordPressCli(["core", "version"]),
      requireOutput(
        this.#processRunner,
        [
          "exec",
          this.#resources.wordpressContainer,
          "php",
          "-r",
          "echo PHP_VERSION;",
        ],
        "health",
      ),
      requireOutput(
        this.#processRunner,
        ["exec", this.#resources.databaseContainer, "mariadb", "--version"],
        "health",
      ),
      requireOutput(
        this.#processRunner,
        ["exec", this.#resources.wordpressContainer, "apache2", "-v"],
        "health",
      ),
    ]);
    return {
      wordpress: wordpress.trim(),
      php: php.trim(),
      database: database.trim(),
      webServer: webServer.trim(),
    };
  }

  async dispose(): Promise<boolean> {
    if (this.#disposed) return true;
    const cleaned = await disposeResources(
      this.#processRunner,
      this.#resources,
    );
    if (cleaned) this.#disposed = true;
    return cleaned;
  }

  #wpCliArgs(command: readonly string[]): readonly string[] {
    return [
      "run",
      "--rm",
      "--runtime=runsc",
      "--network",
      this.#resources.network,
      "--env",
      `WORDPRESS_DB_HOST=${this.#databaseAddress}`,
      "--env",
      "WORDPRESS_DB_NAME=wordpress",
      "--env",
      "WORDPRESS_DB_USER=root",
      "--env",
      `WORDPRESS_DB_PASSWORD=${this.#databasePassword}`,
      "--volume",
      `${this.#resources.volume}:/var/www/html`,
      this.#images.wordpressCli,
      "wp",
      ...command,
      "--allow-root",
    ];
  }

  #requireActive(): void {
    if (this.#disposed) throw new Error("gVisor WordPress session is disposed");
  }
}

async function containerAddress(
  processRunner: ContainerProcessRunner,
  container: string,
): Promise<string> {
  const output = await requireOutput(
    processRunner,
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      container,
    ],
    "setup",
    10_000,
  );
  return ipv4AddressSchema.parse(output.trim());
}

async function waitForWordPress(input: {
  readonly processRunner: ContainerProcessRunner;
  readonly images: GvisorWordPressImages;
  readonly resources: SessionResources;
  readonly databaseAddress: string;
  readonly databasePassword: string;
}): Promise<void> {
  const temporarySession = new DefaultGvisorWordPressSession({
    labId: "setup",
    processRunner: input.processRunner,
    images: input.images,
    resources: input.resources,
    databaseAddress: input.databaseAddress,
    wordpressAddress: "127.0.0.1",
    databasePassword: input.databasePassword,
    adminPassword: "setup",
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await temporarySession.runWordPressCli(["db", "check"]);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new GvisorWordPressSessionError("health");
}

export async function establishGvisorWordPressSession(
  options: EstablishGvisorWordPressSessionOptions,
): Promise<GvisorWordPressSession> {
  const nonce = randomUUID();
  const labId = `lab-${nonce}`;
  const prefix = `wh-${nonce}`;
  const resources: SessionResources = {
    network: `${prefix}-net`,
    volume: `${prefix}-wordpress`,
    databaseContainer: `${prefix}-database`,
    wordpressContainer: `${prefix}-wordpress`,
  };
  const databasePassword = randomUUID();
  const adminPassword = randomUUID();
  try {
    await requireOutput(
      options.processRunner,
      [
        "network",
        "create",
        "--internal",
        "--label",
        "org.wordpress-harness.resource=verification-lab",
        resources.network,
      ],
      "setup",
    );
    await requireOutput(
      options.processRunner,
      [
        "volume",
        "create",
        "--label",
        "org.wordpress-harness.resource=verification-lab",
        resources.volume,
      ],
      "setup",
    );
    await requireOutput(
      options.processRunner,
      [
        "run",
        "--detach",
        "--name",
        resources.databaseContainer,
        "--runtime=runsc",
        "--network",
        resources.network,
        "--network-alias",
        "database",
        "--env",
        `MARIADB_ROOT_PASSWORD=${databasePassword}`,
        "--env",
        "MARIADB_DATABASE=wordpress",
        options.images.database,
      ],
      "setup",
    );
    const databaseAddress = await containerAddress(
      options.processRunner,
      resources.databaseContainer,
    );
    await requireOutput(
      options.processRunner,
      [
        "run",
        "--detach",
        "--name",
        resources.wordpressContainer,
        "--runtime=runsc",
        "--network",
        resources.network,
        "--network-alias",
        "wordpress",
        "--volume",
        `${resources.volume}:/var/www/html`,
        "--env",
        `WORDPRESS_DB_HOST=${databaseAddress}`,
        "--env",
        "WORDPRESS_DB_NAME=wordpress",
        "--env",
        "WORDPRESS_DB_USER=root",
        "--env",
        `WORDPRESS_DB_PASSWORD=${databasePassword}`,
        options.images.wordpress,
      ],
      "setup",
    );
    const wordpressAddress = await containerAddress(
      options.processRunner,
      resources.wordpressContainer,
    );
    await waitForWordPress({
      processRunner: options.processRunner,
      images: options.images,
      resources,
      databaseAddress,
      databasePassword,
    });
    const session = new DefaultGvisorWordPressSession({
      labId,
      processRunner: options.processRunner,
      images: options.images,
      resources,
      databaseAddress,
      wordpressAddress,
      databasePassword,
      adminPassword,
    });
    await session.runWordPressCli([
      "core",
      "install",
      "--url=http://wordpress",
      "--title=Verification Lab",
      "--admin_user=harness-admin",
      `--admin_password=${adminPassword}`,
      "--admin_email=harness-admin@example.invalid",
      "--skip-email",
    ]);
    for (const plugin of options.plugins) {
      await requireOutput(
        options.processRunner,
        [
          "exec",
          resources.wordpressContainer,
          "mkdir",
          "-p",
          `/var/www/html/wp-content/plugins/${plugin.pluginSlug}`,
        ],
        "activation",
      );
      await requireOutput(
        options.processRunner,
        [
          "cp",
          `${plugin.sourceDirectory}/.`,
          `${resources.wordpressContainer}:/var/www/html/wp-content/plugins/${plugin.pluginSlug}`,
        ],
        "activation",
      );
      await session.runWordPressCli(["plugin", "activate", plugin.pluginSlug]);
    }
    if (options.canonicalConfiguration !== undefined) {
      await session.runWordPressCli([
        "option",
        "update",
        "WPLANG",
        options.canonicalConfiguration.locale,
      ]);
      await session.runWordPressCli([
        "option",
        "update",
        "timezone_string",
        options.canonicalConfiguration.timezone,
      ]);
    }
    return session;
  } catch (error) {
    await disposeResources(options.processRunner, resources);
    throw error;
  }
}
