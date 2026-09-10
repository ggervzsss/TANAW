import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const contractsDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(contractsDirectory, "../..");
const repositoryRoot = resolve(backendDirectory, "..");
const checkOnly = process.argv.includes("--check");
const generatedHeader = "// Generated from FastAPI/Pydantic contracts. Do not edit manually.\n";

const bundleText = execFileSync(
  "uv",
  ["run", "--directory", backendDirectory, "python", "-m", "app.contracts.export"],
  {
    encoding: "utf8",
    env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? "/tmp/uv-cache" },
    maxBuffer: 16 * 1024 * 1024,
  },
);
const bundle = JSON.parse(bundleText);

const outputs = [
  ["api.ts", bundle.openapi],
  ["realtime.ts", bundle.realtime],
];
const clientDirectories = [
  resolve(repositoryRoot, "frontend-tanaw/src/contracts/generated"),
  resolve(repositoryRoot, "desktop-tanaw/src/contracts/generated"),
];

let stale = false;
for (const [filename, schema] of outputs) {
  const eventTypes = schema.components?.schemas?.RealtimeEventType?.enum;
  const runtimeContract = Array.isArray(eventTypes)
    ? `export const realtimeEventTypes = ${JSON.stringify(eventTypes, null, 2)} as const;\n\n`
    : "";
  const generated = `${generatedHeader}${runtimeContract}${astToString(await openapiTS(schema))}`;
  for (const directory of clientDirectories) {
    const outputPath = resolve(directory, filename);
    if (checkOnly) {
      let current = "";
      try {
        current = readFileSync(outputPath, "utf8");
      } catch {
        // A missing generated contract is stale by definition.
      }
      if (normalizeLineEndings(current) !== normalizeLineEndings(generated)) {
        stale = true;
        console.error(`Stale generated contract: ${outputPath}`);
      }
    } else {
      writeFileSync(outputPath, generated);
      console.log(`Generated ${outputPath}`);
    }
  }
}

if (stale) {
  console.error(
    "Run `npm --prefix backend-tanaw/scripts/contracts run generate` and commit the generated files.",
  );
  process.exitCode = 1;
}

function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n");
}
