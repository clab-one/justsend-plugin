// Defends the transitions the contract server enforces in code, because these
// are exactly the rules an agent under pressure will otherwise talk its way
// around: no GREEN without a RED, no SURFACE before GREEN, no artifact it did
// not produce, and no completion while a criterion is unproven.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs shipped to node, no type declarations by design.
import {
  LEGACY_PROTOCOLS,
  MODERN_PROTOCOLS,
  TOOLS,
  callTool,
  contractPath,
  gateReason,
  loadContract,
  validateArtifact,
} from "../mcp/contract.mjs";

function manifestVersion(): string {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../.claude-plugin/plugin.json", import.meta.url)), "utf8")).version;
}

// Every run used to leave its temp contracts behind; thousands had accumulated. A suite that
// tests teardown discipline should not be the thing leaking.
const workspaces: string[] = [];
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "js-contract-"));
  workspaces.push(dir);
  return dir;
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
    expect(existsSync(join(cwd, ".justsend", "evidence"))).toBe(false);
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
    expect(loadContract(cwd, "t").criteria[0].cleanup_receipts[0].at).toBeString();
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

  // 아래 넷은 감사(2026-08-23)에서 실제로 시도해 본 우회다. 전부 막혔고, 막힌 이유는
  // `realpathSync` 로 먼저 실체를 구한 뒤 **경계 구분자까지 포함해** 접두어를 보기
  // 때문이다(`real === root || real.startsWith(root + sep)`). 그 두 성질 중 하나만
  // 빠져도 아래가 통과하므로, 통과하는 상태를 여기 고정한다.
  test("a parent directory that is a symlink cannot smuggle an outside file in", () => {
    const cwd = workspace();
    const gate = join(cwd, "etc");
    symlinkSync("/etc", gate);
    expect(() => validateArtifact(cwd, join(gate, "hosts"))).toThrow(/outside the allowed roots/);
  });

  test("dot-dot cannot climb out of the allowed roots", () => {
    const cwd = workspace();
    expect(() => validateArtifact(cwd, "../".repeat(12) + "etc/hosts")).toThrow(
      /outside the allowed roots/,
    );
  });

  test("an absolute path outside the roots is refused", () => {
    const cwd = workspace();
    expect(() => validateArtifact(cwd, "/etc/hosts")).toThrow(/outside the allowed roots/);
  });

  test("a sibling directory whose name starts with a root is not inside it", () => {
    const cwd = workspace();
    // `<tmpdir>-evil/x.log` shares the root's textual prefix but not its path
    // boundary — the classic `startsWith` mistake this check must not make.
    const sibling = `${tmpdir().replace(/\/$/, "")}-evil`;
    mkdirSync(sibling, { recursive: true });
    const path = join(sibling, "x.log");
    writeFileSync(path, "forged\n");
    expect(() => validateArtifact(cwd, path)).toThrow(/outside the allowed roots/);
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

  test("captures immutable bytes and a complete receipt", () => {
    const cwd = workspace();
    contracted(cwd);
    const source = artifact(cwd, "mutable.log", "before\n");
    callTool(cwd, "justsend_evidence", {
      task_key: "t",
      criterion_id: "c1",
      kind: "red",
      artifact_path: source,
    });
    const receipt = loadContract(cwd, "t").criteria[0].evidence.red;
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.size).toBe(7);
    expect(receipt.captured_at).toBeString();
    expect(receipt.source_path).toBe(realpathSync(source));
    expect(receipt.snapshot_path).toBe(`.justsend/evidence/sha256/${receipt.sha256.slice(0, 2)}/${receipt.sha256}`);
    expect(callTool(cwd, "justsend_contract_status", { task_key: "t" })).toContain(realpathSync(source));
    writeFileSync(source, "after\n");
    expect(readFileSync(join(cwd, receipt.snapshot_path), "utf8")).toBe("before\n");
    rmSync(source);
    expect(readFileSync(join(cwd, receipt.snapshot_path), "utf8")).toBe("before\n");
  });

  test("deduplicates the same evidence bytes from different paths", () => {
    const cwd = workspace();
    contracted(cwd, {
      criteria: [
        { id: "c1", scenario: "first", observable: "first" },
        { id: "c2", scenario: "second", observable: "second" },
      ],
    });
    for (const [criterion, name] of [["c1", "one.log"], ["c2", "two.log"]] as const) {
      callTool(cwd, "justsend_evidence", {
        task_key: "t",
        criterion_id: criterion,
        kind: "red",
        artifact_path: artifact(cwd, name, "same bytes\n"),
      });
    }
    const stored = loadContract(cwd, "t") as unknown as {
      criteria: Array<{ evidence: { red: { sha256: string; snapshot_path: string } } }>;
    };
    const [first, second] = stored.criteria.map((entry) => entry.evidence.red);
    expect(first.sha256).toBe(second.sha256);
    expect(first.snapshot_path).toBe(second.snapshot_path);
  });

  test("refuses a symlink substituted for an existing snapshot", () => {
    const cwd = workspace();
    contracted(cwd, {
      criteria: [
        { id: "c1", scenario: "first", observable: "first" },
        { id: "c2", scenario: "second", observable: "second" },
      ],
    });
    const first = artifact(cwd, "first.log", "same bytes\n");
    callTool(cwd, "justsend_evidence", {
      task_key: "t", criterion_id: "c1", kind: "red", artifact_path: first,
    });
    const receipt = loadContract(cwd, "t").criteria[0].evidence.red;
    const snapshot = join(cwd, receipt.snapshot_path);
    rmSync(snapshot);
    symlinkSync(first, snapshot);
    expect(() =>
      callTool(cwd, "justsend_evidence", {
        task_key: "t",
        criterion_id: "c2",
        kind: "red",
        artifact_path: artifact(cwd, "second.log", "same bytes\n"),
      }),
    ).toThrow(/not a real file/);
  });
});

describe("task identity", () => {
  test("keeps valid keys canonical and rejects collision-prone identities", () => {
    const cwd = workspace();
    for (const key of ["a", "a.b_c-d", "a".repeat(64)]) {
      expect(contractPath(cwd, key)).toEndWith(`${key}.json`);
    }
    for (const key of [".", "..", "abc/def", "abc:def", "two words", "Upper", "a".repeat(65), "-edge", "edge-"]) {
      expect(() => contractPath(cwd, key)).toThrow(/Invalid task_key/);
    }
  });

  test("tool calls reject invalid keys instead of sanitizing them", () => {
    const cwd = workspace();
    expect(() =>
      callTool(cwd, "justsend_contract_set", {
        task_key: "abc/def",
        objective: "bad identity",
        tier: "LIGHT",
        criteria,
      }),
    ).toThrow(/Invalid task_key/);
    expect(existsSync(join(cwd, ".justsend", "contract", "abc-def.json"))).toBe(false);
  });
});

describe("completion gate", () => {
  test("locks while a criterion is unproven", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");
  });

  test("surfacing alone does not open it — the teardown receipt is part of the proof", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    // Proven, but whatever the scenario spawned is still running.
    const held = gateReason(loadContract(cwd, "t"));
    expect(held).toContain("no teardown recorded");
    expect(held).toContain("c1");

    // The other three readers of the same fact. `continuation` resolves its target
    // through activeContract -> isDone, so a contract that looks finished there ends
    // the turn quietly no matter what gateReason() would have said.
    const server = fileURLToPath(new URL("../mcp/contract.mjs", import.meta.url));
    const stop = spawnSync(process.execPath, [server, "continuation"], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      encoding: "utf8",
    });
    expect(stop.status).toBe(2);
    expect(`${stop.stdout}${stop.stderr}`).toContain("no teardown recorded");
    expect(callTool(cwd, "justsend_contract_status", { task_key: "t" })).toContain("No teardown receipt");

    const reply = callTool(cwd, "justsend_evidence", {
      task_key: "t",
      criterion_id: "c1",
      kind: "cleanup",
      note: "nothing spawned",
    });
    expect(reply).toContain("proven and torn down");
    expect(gateReason(loadContract(cwd, "t"))).toBeUndefined();
    expect(
      spawnSync(process.execPath, [server, "continuation"], {
        cwd,
        env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
        encoding: "utf8",
      }).status,
    ).toBe(0);
  });

  test("a criterion with no status field is reported as malformed, not as undefined", () => {
    const cwd = workspace();
    contracted(cwd);
    const file = contractPath(cwd, "t");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    delete raw.criteria[0].status;
    writeFileSync(file, JSON.stringify(raw));
    const reason = gateReason(loadContract(cwd, "t"));
    expect(reason).toContain("malformed");
    expect(reason).not.toContain("undefined");
  });

  test("GREEN needs the RED state, not a RED artifact left over from an earlier cycle", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    // Two calls used to replace the proof here: green passed because a RED existed at all,
    // then surface passed because green had just set the status.
    const forged = artifact(cwd, "forged.log", "anything at all\n");
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "green", artifact_path: forged }),
    ).toThrow(/already surfaced/);
    expect(loadContract(cwd, "t").criteria[0].evidence.green.source_path).toBe(realpathSync(path));
  });

  test("reopen archives the finished cycle, returns to pending, and re-arms the gate", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    for (const kind of ["red", "green", "surface"]) {
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind, artifact_path: path });
    }
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "cleanup", note: "nothing spawned" });
    expect(gateReason(loadContract(cwd, "t"))).toBeUndefined();

    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "reopen" }),
    ).toThrow(/note saying what changed/);

    callTool(cwd, "justsend_evidence", {
      task_key: "t",
      criterion_id: "c1",
      kind: "reopen",
      note: "the tree moved after this was surfaced",
    });
    const after = loadContract(cwd, "t").criteria[0];
    expect(after.status).toBe("pending");
    expect(after.evidence).toEqual({});
    expect(after.cleanup_receipts).toEqual([]);
    expect(after.superseded).toHaveLength(1);
    // The old cycle is kept, not dropped: that is what makes a reopen auditable.
    expect(after.superseded[0].evidence.surface.source_path).toBe(realpathSync(path));
    expect(after.superseded[0].reason).toContain("the tree moved");
    expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");

    // Failing-first still binds on the new cycle.
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "green", artifact_path: path }),
    ).toThrow(/Failing-first/);
  });

  test("a review criterion surfaces once; the reviewed basis cannot be quietly replaced", () => {
    const cwd = workspace();
    callTool(cwd, "justsend_contract_set", {
      task_key: "t",
      objective: "prove it",
      tier: "LIGHT",
      criteria: [{ id: "c1", scenario: "judge the prose", observable: "it holds", proof: "review" }],
    });
    const basis = artifact(cwd, "basis.log", "the basis that was read\n");
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "surface", artifact_path: basis });

    // The green guard does not cover this: a review criterion never enters the red or green
    // state, so surface was the only door and it checked nothing.
    const other = artifact(cwd, "other.log", "an unrelated file\n");
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "surface", artifact_path: other }),
    ).toThrow(/already surfaced/);
    expect(loadContract(cwd, "t").criteria[0].evidence.surface.source_path).toBe(realpathSync(basis));

    // Reopening is the recorded way to re-review, and it archives the old basis.
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "reopen", note: "the policy text changed" });
    expect(loadContract(cwd, "t").criteria[0].status).toBe("pending");
    callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "surface", artifact_path: other });
    const after = loadContract(cwd, "t").criteria[0];
    expect(after.status).toBe("surfaced");
    expect(after.evidence.surface.source_path).toBe(realpathSync(other));
    expect(after.superseded[0].evidence.surface.source_path).toBe(realpathSync(basis));
  });

  test("SURFACE on a red-green criterion still requires the green state", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "surface", artifact_path: path }),
    ).toThrow(/SURFACE comes after GREEN \(currently: pending\)/);
  });

  test("reopen applies only to a surfaced criterion", () => {
    const cwd = workspace();
    contracted(cwd);
    expect(() =>
      callTool(cwd, "justsend_evidence", { task_key: "t", criterion_id: "c1", kind: "reopen", note: "why" }),
    ).toThrow(/surfaced criterion \(currently: pending\)/);
  });

  test("a completed contract refuses evidence of every kind", () => {
    const cwd = workspace();
    contracted(cwd);
    const path = artifact(cwd);
    const file = contractPath(cwd, "t");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.closed_at = "2026-08-25T00:00:00Z";
    writeFileSync(file, JSON.stringify(raw));
    // Writing into a finished claim revises what was already reported with nothing saying so.
    for (const kind of ["red", "green", "surface", "cleanup"]) {
      expect(() =>
        callTool(cwd, "justsend_evidence", {
          task_key: "t",
          criterion_id: "c1",
          kind,
          ...(kind === "cleanup" ? { note: "n" } : { artifact_path: path }),
        }),
      ).toThrow(/was completed at/);
    }
    // Re-registering is the documented way back, and it clears the stamp.
    contracted(cwd);
    expect(loadContract(cwd, "t").closed_at).toBeUndefined();
  });

  test("agent payload cannot disarm the user-owned gate", () => {
    const cwd = workspace();
    expect(() => contracted(cwd, { enforce: false })).toThrow(/user-owned/);
    expect(TOOLS.find((tool) => tool.name === "justsend_contract_set")?.inputSchema.properties.enforce).toBeUndefined();
  });

  test("user config selects strict or advisory and defaults to strict", () => {
    const cwd = workspace();
    const configRoot = workspace();
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
      contracted(cwd);
      expect(loadContract(cwd, "t").verification_mode).toBe("strict");
      expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");
      mkdirSync(join(configRoot, "justsend-plugin"), { recursive: true });
      writeFileSync(
        join(configRoot, "justsend-plugin", "config.json"),
        JSON.stringify({ verification: { mode: "advisory" } }),
      );
      contracted(cwd);
      expect(loadContract(cwd, "t").verification_mode).toBe("advisory");
      expect(gateReason(loadContract(cwd, "t"))).toBeUndefined();
      expect(callTool(cwd, "justsend_contract_status", { task_key: "t" })).toContain("Verification mode: advisory");
      expect(callTool(cwd, "justsend_contract_status", { task_key: "t", format: "report" })).toContain("⚠️ advisory");
      writeFileSync(
        join(configRoot, "justsend-plugin", "config.json"),
        JSON.stringify({ verification: { mode: "strict" } }),
      );
      expect(gateReason(loadContract(cwd, "t"))).toContain("c1[pending]");
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
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
    expect(loadContract(cwd, "t").completion_lease).toBeUndefined();
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
    expect(gate.stderr).toContain("criteria still unproven");
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

describe("completion lease", () => {
  const server = fileURLToPath(new URL("../mcp/contract.mjs", import.meta.url));
  const cli = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [server, ...args], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      encoding: "utf8",
    });

  function proven(cwd: string) {
    callTool(cwd, "justsend_contract_set", {
      task_key: "lease",
      objective: "lease",
      tier: "LIGHT",
      criteria: [{ id: "c1", scenario: "review", observable: "approved", proof: "review" }],
    });
    callTool(cwd, "justsend_evidence", {
      task_key: "lease",
      criterion_id: "c1",
      kind: "surface",
      artifact_path: artifact(cwd),
    });
  }

  test("gate freezes the approved revision until close consumes it", () => {
    const cwd = workspace();
    proven(cwd);
    expect(cli(cwd, ["gate", "lease"]).status).toBe(0);
    const leased = loadContract(cwd, "lease");
    expect(leased.completion_lease.revision).toBe(leased.revision);
    expect(() =>
      callTool(cwd, "justsend_contract_set", {
        task_key: "lease",
        objective: "lease",
        tier: "HEAVY",
        criteria: [{ id: "c2", scenario: "late", observable: "must not race" }],
      }),
    ).toThrow(/Completion is in progress/);
    expect(cli(cwd, ["close", "lease"]).status).toBe(0);
    const closed = loadContract(cwd, "lease");
    expect(closed.closed_at).toBeString();
    expect(closed.completion_lease).toBeUndefined();
    expect(closed.criteria.some((entry: { id: string }) => entry.id === "c2")).toBe(false);
  });

  test("a second completion is denied while the first lease is active", () => {
    const cwd = workspace();
    proven(cwd);
    expect(cli(cwd, ["gate", "lease"]).status).toBe(0);
    const second = cli(cwd, ["gate", "lease"]);
    expect(second.status).toBe(2);
    expect(second.stderr).toContain("already in progress");
  });

  test("release clears a failed completion lease without closing", () => {
    const cwd = workspace();
    proven(cwd);
    expect(cli(cwd, ["gate", "lease"]).status).toBe(0);
    expect(cli(cwd, ["release", "lease"]).status).toBe(0);
    const contract = loadContract(cwd, "lease");
    expect(contract.completion_lease).toBeUndefined();
    expect(contract.closed_at).toBeUndefined();
    expect(() =>
      callTool(cwd, "justsend_contract_set", {
        task_key: "lease", objective: "resume", tier: "LIGHT", criteria,
      }),
    ).not.toThrow();
  });

  test("an invalid completion key falls back to the active contract gate", () => {
    const cwd = workspace();
    contracted(cwd);
    const gate = cli(cwd, ["gate", "IOSPROD-202"]);
    expect(gate.status).toBe(2);
    expect(gate.stderr).toContain('for "t"');
  });

  test("a proven fallback contract is read-only and receives no unrelated lease", () => {
    const cwd = workspace();
    proven(cwd);
    expect(cli(cwd, ["gate", "IOSPROD-202"]).status).toBe(0);
    expect(loadContract(cwd, "lease").completion_lease).toBeUndefined();
  });

  test("a blocker invalidates the strict lease and latest gate state permits close", () => {
    const cwd = workspace();
    proven(cwd);
    expect(cli(cwd, ["gate", "lease"]).status).toBe(0);
    expect(cli(cwd, ["block", "lease"]).status).toBe(0);
    const blocked = loadContract(cwd, "lease");
    expect(blocked.completion_lease).toBeUndefined();
    expect(blocked.blocked_at).toBeString();
    expect(cli(cwd, ["close", "lease"]).status).toBe(0);
    expect(loadContract(cwd, "lease").closed_at).toBeString();
  });

  test("advisory completion closes without creating a strict lease", () => {
    const cwd = workspace();
    const configRoot = workspace();
    mkdirSync(join(configRoot, "justsend-plugin"), { recursive: true });
    writeFileSync(
      join(configRoot, "justsend-plugin", "config.json"),
      JSON.stringify({ verification: { mode: "advisory" } }),
    );
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
      callTool(cwd, "justsend_contract_set", {
        task_key: "advisory", objective: "tracked", tier: "LIGHT", criteria,
      });
      expect(cli(cwd, ["gate", "advisory"]).status).toBe(0);
      expect(loadContract(cwd, "advisory").completion_lease).toBeUndefined();
      expect(cli(cwd, ["close", "advisory"]).status).toBe(0);
      expect(loadContract(cwd, "advisory").closed_at).toBeString();
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });

  test("strict pending state refuses close without an approval lease", () => {
    const cwd = workspace();
    contracted(cwd, { task_key: "pending-close" });
    const close = cli(cwd, ["close", "pending-close"]);
    expect(close.status).toBe(2);
    expect(close.stderr).toContain("contract remains open");
    expect(loadContract(cwd, "pending-close").closed_at).toBeUndefined();
  });

  test("an empty contract allowed by the gate can still close", () => {
    const cwd = workspace();
    contracted(cwd, { task_key: "empty" });
    const empty = loadContract(cwd, "empty");
    empty.criteria = [];
    writeFileSync(contractPath(cwd, "empty"), `${JSON.stringify(empty, null, 2)}\n`);
    expect(cli(cwd, ["gate", "empty"]).status).toBe(0);
    expect(cli(cwd, ["close", "empty"]).status).toBe(0);
    expect(loadContract(cwd, "empty").closed_at).toBeString();
  });

  test("retract abandon closes without a completion lease", () => {
    const cwd = workspace();
    contracted(cwd, { task_key: "retracted" });
    expect(cli(cwd, ["abandon", "retracted"]).status).toBe(0);
    expect(loadContract(cwd, "retracted").closed_at).toBeString();
  });
});

describe("multi-process storage", () => {
  test("concurrent contract upserts preserve every successful writer", async () => {
    const cwd = workspace();
    contracted(cwd, { task_key: "race" });
    const barrier = join(cwd, "go");
    const moduleUrl = new URL("../mcp/contract.mjs", import.meta.url).href;
    const children = Array.from({ length: 12 }, (_, index) => {
      const script = `
        import { existsSync } from "node:fs";
        import { callTool } from ${JSON.stringify(moduleUrl)};
        const sleep = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(process.env.BARRIER)) Atomics.wait(sleep, 0, 0, 2);
        callTool(process.env.WORKSPACE, "justsend_contract_set", {
          task_key: "race", objective: "race", tier: "HEAVY",
          criteria: [{ id: process.env.CRITERION, scenario: "run", observable: "kept" }],
        });
      `;
      return Bun.spawn([process.execPath, "-e", script], {
        env: {
          ...process.env,
          WORKSPACE: cwd,
          BARRIER: barrier,
          CRITERION: `p${index}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    });
    writeFileSync(barrier, "go");
    const exits = await Promise.all(children.map((child) => child.exited));
    expect(exits).toEqual(Array(12).fill(0));
    const contract = loadContract(cwd, "race");
    expect(new Set(contract.criteria.map((entry: { id: string }) => entry.id)).size).toBe(13);
    expect(contract.revision).toBe(13);
  });

  test("contract_set and evidence serialize on the same latest revision", async () => {
    const cwd = workspace();
    contracted(cwd, { task_key: "mixed" });
    const proof = artifact(cwd, "mixed.log", "red\n");
    const barrier = join(cwd, "mixed-go");
    const moduleUrl = new URL("../mcp/contract.mjs", import.meta.url).href;
    const common = `
      import { existsSync } from "node:fs";
      import { callTool } from ${JSON.stringify(moduleUrl)};
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(process.env.BARRIER)) Atomics.wait(sleep, 0, 0, 2);
    `;
    const set = Bun.spawn([process.execPath, "-e", `${common}
      callTool(process.env.WORKSPACE, "justsend_contract_set", {
        task_key: "mixed", objective: "mixed", tier: "HEAVY",
        criteria: [{ id: "c2", scenario: "second", observable: "kept" }],
      });
    `], { env: { ...process.env, WORKSPACE: cwd, BARRIER: barrier }, stderr: "pipe" });
    const evidence = Bun.spawn([process.execPath, "-e", `${common}
      callTool(process.env.WORKSPACE, "justsend_evidence", {
        task_key: "mixed", criterion_id: "c1", kind: "red", artifact_path: process.env.PROOF,
      });
    `], { env: { ...process.env, WORKSPACE: cwd, BARRIER: barrier, PROOF: proof }, stderr: "pipe" });
    writeFileSync(barrier, "go");
    expect(await Promise.all([set.exited, evidence.exited])).toEqual([0, 0]);
    const contract = loadContract(cwd, "mixed");
    expect(contract.criteria.find((entry: { id: string }) => entry.id === "c1").status).toBe("red");
    expect(contract.criteria.find((entry: { id: string }) => entry.id === "c2")).toBeDefined();
    expect(contract.revision).toBe(3);
  });

  test("completion gate waits for an in-flight task commit and reads the new state", async () => {
    const cwd = workspace();
    contracted(cwd);
    const lock = join(cwd, ".justsend", "contract", "t.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, token: "writer" }));
    const server = fileURLToPath(new URL("../mcp/contract.mjs", import.meta.url));
    const gate = Bun.spawn([process.execPath, server, "gate", "t"], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      stdout: "pipe",
      stderr: "pipe",
    });
    // Integration boundary: the independent CLI exposes no in-process clock or
    // lock-acquired event. This short wait only lets it reach the live lock;
    // the assertion still depends on the committed state it reads afterwards.
    await Bun.sleep(50);
    const contract = loadContract(cwd, "t");
    // Closable, so the assertion is about the lock and the committed read — not
    // about the receipt rule, which has its own test.
    contract.criteria[0].status = "surfaced";
    contract.criteria[0].cleanup_receipts = [{ at: new Date().toISOString(), note: "nothing spawned" }];
    writeFileSync(contractPath(cwd, "t"), `${JSON.stringify(contract, null, 2)}\n`);
    rmSync(lock, { recursive: true, force: true });
    expect(await gate.exited).toBe(0);
  });

  test("a corrupt contract blocks completion instead of failing open", () => {
    const cwd = workspace();
    mkdirSync(join(cwd, ".justsend", "contract"), { recursive: true });
    writeFileSync(contractPath(cwd, "corrupt"), "{not-json");
    const server = fileURLToPath(new URL("../mcp/contract.mjs", import.meta.url));
    const gate = spawnSync(process.execPath, [server, "gate", "corrupt"], {
      cwd,
      env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
      encoding: "utf8",
    });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toContain("Cannot read contract");
  });
});

describe("MCP dual-era protocol", () => {
  const server = fileURLToPath(new URL("../mcp/contract.mjs", import.meta.url));
  const modernMeta = {
    "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOLS[0],
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
  };

  function rpc(requests: unknown[]) {
    const run = spawnSync(process.execPath, [server], {
      cwd: workspace(),
      input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    return run.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  test("discovers the modern server with cache and server metadata", () => {
    const [reply] = rpc([{ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: modernMeta } }]);
    expect(reply.result).toMatchObject({
      resultType: "complete",
      supportedVersions: MODERN_PROTOCOLS,
      capabilities: { tools: {} },
      ttlMs: 0,
      cacheScope: "private",
      // Read from the manifest rather than pinned: the server reports pluginVersion(),
      // and hook.test.ts is what defends the manifests agreeing with each other.
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "justsend-contract", version: manifestVersion() } },
    });
  });

  test("handles a direct modern list request without prior discovery", () => {
    const [reply] = rpc([{ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: modernMeta } }]);
    expect(reply.result.resultType).toBe("complete");
    expect(reply.result.tools.length).toBeGreaterThan(0);
    expect(reply.result).toMatchObject({ ttlMs: 0, cacheScope: "private" });
  });

  test("returns the modern unsupported-version error and supported list", () => {
    const [reply] = rpc([{
      jsonrpc: "2.0",
      id: 3,
      method: "server/discover",
      params: {
        _meta: {
          ...modernMeta,
          "io.modelcontextprotocol/protocolVersion": "1900-01-01",
        },
      },
    }]);
    expect(reply.error).toEqual({
      code: -32022,
      message: "Unsupported protocol version",
      data: { supported: MODERN_PROTOCOLS, requested: "1900-01-01" },
    });
  });

  test("rejects incomplete modern request metadata", () => {
    const [reply] = rpc([{
      jsonrpc: "2.0",
      id: 4,
      method: "server/discover",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOLS[0] } },
    }]);
    expect(reply.error.code).toBe(-32602);
  });

  test("negotiates legacy initialize from server-owned versions", () => {
    const [supported, unknown] = rpc([
      {
        jsonrpc: "2.0",
        id: 5,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "old", version: "1" } },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "initialize",
        params: { protocolVersion: "1900-01-01", capabilities: {}, clientInfo: { name: "old", version: "1" } },
      },
    ]);
    expect(supported.result.protocolVersion).toBe("2024-11-05");
    expect(unknown.result.protocolVersion).toBe(LEGACY_PROTOCOLS[0]);
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

  // `justsend_work_start.title` is capped at 80 characters, so a longer generated
  // title comes back severed mid-word.
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
