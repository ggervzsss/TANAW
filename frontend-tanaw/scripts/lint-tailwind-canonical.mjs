import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Scanner } from "@tailwindcss/oxide";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fix = process.argv.includes("--fix");
const rootFontSize = 16;
const supportedExtensions = new Set([".css", ".html", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

async function listSourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(filePath)));
    } else if (supportedExtensions.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }

  return files;
}

function resolveCandidateOffset(content, candidate, reportedOffset) {
  if (content.slice(reportedOffset, reportedOffset + candidate.length) === candidate) {
    return reportedOffset;
  }

  const utf8Offset = Buffer.from(content).subarray(0, reportedOffset).toString("utf8").length;
  if (content.slice(utf8Offset, utf8Offset + candidate.length) === candidate) {
    return utf8Offset;
  }

  return null;
}

function getPosition(content, offset) {
  const lines = content.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1).length + 1,
  };
}

async function auditFiles(files, designSystem) {
  const scanner = new Scanner({});
  const fileContents = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      content: await fs.readFile(filePath, "utf8"),
      extension: path.extname(filePath).slice(1),
    })),
  );
  const candidates = scanner.scanFiles(fileContents.map(({ content, extension }) => ({ content, extension })));
  const replacements = new Map();

  for (const candidate of candidates) {
    const canonical = designSystem.canonicalizeCandidates([candidate], { rem: rootFontSize })[0];
    if (canonical && canonical !== candidate) {
      replacements.set(candidate, canonical);
    }
  }

  if (replacements.size === 0) {
    return [];
  }

  const findings = [];

  for (const { filePath, content, extension } of fileContents) {
    const seen = new Set();

    for (const result of scanner.getCandidatesWithPositions({ content, extension })) {
      const canonical = replacements.get(result.candidate);
      if (!canonical) {
        continue;
      }

      const offset = resolveCandidateOffset(content, result.candidate, result.position);
      if (offset === null) {
        throw new Error(`Could not locate Tailwind candidate "${result.candidate}" in ${path.relative(projectRoot, filePath)}.`);
      }

      const findingKey = `${offset}:${result.candidate}`;
      if (seen.has(findingKey)) {
        continue;
      }
      seen.add(findingKey);

      findings.push({
        filePath,
        offset,
        from: result.candidate,
        to: canonical,
        ...getPosition(content, offset),
      });
    }
  }

  return findings.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.offset - right.offset || left.from.localeCompare(right.from));
}

async function applyFixes(findings) {
  const findingsByFile = new Map();

  for (const finding of findings) {
    const fileFindings = findingsByFile.get(finding.filePath) ?? [];
    fileFindings.push(finding);
    findingsByFile.set(finding.filePath, fileFindings);
  }

  for (const [filePath, fileFindings] of findingsByFile) {
    let content = await fs.readFile(filePath, "utf8");

    for (const finding of [...fileFindings].sort((left, right) => right.offset - left.offset)) {
      if (content.slice(finding.offset, finding.offset + finding.from.length) !== finding.from) {
        throw new Error(`Refusing to replace a changed Tailwind candidate in ${path.relative(projectRoot, filePath)}.`);
      }

      content = `${content.slice(0, finding.offset)}${finding.to}${content.slice(finding.offset + finding.from.length)}`;
    }

    await fs.writeFile(filePath, content);
  }
}

function printFindings(findings) {
  for (const finding of findings) {
    const relativePath = path.relative(projectRoot, finding.filePath);
    console.error(`${relativePath}:${finding.line}:${finding.column} tailwind-canonical: "${finding.from}" can be written as "${finding.to}"`);
  }
}

const cssPath = path.join(projectRoot, "src/index.css");
const css = await fs.readFile(cssPath, "utf8");
const designSystem = await __unstable__loadDesignSystem(css, { base: path.dirname(cssPath) });
const files = await listSourceFiles(path.join(projectRoot, "src"));
files.push(path.join(projectRoot, "index.html"));

const findings = await auditFiles(files, designSystem);

if (findings.length === 0) {
  console.log(`Tailwind canonical classes: clean (${files.length} files scanned).`);
  process.exit(0);
}

if (!fix) {
  printFindings(findings);
  console.error(`\nFound ${findings.length} noncanonical Tailwind ${findings.length === 1 ? "class" : "classes"}. Run "npm run lint:tailwind:fix" to update them.`);
  process.exit(1);
}

await applyFixes(findings);
const remainingFindings = await auditFiles(files, designSystem);

if (remainingFindings.length > 0) {
  printFindings(remainingFindings);
  console.error(`\nFixed ${findings.length - remainingFindings.length} classes, but ${remainingFindings.length} remain.`);
  process.exit(1);
}

console.log(`Fixed ${findings.length} noncanonical Tailwind ${findings.length === 1 ? "class" : "classes"} across ${new Set(findings.map((finding) => finding.filePath)).size} files.`);
