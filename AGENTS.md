# AGENTS.md — Agent Charter & Ledger for Study Studio

> **Read order (mandatory, every landing):** `AGENTS.md` → `CONSTITUTION.md` →
> `GOVERNANCE.md` → `README.md`. Then **sign in** to the ledger below, do the work,
> **sign out**. No entry, no trust: an unlogged session's work is treated as unverified
> until someone checks it.

## 1. Who agents are here

An "agent" is any entity that reads or writes this repository — an AI model, an
automation script, or a human acting as operator. There is exactly **one supreme
authority**: the repository owner (**Hatem Shalaby**). An agent acts only on the
owner's instruction and records every landing.

## 2. The mandatory sign-in / sign-out rule

Every agent, on **every landing** (a landing = one session that ends with the agent
stopping, whether the task is finished or not), must:

1. **SIGN IN** before any write action — who, why, what will be touched, sensitive or
   network actions planned, and the **date and time from the system clock**.
2. **SIGN OUT** when the landing's work is complete or stopped — what changed, why,
   the files touched, evidence of verification, and **the current status when leaving**,
   written so the next agent can continue without re-discovery.

Fail closed: if a task cannot be completed, still sign out and state exactly what is
incomplete. Never claim verification that did not happen.

### Entry format

```
## [YYYY-MM-DD HH:MM TZ] — <agent name / model>
Task: <what was assigned>
Touched: <files created / modified / deleted / moved>
Why: <the reasoning, not just the diff>
Verification: <what was actually checked and the observed result>
Left undone: <what is incomplete, needs review, or is deferred — or "nothing">
Sensitive: <any remote writes, secrets, or destructive actions, or "none">
```

## 3. Environment facts

- **Repo:** Study Studio — a desktop and browser app that turns a topic into a lesson, a quiz, a glossary and a bilingual podcast script. Local inference is the default; hosted providers (OpenAI / OpenRouter) are off until the user turns one on and gives explicit consent. Version 0.2.1.
- **Owner account:** https://github.com/Hatemshalaby15071979
- **Default branch:** main
- **Where it runs:** on the user's own machine (Tauri desktop app). Nothing leaves the device unless a hosted provider is explicitly enabled. CI runs on GitHub Actions with Node 20.
- **Working directory trap:** the CI workflow sets a repository-wide default `working-directory: apps/desktop`. Any step that must run at the repository root has to say `working-directory: .` explicitly.
- **Verification commands:** `python3 scripts/check_root_docs.py` (the root-document gate; `--self-test` proves it fails closed). The application's own gates are the npm scripts in `apps/desktop` (`npm run verify`, plus the mutation harness `npm run check:mutations`, which refuses to run on a dirty tree).

## 4. Rules this agent must follow

- Read and obey **CONSTITUTION.md** (philosophy + clean-code policy). On conflict, it
  wins over this file.
- Follow **GOVERNANCE.md** for the repo map, documentation policy, and archiving rules.
- Keep `README.md` the single source of truth; landing and marketing pages mirror it.
- Keep local and remote in harmony: after a sanctioned change, commit and push so the
  GitHub copy matches the working copy.
- Sign in and sign out every landing, with the real clock time.
- The mutation harness restores from a snapshot and refuses to run over uncommitted
  edits. Do not "fix" that refusal — commit first.

## 5. Ledger (sign-in / sign-out)

## [2026-11-27 05:17 EET] — sami (OpenMausBot), owner-authorised governance landing

STATUS: SIGN-IN (work in progress)

Task: Bring this repository onto the portfolio governance standard, as the owner approved in chat on 2026-11-27 ("bring the remaining eleven onto the same governance standard"). Add the missing `AGENTS.md`, `CONSTITUTION.md` and `GOVERNANCE.md`, land the shared root-document gate, and wire it into CI.

Touched: Will add `AGENTS.md`, `CONSTITUTION.md`, `GOVERNANCE.md`, `scripts/check_root_docs.py`; add one job to `.github/workflows/ci.yml`. The root was already clean of stray documents, and nothing is moved, renamed or deleted.

Why: This repository had a README, a changelog and a security policy but no agent charter, no portfolio constitution and no written policy for the root, and nothing enforcing one. It also carries two older constitution-shaped documents (`constitution.me` and `docs/HELIX_CONSTITUTION.md`) that are linked from six files; those are recorded in `GOVERNANCE.md` section 2 as a duplication defect for the owner to settle, not resolved by an agent.

Verification: Planned — `python3 scripts/check_root_docs.py` and `--self-test` locally, then the GitHub Actions run on the landing commit.

Left undone: Nothing at sign-in.

Sensitive: `git push origin main` (owner's instruction in chat, 2026-11-27). No force push, no history rewrite, no secrets.
