/**
 * Kubectl Guard Extension
 *
 * Prevents `kubectl` modification commands from running without explicit permission.
 * Read-only commands (get, list, describe, logs, top, version, etc.) pass through freely.
 * Modification commands (apply, create, delete, patch, replace, exec, cp, edit, drain,
 * taint, cordon, uncordon, scale, rolling-update, label, annotate) are blocked unless
 * you explicitly allow them.
 *
 * Modes (toggle with `kubectl-guard mode <strict|confirm>`):
 *   strict  — blocks all modifications silently. Add `--allow-kubectl` to bypass.
 *   confirm — prompts for confirmation before each modification.
 *
 * Global toggle (on/off):
 *   kubectl-guard on   — enable protection
 *   kubectl-guard off  — disable protection
 *
 * One-shot bypass:
 *   kubectl ... --allow-kubectl   — allow this single command
 *
 * Usage:
 *   - Write commands are intercepted at the tool_call level before execution.
 *   - Read commands pass through silently.
 *   - The guard also intercepts the `kubectl-guard` alias itself for mode/toggle control.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Classification ──────────────────────────────────────────────────────────

const READ_ONLY_VERBS = new Set([
	"get", "list", "describe", "logs", "top", "version", "cluster-info",
	"api-versions", "api-resources", "explain", "auth", "wait",
]);

const MODIFICATION_VERBS = new Set([
	"apply", "create", "delete", "patch", "replace", "rollout",
	"scale", "edit", "exec", "cp", "cordon", "uncordon", "drain",
	"taint", "annotate", "label", "port-forward", "proxy",
	"run", "debug", "attach", "plugin", "certificates",
]);

function classifyKubectlCommand(command: string): "read" | "modify" | "none" {
  const match = command.match(/kubectl(\s--context[\s=](?<context>\S+))?\s(-n(amespace)?[\s=](?<namespace>\S+)\s)?(?<verb>[\w][\w-]*)(.+)?/);
  const verb = match?.groups?.verb;

	if (!verb) return "none";
	if (READ_ONLY_VERBS.has(verb)) return "read";
	if (MODIFICATION_VERBS.has(verb)) return "modify";

	// Unknown verb — classify as modify to be safe
	return "modify";
}

// ── State ───────────────────────────────────────────────────────────────────

type GuardMode = "strict" | "confirm";

interface GuardState {
	mode: GuardMode;
	enabled: boolean;
	allowedCommands: Set<string>; // already-approved commands in this session
}

const state: GuardState = {
	mode: "confirm",
	enabled: true,
	allowedCommands: new Set(),
};

// ── kubectl-guard command handler ───────────────────────────────────────────

function handleKubectlGuardCommand(args: string[]): { block: true; reason: string } | undefined {
	const cmd = args[0]?.toLowerCase();

	if (cmd === "mode" && args[1]) {
		const mode = args[1].toLowerCase();
		if (mode === "strict" || mode === "confirm") {
			state.mode = mode;
			return { block: true, reason: `kubectl-guard mode set to "${mode}"` };
		}
		return { block: true, reason: `Unknown mode "${args[1]}". Use "strict" or "confirm".` };
	}

	if (cmd === "on") {
		state.enabled = true;
		return { block: true, reason: "kubectl-guard enabled" };
	}

	if (cmd === "off") {
		state.enabled = false;
		return { block: true, reason: "kubectl-guard disabled" };
	}

	if (cmd === "status") {
		return {
			block: true,
			reason: `kubectl-guard: ${state.enabled ? "ON" : "OFF"} | mode: ${state.mode} | allowed: ${state.allowedCommands.size}`,
		};
	}

	if (cmd === "reset") {
		state.allowedCommands.clear();
		return { block: true, reason: "kubectl-guard: cleared session allowances" };
	}

	return undefined;
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = (event.input.command as string).trim();

		// ── Handle kubectl-guard sub-command (before kubectl check) ───────
		const guardMatch = command.match(/^kubectl-guard\s+(.*)/i);
		if (guardMatch) {
			const result = handleKubectlGuardCommand(guardMatch[1].trim().split(/\s+/));
			if (result) return result;
		}

		if (!command.startsWith("kubectl")) return undefined;

		// ── One-shot bypass ──────────────────────────────────────────────
		if (command.includes("--allow-kubectl")) {
			return undefined; // pass through
		}

		// ── Guard disabled ───────────────────────────────────────────────
		if (!state.enabled) return undefined;

		// ── Classify ─────────────────────────────────────────────────────
		const classification = classifyKubectlCommand(command);
		if (classification === "read") return undefined; // always allow reads

		// ── Modification: check if already approved this session ─────────
		if (state.allowedCommands.has(command)) return undefined;

		// ── Block or prompt ──────────────────────────────────────────────
		if (state.mode === "strict") {
			return {
				block: true,
				reason: `kubectl-guard (strict): modification blocked. Use kubectl-guard mode confirm to prompt, or add --allow-kubectl to bypass.`,
			};
		}

		// confirm mode: prompt user
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `kubectl-guard: modification blocked (no UI for confirmation). Run in an interactive session or use strict mode.`,
			};
		}

		const choice = await ctx.ui.select(
			`⚠️ kubectl modification blocked\n\n${command}\n\nThis will modify your Kubernetes cluster.`,
			["Allow and run", "Block"],
		);

		if (choice !== "Allow and run") {
			return { block: true, reason: "Blocked by kubectl-guard" };
		}

		// Remember this command for the rest of the session
		state.allowedCommands.add(command);
	});
}
