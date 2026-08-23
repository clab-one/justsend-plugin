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
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

const STATE_DIR = join(".justsend", "contract");
const EVIDENCE_DIR = join(".justsend", "evidence", "sha256");
const TASK_KEY = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const MODERN_PROTOCOLS = ["2026-07-28"];
const LEGACY_PROTOCOLS = ["2025-11-25", "2025-06-18", "2024-11-05"];
function pluginVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"),
    );
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}
const SERVER_INFO = { name: "justsend-contract", version: pluginVersion() };
const LOCK_WAIT_MS = 5_000;
const COMPLETION_LEASE_MS = 60_000;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
/** Open but stable: the word lands in the record title, so it is a fold key for a
 *  saved search, not decoration. `change` is the fallback, never a choice. */
const RECORD_TYPES = ["fix", "feature", "investigation", "migration", "method", "review"];

function validateTaskKey(taskKey) {
  if (typeof taskKey !== "string" || !TASK_KEY.test(taskKey) || taskKey === "." || taskKey === "..") {
    throw new Error(
      "Invalid task_key. Use 1-64 lowercase characters: letters, digits, dot, underscore, or hyphen; start and end with a letter or digit.",
    );
  }
  return taskKey;
}

const contractDir = (cwd) => join(cwd, STATE_DIR);
const contractPath = (cwd, taskKey) => join(contractDir(cwd), `${validateTaskKey(taskKey)}.json`);
const lockPath = (cwd, taskKey) => join(contractDir(cwd), `${validateTaskKey(taskKey)}.lock`);

function withContractLock(cwd, taskKey, action) {
  validateTaskKey(taskKey);
  mkdirSync(contractDir(cwd), { recursive: true });
  const path = lockPath(cwd, taskKey);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(path);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      // Never delete another process's lock automatically. PID reuse and two
      // simultaneous reclaimers can both make a stale-looking lock live again;
      // bounded failure is safer than granting the same task to two writers.
      if (Date.now() >= deadline) {
        let owner = "owner metadata unavailable";
        try {
          owner = readFileSync(join(path, "owner.json"), "utf8").trim();
        } catch {
          // The path itself still proves contention; do not guess that it is stale.
        }
        throw new Error(`Timed out waiting for contract lock "${taskKey}" at ${path}: ${owner}`);
      }
      Atomics.wait(sleepCell, 0, 0, 10);
      continue;
    }
    try {
      writeFileSync(
        join(path, "owner.json"),
        `${JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() })}\n`,
        { flag: "wx" },
      );
      break;
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    return action();
  } finally {
    try {
      const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
      if (owner.token === token) rmSync(path, { recursive: true, force: true });
    } catch {
      // Never remove a lock whose ownership cannot be proven.
    }
  }
}

function loadContract(cwd, taskKey) {
  const path = contractPath(cwd, taskKey);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Cannot read contract "${taskKey}": ${error instanceof Error ? error.message : String(error)}`);
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

/** Atomic commit. Production read-modify-write callers hold the task lock. */
function saveContract(cwd, contract) {
  contract.verification_mode = verificationMode();
  contract.revision = (Number.isSafeInteger(contract.revision) ? contract.revision : 0) + 1;
  contract.updated_at = new Date().toISOString();
  const path = contractPath(cwd, contract.task_key);
  mkdirSync(contractDir(cwd), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(contract, null, 2)}\n`, { flag: "wx" });
  renameSync(tmp, path);
}

function mutateContract(cwd, taskKey, action) {
  return withContractLock(cwd, taskKey, () => {
    const current = loadContract(cwd, taskKey);
    const next = action(current);
    if (next) saveContract(cwd, next);
    return next;
  });
}

function activeCompletionLease(contract) {
  const lease = contract?.completion_lease;
  if (!lease || !Number.isSafeInteger(lease.revision) || typeof lease.expires_at !== "string") {
    return undefined;
  }
  return Date.parse(lease.expires_at) > Date.now() ? lease : undefined;
}

function assertNoCompletionLease(contract) {
  const lease = activeCompletionLease(contract);
  if (lease) {
    throw new Error(
      `Completion is in progress for "${contract.task_key}" at revision ${lease.revision}; retry after ${lease.expires_at}.`,
    );
  }
  delete contract.completion_lease;
}

function newContract(taskKey, objective, tier) {
  const now = new Date().toISOString();
  return {
    version: 2,
    revision: 0,
    task_key: validateTaskKey(taskKey),
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

function snapshotDirectory(cwd, prefix) {
  let current = realpathSync(cwd);
  for (const component of [".justsend", "evidence", "sha256", prefix]) {
    current = join(current, component);
    try {
      mkdirSync(current);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const entry = lstatSync(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Evidence snapshot directory is not a real directory: ${current}`);
    }
  }
  return current;
}

function captureArtifact(cwd, artifactPath) {
  const sourcePath = validateArtifact(cwd, artifactPath);
  const before = statSync(sourcePath);
  const bytes = readFileSync(sourcePath);
  const after = statSync(sourcePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`Evidence artifact changed while it was being captured: ${sourcePath}`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const relativeSnapshot = join(EVIDENCE_DIR, sha256.slice(0, 2), sha256);
  const snapshotPath = join(snapshotDirectory(cwd, sha256.slice(0, 2)), sha256);
  try {
    writeFileSync(snapshotPath, bytes, { flag: "wx", mode: 0o444 });
    chmodSync(snapshotPath, 0o444);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const entry = lstatSync(snapshotPath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Evidence snapshot is not a real file: ${snapshotPath}`);
    }
    const existing = readFileSync(snapshotPath);
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existing.length !== bytes.length || existingHash !== sha256) {
      throw new Error(`Evidence snapshot collision or corruption: ${snapshotPath}`);
    }
  }

  const capturedAt = new Date().toISOString();
  return {
    sha256,
    size: bytes.length,
    captured_at: capturedAt,
    source_path: sourcePath,
    snapshot_path: relativeSnapshot,
    // v1 aliases keep old report/readers useful during the clean storage upgrade.
    at: capturedAt,
    path: relativeSnapshot,
  };
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
  const evidence = { at: new Date().toISOString(), ...(input.receipt ?? {}), note: input.note };

  switch (input.kind) {
    case "cleanup":
      if (!input.note && !input.receipt) {
        throw new Error("A cleanup receipt needs a note or an artifact.");
      }
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
  const where = (evidence) => evidence.source_path ?? evidence.path ?? "note";
  const lines = [`Contract ${contract.task_key} [${contract.tier}]: ${contract.objective}`];
  for (const c of contract.criteria) {
    const ev = [
      c.evidence.red ? `RED:${where(c.evidence.red)}` : undefined,
      c.evidence.green ? `GREEN:${where(c.evidence.green)}` : undefined,
      c.evidence.surface ? `SURFACE:${where(c.evidence.surface)}` : undefined,
      c.cleanup_receipts.length > 0 ? `receipts:${c.cleanup_receipts.length}` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`- [${c.status}] ${c.id}: ${c.scenario} -> ${c.observable}${ev ? ` (${ev})` : ""}`);
  }
  if (contract.verification_mode === "advisory") {
    lines.push("Verification mode: advisory — unproven criteria do not block completion.");
  }
  const open = unproven(contract);
  lines.push(
    open.length === 0
      ? "Every criterion is proven — justsend_work_complete is allowed."
      : `Unproven ${open.length}: ${open.map((c) => c.id).join(", ")}`,
  );
  // A disarmed gate that says nothing is how an unproven task quietly becomes a
  // finished one. The compaction and session-start hooks read this same text.
  if (contract.blocked_at) {
    lines.push(
      `Blocked since ${contract.blocked_at} — waiting on a human; the gate is disarmed until new evidence lands.`,
    );
  }
  return lines.join("\n");
}

/**
 * The contract as one artifact: a person reads it at a glance, and an agent
 * resuming after a compaction gets the same thing. Generated rather than
 * hand-assembled, so the record body and the closing summary quote one table
 * rather than two written from memory. The hooks deliberately keep `summarize()`:
 * they serve the agent, and evidence paths and per-criterion status are exactly
 * what a person reading on a phone does not want. Paste this and add what it
 * cannot know, which is what failed and what it taught.
 */
function report(contract) {
  // A scenario is a literal command, so it may well contain a pipe. It is also
  // often a whole sentence, and a 200-character cell is the text wall this view
  // exists to avoid — the full text stays in the contract file and in
  // `format: "status"`, so bounding it here loses nothing.
  const cell = (s) => {
    const flat = String(s ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\s+/g, " ")
      .trim();
    if (flat.length <= 80) return flat;
    const cut = flat.slice(0, 80);
    const space = cut.lastIndexOf(" ");
    return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
  };
  // The objective's first clause is the subject. A title that carries the whole
  // sentence stops being a fold key: saved searches are text queries over a
  // trigram index, so the shorter and more regular it is, the better it folds.
  // 80 is not a style choice: `justsend_work_start.title` is capped at 80
  // characters, so a longer report title would come back severed mid-word. Bound
  // it here, at the same budget, with the type included.
  const TITLE_BUDGET = 80;
  const type = contract.type ?? "change";
  const clause = String(contract.objective ?? "")
    .split(/[;.:\n]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const room = TITLE_BUDGET - (type.length + 2);
  let subject = clause;
  if (subject.length > room) {
    const cut = subject.slice(0, room - 1);
    const space = cut.lastIndexOf(" ");
    subject = `${(space > room / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  // **No prose here.** The app ships in sixteen languages and this process cannot
  // know which one the reader has, so every word it emits would be wrong for
  // most of them. It emits structure — ids, PASS/FAIL, the bounded observable —
  // and the agent writes the summary and the failures around it in the language
  // it is already speaking.
  // The only word is the type, and it is deliberate: it lands in the record title
  // as an ASCII fold key for a saved search, the same reason the work id does.
  // Everything else is a mark, an id, or text the agent wrote — no header row, so
  // the agent supplies one in the reader's language.
  // The header cells are empty on purpose: a delimiter row is what makes this a
  // GFM table rather than a paragraph, and empty cells carry no word to translate.
  const lines = [
    `${contract.type ?? "change"}: ${subject}`,
    ...(contract.verification_mode === "advisory" ? ["", "⚠️ advisory"] : []),
    "",
    "|  |  |  |",
    "|---|---|---|",
  ];
  for (const c of contract.criteria) {
    lines.push(`| ${c.id} | ${c.status === "surfaced" ? "✅" : "—"} | ${cell(c.observable)} |`);
  }
  const open = unproven(contract);
  if (open.length > 0) {
    lines.push("", `${contract.criteria.length - open.length}/${contract.criteria.length}`);
  }
  return lines.join("\n");
}

/** Most recently updated contract that is neither closed nor finished, with a
 *  live one preferred over a blocked one: blocking stamps `updated_at`, so the
 *  blocked contract would otherwise sort to the front and silence the gate for
 *  an unrelated contract that is still unproven. A blocked contract is still
 *  returned when it is the only one, so `summary` keeps naming it. */
const activeContract = (cwd) => {
  const open = listContracts(cwd).filter((c) => !c.closed_at && !isDone(c));
  return open.find((c) => !c.blocked_at) ?? open[0];
};

function verificationMode() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  try {
    const config = JSON.parse(readFileSync(join(base, "justsend-plugin", "config.json"), "utf8"));
    return config?.verification?.mode === "advisory" ? "advisory" : "strict";
  } catch {
    return "strict";
  }
}

/** Locked only while the contract is live, still has something unproven, and the
 *  gate was not explicitly disarmed. Keyed off the unproven list rather than
 *  isDone() so a contract with no criteria at all cannot lock on an empty
 *  message — there is nothing to prove, so there is nothing to gate.
 *
 *  `blocked_at` is the exit this gate's own message promises: a task waiting on
 *  a human is not a task the agent can prove, so holding the turn open would
 *  only loop. The next piece of evidence clears the stamp and re-arms. */
function gateReason(contract) {
  if (!contract || verificationMode() === "advisory" || contract.closed_at || contract.blocked_at) return undefined;
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
      "Register or update the verification contract for a task_key: success criteria written to .justsend/contract/<task_key>.json, criteria upserted by id with existing evidence preserved. Completion policy is user-owned config, not a tool argument. Use the same task_key as the work record, then justsend_evidence to prove, justsend_contract_status to check, justsend_work_complete to close.",
    inputSchema: {
      type: "object",
      properties: {
        task_key: { type: "string", description: "Same stable key as the work record." },
        objective: { type: "string", description: "One sentence: what done means." },
        tier: { type: "string", enum: ["LIGHT", "HEAVY"], description: "LIGHT for a contained change, HEAVY when the blast radius spans subsystems." },
        type: {
          type: "string",
          enum: RECORD_TYPES,
          description:
            "What kind of record this is. Becomes the first word of the record title, where a saved search can fold on it. Omitted reads as \"change\".",
        },
        criteria: { type: "array", minItems: 1, items: CRITERION_SCHEMA },
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
      "Per-criterion status, evidence paths, and the unproven list for one contract. Use this after a compaction or when resuming instead of re-reading notes. Omit task_key for the most recently updated open contract. Pass format: \"report\" for the readable artifact to paste into the record or the closing summary — objective, one table row per criterion, and what is still unproven.",
    inputSchema: {
      type: "object",
      properties: {
        task_key: { type: "string" },
        format: {
          type: "string",
          enum: ["status", "report"],
          description: "Default status: the terse agent-facing view. report: the artifact a person reads.",
        },
      },
      additionalProperties: false,
    },
  },
];

function callTool(cwd, name, args) {
  if (name === "justsend_contract_set") {
    validateTaskKey(args.task_key);
    if (Object.hasOwn(args, "enforce") || Object.hasOwn(args, "mode")) {
      throw new Error(
        "Verification mode is user-owned. Set verification.mode in ~/.config/justsend-plugin/config.json.",
      );
    }
    if (args.type !== undefined && !RECORD_TYPES.includes(args.type)) {
      throw new Error(`Unknown record type "${args.type}". Use one of: ${RECORD_TYPES.join(", ")}`);
    }
    const contract = mutateContract(cwd, args.task_key, (current) => {
      if (current) assertNoCompletionLease(current);
      const next = current ?? newContract(args.task_key, args.objective, args.tier);
      next.version = 2;
      next.objective = args.objective;
      next.tier = args.tier;
      if (args.type !== undefined) next.type = args.type;
      delete next.enforce;
      // Re-registering resumes: unclose, unblock, and re-arm the gate.
      delete next.closed_at;
      delete next.blocked_at;
      upsertCriteria(next, args.criteria);
      return next;
    });
    return `${summarize(contract)}\nContract stored at ${contractPath(cwd, contract.task_key)}`;
  }

  if (name === "justsend_evidence") {
    validateTaskKey(args.task_key);
    if (!loadContract(cwd, args.task_key)) {
      throw new Error(`No contract "${args.task_key}" — call justsend_contract_set first.`);
    }
    if (!args.artifact_path && args.kind !== "cleanup") {
      throw new Error(`${args.kind} evidence requires artifact_path — capture the output to a file and pass that path.`);
    }
    const contract = mutateContract(cwd, args.task_key, (current) => {
      if (!current) throw new Error(`No contract "${args.task_key}" — call justsend_contract_set first.`);
      assertNoCompletionLease(current);
      // Validate the id and transition before creating a permanent snapshot.
      applyEvidence(structuredClone(current), args.criterion_id, {
        kind: args.kind,
        receipt: args.artifact_path ? {} : undefined,
        note: args.note,
      });
      const receipt = args.artifact_path ? captureArtifact(cwd, args.artifact_path) : undefined;
      applyEvidence(current, args.criterion_id, {
        kind: args.kind,
        receipt,
        note: args.note,
      });
      // Evidence means the agent is working again, so a human-blocked stamp is
      // stale: re-arm rather than leave the gate open for the rest of the task.
      delete current.blocked_at;
      current.version = 2;
      return current;
    });
    const criterion = contract.criteria.find((entry) => entry.id === args.criterion_id);
    const open = unproven(contract);
    const remaining =
      open.length === 0
        ? "Every criterion is proven — justsend_work_complete is allowed."
        : `Unproven ${open.length}: ${open.map((c) => c.id).join(", ")}`;
    return `${criterion.id} -> ${criterion.status} (${args.kind}). ${remaining}`;
  }

  if (name === "justsend_contract_status") {
    // A finished contract is not "active", but the report is wanted precisely
    // then — it is what goes into the closing summary — so fall back to the most
    // recent one for that format rather than answering "no open contract".
    const contract = args.task_key
      ? loadContract(cwd, args.task_key)
      : (activeContract(cwd) ?? (args.format === "report" ? listContracts(cwd)[0] : undefined));
    if (!contract) {
      const known = listContracts(cwd).map((c) => c.task_key);
      return known.length > 0
        ? `No open contract. Known contracts: ${known.join(", ")}`
        : "No contract in this directory — start one with justsend_contract_set.";
    }
    return args.format === "report" ? report(contract) : summarize(contract);
  }

  throw new Error(`Unknown tool: ${name}`);
}

function serve() {
  const cwd = process.cwd();
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const serverMeta = { "io.modelcontextprotocol/serverInfo": SERVER_INFO };
  let buf = "";

  const sendError = (id, code, message, data) => {
    const error = data === undefined ? { code, message } : { code, message, data };
    send({ jsonrpc: "2.0", id, error });
  };
  const modernResult = (result, cacheable = false) => ({
    ...result,
    resultType: "complete",
    ...(cacheable ? { ttlMs: 0, cacheScope: "private" } : {}),
    _meta: serverMeta,
  });

  function modernMetadata(req) {
    const meta = req.params?._meta;
    const protocolVersion = meta?.["io.modelcontextprotocol/protocolVersion"];
    const clientCapabilities = meta?.["io.modelcontextprotocol/clientCapabilities"];
    if (typeof protocolVersion !== "string" || !clientCapabilities || typeof clientCapabilities !== "object") {
      sendError(
        req.id,
        -32602,
        "Modern MCP requests require protocolVersion and clientCapabilities in params._meta.",
      );
      return undefined;
    }
    if (!MODERN_PROTOCOLS.includes(protocolVersion)) {
      sendError(req.id, -32022, "Unsupported protocol version", {
        supported: MODERN_PROTOCOLS,
        requested: protocolVersion,
      });
      return undefined;
    }
    return true;
  }

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
        sendError(null, -32700, "Parse error");
        continue;
      }
      dispatch(req);
    }
  });

  function dispatch(req) {
    const { id, method, params } = req;
    if (method?.startsWith("notifications/")) return;

    if (method === "initialize") {
      const requested = params?.protocolVersion;
      const protocolVersion = LEGACY_PROTOCOLS.includes(requested) ? requested : LEGACY_PROTOCOLS[0];
      send({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO },
      });
      return;
    }

    const meta = params?._meta;
    const looksModern =
      method === "server/discover" ||
      Boolean(
        meta &&
          (Object.hasOwn(meta, "io.modelcontextprotocol/protocolVersion") ||
            Object.hasOwn(meta, "io.modelcontextprotocol/clientCapabilities")),
      );
    if (looksModern && !modernMetadata(req)) return;

    if (method === "server/discover") {
      send({
        jsonrpc: "2.0",
        id,
        result: modernResult(
          { supportedVersions: MODERN_PROTOCOLS, capabilities: { tools: {} } },
          true,
        ),
      });
      return;
    }
    if (method === "tools/list") {
      const result = looksModern ? modernResult({ tools: TOOLS }, true) : { tools: TOOLS };
      send({ jsonrpc: "2.0", id, result });
      return;
    }
    if (method === "tools/call") {
      try {
        const text = callTool(cwd, params?.name, params?.arguments ?? {});
        const result = { content: [{ type: "text", text }] };
        send({ jsonrpc: "2.0", id, result: looksModern ? modernResult(result) : result });
      } catch (err) {
        // A refused transition is information the model must act on, so it comes
        // back as tool output rather than a protocol error.
        const result = {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
        send({ jsonrpc: "2.0", id, result: looksModern ? modernResult(result) : result });
      }
      return;
    }
    if (id !== undefined) {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Hook subcommands — same state, read by the lifecycle hooks
// ---------------------------------------------------------------------------

function cli(argv) {
  const cwd = process.env.JUSTSEND_HOOK_CWD || process.cwd();
  const [cmd, arg] = argv;

  const denyGate = (reason) => {
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
  };

  if (cmd === "gate") {
    // The lease closes the pre-tool/post-tool race: while completion is in
    // flight, every contract/evidence mutation is refused, and close consumes
    // only the exact revision gate approved. A crash recovers by expiry.
    const validArg = Boolean(arg && TASK_KEY.test(arg) && arg !== "." && arg !== "..");
    const key = validArg ? arg : activeContract(cwd)?.task_key;
    if (!key) return 0;
    const reason = withContractLock(cwd, key, () => {
      const contract = loadContract(cwd, key);
      if (!contract) return undefined;
      const lease = activeCompletionLease(contract);
      if (lease) {
        return `Completion is already in progress for "${key}" at revision ${lease.revision}.`;
      }
      const hadExpiredLease = Boolean(contract.completion_lease);
      delete contract.completion_lease;
      const blocked = gateReason(contract);
      if (blocked) {
        if (hadExpiredLease) saveContract(cwd, contract);
        return blocked;
      }
      if (
        validArg &&
        key === arg &&
        verificationMode() === "strict" &&
        !contract.blocked_at &&
        isDone(contract) &&
        !contract.closed_at
      ) {
        const revision = (Number.isSafeInteger(contract.revision) ? contract.revision : 0) + 1;
        contract.completion_lease = {
          revision,
          expires_at: new Date(Date.now() + COMPLETION_LEASE_MS).toISOString(),
        };
        saveContract(cwd, contract);
      }
      return undefined;
    });
    return reason ? denyGate(reason) : 0;
  }

  if (cmd === "close") {
    if (!arg) return 0;
    let refusal;
    withContractLock(cwd, arg, () => {
      const contract = loadContract(cwd, arg);
      if (!contract || contract.closed_at) return;
      const lease = activeCompletionLease(contract);
      if (!lease || lease.revision !== contract.revision) {
        delete contract.completion_lease;
        // Advisory, human-blocked, empty, and already-proven contracts all have
        // an open gate without a strict lease. Re-evaluate the latest revision:
        // only a state the gate would still allow may close.
        if (!gateReason(contract)) {
          contract.closed_at = new Date().toISOString();
          saveContract(cwd, contract);
          return;
        }
        saveContract(cwd, contract);
        refusal = `Completion lease is missing, expired, or stale for "${arg}"; contract remains open.`;
        return;
      }
      delete contract.completion_lease;
      contract.closed_at = new Date().toISOString();
      saveContract(cwd, contract);
    });
    if (refusal) {
      process.stderr.write(`${refusal}\n`);
      return 2;
    }
    return 0;
  }

  if (cmd === "release") {
    if (arg) {
      mutateContract(cwd, arg, (contract) => {
        if (!contract || !contract.completion_lease) return undefined;
        delete contract.completion_lease;
        return contract;
      });
    }
    return 0;
  }

  if (cmd === "abandon") {
    if (arg) {
      mutateContract(cwd, arg, (contract) => {
        if (!contract || contract.closed_at) return undefined;
        delete contract.completion_lease;
        contract.closed_at = new Date().toISOString();
        return contract;
      });
    }
    return 0;
  }

  if (cmd === "block") {
    // PostToolUse on a `justsend_work_note` that carries `blocker: true`. The
    // first stamp is the one that counts: re-blocking must not reset the clock
    // that tells the user how long this has been waiting on them.
    if (arg) {
      mutateContract(cwd, arg, (contract) => {
        if (!contract || contract.blocked_at) return undefined;
        // A human blocker supersedes an in-flight completion. Invalidate its
        // lease atomically so the later close cannot seal this blocked contract.
        delete contract.completion_lease;
        contract.blocked_at = new Date().toISOString();
        return contract;
      });
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

  process.stderr.write("usage: contract.mjs [gate|close|release|abandon|block|summary|continuation|line] [task_key]\n");
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
    try {
      process.exit(cli(argv));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`justsend contract: ${message}\n`);
      process.exit(argv[0] === "gate" || argv[0] === "continuation" ? 2 : 1);
    }
  }
}

export {
  LEGACY_PROTOCOLS,
  MODERN_PROTOCOLS,
  TOOLS,
  callTool,
  contractPath,
  gateReason,
  isDone,
  listContracts,
  loadContract,
  newContract,
  report,
  summarize,
  unproven,
  upsertCriteria,
  validateArtifact,
  validateTaskKey,
  verificationMode,
};
