#!/usr/bin/env node
// Fills in GATEKEEPER_SIGNING_KEY / GATEKEEPER_ENCRYPTION_KEY in an env
// file automatically, generating fresh key material whenever either is
// missing or blank — so setup never requires hand-running the key
// generator and pasting the result. Requires @gatekeeper/crypto to
// already be built (`npm run build`). See README.md / docs/TESTING.md.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";

const [, , targetPath, examplePath] = process.argv;
if (!targetPath || !examplePath) {
  console.error("Usage: node scripts/ensure-env.mjs <target .env file> <example file>");
  process.exit(1);
}

if (!existsSync(targetPath)) {
  copyFileSync(examplePath, targetPath);
  console.log(`Created ${targetPath} from ${examplePath}`);
}

let content = readFileSync(targetPath, "utf8");

function fieldIsBlank(name) {
  const match = new RegExp(`^${name}=(.*)$`, "m").exec(content);
  return !match || match[1].trim() === "";
}

function setField(name, value) {
  const re = new RegExp(`^${name}=.*$`, "m");
  content = re.test(content) ? content.replace(re, `${name}=${value}`) : `${content}\n${name}=${value}\n`;
}

const needsSigningKey = fieldIsBlank("GATEKEEPER_SIGNING_KEY");
const needsEncryptionKey = fieldIsBlank("GATEKEEPER_ENCRYPTION_KEY");

if (!needsSigningKey && !needsEncryptionKey) {
  console.log(`${targetPath} already has both Gate Keeper keys set — leaving it alone.`);
  process.exit(0);
}

let crypto;
try {
  crypto = await import("@gatekeeper/crypto");
} catch {
  console.error(
    `Could not load @gatekeeper/crypto — run "npm run build" first (it needs to be built once before keys can be generated).`,
  );
  process.exit(1);
}

if (needsSigningKey) {
  setField("GATEKEEPER_SIGNING_KEY", await crypto.generateEd25519KeyMaterial());
  console.log(`Generated a new GATEKEEPER_SIGNING_KEY in ${targetPath}`);
}
if (needsEncryptionKey) {
  setField("GATEKEEPER_ENCRYPTION_KEY", crypto.generateEncryptionKey());
  console.log(`Generated a new GATEKEEPER_ENCRYPTION_KEY in ${targetPath}`);
}

writeFileSync(targetPath, content);
