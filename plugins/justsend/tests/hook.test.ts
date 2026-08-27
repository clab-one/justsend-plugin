// Defends the omp hook's observable contract against the real scripts: the
// destructive guard blocks and allows the same commands the shell tests cover,
// and a work tool call opens or closes the open-record list.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  // The literal used to be pinned here, which meant every release edited a test to
  // agree with itself. The invariant that has value is that the manifests move
  // together: the install cache is keyed by version, so a bump that misses one
  // manifest serves stale files under a version that claims to be current. That is
  // exactly how skill://justsend-work went stale at 0.9.3.

  // Three times in one session the installed plugin served files older than the tree:
  // the cache is keyed by version, so content that lands after an install is invisible
  // until the version moves again. The manifests agreeing with each other does not
  // catch it — only comparing the installed tree against this one does.
  test("an install cache for the declared version matches this tree", () => {
    const version = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")).version;
    const cacheRoot = join(process.env.HOME ?? "", ".omp/plugins/cache/plugins");
    // Not installed on this machine: nothing to be out of step with.
    if (!existsSync(cacheRoot)) return;
    const prefix = "justsend-plugin___justsend___";
    const versions = readdirSync(cacheRoot)
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length));
    if (versions.length === 0) return;

    // A bump with no reinstall is the same defect wearing a different hat: the
    // harness keeps serving the previous version, and the declared one has no cache
    // to compare against, so the file walk below would pass by finding nothing.
    expect(versions).toContain(version);

    const installed = join(cacheRoot, `${prefix}${version}`);

    const walk = (dir: string, base = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name), join(base, entry.name))
          : [join(base, entry.name)],
      );
    const drifted = walk(root)
      .filter((rel) => existsSync(join(installed, rel)))
      .filter((rel) => readFileSync(join(root, rel), "utf8") !== readFileSync(join(installed, rel), "utf8"));

    expect(drifted).toEqual([]);
  });
  test("ships one plugin whose declared versions all agree, with the merged work skill", () => {
    const claude = JSON.parse(
      readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const codex = JSON.parse(
      readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf8"),
    );
    const marketplace = JSON.parse(
      readFileSync(join(root, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"),
    );
    expect(claude.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(codex.version).toBe(claude.version);
    expect(marketplace.metadata.version).toBe(claude.version);
    // The catalog entry carries no version of its own; it resolves one through
    // `source`, so a version there would be a fourth copy to drift.
    expect(marketplace.plugins.find((entry: { name: string }) => entry.name === "justsend")?.source)
      .toBe("./plugins/justsend");
    expect(readdirSync(join(root, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)).toEqual(["justsend-work"]);
    for (const phase of ["plan.md", "loop.md", "review.md"]) {
      expect(readFileSync(join(root, "skills", "justsend-work", phase), "utf8").length)
        .toBeGreaterThan(0);
    }
  });

  test("injects the authoring contract and MCP schema-failure rules", () => {
    const skill = readFileSync(join(root, "skills", "justsend-work", "SKILL.md"), "utf8");
    const instructions = readFileSync(
      join(root, "skills", "justsend-work", "reference", "instructions-block.md"),
      "utf8",
    );
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
    const policySurfaces = [skill, instructions, output]
      .map((text) => text.replace(/\s+/g, " "));
    for (const rule of [
      "read its current schema",
      "`Invalid args` or a schema-validation error means the tool did not run",
      "until the corrected call succeeds",
      "uppercased with separators removed",
      // The drawing contract lives here now: a third-party plugin's version
      // directory is not a path an instruction may point at, because an upgrade
      // deletes it and the session that reads the line finds nothing.
      "hero-diagram.md",
      "hero-check.py",
      "hero-bake.sh",
      // Export scope is load-bearing: the first `<svg>` only, at viewBox x 2.
      "viewBox",
    ]) {
      for (const surface of policySurfaces) expect(surface).toContain(rule);
    }
    expect(skill).not.toContain("The title is the first line of `work_start(task:)`");
    expect(output).not.toContain("It is honoured only at creation");
    // The retired axis and nameplate wording must be gone, not merely outvoted by a
    // newer sentence: `project` used to be the raw directory basename, which forks a
    // second numbering series, and the nameplate used to be the project alone.
    // The templates only fix the "always a flowchart" default if the surfaces an
    // agent actually reads point at them. Naming the reference is not enough: it
    // is the copyable page that removes the reason to invent coordinates.
    for (const surface of policySurfaces) {
      expect(surface).toContain("templates/hero");
      expect(surface).toContain("data-type");
      for (const story of ["flow", "loop", "timeline", "swimlane", "cause"]) {
        expect(surface).toContain(story);
      }
    }

    for (const surface of policySurfaces) {
      expect(surface).not.toContain("directory basename");
      // The newspaper page is retired, not outvoted. Every word that told an agent to
      // build a masthead must be gone, or a session reading one stale line will spend
      // 3KB of hand-written page HTML again.
      for (const retired of [
        "newspaper page",
        "masthead",
        "nameplate",
        "dateline",
        "--hed",
        "--deck",
        // Absorbed: no surface may send a session to another plugin's cache or to a
        // profile in the home directory. Both move; this repository does not.
        "diagram-design",
        ".diagram-design",
        "<skill-dir>",
        "Playwright",
      ]) {
        expect(surface).not.toContain(retired);
      }
    }
  });
});

describe("record diagram tools", () => {
  const root = join(import.meta.dir, "..");
  const check = join(root, "scripts", "hero-check.py");
  const templates = join(root, "templates", "hero");
  // The templates are the fixtures: an example nobody ships is an example nobody
  // keeps working, and a second copy would drift from the one agents actually open.
  const fixture = join(templates, "flow.html");
  const run = (path: string, story?: string) =>
    Bun.spawnSync(story ? ["python3", check, "--type", story, path] : ["python3", check, path]);

  const STORIES = ["flow", "pipeline", "state", "structure", "sequence",
                   "comparison", "loop", "timeline", "swimlane", "cause"];
  // Removing exactly the element the type is named after. The other five types
  // are declaration only, and the test below proves the check does not guess.
  const DEFINING: Record<string, [RegExp, string]> = {
    sequence: [/ stroke-dasharray="3 4"/g, "dashed vertical lifelines"],
    timeline: [/<line x1="72" y1="240" x2="944" y2="240"[^/]*\/>/, "time axis"],
    swimlane: [/ class="lane"/g, 'class="lane"'],
    cause: [/<line x1="104" y1="240" x2="824" y2="240"[^/]*\/>/, "spine"],
    loop: [/<path d="M 800 240[\s\S]*?\/>/, "returns to an earlier point"],
  };

  const draft = () => readFileSync(fixture, "utf8");
  const mutated = (from: string, to: string) => {
    const source = draft();
    expect(source).toContain(from);
    const path = join(tmpdir(), `hero-${Math.random().toString(36).slice(2)}.html`);
    writeFileSync(path, source.replace(from, to));
    return path;
  };

  test("ships one drawn template per story, and every one keeps the contract", () => {
    expect(readdirSync(templates).sort()).toEqual(STORIES.map((s) => `${s}.html`).sort());
    const bodies = new Set<string>();
    for (const story of STORIES) {
      const path = join(templates, `${story}.html`);
      expect(readFileSync(path, "utf8")).toContain(`data-type="${story}"`);
      expect(run(path).exitCode).toBe(0);
      expect(run(path, story).exitCode).toBe(0);
      bodies.add(readFileSync(path, "utf8").split('<rect width="100%"')[1]);
    }
    // Ten templates that were one template with new labels would not fix anything.
    expect(bodies.size).toBe(STORIES.length);
  });

  test("refuses a story outside the vocabulary, and a flag that contradicts the page", () => {
    const unknown = mutated('data-type="flow"', 'data-type="fishbone"');
    expect(run(unknown).exitCode).toBe(1);
    expect(run(unknown).stderr.toString()).toContain("is not one of");
    const crossed = run(fixture, "loop");
    expect(crossed.exitCode).toBe(1);
    expect(crossed.stderr.toString()).toContain("contradicts the page");
  });

  test("looks for the element each of the five types is named after", () => {
    for (const [story, [pattern, reason]] of Object.entries(DEFINING)) {
      const source = readFileSync(join(templates, `${story}.html`), "utf8");
      const stripped = source.replace(pattern, "");
      expect(stripped).not.toBe(source);
      const path = join(tmpdir(), `hero-${story}-${Math.random().toString(36).slice(2)}.html`);
      writeFileSync(path, stripped);
      const result = run(path);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(reason);
    }
  });

  test("never guesses validity from the shape inventory", () => {
    // Each of these is a correct drawing that a shape-counting checker would
    // reject: a linear flow, a square-cornered state machine, a pipeline with no
    // chips, a structure with no zone box, a comparison with one axis.
    const allowed: [string, RegExp][] = [
      ["flow", /<(polygon points="500|ellipse)[^/]*\/>/g],
      ["state", / rx="8"/g],
      ["pipeline", /<rect x="(36|804)" y="(72|316)"[^/]*\/>/g],
      ["structure", /<rect x="(40|520)" y="96"[^/]*\/>/g],
      ["comparison", /<line x1="120" y1="464" x2="120" y2="88"[^/]*\/>/],
    ];
    for (const [story, pattern] of allowed) {
      const source = readFileSync(join(templates, `${story}.html`), "utf8");
      const stripped = source.replace(pattern, "");
      expect(stripped).not.toBe(source);
      const path = join(tmpdir(), `hero-ok-${story}-${Math.random().toString(36).slice(2)}.html`);
      writeFileSync(path, stripped);
      expect(run(path).exitCode).toBe(0);
    }
  });

  test("a swimlane divider must be declared and full-width, not one or the other", () => {
    const source = readFileSync(join(templates, "swimlane.html"), "utf8");
    const cases = [
      // the case a geometry-only rule got wrong: one lane plus the legend hairline
      source.replace(/    <line class="lane" x1="40" y1="(216|336)"[^/]*\/>\n/g, ""),
      // and the case a class-only rule would get wrong: `lane` on short strokes
      source.replace(/x1="40" y1="(96|216)" x2="960"/g, 'x1="40" y1="$1" x2="200"')
            .replace(/    <line class="lane" x1="40" y1="336"[^/]*\/>\n/, ""),
    ];
    for (const body of cases) {
      expect(body).not.toBe(source);
      const path = join(tmpdir(), `hero-sw-${Math.random().toString(36).slice(2)}.html`);
      writeFileSync(path, body);
      const result = run(path);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('class="lane"');
    }
  });

  // Each mutation is one rule from reference/hero-diagram.md, and each is a real
  // way a record image goes wrong: a font that loads over the network re-flows
  // Hangul on the next machine; a diagonal connector cannot be traced; a colour
  // outside the palette makes two records look like two libraries.
  const violations: [string, string, string, string][] = [
    ["a remote font", '<meta charset="UTF-8">',
      '<meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">',
      "remote reference"],
    ["a diagonal connector", '<line x1="500" y1="92" x2="500" y2="132"',
      '<line x1="500" y1="92" x2="620" y2="132"', "diagonal <line>"],
    ["a colour off the palette", 'stroke="#d0021b" stroke-width="1.2"',
      'stroke="#eb6c36" stroke-width="1.2"', "outside the record palette"],
    ["box geometry off the 4px grid", '<rect x="412" y="136" width="176" height="72"',
      '<rect x="413" y="136" width="176" height="72"', "divisible by 4"],
    ["a script", "</body>", "<script>console.log(1)</script></body>", "<script> is not allowed"],
    ["an empty description", '<desc id="record-hero-desc">시작', '<desc id="record-hero-desc"></desc><x>시작'],
  ] as [string, string, string, string][];

  for (const [name, from, to, reason] of violations) {
    test(`refuses ${name}`, () => {
      const result = run(mutated(from, to));
      expect(result.exitCode).toBe(1);
      const said = result.stderr.toString();
      expect(said).toContain("FAIL");
      if (reason) expect(said).toContain(reason);
    });
  }

  test("the bake refuses to write a PNG for a drawing that fails the check", () => {
    const bad = mutated('<line x1="500" y1="92" x2="500" y2="132"',
                        '<line x1="500" y1="92" x2="620" y2="132"');
    const out = join(tmpdir(), `hero-${Math.random().toString(36).slice(2)}.png`);
    const result = Bun.spawnSync(["bash", join(root, "scripts", "hero-bake.sh"), bad, out]);
    expect(result.exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  test("the tools are executable and carry the export contract", () => {
    for (const tool of ["hero-check.py", "hero-bake.sh"]) {
      expect(statSync(join(root, "scripts", tool)).mode & 0o111).toBeGreaterThan(0);
    }
    const bake = readFileSync(join(root, "scripts", "hero-bake.sh"), "utf8");
    // The size claim is measured, not computed: a bake that trusts its own
    // arithmetic cannot notice a clipped page.
    expect(bake).toContain("size mismatch");
    expect(bake).toContain("hero-check.py");
    const reference = readFileSync(
      join(root, "skills", "justsend-work", "reference", "hero-diagram.md"), "utf8");
    expect(reference).toContain("THIRD_PARTY_LICENSES.md");
    expect(readFileSync(join(root, "..", "..", "THIRD_PARTY_LICENSES.md"), "utf8"))
      .toContain("MIT License");
  });
});

