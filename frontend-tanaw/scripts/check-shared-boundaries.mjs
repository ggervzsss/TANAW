import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharedRoot = resolve(projectRoot, "src/shared");
const appRoot = resolve(projectRoot, "src/app");
const sourceExtensions = new Set([".ts", ".tsx"]);
const violations = [];

for (const file of walk(sharedRoot)) {
  if (![...sourceExtensions].some((extension) => file.endsWith(extension))) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(["'])([^"']+)\1/g)) {
    const specifier = match[2];
    const target = specifier === "@/app" || specifier.startsWith("@/app/")
      ? appRoot
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : null;
    if (target && (target === appRoot || target.startsWith(`${appRoot}${sep}`))) {
      violations.push(`${relative(projectRoot, file)} imports ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error("The lower-level web shared layer must not import the application layer:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
