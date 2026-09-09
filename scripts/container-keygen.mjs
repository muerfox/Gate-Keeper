#!/usr/bin/env node
// Runs INSIDE a container (the "keygen" service in docker-compose.test.yml)
// — never on the host. Writes GATEKEEPER_SIGNING_KEY / GATEKEEPER_ENCRYPTION_KEY
// as `export`-prefixed lines to a file on a shared volume, so a sibling
// container can `. <file>` at startup to pick them up. This lets the
// disposable test stack fully self-configure on `docker compose up`, with
// no host Node install and no key-generation step required beforehand.
//
// These are throwaway keys for a disposable test stack only — regenerated
// whenever the shared volume doesn't already have them (e.g. after
// `docker compose down -v`). Never reuse this pattern for a real
// deployment; see docs/SECURITY.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [, , targetPath] = process.argv;
if (!targetPath) {
  console.error("Usage: node scripts/container-keygen.mjs <output file>");
  process.exit(1);
}

if (existsSync(targetPath)) {
  const content = readFileSync(targetPath, "utf8");
  if (/^export GATEKEEPER_SIGNING_KEY=.+$/m.test(content) && /^export GATEKEEPER_ENCRYPTION_KEY=.+$/m.test(content)) {
    console.log(`${targetPath} already has both keys — reusing them.`);
    process.exit(0);
  }
}

const { generateEd25519KeyMaterial, generateEncryptionKey } = await import("@gatekeeper/crypto");
const signingKey = await generateEd25519KeyMaterial();
const encryptionKey = generateEncryptionKey();

writeFileSync(targetPath, `export GATEKEEPER_SIGNING_KEY=${signingKey}\nexport GATEKEEPER_ENCRYPTION_KEY=${encryptionKey}\n`);
console.log(`Generated fresh test keys at ${targetPath}`);
