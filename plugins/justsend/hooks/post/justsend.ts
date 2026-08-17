// omp-native hook. Claude Code and Codex run `hooks/hooks.json` (shell commands
// on lifecycle events); omp runs TypeScript factories instead and ignores that
// file. Rather than reimplement the rules in a second language, this hook shells
// out to the SAME scripts, so there is one destructive-command matcher and one
// open-record tracker for every harness.
//
// omp loads `hooks/post/*.ts` from a marketplace-installed plugin, and Claude
// Code and Codex ignore a stray `.ts` under `hooks/`, so the two live together.
import { spawnSync } from "node:child_process";
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
 *  hook uses: exit 2 means a criterion is still unproven. */
export function guardComplete(taskKey: string, cwd: string): HookResult {
  const result = run("contract.sh", ["gate", taskKey], undefined, cwd);
  if (result.status !== 2) return undefined;
  const reason = (result.stderr ?? "").trim();
  return { block: true, reason: reason || "The JustSend contract still has unproven criteria." };
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
    "`justsend_work_complete` (outcome, how it was verified, what is still open), " +
    "or leave `justsend_work_note` with `blocker: true` if a human has to act."
  );
}

export default function justsend(pi: HookAPILike): void {
  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName ?? "");
    if (workVerb(name) === "work_complete") {
      return guardComplete(String(event.input?.task_key ?? ""), ctx.cwd);
    }
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    if (!command) return;
    return guardBash(command, ctx.cwd);
  });

  pi.on("tool_result", async (event, ctx) => {
    const verb = workVerb(String(event.toolName ?? ""));
    if (!verb || event.isError) return;
    run(
      "record-state.sh",
      [],
      JSON.stringify({ tool_name: `justsend_${verb}`, tool_input: event.input ?? {} }),
      ctx.cwd,
    );
    if (verb === "work_complete" || verb === "work_retract") {
      run("contract.sh", ["close", String(event.input?.task_key ?? "")], undefined, ctx.cwd);
    }
    return undefined;
  });

  // Footer only — the status line is where omp shows what is still open without
  // spending a token on it.
  const status = (ctx: { hasUI: boolean; cwd: string; ui: { setStatus(k: string, t: string): void } }) => {
    if (!ctx.hasUI) return;
    const open = openRecords(ctx.cwd);
    const line = contract(ctx.cwd, "line");
    const parts = [open.length > 0 ? open.join(",") : undefined, line].filter(Boolean);
    ctx.ui.setStatus("justsend", parts.length > 0 ? `justsend ${parts.join(" ")}` : "justsend");
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
