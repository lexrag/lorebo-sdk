import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";

import { expect, test } from "vitest";
import { z } from "zod";

test("publishes approved bytes without local metadata or lifecycle execution", async () => {
  const npmExecutable = process.env.npm_execpath;

  if (npmExecutable === undefined) {
    throw new Error("Run the publication check through npm test");
  }

  const execute = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), "lorebo-sdk-publication-"));
  const publications: string[] = [];
  const server = createServer((request, response) => {
    if (request.method !== "PUT") {
      response.writeHead(404).end();

      return;
    }

    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      publications.push(body);
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    });
  });

  try {
    await new Promise<void>((resolveListening, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListening);
    });
    const address = server.address();

    if (address === null || typeof address === "string") {
      throw new Error("The publication fixture did not open a loopback port");
    }

    const registry = `http://127.0.0.1:${address.port}/`;
    const configuration = join(directory, "npmrc");

    await writeFile(configuration, `//127.0.0.1:${address.port}/:_authToken=synthetic\n`);
    const environment = {
      ...process.env,
      NPM_CONFIG_USERCONFIG: configuration,
      NPM_CONFIG_GLOBALCONFIG: join(directory, "global-npmrc"),
      NPM_CONFIG_CACHE: join(directory, "cache"),
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
    };
    const fixture = join(directory, "fixture");
    const artifacts = join(directory, "artifacts");

    await mkdir(fixture);
    await mkdir(artifacts);
    await writeFile(join(directory, "global-npmrc"), "");
    await writeFile(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "lorebo-sdk-publication-fixture",
        version: "0.0.0",
        files: ["index.js"],
        scripts: { prepack: "node -e \"throw new Error('Lifecycle execution is forbidden')\"" },
      }),
    );
    await writeFile(join(fixture, "index.js"), "export const accepted = true;\n");
    await execute(
      process.execPath,
      [npmExecutable, "pack", "--ignore-scripts", "--pack-destination", artifacts],
      { cwd: fixture, env: environment },
    );
    const archive = join(artifacts, "lorebo-sdk-publication-fixture-0.0.0.tgz");
    const accepted = await readFile(archive);

    await execute("bash", [resolve("../scripts/publish-npm.sh"), archive, "--registry", registry], {
      cwd: directory,
      env: environment,
    });
    expect(publications).toHaveLength(1);
    const publication = publications[0];

    if (publication === undefined) {
      throw new Error("The publication request was not observed");
    }

    const body = z
      .object({
        versions: z.record(z.string(), z.record(z.string(), z.unknown())),
        _attachments: z.record(z.string(), z.object({ data: z.string() })),
      })
      .parse(JSON.parse(publication));
    const manifest = body.versions["0.0.0"];

    expect(manifest).toBeDefined();

    for (const field of ["_from", "_resolved", "_where"]) {
      expect(manifest).not.toHaveProperty(field);
    }

    expect(JSON.stringify(manifest)).not.toMatch(/\/(?:Users|home|tmp|var\/folders)\/|[A-Za-z]:\\/);
    expect(publication).not.toContain(directory);
    const attachment = Object.values(body._attachments)[0];

    expect(attachment).toBeDefined();

    if (attachment === undefined) {
      throw new Error("The publication request has no distribution");
    }

    const published = Buffer.from(attachment.data, "base64");

    expect(createHash("sha256").update(published).digest("hex")).toBe(
      createHash("sha256").update(accepted).digest("hex"),
    );

    const noncanonical = join(directory, "noncanonical.tgz");

    await writeFile(noncanonical, gzipSync(gunzipSync(accepted), { level: 0 }));
    await expect(
      execute(
        "bash",
        [resolve("../scripts/publish-npm.sh"), noncanonical, "--registry", registry],
        { cwd: directory, env: environment },
      ),
    ).rejects.toThrow();
    expect(publications).toHaveLength(1);
  } finally {
    server.closeAllConnections();

    try {
      if (server.listening) {
        await new Promise<void>((resolveClosed, reject) => {
          server.close((error) => (error === undefined ? resolveClosed() : reject(error)));
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 30000);
