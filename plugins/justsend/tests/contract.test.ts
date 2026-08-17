// Defends the transitions the contract server enforces in code, because these
// are exactly the rules an agent under pressure will otherwise talk its way
// around: no GREEN without a RED, no SURFACE before GREEN, no artifact it did
// not produce, and no completion while a criterion is unproven.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs shipped to node, no type declarations by design.
import { callTool, gateReason, loadContract, validateArtifact } from "../mcp/contract.mjs";

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
