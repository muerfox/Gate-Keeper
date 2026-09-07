import EmbeddedPostgres from "embedded-postgres";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";

const execFileAsync = promisify(execFile);

/** Test files run as separate module instances (possibly in separate
 * worker threads/processes), so a simple incrementing counter is NOT
 * unique across them — two suites starting concurrently would both pick
 * port 55432 and collide (observed: one instance silently fails to bind
 * IPv4 and falls back to Unix-socket-only, while the other suite's TCP
 * connection then talks to the WRONG postgres instance). Asking the OS for
 * a genuinely free port avoids that. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("failed to allocate a free port")));
      }
    });
  });
}

/**
 * Starts a real, ephemeral PostgreSQL instance (via the `embedded-postgres`
 * package, which ships an actual `postgres`/`initdb` binary — not a mock)
 * and applies the Gate Keeper schema to it with `prisma db push`. This lets
 * the integration/security test suites exercise real SQL — real unique
 * constraints, real transactions — rather than a Prisma mock, which matters
 * most for the tests that specifically verify atomicity via a database
 * unique-constraint race (docs/ARCHITECTURE.md §Replay Protection fallback).
 */
export interface TestPostgres {
  databaseUrl: string;
  stop(): Promise<void>;
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "gk-pg-"));
  const port = await getFreePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "gatekeeper",
    password: "test",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("gatekeeper");

  const databaseUrl = `postgres://gatekeeper:test@127.0.0.1:${port}/gatekeeper`;

  const schemaPath = path.resolve(__dirname, "../../packages/shared/prisma/schema.prisma");
  await execFileAsync("npx", ["prisma", "db", "push", "--schema", schemaPath, "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    cwd: path.resolve(__dirname, "../.."),
  });

  return {
    databaseUrl,
    async stop() {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
