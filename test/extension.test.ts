/**
 * Unit tests for the kubectl modification guard extension.
 *
 * Runs with zero dependencies via Node's built-in test runner and native
 * TypeScript type stripping (Node >= 22.19):
 *
 *   node --test test/extension.test.ts
 *
 * The ExtensionAPI is mocked; no pi session or kubectl binary is needed.
 *
 * Note: the extension's module state (mode/enabled/allowedCommands) persists
 * across tests in one process, so every test that depends on guard state
 * resets it first via resetGuard().
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import extension from "../index.ts";

// ── Mock ExtensionAPI ───────────────────────────────────────────────────────

type ToolCallHandler = (
	event: { toolName: string; input: Record<string, unknown> },
	ctx: unknown,
) => unknown;

type Fire = (
	command: string,
	ctx?: unknown,
	toolName?: string,
) => Promise<unknown>;

function loadExtension() {
	const handlers: Record<string, ToolCallHandler[]> = {};
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			(handlers[name] ??= []).push(handler);
		},
	};

	extension(pi as never);

	const toolCall = handlers["tool_call"]?.[0];
	assert.ok(toolCall, "extension should register a tool_call handler");

	return {
		/** Fire a synthetic tool_call event with a per-test ctx. */
		fire: async (command: string, ctx: unknown = { hasUI: false }, toolName = "bash") =>
			await toolCall({ toolName, input: { command } }, ctx),
	} as { fire: Fire };
}

/**
 * Reset guard state to a known baseline: clear session allowances, enable
 * the guard, and set the given mode.
 */
async function resetGuard(fire: Fire, mode: "strict" | "confirm" = "confirm"): Promise<void> {
	await fire("kubectl-guard reset");
	await fire("kubectl-guard on");
	await fire(`kubectl-guard mode ${mode}`);
}

function isBlocked(result: unknown): result is { block: true; reason: string } {
	if (typeof result !== "object" || result === null) return false;
	const r = result as Record<string, unknown>;
	return r.block === true && typeof r.reason === "string";
}

// ── Pass-through behavior ───────────────────────────────────────────────────

test("ignores non-bash tools", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	assert.equal(await fire("kubectl delete pod x", { hasUI: false }, "read_file"), undefined);
});

test("ignores bash commands that do not contain kubectl", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	assert.equal(await fire("ls -la"), undefined);
	assert.equal(await fire("echo hello && git status"), undefined);
});

test("allows read-only verbs (get, describe, logs, version)", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	assert.equal(await fire("kubectl get pods"), undefined);
	assert.equal(await fire("kubectl describe pod x"), undefined);
	assert.equal(await fire("kubectl logs pod x"), undefined);
	assert.equal(await fire("kubectl version"), undefined);
});

// ── Modification blocking ───────────────────────────────────────────────────

test("blocks modifications in confirm mode without UI", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "confirm");
	const result = await fire("kubectl delete pod x", { hasUI: false });
	assert.ok(isBlocked(result), "expected block, got: " + JSON.stringify(result));
	assert.match(result.reason, /no UI/);
});

test("blocks modifications in strict mode", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	const result = await fire("kubectl delete pod x", { hasUI: false });
	assert.ok(isBlocked(result), "expected block, got: " + JSON.stringify(result));
	assert.match(result.reason, /strict/);
});

test("allows --allow-kubectl bypass even in strict mode", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	assert.equal(await fire("kubectl delete pod x --allow-kubectl", { hasUI: false }), undefined);
});

test("treats unknown verbs as modifications", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	const result = await fire("kubectl frobnicate thing", { hasUI: false });
	assert.ok(isBlocked(result), "expected block, got: " + JSON.stringify(result));
	assert.match(result.reason, /strict/);
});

// ── kubectl-guard control commands ──────────────────────────────────────────

test("kubectl-guard status reports ON and the current mode", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "confirm");
	const result = await fire("kubectl-guard status");
	assert.ok(isBlocked(result), "expected block, got: " + JSON.stringify(result));
	assert.match(result.reason, /ON/);
	assert.match(result.reason, /confirm/);
});

test("off disables the guard and on re-enables it", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "strict");
	const offResult = await fire("kubectl-guard off");
	assert.ok(isBlocked(offResult));
	assert.match(offResult.reason, /disabled/);
	// disabled: modification passes through
	assert.equal(await fire("kubectl delete pod x", { hasUI: false }), undefined);
	const onResult = await fire("kubectl-guard on");
	assert.ok(isBlocked(onResult));
	assert.match(onResult.reason, /enabled/);
	// re-enabled: modification blocked again
	const blocked = await fire("kubectl delete pod x", { hasUI: false });
	assert.ok(isBlocked(blocked));
});

// ── Confirm mode with UI ────────────────────────────────────────────────────

test("confirm mode with UI: allow passes and is remembered; block blocks", async () => {
	const { fire } = loadExtension();
	await resetGuard(fire, "confirm");

	let prompts = 0;
	const allowCtx = {
		hasUI: true,
		ui: {
			select: async () => {
				prompts += 1;
				return "Allow and run";
			},
		},
	};

	// First run prompts and passes.
	assert.equal(await fire("kubectl delete pod y", allowCtx), undefined);
	assert.equal(prompts, 1);

	// Repeat of the same command passes without prompting again.
	assert.equal(await fire("kubectl delete pod y", allowCtx), undefined);
	assert.equal(prompts, 1);

	// A different command with a "Block" answer is blocked.
	const blockCtx = {
		hasUI: true,
		ui: { select: async () => "Block" },
	};
	const result = await fire("kubectl delete pod z", blockCtx);
	assert.ok(isBlocked(result), "expected block, got: " + JSON.stringify(result));
	assert.match(result.reason, /Blocked/);
});
