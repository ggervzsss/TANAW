import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [file] : [];
  });
}

/**
 * React runs whatever an effect returns as its clean-up. A concise arrow (`() => element.scrollTo()`)
 * returns the call's result, and DOM methods typed as returning nothing can return a value at runtime:
 * current Chromium returns a Promise from scroll methods, which crashed Settings on unmount with
 * "destroy is not a function". Effects that mean to return nothing must use a block body.
 */
function effectsReturningVoidCalls(root: string) {
  const program = ts.createProgram(sourceFiles(root), {
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const isNothing = (type: ts.Type): boolean =>
    type.isUnion() ? type.types.every(isNothing) : Boolean(type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined));
  const found: string[] = [];
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(root)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && EFFECT_HOOKS.has(node.expression.getText(file).replace(/^React\./, ""))) {
        const callback = node.arguments[0];
        if (callback && ts.isArrowFunction(callback) && !ts.isBlock(callback.body) && isNothing(checker.getTypeAtLocation(callback.body))) {
          const { line } = file.getLineAndCharacterOfPosition(callback.getStart(file));
          found.push(`${path.relative(appRoot, file.fileName)}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

describe("React effects", () => {
  it("never return the result of a call that is meant to return nothing", () => {
    expect(effectsReturningVoidCalls(path.join(appRoot, "src"))).toEqual([]);
  }, 60_000);
});
