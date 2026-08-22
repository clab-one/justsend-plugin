// Defends the transitions the contract server enforces in code, because these
// are exactly the rules an agent under pressure will otherwise talk its way
// around: no GREEN without a RED, no SURFACE before GREEN, no artifact it did
// not produce, and no completion while a criterion is unproven.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs shipped to node, no type declarations by design.
import { TOOLS, callTool, gateReason, loadContract, validateArtifact } from "../mcp/contract.mjs";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "js-contract-"));
}

function artifact(cwd: string, name = "out.log", body = "captured output\n"): string {
  const path = join(cwd, name);
  writeFileSync(path, body);
  return path;
}

const criteria = [{ scenario: "run the thing", observable: "exit code is 0" }];

function contracted(cwd: string, extra: Record<string, unknown> = {}): void {
  callTool(cwd, "justsend_contract_set", {
    task_key: "t",
    objective: "prove it",
    tier: "LIGHT",
    criteria,
    ...extra,
  });
}

describe("failing-first transitions", () => {
  test("GREEN without a RED is refused", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(() =>
      callTool(cwd, "justsend_evidence", {
        task_key: "t",
        criterion_id: "c1",
        kind: "green",
        artifact_path: artifact(cwd),
      }),
    ).toThrow(/Failing-first violation/);
  });

  test("RED then GREEN then SURFACE walks to surfaced", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    expect(loadContract(cwd, "t").criteria[0].status).toBe("surfaced");
  });

  test("SURFACE before GREEN is refused", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "red", artifact_path: path });
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "surface", artifact_path: path }),
    ).toThrow(/after GREEN/);
  });

  test("re-capturing RED on a GREEN criterion is refused", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "red", artifact_path: path });
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "green", artifact_path: path });
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "red", artifact_path: path }),
    ).toThrow(/forges failing-first/);
  });

  test("a proof=review criterion goes straight to surfaced", () => {
    const cwd = workspace();
    callTool(cwd, "justsend_contract_set", {
      task_key: "t",
      objective: "prose only",
      tier: "LIGHT",
      criteria: [{ scenario: "read the copy", observable: "no struck-out phrasing", proof: "review" }],
    });
    callTool(cwd, "justsend_evidence", {
      task_key: "t",
      criterion_id: "c1",
      kind: "surface",
      artifact_path: artifact(cwd),
    });
    expect(loadContract(cwd, "t").criteria[0].status).toBe("surfaced");
  });

  test("a proof=review criterion refuses GREEN", () => {
    const cwd = workspace();
    callTool(cwd, "justsend_contract_set", {
      task_key: "t",
      objective: "prose only",
      tier: "LIGHT",
      criteria: [{ scenario: "read the copy", observable: "reads cleanly", proof: "review" }],
    });
    expect(() =>
      callTool(cwd, "justsend_evidence", {
        task_key: "t",
        criterion_id: "c1",
        kind: "green",
        artifact_path: artifact(cwd),
      }),
    ).toThrow(/proof=review/);
  });
});

describe("evidence artifacts", () => {
  test("red/green/surface require an artifact path", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(() => callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "red" })).toThrow(
      /requires artifact_path/,
    );
  });

  test("a cleanup receipt needs only a note", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(() =>
      callTool(cwd, "justsend_evidence", {
        task_key: "t",
        criterion_id: "c1",
        kind: "cleanup",
        note: "removed the probe server",
      }),
    ).not.toThrow();
  });

  test("an empty file is not evidence", () => {
    const cwd = workspace();
    expect(() => validateArtifact(cwd, artifact(cwd, "empty.log", ""))).toThrow(/empty/);
  });

  test("a missing file is not evidence", () => {
    const cwd = workspace();
    expect(() => validateArtifact(cwd, join(cwd, "nope.log"))).toThrow(/does not exist/);
  });

  test("a directory is not evidence", () => {
    const cwd = workspace();
    const dir = join(cwd, "sub");
    mkdirSync(dir);
    expect(() => validateArtifact(cwd, dir)).toThrow(/not a regular file/);
  });

  test("a symlink pointing out of the allowed roots is not evidence", () => {
    const cwd = workspace();
    // This test file itself: a real non-empty file that sits outside cwd, the
    // temp dir, and ~/.justsend — the shape of a forged proof that points at
    // something the run never produced.
    const outside = fileURLToPath(import.meta.url);
    const link = join(cwd, "link.log");
    symlinkSync(outside, link);
    expect(() => validateArtifact(cwd, link)).toThrow(/outside the allowed roots/);
  });

  test("an unknown criterion id is refused and names the known ids", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(() =>
      callTool(cwd, "justsend_evidence", {
        task_key: "t",
        criterion_id: "c9",
        kind: "red",
        artifact_path: artifact(cwd),
      }),
    ).toThrow(/Registered ids: c1/);
  });
});

describe("completion gate", () => {
  test("locks while a criterion is unproven", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");
  });

  test("opens once every criterion is surfaced", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    expect(gateReason(loadContract(cwd, "t"))).toBeUndefined();
  });

  test("enforce false tracks without gating", () => {
    const cwd = workspace();
    contracted(cwd, { enforce: false });
    expect(gateReason(loadContract(cwd, "t"))).toBeUndefined();
  });

  test("an empty criteria list is never done", () => {
    const cwd = workspace();
    contracted(cwd);
    const contract = loadContract(cwd, "t");
    contract.criteria = [];
    expect(gateReason(contract)).toBeUndefined();
  });
});

describe("a blocked contract", () => {
  // The gate's own message tells the agent to leave `justsend_work_note` with
  // `blocker: true` when a human has to act. Until this suite existed the gate
  // ignored that note, so an agent that followed the instruction stayed blocked
  // and the Stop hook refused the turn forever.
  const cliPath = fileURLToPath(new URL("../mcp/contract.mjs", import.meta.url));
  const shPath = fileURLToPath(new URL("../scripts/contract.sh", import.meta.url));

  function cli(cwd: string, args: string[]) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      encoding: "utf8",
    });
  }

  test("blocking disarms the gate", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");

    expect(cli(cwd, ["block", "t"]).status).toBe(0);

    expect(loadContract(cwd, "t").blocked_at).toBeString();
    expect(gateReason(loadContract(cwd, "t"))).toBeUndefined();
  });

  test("the gate CLI lets a completion through while blocked", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(cli(cwd, ["gate", "t"]).status).toBe(2);

    cli(cwd, ["block", "t"]);
    const gate = cli(cwd, ["gate", "t"]);
    expect(gate.status).toBe(0);
    expect(gate.stdout).toBe("");
  });

  test("new evidence re-arms the gate", () => {
    const cwd = workspace();
    contracted(cwd);
    cli(cwd, ["block", "t"]);

    callTool(cwd, "justsend_evidence", {
      task_key: "t",
      criterion_id: "c1",
      kind: "red",
      artifact_path: artifact(cwd),
    });

    expect(loadContract(cwd, "t").blocked_at).toBeUndefined();
    const gate = cli(cwd, ["gate", "t"]);
    expect(gate.status).toBe(2);
    expect(gate.stderr).toContain("Contract gate: criteria still unproven");
  });

  test("re-registering the contract re-arms the gate", () => {
    const cwd = workspace();
    contracted(cwd);
    cli(cwd, ["block", "t"]);
    contracted(cwd);
    expect(loadContract(cwd, "t").blocked_at).toBeUndefined();
    expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");
  });

  test("blocking twice keeps the first timestamp", () => {
    const cwd = workspace();
    contracted(cwd);
    cli(cwd, ["block", "t"]);
    const first = loadContract(cwd, "t").blocked_at;
    cli(cwd, ["block", "t"]);
    expect(loadContract(cwd, "t").blocked_at).toBe(first);
  });

  test("the summary states the blocked state, so a compaction cannot hide it", () => {
    const cwd = workspace();
    contracted(cwd);
    cli(cwd, ["block", "t"]);
    const blockedAt = loadContract(cwd, "t").blocked_at;

    const summary = callTool(cwd, "justsend_contract_status", {});
    expect(summary).toContain("Blocked since");
    expect(summary).toContain(blockedAt);

    expect(cli(cwd, ["summary"]).stdout).toContain("Blocked since");
  });

  // Found in review: the glob this bridge inherited from record-state.sh matches
  // `true` ANYWHERE after the word blocker, so an ordinary note whose body
  // happens to contain "true" disarmed the gate. A loose match on a reminder is
  // noise; the same loose match on a gate is a silent escape hatch.
  test("blocker false does not disarm, even when the body says true", () => {
    const cwd = workspace();
    contracted(cwd);
    const result = spawnSync("bash", [shPath, "block"], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      input: JSON.stringify({
        tool_name: "justsend_work_note",
        tool_input: { task_key: "t", blocker: false, note: "the flag is true for the other case" },
      }),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(loadContract(cwd, "t").blocked_at).toBeUndefined();
  });

  // Found in review: a blocked contract sorted to the front of the active list,
  // so the Stop hook read IT instead of the unrelated contract that was still
  // live and unproven, and stopped gating altogether.
  test("a blocked contract does not shadow a live one for the session hooks", () => {
    const cwd = workspace();
    callTool(cwd, "justsend_contract_set", {
      task_key: "live-one",
      objective: "still working",
      tier: "LIGHT",
      criteria,
    });
    contracted(cwd); // "t", registered second, so it sorts first by updated_at
    cli(cwd, ["block", "t"]);

    const stop = cli(cwd, ["continuation"]);
    expect(stop.status).toBe(2);
    expect(stop.stderr).toContain("live-one");
  });

  test("the shell bridge blocks only on a note that carries blocker true", () => {
    const cwd = workspace();
    contracted(cwd);

    const plain = spawnSync("bash", [shPath, "block"], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      input: JSON.stringify({ tool_name: "justsend_work_note", task_key: "t", note: "progress" }),
      encoding: "utf8",
    });
    expect(plain.status).toBe(0);
    expect(loadContract(cwd, "t").blocked_at).toBeUndefined();

    const blocked = spawnSync("bash", [shPath, "block"], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      input: JSON.stringify({
        tool_name: "justsend_work_note",
        task_key: "t",
        blocker: true,
        note: "needs a human",
      }),
      encoding: "utf8",
    });
    expect(blocked.status).toBe(0);
    expect(loadContract(cwd, "t").blocked_at).toBeString();
  });
});

// One generator, so the record, the closing summary and the hooks cannot drift
// into three different shapes of the same truth.
describe("the report", () => {
  // The app ships in sixteen languages and this process cannot know which one the
  // reader has, so it emits no word it would have to translate. The type is the
  // one exception and it is a fold key, like the work id.
  test("emits the type line, a wordless header, and one marked row per criterion", () => {
    const cwd = workspace();
    contracted(cwd, { type: "fix", objective: "Stop the double refresh; it races on slow networks." });
    const text = callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" });
    expect(text.split("\n")[0]).toBe("fix: Stop the double refresh");
    // The delimiter row is what makes it a table instead of a paragraph.
    expect(text).toContain("|  |  |  |\n|---|---|---|");
    expect(text).toContain("| c1 | \u2014 | exit code is 0 |");
  });

  // `justsend_work_start` cuts the first line of `task` at 80 characters to make
  // the title, so a longer line comes back severed mid-word.
  test("the title line fits the 80-character budget work_start imposes", () => {
    const cwd = workspace();
    contracted(cwd, {
      type: "investigation",
      objective:
        "Work out why the blocker note never stood the completion gate down even though the gate message itself tells the agent to leave one",
    });
    const first = callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" }).split("\n")[0];
    expect(first.length).toBeLessThanOrEqual(80);
    expect(first.startsWith("investigation: ")).toBe(true);
    expect(first.endsWith("…")).toBe(true);
    expect(first).not.toContain("leave one");
  });

  test("a short objective is not padded or cut", () => {
    const cwd = workspace();
    contracted(cwd, { type: "fix", objective: "Stop the double refresh" });
    expect(callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" }).split("\n")[0]).toBe(
      "fix: Stop the double refresh",
    );
  });

  test("emits no prose a reader would need translated", () => {
    const cwd = workspace();
    contracted(cwd, { type: "fix" });
    const text = callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" });
    for (const banned of ["Summary", "Checked", "Failures", "Not proven", "PASS", "Observed", "blocked", "waiting"]) {
      expect(text).not.toContain(banned);
    }
  });

  // `callTool` skips the schema, but a real client does not: `additionalProperties`
  // is false, so a property the schema omits can never arrive and the runtime
  // check below would be unreachable.
  test("the tool schema declares type, so a client can actually send it", () => {
    // The .mjs server ships without declarations on purpose, so the shape is
    // asserted once here rather than spread as `any` through the test.
    type ToolSchema = {
      name: string;
      inputSchema: { additionalProperties: boolean; properties: Record<string, { enum?: string[] }> };
    };
    const tools = TOOLS as unknown as ToolSchema[];
    const set = tools.find((t) => t.name === "justsend_contract_set")!;
    expect(set.inputSchema.additionalProperties).toBe(false);
    expect(set.inputSchema.properties.type.enum).toEqual([
      "fix",
      "feature",
      "investigation",
      "migration",
      "method",
      "review",
    ]);
  });

  test("an unknown type is refused and names the vocabulary", () => {
    const cwd = workspace();
    expect(() => contracted(cwd, { type: "banana" })).toThrow(/fix, feature, investigation, migration, method, review/);
  });

  test("no type falls back rather than failing", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" }).split("\n")[0]).toBe(
      "change: prove it",
    );
  });

  test("a proven criterion is marked and the count disappears", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    const text = callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" });
    expect(text).toContain("| c1 | \u2705 |");
    expect(text).not.toContain("0/1");
  });

  test("an open criterion reports the proven count", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" })).toContain("0/1");
  });

  // The frame cannot fix content that is too long, so the generator bounds it.
  test("a long observable is cut, not spilled across the phone", () => {
    const cwd = workspace();
    const long =
      "HTTP 400 with code EMPTY_PASSWORD and a body that explains the rule at length so the cell would otherwise run wide";
    contracted(cwd, { criteria: [{ scenario: "curl -i /login", observable: long }] });
    const row = callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" })
      .split("\n")
      .find((l) => l.startsWith("| c1 "))!;
    expect(row.length).toBeLessThan(100);
    expect(row).toContain("\u2026");
    expect(row).not.toContain("run wide");
  });

  test("a pipe in an observable does not break the row", () => {
    const cwd = workspace();
    contracted(cwd, { criteria: [{ scenario: "run it", observable: "exit 0 | no stderr" }] });
    expect(callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" })).toContain(
      "exit 0 \\| no stderr",
    );
  });

  test("the report still answers once every criterion is proven", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    expect(callTool(cwd, "justsend_contract_status", { format: "report" })).toContain("| c1 |");
  });
});

describe("re-registering a contract", () => {
  test("preserves evidence already captured for the same criterion id", () => {
    const cwd = workspace();
    contracted(cwd);
    callTool(cwd, "justsend_evidence", {
      task_key: "t",
      criterion_id: "c1",
      kind: "red",
      artifact_path: artifact(cwd),
    });
    contracted(cwd, { criteria: [{ id: "c1", scenario: "run the thing again", observable: "exit code is 0" }] });
    const criterion = loadContract(cwd, "t").criteria[0];
    expect(criterion.status).toBe("red");
    expect(criterion.evidence.red).toBeDefined();
    expect(criterion.scenario).toBe("run the thing again");
  });

  test("status reports the unproven list", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(callTool(cwd, "justsend_contract_status", {})).toContain("Unproven 1: c1");
  });

  test("evidence against an unknown task_key names the fix", () => {
    const cwd = workspace();
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "ghost", criterion_id: "c1", kind: "cleanup", note: "x" }),
    ).toThrow(/justsend_contract_set first/);
  });
});
