// omp-native hook. Claude Code and Codex run `hooks/hooks.json` (shell commands
// on lifecycle events); omp runs TypeScript factories instead and ignores that
// file. Rather than reimplement the rules in a second language, this hook shells
// out to the SAME scripts, so there is one destructive-command matcher and one
// open-record tracker for every harness.
//
// omp loads `hooks/post/*.ts` from a marketplace-installed plugin, and Claude
// Code and Codex ignore a stray `.ts` under `hooks/`, so the two live together.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type HookResult = { block?: boolean; reason?: string } | undefined;
interface HookAPILike {
  on(event: string, handler: (event: any, ctx: any) => Promise<HookResult> | HookResult): void;
}

const HERE: string =
  (import.meta as { dirname?: string }).dirname ?? dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..", "..", "scripts");

/** Work verbs that open or close a record. Suffix-matched because each harness
 *  namespaces MCP tools differently (`mcp__justsend__justsend_work_start` in
 *  Claude Code, `mcp__justsend_work_start` in omp). */
const WORK_TOOLS = [
  "work_start",
  "work_note",
  "work_complete",
  "work_retract",
  "work_cancel",
  "progress_note",
] as const;

export function workVerb(toolName: string): string | undefined {
  if (!toolName.includes("justsend")) return undefined;
  return WORK_TOOLS.find((verb) => toolName.endsWith(verb));
}

function run(script: string, args: string[], payload: string | undefined, cwd: string) {
  return spawnSync("bash", [join(SCRIPTS, script), ...args], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, JUSTSEND_HOOK_CWD: cwd },
    timeout: 5_000,
  });
}

/** Exit 2 from the guard means "blocked"; stderr carries the reason. Anything
 *  else — including a missing script or a timeout — allows the command through:
 *  a guard that fails closed on its own bug would be worse than no guard. */
export function guardBash(command: string, cwd: string): HookResult {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const result = run("destructive-guard.sh", [], payload, cwd);
  if (result.status !== 2) return undefined;
  const reason = (result.stderr ?? "").trim();
  return { block: true, reason: reason || "Destructive command blocked by the JustSend guard." };
}

export function openRecords(cwd: string): string[] {
  const result = run("open-records.sh", [], undefined, cwd);
  if (result.status !== 0) return [];
  return (result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** The completion gate, same state and same wording the Claude/Codex PreToolUse
 *  hook uses. Only exit 0 permits completion; unproven state and infrastructure
 *  failures both block, while advisory mode is resolved by contract.mjs as 0. */
export function guardComplete(taskKey: string, cwd: string): HookResult {
  const result = run("contract.sh", ["gate", taskKey], undefined, cwd);
  if (result.status === 0) return undefined;
  const reason = (result.stderr ?? "").trim();
  return {
    block: true,
    reason:
      reason ||
      (result.status === 2
        ? "The JustSend contract still has unproven criteria."
        : "The JustSend verification gate could not run; completion remains blocked."),
  };
}

/** Active contract as text, for the status line and for compaction. */
function contract(cwd: string, mode: "summary" | "line"): string | undefined {
  const result = run("contract.sh", [mode], undefined, cwd);
  if (result.status !== 0) return undefined;
  const text = (result.stdout ?? "").trim();
  return text || undefined;
}

function reminder(cwd: string): string | undefined {
  const open = openRecords(cwd);
  if (open.length === 0) return undefined;
  return (
    `Open JustSend record(s): ${open.join(", ")}. Close each one with ` +
    "`justsend_work_complete` (`summary`: outcome, verification, failures, and what is still open), " +
    "or leave `justsend_work_note` with `blocker: true` if a human has to act."
  );
}

/** The concurrency cap. omp queues spawns past it instead of refusing them, so a
 *  seven-wide batch looks accepted and buys nothing — the model gets no
 *  correction signal. Read from omp's own settings so the guard and the harness
 *  cannot disagree; a conservative 2 when the file is unreadable. */
export function parseCap(yml: string): number | undefined {
  const m = /^\s*maxConcurrency:\s*(\d+)\s*$/m.exec(yml);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function configuredCap(): number {
  try {
    const yml = readFileSync(join(homedir(), ".omp", "agent", "config.yml"), "utf8");
    return parseCap(yml) ?? 2;
  } catch {
    return 2;
  }
}

const EXECUTOR_SECTIONS = ["Target", "Change", "Acceptance"] as const;
const EXECUTOR_AGENTS: Record<string, true> = { task: true, worker: true };

/** Missing section headings in an executor brief, at any heading level. */
export function missingWorkerSections(brief: string): string[] {
  return EXECUTOR_SECTIONS.filter((s) => !new RegExp(`^#+\\s*${s}\\b`, "im").test(brief));
}

/** Both delegation rules, for the harness that actually passes a batch.
 *
 *  The shell guard (`delegation-guard.sh`) can only see one agent per call
 *  because that is all Claude Code sends; omp sends `tasks[]`, so the batch cap
 *  is enforceable here and only here. */
export function guardDelegation(tasks: unknown, cap: number): HookResult {
  if (!Array.isArray(tasks)) return undefined;
  if (tasks.length > cap) {
    return {
      block: true,
      reason:
        `task 배치 ${tasks.length}개가 동시 실행 상한(${cap})을 넘습니다. ` +
        `초과분은 큐에서 기다리기만 하므로 병렬 이득이 0입니다. 가장 독립적인 ${cap}개만 ` +
        `먼저 보내고 결과를 받은 뒤 다음 웨이브를 보내거나, 분해를 더 좁히세요.`,
    };
  }
  for (const [i, t] of tasks.entries()) {
    if (!t || typeof t !== "object") continue;
    const entry = t as { agent?: unknown; task?: unknown };
    const requestedAgent = typeof entry.agent === "string" ? entry.agent.trim() : "";
    const agent = requestedAgent || "task";
    if (!Object.hasOwn(EXECUTOR_AGENTS, agent)) continue;
    const missing = missingWorkerSections(typeof entry.task === "string" ? entry.task : "");
    if (missing.length > 0) {
      return {
        block: true,
        reason:
          `executor 태스크(${i + 1}번째)에 필수 섹션이 없습니다: ${missing.map((s) => `# ${s}`).join(", ")}. ` +
          `Target(파일·심볼·비목표) / Change(단계별 변경) / Acceptance(관측 가능한 결과 + 증거 산출물) ` +
          `세 섹션을 마크다운 헤딩으로 반드시 포함해야 합니다.`,
      };
    }
  }
  return undefined;
}

export default function justsend(pi: HookAPILike): void {
  const cap = configuredCap();
  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName ?? "");
    if (workVerb(name) === "work_complete") {
      return guardComplete(String(event.input?.task_key ?? ""), ctx.cwd);
    }
    if (event.toolName === "task") {
      return guardDelegation(event.input?.tasks, cap);
    }
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    if (!command) return;
    return guardBash(command, ctx.cwd);
  });

  pi.on("tool_result", async (event, ctx) => {
    const verb = workVerb(String(event.toolName ?? ""));
    if (!verb) return;
    if (event.isError) {
      if (verb === "work_complete") {
        run("contract.sh", ["release", String(event.input?.task_key ?? "")], undefined, ctx.cwd);
      }
      return;
    }
    run(
      "record-state.sh",
      [],
      JSON.stringify({ tool_name: `justsend_${verb}`, tool_input: event.input ?? {} }),
      ctx.cwd,
    );
    if (verb === "work_complete") {
      run("contract.sh", ["close", String(event.input?.task_key ?? "")], undefined, ctx.cwd);
    }
    if (verb === "work_retract") {
      run("contract.sh", ["abandon", String(event.input?.task_key ?? "")], undefined, ctx.cwd);
    }
    // The blocker decision is made here rather than in the script because this
    // path passes the task_key as an argument and never hands the script a
    // payload — the Claude/Codex path is the one that reads the note from stdin.
    if (verb === "work_note" && event.input?.blocker) {
      run("contract.sh", ["block", String(event.input?.task_key ?? "")], undefined, ctx.cwd);
    }
    return undefined;
  });

  // Footer only — a fixed marker that the plugin is loaded, nothing more.
  //
  // It used to append `open.join(",")` and the contract's `done/total`. Neither
  // is reconciled against JustSend: the open list is a per-cwd text ledger that
  // only shrinks when a close hook fires in the same cwd, and the counter is the
  // newest unfinished file under `.justsend/contract/`. So the footer accumulated
  // task_keys with no live record and a counter for work already closed. The
  // UserPromptSubmit reminder and `justsend_contract_status` read authoritative
  // state; the footer never did, so it no longer pretends to.
  const status = (ctx: { hasUI: boolean; cwd: string; ui: { setStatus(k: string, t: string): void } }) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("justsend", "justsend");
  };
  pi.on("session_start", async (_event, ctx) => { status(ctx); });
  pi.on("turn_end", async (_event, ctx) => { status(ctx); });

  // Compaction drops whatever the summariser did not think mattered. The open
  // record and the contract have to survive it, so both are re-injected
  // deterministically rather than left to the summary.
  pi.on("session.compacting", async (_event, ctx) => {
    const parts = [reminder(ctx.cwd), contract(ctx.cwd, "summary")].filter(Boolean) as string[];
    return parts.length > 0 ? ({ context: parts } as unknown as HookResult) : undefined;
  });
}
