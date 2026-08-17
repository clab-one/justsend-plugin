#!/usr/bin/env node
// JustSend verification contract — the single source of truth for success
// criteria, failing-first evidence, and the completion gate.
//
// Why this is code and not prompt text: an agent asked to "verify before
// finishing" will report success it did not observe. The transitions below are
// enforced mechanically, so GREEN without a captured RED is impossible and
// `justsend_work_complete` is refused while a criterion is unproven.
//
// State: <cwd>/.justsend/contract/<task_key>.json — one file per task_key, the
// same key the work record uses, so the record and the contract never drift.
// Zero dependencies: node stdlib only, no network, no build step. The work
// record itself is written by the justsend MCP server; this process never talks
// to it, which is why evidence is free to record at high frequency.
//
// Two entry points, one implementation:
//   no argv        -> stdio MCP server (declared in the plugin manifest)
//   <subcommand>   -> the hooks' view of the same state (gate/close/summary/...)

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

const STATE_DIR = join(".justsend", "contract");
const UNSAFE = /[^a-zA-Z0-9._-]+/g;

const contractDir = (cwd) => join(cwd, STATE_DIR);
const contractPath = (cwd, taskKey) => join(contractDir(cwd), `${taskKey.replace(UNSAFE, "-")}.json`);

function loadContract(cwd, taskKey) {
  try {
    return JSON.parse(readFileSync(contractPath(cwd, taskKey), "utf8"));
  } catch {
    return undefined;
  }
}

function listContracts(cwd) {
  let names;
  try {
    names = readdirSync(contractDir(cwd)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      out.push(JSON.parse(readFileSync(join(contractDir(cwd), name), "utf8")));
    } catch {
      // A contract we cannot parse is reported by omission rather than by
      // crashing the gate: a corrupt file must not wedge every later call.
    }
  }
  return out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

/** Atomic write: temp file plus rename, so a killed process never leaves a half-written contract. */
function saveContract(cwd, contract) {
  contract.updated_at = new Date().toISOString();
  const path = contractPath(cwd, contract.task_key);
  mkdirSync(contractDir(cwd), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(contract, null, 2)}\n`);
  renameSync(tmp, path);
}

function newContract(taskKey, objective, tier) {
  const now = new Date().toISOString();
  return {
    version: 1,
    task_key: taskKey,
    objective,
    tier,
    criteria: [],
    created_at: now,
    updated_at: now,
  };
}

/** Upsert by id — an existing criterion keeps its status and evidence. */
function upsertCriteria(contract, inputs) {
  inputs.forEach((input, index) => {
    const id = input.id ?? `c${index + 1}`;
    const existing = contract.criteria.find((c) => c.id === id);
    if (existing) {
      existing.scenario = input.scenario;
      existing.observable = input.observable;
      existing.proof = input.proof ?? existing.proof;
      return;
    }
    contract.criteria.push({
      id,
      scenario: input.scenario,
      observable: input.observable,
      proof: input.proof ?? "red-green",
      status: "pending",
      evidence: {},
      cleanup_receipts: [],
    });
  });
}

const unproven = (contract) => contract.criteria.filter((c) => c.status !== "surfaced");
const isDone = (contract) => contract.criteria.length > 0 && unproven(contract).length === 0;

/**
 * Evidence artifacts must be a real, non-empty regular file whose realpath sits
 * under an allowed root. Resolving the symlink first is the point: a link out to
 * a file the run never produced is the cheapest way to fake a proof.
 */
function validateArtifact(cwd, artifactPath) {
  const abs = isAbsolute(artifactPath) ? artifactPath : resolve(cwd, artifactPath);
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`Evidence artifact does not exist: ${abs}`);
  }
  const st = statSync(real);
  if (!st.isFile()) throw new Error(`Evidence artifact is not a regular file: ${real}`);
  if (st.size === 0) throw new Error(`Evidence artifact is empty: ${real}`);
  const roots = [cwd, tmpdir(), join(homedir(), ".justsend")].map((r) => {
    try {
      return realpathSync(r);
    } catch {
      return r;
    }
  });
  if (!roots.some((root) => real === root || real.startsWith(root + sep))) {
    throw new Error(`Evidence artifact is outside the allowed roots (cwd, tmpdir, ~/.justsend): ${real}`);
  }
  return real;
}

/**
 * Apply evidence and enforce the transitions:
 *   red     — only from pending or red (a re-capture is fine)
 *   green   — requires RED first; this is the failing-first rule
 *   surface — after green, or straight through when proof is "review"
 *   cleanup — a receipt, any status, needs a note or a path
 */
function applyEvidence(contract, criterionId, input) {
  const criterion = contract.criteria.find((c) => c.id === criterionId);
  if (!criterion) {
    const known = contract.criteria.map((c) => c.id).join(", ") || "(none)";
    throw new Error(`Criterion "${criterionId}" is not in this contract. Registered ids: ${known}`);
  }
  const evidence = { at: new Date().toISOString(), path: input.path, note: input.note };

  switch (input.kind) {
    case "cleanup":
      if (!input.note && !input.path) throw new Error("A cleanup receipt needs a note or a path.");
      criterion.cleanup_receipts.push(evidence);
      return criterion;
    case "red":
      if (criterion.status !== "pending" && criterion.status !== "red") {
        throw new Error(
          `RED is captured from pending only (currently: ${criterion.status}). Rewriting RED on an already-GREEN criterion forges failing-first.`,
        );
      }
      criterion.evidence.red = evidence;
      criterion.status = "red";
      return criterion;
    case "green":
      if (criterion.proof === "review") {
        throw new Error(`Criterion "${criterionId}" is proof=review — go straight to surface with the review basis, no RED/GREEN.`);
      }
      if (!criterion.evidence.red) {
        throw new Error(`Failing-first violation: criterion "${criterionId}" has no RED evidence. Capture the failure before implementing.`);
      }
      criterion.evidence.green = evidence;
      criterion.status = "green";
      return criterion;
    case "surface":
      if (criterion.proof !== "review" && criterion.status !== "green") {
        throw new Error(`SURFACE comes after GREEN (currently: ${criterion.status}). Only proof=review criteria go straight through.`);
      }
      criterion.evidence.surface = evidence;
      criterion.status = "surfaced";
      return criterion;
    default:
      throw new Error(`Unknown evidence kind: ${String(input.kind)}`);
  }
}

function summarize(contract) {
  const lines = [`Contract ${contract.task_key} [${contract.tier}]: ${contract.objective}`];
  for (const c of contract.criteria) {
    const ev = [
      c.evidence.red ? `RED:${c.evidence.red.path ?? "note"}` : undefined,
      c.evidence.green ? `GREEN:${c.evidence.green.path ?? "note"}` : undefined,
      c.evidence.surface ? `SURFACE:${c.evidence.surface.path ?? "note"}` : undefined,
      c.cleanup_receipts.length > 0 ? `receipts:${c.cleanup_receipts.length}` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`- [${c.status}] ${c.id}: ${c.scenario} -> ${c.observable}${ev ? ` (${ev})` : ""}`);
  }
  const open = unproven(contract);
  lines.push(
    open.length === 0
      ? "Every criterion is proven — justsend_work_complete is allowed."
      : `Unproven ${open.length}: ${open.map((c) => c.id).join(", ")}`,
  );
  return lines.join("\n");
}

/** Most recently updated contract that is neither closed nor finished. */
const activeContract = (cwd) => listContracts(cwd).find((c) => !c.closed_at && !isDone(c));

/** Locked only while the contract is live, still has something unproven, and the
 *  gate was not explicitly disarmed. Keyed off the unproven list rather than
 *  isDone() so a contract with no criteria at all cannot lock on an empty
 *  message — there is nothing to prove, so there is nothing to gate. */
function gateReason(contract) {
  if (!contract || contract.enforce === false || contract.closed_at) return undefined;
  const open = unproven(contract);
  if (open.length === 0) return undefined;
  return (
    `Contract gate: criteria still unproven for "${contract.task_key}" — ` +
    `${open.map((c) => `${c.id}[${c.status}]`).join(", ")}. ` +
    `Finish the proof with justsend_evidence, or call justsend_work_note with blocker: true when a human has to act.`
  );
}

// ---------------------------------------------------------------------------
// MCP stdio server
// ---------------------------------------------------------------------------

const CRITERION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Auto-assigned c1, c2… when omitted." },
    scenario: { type: "string", description: "The literal command, page action, or payload that exercises this." },
    observable: { type: "string", description: "The single binary observation that decides PASS or FAIL." },
    proof: {
      type: "string",
      enum: ["red-green", "review"],
      description: "Default red-green, failing-first enforced. Use review only for prose with no machine consumer.",
    },
  },
  required: ["scenario", "observable"],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: "justsend_contract_set",
    description:
      "Register or update the verification contract for a task_key: success criteria written to .justsend/contract/<task_key>.json, criteria upserted by id with existing evidence preserved. Arms the completion gate unless enforce is false. Use the same task_key as the work record, then justsend_evidence to prove, justsend_contract_status to check, justsend_work_complete to close.",
    inputSchema: {
      type: "object",
      properties: {
        task_key: { type: "string", description: "Same stable key as the work record." },
        objective: { type: "string", description: "One sentence: what done means." },
        tier: { type: "string", enum: ["LIGHT", "HEAVY"], description: "LIGHT for a contained change, HEAVY when the blast radius spans subsystems." },
        criteria: { type: "array", minItems: 1, items: CRITERION_SCHEMA },
        enforce: {
          type: "boolean",
          description: "Default true: unproven criteria block justsend_work_complete. False tracks without gating.",
        },
      },
      required: ["task_key", "objective", "tier", "criteria"],
      additionalProperties: false,
    },
  },
  {
    name: "justsend_evidence",
    description:
      "Record evidence for one criterion. Transitions are enforced here, not by prompt: red/green/surface each require an artifact_path (an existing non-empty file under cwd, tmpdir, or ~/.justsend); GREEN is rejected without a RED (failing-first); SURFACE is rejected before GREEN; proof=review goes straight to surface; cleanup needs a note. No network, so this is cheap to call often.",
    inputSchema: {
      type: "object",
      properties: {
        task_key: { type: "string" },
        criterion_id: { type: "string" },
        kind: { type: "string", enum: ["red", "green", "surface", "cleanup"] },
        artifact_path: { type: "string", description: "Captured output file. Required for red, green, and surface." },
        note: { type: "string", description: "One-line gist. Required for a cleanup receipt with no path." },
      },
      required: ["task_key", "criterion_id", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "justsend_contract_status",
    description:
      "Per-criterion status, evidence paths, and the unproven list for one contract. Use this after a compaction or when resuming instead of re-reading notes. Omit task_key for the most recently updated open contract.",
    inputSchema: {
      type: "object",
      properties: { task_key: { type: "string" } },
      additionalProperties: false,
    },
  },
];

function callTool(cwd, name, args) {
  if (name === "justsend_contract_set") {
    const contract = loadContract(cwd, args.task_key) ?? newContract(args.task_key, args.objective, args.tier);
    contract.objective = args.objective;
    contract.tier = args.tier;
    contract.enforce = args.enforce ?? true;
    delete contract.closed_at; // Re-registering resumes: unclose and re-arm the gate.
    upsertCriteria(contract, args.criteria);
    saveContract(cwd, contract);
    return `${summarize(contract)}\nContract stored at ${contractPath(cwd, contract.task_key)}`;
  }

  if (name === "justsend_evidence") {
    const contract = loadContract(cwd, args.task_key);
    if (!contract) throw new Error(`No contract "${args.task_key}" — call justsend_contract_set first.`);
    let realPath;
    if (args.artifact_path) {
      realPath = validateArtifact(cwd, args.artifact_path);
    } else if (args.kind !== "cleanup") {
      throw new Error(`${args.kind} evidence requires artifact_path — capture the output to a file and pass that path.`);
    }
    const criterion = applyEvidence(contract, args.criterion_id, { kind: args.kind, path: realPath, note: args.note });
    saveContract(cwd, contract);
    const open = unproven(contract);
    const remaining =
      open.length === 0
        ? "Every criterion is proven — justsend_work_complete is allowed."
        : `Unproven ${open.length}: ${open.map((c) => c.id).join(", ")}`;
    return `${criterion.id} -> ${criterion.status} (${args.kind}). ${remaining}`;
  }

  if (name === "justsend_contract_status") {
    const contract = args.task_key ? loadContract(cwd, args.task_key) : activeContract(cwd);
    if (!contract) {
      const known = listContracts(cwd).map((c) => c.task_key);
      return known.length > 0
        ? `No open contract. Known contracts: ${known.join(", ")}`
        : "No contract in this directory — start one with justsend_contract_set.";
    }
    return summarize(contract);
  }

  throw new Error(`Unknown tool: ${name}`);
}

function serve() {
  const cwd = process.cwd();
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  let buf = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      dispatch(req);
    }
  });

  function dispatch(req) {
    const { id, method, params } = req;
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "justsend-contract", version: "0.2.0" },
        },
      });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      try {
        const text = callTool(cwd, params?.name, params?.arguments ?? {});
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (err) {
        // A refused transition is information the model must act on, so it comes
        // back as tool output rather than a protocol error.
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true },
        });
      }
      return;
    }
    if (method?.startsWith("notifications/")) return;
    if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }
}

// ---------------------------------------------------------------------------
// Hook subcommands — same state, read by the lifecycle hooks
// ---------------------------------------------------------------------------

function cli(argv) {
  const cwd = process.env.JUSTSEND_HOOK_CWD || process.cwd();
  const [cmd, arg] = argv;

  if (cmd === "gate") {
    // PreToolUse on justsend_work_complete. Exit 2 blocks, matching
    // destructive-guard.sh; anything else lets the call through.
    const contract = arg ? loadContract(cwd, arg) : activeContract(cwd);
    const reason = gateReason(contract);
    if (!reason) return 0;
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      })}\n`,
    );
    process.stderr.write(`${reason}\n`);
    return 2;
  }

  if (cmd === "close") {
    const contract = arg ? loadContract(cwd, arg) : undefined;
    if (contract && !contract.closed_at) {
      contract.closed_at = new Date().toISOString();
      saveContract(cwd, contract);
    }
    return 0;
  }

  if (cmd === "summary") {
    const contract = activeContract(cwd);
    if (contract) process.stdout.write(`${summarize(contract)}\n`);
    return 0;
  }

  if (cmd === "continuation") {
    // Stop hook: exit 2 refuses the stop and hands stderr back to the model, so
    // an unproven contract keeps the turn alive instead of ending quietly.
    const reason = gateReason(activeContract(cwd));
    if (!reason) return 0;
    process.stderr.write(`${reason}\n`);
    return 2;
  }

  if (cmd === "line") {
    const contract = activeContract(cwd);
    if (contract) {
      const done = contract.criteria.filter((c) => c.status === "surfaced").length;
      process.stdout.write(`${contract.task_key} ${done}/${contract.criteria.length}\n`);
    }
    return 0;
  }

  process.stderr.write("usage: contract.mjs [gate|close|summary|continuation|line] [task_key]\n");
  return 1;
}

// Only dispatch when this file is what was executed. Importing it (the test
// suite, or any other consumer) must not start a server or exit the process.
const entry = process.argv[1] ?? "";
if (entry.endsWith("contract.mjs")) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    serve();
  } else {
    process.exit(cli(argv));
  }
}

export {
  applyEvidence,
  callTool,
  contractPath,
  gateReason,
  isDone,
  listContracts,
  loadContract,
  newContract,
  saveContract,
  summarize,
  unproven,
  upsertCriteria,
  validateArtifact,
};
