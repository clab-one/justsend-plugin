// Defends the omp hook's observable contract against the real scripts: the
// destructive guard blocks and allows the same commands the shell tests cover,
// and a work tool call opens or closes the open-record list.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import justsend, { guardBash, guardComplete, openRecords, workVerb } from "../hooks/post/justsend";
// @ts-expect-error — plain .mjs shipped to node, no type declarations by design.
import { callTool, gateReason, loadContract } from "../mcp/contract.mjs";

const CWD = "/tmp/js-omp-hook-test";
let state: string;

beforeAll(() => {
  state = mkdtempSync(join(tmpdir(), "justsend-state-"));
  process.env.JUSTSEND_STATE_DIR = state;
});
afterAll(() => rmSync(state, { recursive: true, force: true }));

describe("workVerb", () => {
  test("matches the omp tool naming", () => {
    expect(workVerb("mcp__justsend_work_start")).toBe("work_start");
  });
  test("matches the Claude Code tool naming", () => {
    expect(workVerb("mcp__justsend__justsend_work_complete")).toBe("work_complete");
  });
  test("ignores another server's tools", () => {
    expect(workVerb("mcp__plane_work_start")).toBeUndefined();
  });
  test("ignores read-only justsend tools", () => {
    expect(workVerb("mcp__justsend_search")).toBeUndefined();
  });
});

describe("guardBash", () => {
  test("blocks rm -rf on a real path", () => {
    const result = guardBash("rm -rf /var/data", CWD);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("rm -rf");
  });
  test("blocks a force push", () => {
    expect(guardBash("git push -f origin main", CWD)?.block).toBe(true);
  });
  test("allows build-output cleanup", () => {
    expect(guardBash("rm -rf node_modules dist", CWD)).toBeUndefined();
  });
  test("allows an unrelated command", () => {
    expect(guardBash("git status", CWD)).toBeUndefined();
  });
});

describe("registered handlers", () => {
  function collect() {
    const handlers = new Map<string, (e: any, c: any) => any>();
    justsend({ on: (event, handler) => void handlers.set(event, handler) });
    return handlers;
  }

  test("a bash tool_call is gated and other tools are not", async () => {
    const handlers = collect();
    const call = handlers.get("tool_call")!;
    expect(await call({ toolName: "bash", input: { command: "git reset --hard" } }, { cwd: CWD })).toMatchObject({ block: true });
    expect(await call({ toolName: "read", input: { path: "rm -rf /" } }, { cwd: CWD })).toBeUndefined();
  });

  test("work_start opens the record and work_complete closes it", async () => {
    const handlers = collect();
    const result = handlers.get("tool_result")!;
    await result({ toolName: "mcp__justsend_work_start", input: { task_key: "omp-hook" }, isError: false }, { cwd: CWD });
    expect(openRecords(CWD)).toContain("omp-hook");

    await result({ toolName: "mcp__justsend_work_complete", input: { task_key: "omp-hook" }, isError: false }, { cwd: CWD });
    expect(openRecords(CWD)).not.toContain("omp-hook");
  });

  // The gate's message names `justsend_work_note(blocker: true)` as the way out
  // when a human has to act, so every harness that runs the hooks has to honour
  // it. omp runs this file instead of hooks.json, which is why it needs its own
  // proof rather than inheriting the shell one.
  test("a blocker note disarms the contract gate", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "js-omp-contract-"));
    callTool(cwd, "justsend_contract_set", {
      task_key: "omp-blocked",
      objective: "prove it",
      tier: "LIGHT",
      criteria: [{ scenario: "run the thing", observable: "exit code is 0" }],
    });
    expect(gateReason(loadContract(cwd, "omp-blocked"))).toContain("c1[pending]");

    const result = collect().get("tool_result")!;
    await result(
      {
        toolName: "mcp__justsend_work_note",
        input: { task_key: "omp-blocked", blocker: true, note: "needs a human" },
        isError: false,
      },
      { cwd },
    );

    expect(loadContract(cwd, "omp-blocked").blocked_at).toBeString();
    expect(gateReason(loadContract(cwd, "omp-blocked"))).toBeUndefined();
  });

  test("an ordinary note leaves the gate armed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "js-omp-contract-"));
    callTool(cwd, "justsend_contract_set", {
      task_key: "omp-open",
      objective: "prove it",
      tier: "LIGHT",
      criteria: [{ scenario: "run the thing", observable: "exit code is 0" }],
    });

    const result = collect().get("tool_result")!;
    await result(
      { toolName: "mcp__justsend_work_note", input: { task_key: "omp-open", note: "progress" }, isError: false },
      { cwd },
    );

    expect(loadContract(cwd, "omp-open").blocked_at).toBeUndefined();
    expect(gateReason(loadContract(cwd, "omp-open"))).toContain("c1[pending]");
  });

  test("a failed omp completion releases its contract lease", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "js-omp-lease-"));
    const proof = join(cwd, "review.log");
    writeFileSync(proof, "approved\n");
    callTool(cwd, "justsend_contract_set", {
      task_key: "omp-lease",
      objective: "lease",
      tier: "LIGHT",
      criteria: [{ id: "c1", scenario: "review", observable: "approved", proof: "review" }],
    });
    callTool(cwd, "justsend_evidence", {
      task_key: "omp-lease",
      criterion_id: "c1",
      kind: "surface",
      artifact_path: proof,
    });

    const handlers = collect();
    expect(
      await handlers.get("tool_call")!(
        { toolName: "mcp__justsend_work_complete", input: { task_key: "omp-lease" } },
        { cwd },
      ),
    ).toBeUndefined();
    expect(loadContract(cwd, "omp-lease").completion_lease).toBeDefined();

    await handlers.get("tool_result")!(
      {
        toolName: "mcp__justsend_work_complete",
        input: { task_key: "omp-lease" },
        isError: true,
      },
      { cwd },
    );
    expect(loadContract(cwd, "omp-lease").completion_lease).toBeUndefined();
    expect(loadContract(cwd, "omp-lease").closed_at).toBeUndefined();
  });

  test("compaction re-injects the open record", async () => {
    const handlers = collect();
    const result = handlers.get("tool_result")!;
    const compacting = handlers.get("session.compacting")!;
    expect(await compacting({}, { cwd: CWD })).toBeUndefined();

    await result({ toolName: "mcp__justsend_work_start", input: { task_key: "survives-compaction" }, isError: false }, { cwd: CWD });
    const injected = await compacting({}, { cwd: CWD });
    expect(injected.context[0]).toContain("survives-compaction");
    expect(injected.context[0]).toContain("`summary`");
  });
});

describe("contract runtime resolver", () => {
  const root = join(import.meta.dir, "..");
  const runner = join(root, "mcp", "run.sh");
  const hook = join(root, "scripts", "contract.sh");

  function fakeRuntime(dir: string, name: string) {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$*" > "$JUSTSEND_RUNTIME_ARGS"\n`);
    chmodSync(path, 0o755);
    return path;
  }

  test.each(["bun", "node"])("%s-only runs MCP subcommands through the same entrypoint", (name) => {
    const dir = mkdtempSync(join(tmpdir(), `justsend-${name}-only-`));
    const args = join(dir, "args");
    fakeRuntime(dir, name);
    const run = Bun.spawnSync([runner, "gate", "runtime-task"], {
      cwd: root,
      env: { ...process.env, PATH: dir, HOME: dir, JUSTSEND_RUNTIME_ARGS: args },
    });
    expect(run.exitCode).toBe(0);
    expect(readFileSync(args, "utf8").trim()).toBe(`${join(root, "mcp", "contract.mjs")} gate runtime-task`);
  });

  test("an explicit runtime override is shared by the shell hook", () => {
    const dir = mkdtempSync(join(tmpdir(), "justsend-runtime-override-"));
    const args = join(dir, "args");
    const runtime = fakeRuntime(dir, "custom-js");
    const run = Bun.spawnSync(["bash", hook, "continuation"], {
      cwd: root,
      env: {
        ...process.env,
        JUSTSEND_CONTRACT_RUNTIME: runtime,
        JUSTSEND_RUNTIME_ARGS: args,
      },
    });
    expect(run.exitCode).toBe(0);
    expect(readFileSync(args, "utf8").trim()).toBe(`${join(root, "mcp", "contract.mjs")} continuation`);
  });

  test("the resolver itself reports a missing explicit runtime", () => {
    const run = Bun.spawnSync([runner, "gate", "runtime-task"], {
      cwd: root,
      env: { ...process.env, JUSTSEND_CONTRACT_RUNTIME: "/missing/justsend-runtime" },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("cannot be executed");
  });

  test("the shell completion gate maps a missing runtime to deny", () => {
    const run = Bun.spawnSync(["bash", hook, "gate", "runtime-task"], {
      cwd: root,
      env: { ...process.env, JUSTSEND_CONTRACT_RUNTIME: "/missing/justsend-runtime" },
    });
    expect(run.exitCode).toBe(2);
    expect(run.stdout.toString()).toContain('"permissionDecision":"deny"');
    expect(run.stderr.toString()).toContain("completion remains blocked");
  });

  test("the omp completion hook also blocks infrastructure failure", () => {
    const previous = process.env.JUSTSEND_CONTRACT_RUNTIME;
    process.env.JUSTSEND_CONTRACT_RUNTIME = "/missing/justsend-runtime";
    try {
      expect(guardComplete("runtime-task", root)).toMatchObject({ block: true });
    } finally {
      if (previous === undefined) delete process.env.JUSTSEND_CONTRACT_RUNTIME;
      else process.env.JUSTSEND_CONTRACT_RUNTIME = previous;
    }
  });
});

describe("packaged authoring contract", () => {
  const root = join(import.meta.dir, "..");

  test("portable hooks close, abandon, and release the matching lifecycle", () => {
    const manifest = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
    const post = manifest.hooks.PostToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    const failed = manifest.hooks.PostToolUseFailure as Array<{
      matcher: string;
      hooks: Array<{ command: string }>;
    }>;
    expect(post.find((entry) => entry.matcher === "justsend_work_complete")?.hooks[0].command).toContain(" close ");
    expect(post.find((entry) => entry.matcher === "justsend_work_retract")?.hooks[0].command).toContain(" abandon ");
    expect(failed.find((entry) => entry.matcher === "justsend_work_complete")?.hooks[0].command).toContain(" release ");
  });

  test("ships one 0.9.2 plugin with the merged work skill", () => {
    const claude = JSON.parse(
      readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const codex = JSON.parse(
      readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf8"),
    );
    const marketplace = JSON.parse(
      readFileSync(join(root, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"),
    );
    expect(claude.version).toBe("0.9.2");
    expect(codex.version).toBe("0.9.2");
    expect(marketplace.metadata.version).toBe("0.9.2");
    expect(readdirSync(join(root, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)).toEqual(["justsend-work"]);
    for (const phase of ["plan.md", "loop.md", "review.md"]) {
      expect(readFileSync(join(root, "skills", "justsend-work", phase), "utf8").length)
        .toBeGreaterThan(0);
    }
  });

  test("injects the same title-body-image start contract the skill teaches", () => {
    const skill = readFileSync(join(root, "skills", "justsend-work", "SKILL.md"), "utf8");
    const session = Bun.spawnSync(["bash", join(root, "scripts", "session-start.sh")], {
      cwd: root,
      env: { ...process.env, JUSTSEND_STATE_DIR: state },
    });
    const output = session.stdout.toString();
    expect(session.exitCode).toBe(0);
    for (const token of ["`title`", "`body`", "`image_path`"]) {
      expect(skill).toContain(token);
      expect(output).toContain(token);
    }
    expect(skill).not.toContain("The title is the first line of `work_start(task:)`");
    expect(output).not.toContain("It is honoured only at creation");
  });
});
