import { glob, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { convert } from "ast-v8-to-istanbul";
import { parseAstAsync } from "vite";
import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { create, createContext } from "@vitest/istanbul-lib-report";

const root = process.cwd();
const unit = JSON.parse(await readFile("coverage/coverage-final.json", "utf8"));
const merged = createCoverageMap(unit);
const originals = [];
for await (const file of glob(["src/**/*.{ts,tsx}", "e2e/harness/*.tsx"])) {
  originals.push({ file: path.resolve(file), code: await readFile(file, "utf8") });
}
let snapshots = 0;
for await (const file of glob("test-results/**/browser-v8.json")) {
  const { entries, sourceMap } = JSON.parse(await readFile(file, "utf8"));
  const mapped = { ...sourceMap, sources: sourceMap.sources.map((source, index) => {
    const matches = originals.filter((candidate) => candidate.code === sourceMap.sourcesContent[index]);
    if (matches.length === 1) return pathToFileURL(matches[0].file).href;
    if (matches.length > 1) throw new Error(`Ambiguous original source: ${source}`);
    // Dependencies and bundler runtime are outside the application's denominator.
    // Their mappings remain present during conversion and are filtered afterward.
    if (/\.(ts|tsx)$/.test(source) && !source.includes("node_modules")) {
      throw new Error(`Original source changed or is missing: ${source}. Rerun browser tests.`);
    }
    return pathToFileURL(path.join(root, ".browser-vendor", source.replace(/^webpack:\/\/[^/]+\//, ""))).href;
  }) };
  for (const entry of entries) {
    const data = await convert({ code: entry.source, ast: parseAstAsync(entry.source), wrapperLength: 0,
      coverage: { url: pathToFileURL(path.join(root, "fixture.js")).href, functions: entry.functions }, sourceMap: mapped });
    for (const [filePath, coverage] of Object.entries(data)) {
      if (filePath.startsWith(path.join(root, "src") + path.sep)) merged.addFileCoverage(coverage);
    }
    snapshots++;
  }
}
if (!snapshots) throw new Error("No browser coverage found. Run npm run test:e2e first.");
const frontend = createCoverageMap({});
for (const file of merged.files()) {
  if (file.includes("/src/components/") || (file.includes("/src/app/") && !file.includes("/src/app/api/"))) {
    frontend.addFileCoverage(merged.fileCoverageFor(file));
  }
}
const output = "coverage/frontend";
await mkdir(output, { recursive: true });
const context = createContext({ dir: output, coverageMap: frontend });
for (const report of ["json", "html", "text-summary"]) create(report).execute(context);
await writeFile(path.join(output, "summary.json"), JSON.stringify(frontend.getCoverageSummary(), null, 2));
console.log(`Merged ${snapshots} browser snapshots with unit coverage across ${frontend.files().length} frontend files.`);
const summary = frontend.getCoverageSummary();
for (const metric of ["lines", "statements", "functions", "branches"]) {
  console.log(`${metric}: ${summary[metric].pct}%`);
}
// The project target for frontend coverage is 70% (AGENTS.md). These floors sit
// a few points under what is measured today so CI catches a regression; raise
// them as coverage grows and never lower them.
const FLOORS = { lines: 60, statements: 45, functions: 47, branches: 50 };
if (process.argv.includes("--check")) {
  for (const [metric, floor] of Object.entries(FLOORS)) {
    if (summary[metric].pct < floor) {
      console.error(`Frontend ${metric} coverage ${summary[metric].pct}% is below the ${floor}% floor.`);
      process.exitCode = 1;
    }
  }
}
