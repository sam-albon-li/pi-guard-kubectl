[![ci](https://github.com/sam-albon-li/pi-guard-kubectl/actions/workflows/ci.yml/badge.svg)](https://github.com/sam-albon-li/pi-guard-kubectl/actions/workflows/ci.yml)

# pi-guard-kubectl

Pi extension that blocks kubectl modification commands without explicit permission.

## Install

```bash
pi install git:github.com/sam-albon-li/pi-guard-kubectl@v1.0.0
```

Remove with `pi remove git:github.com/sam-albon-li/pi-guard-kubectl`.

## Usage

Read-only verbs (`get`, `list`, `describe`, `logs`, `top`, `version`, `cluster-info`, `api-versions`, `api-resources`, `explain`, `auth`, `wait`) pass through freely.

Modification verbs (`apply`, `create`, `delete`, `patch`, `replace`, `rollout`, `scale`, `edit`, `exec`, `cp`, `cordon`, `uncordon`, `drain`, `taint`, `annotate`, `label`, `port-forward`, `proxy`, `run`, `debug`, `attach`, `plugin`, `certificates`) are blocked. Any unknown verb is treated as a modification to be safe.

Modes (default is `confirm`):

```bash
kubectl-guard mode strict   # block modifications silently
kubectl-guard mode confirm  # prompt for confirmation before each modification
```

In `confirm` mode, an approved command is remembered for the rest of the session and is not prompted again. In headless sessions (no UI) modifications are blocked with a "no UI for confirmation" message.

Global toggle and status:

```bash
kubectl-guard on     # enable protection
kubectl-guard off    # disable protection
kubectl-guard status # show enabled state, mode, and session allowance count
kubectl-guard reset  # clear session allowances
```

One-shot bypass for a single command:

```bash
kubectl delete pod foo --allow-kubectl
```

## Development

Unit tests run with zero dependencies via Node's built-in test runner (Node ≥ 22.19 executes TypeScript natively):

```bash
npm test
```

An end-to-end test drives the installed package through real headless pi sessions. It requires a working default model and a `kubectl` binary on PATH, and uses a fake context so no real cluster is ever contacted:

```bash
npm run test:e2e
```
