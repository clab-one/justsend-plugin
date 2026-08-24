// Defends the delegation guard's observable contract on both halves: the omp
// side (batch cap + brief sections, real JSON) and the shell side (brief
// sections only, patterns against the raw payload).
//
// Each test states the bug it would catch. A guard nobody can see fail is a
// guard nobody notices breaking.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  guardDelegation,
  missingWorkerSections,
  parseCap,
} from "../hooks/post/justsend";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "..", "scripts", "delegation-guard.sh");

function shell(payload: unknown) {
  return spawnSync("bash", [GUARD], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

function brief(sections: string[]): string {
  return sections.map((s) => `## ${s}\nwhatever`).join("\n\n");
}

describe("parseCap", () => {
  test("reads the omp setting", () => {
    expect(parseCap("task:\n  maxConcurrency: 3\n")).toBe(3);
  });
  test("rejects a non-positive cap rather than trusting it", () => {
    expect(parseCap("  maxConcurrency: 0\n")).toBeUndefined();
  });
  test("returns undefined when the key is absent so the caller falls back", () => {
    expect(parseCap("task:\n  other: 1\n")).toBeUndefined();
  });
});

describe("missingWorkerSections", () => {
  test("accepts any heading level", () => {
    expect(missingWorkerSections("# Target\na\n###### Change\nb\n## Acceptance\nc")).toEqual([]);
  });
  test("names only what is missing", () => {
    expect(missingWorkerSections(brief(["Target", "Change"]))).toEqual(["Acceptance"]);
  });
  test("a mention in prose is not a section", () => {
    // The whole point is a structured brief. "the acceptance is obvious" must
    // not satisfy the rule, or the guard becomes a word search.
    expect(missingWorkerSections("Target: src/a.ts, acceptance is obvious")).toEqual([
      "Target",
      "Change",
      "Acceptance",
    ]);
  });
});

describe("guardDelegation (omp: batch)", () => {
  const ok = { agent: "task", task: brief(["Target", "Change", "Acceptance"]) };

  test("blocks a batch past the cap, because omp queues instead of refusing", () => {
    const result = guardDelegation([ok, ok, ok], 2);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("3");
  });
  test("allows a batch at the cap", () => {
    expect(guardDelegation([ok, ok], 2)).toBeUndefined();
  });
  test("blocks an explicit task executor whose brief is incomplete", () => {
    const result = guardDelegation([{ agent: "task", task: "go fix it" }], 2);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("Acceptance");
  });
  test("blocks the omitted agent because omp resolves it to task", () => {
    const result = guardDelegation([{ task: "go fix it" }], 2);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("Acceptance");
  });
  test("normalizes agent whitespace the same way omp dispatch does", () => {
    expect(guardDelegation([{ agent: "   ", task: "go fix it" }], 2)?.block).toBe(true);
    expect(guardDelegation([{ agent: " task ", task: "go fix it" }], 2)?.block).toBe(true);
  });
  test("keeps worker as a compatibility executor", () => {
    const result = guardDelegation([{ agent: "worker", task: "go fix it" }], 2);
    expect(result?.block).toBe(true);
  });
  test("names which task in the batch is malformed", () => {
    const result = guardDelegation([ok, { agent: "task", task: "vague" }], 2);
    expect(result?.reason).toContain("2번째");
  });
  test("leaves read-only roles alone — scouts and reviewers return findings", () => {
    expect(guardDelegation([
      { agent: "scout", task: "find auth" },
      { agent: "reviewer", task: "review diff" },
    ], 2)).toBeUndefined();
  });
  test("ignores a non-array input instead of throwing", () => {
    expect(guardDelegation(undefined, 2)).toBeUndefined();
  });
});

describe("delegation-guard.sh (Claude Code / Codex)", () => {
  test("blocks a worker brief with no sections", () => {
    const r = shell({
      tool_name: "Task",
      tool_input: { subagent_type: "worker", prompt: "go fix the login bug" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Target");
  });

  test("allows a complete brief", () => {
    const r = shell({
      tool_name: "Task",
      tool_input: {
        subagent_type: "worker",
        prompt: "# Target\nsrc/a.ts\n\n## Change\nrename\n\n## Acceptance\nlog at /tmp/x.log",
      },
    });
    expect(r.status).toBe(0);
  });

  test("survives the escaping that breaks a flat field extractor", () => {
    // The prompt arrives with escaped quotes and newlines. A `[^"]*` field read
    // truncates at the first quote and would report every section missing.
    const r = shell({
      tool_name: "Task",
      tool_input: {
        subagent_type: "worker",
        prompt: '## Target\nsrc/"a".ts\n\n## Change\nrename "x"\n\n## Acceptance\n"done"',
      },
    });
    expect(r.status).toBe(0);
  });

  test("leaves a scout alone", () => {
    const r = shell({
      tool_name: "Task",
      tool_input: { subagent_type: "scout", prompt: "find where auth lives" },
    });
    expect(r.status).toBe(0);
  });

  test("allows an empty payload rather than blocking on its own bug", () => {
    const r = spawnSync("bash", [GUARD], { input: "", encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
