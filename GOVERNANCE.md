# GOVERNANCE.md — Operating Policy & Repo Map for Study Studio

> Companion to `CONSTITUTION.md` (the *why* — philosophy and clean-code policy, which
> this file enforces operationally) and `AGENTS.md` (the agent charter + ledger).
> Read all three before acting. This file may be updated by any agent **as a logged
> governance change**; the CONSTITUTION itself is owner-only.

## 1. Repository map

Authoritative directory map for **Study Studio**. Any file you add, move, rename, or
delete gets reflected here in the same landing.

| Path | Purpose (one line) |
|---|---|
| `apps/desktop/` | The product: a Tauri shell plus a Next.js front end, and the Rust sidecar contract tests. |
| `marketing/` | Marketing pages. |
| `docs/` | Standing documentation — architecture, AI runtime, rollback, pre-registration. |
| `docs/prereg/`, `docs/img/` | Pre-registration records and the images the docs reference. |
| `.github/` | CI workflows. The workflow sets a repository-wide default working directory of `apps/desktop`, so **any job that must run at the root has to say `working-directory: .`** — the `governance` job does. |
| `.githooks/` | Repository git hooks. |
| `index.html`, `Helix_Prime.html` | Landing pages. They mirror `README.md`; they never fork it. |
| `package.json`, `deno.json` | npm scripts and the Deno lint configuration. |

## 2. Documentation policy (what belongs where)

**Root holds only the requested set** — nothing else:

| File | State | Purpose |
|---|---|---|
| `README.md` | required | The single source of truth: what this is, why it's here, how to use it — in simple English for a professional reader. Carries the Helix Solutions logo. |
| `AGENTS.md` | required | Agent charter + sign-in/out ledger. |
| `CONSTITUTION.md` | required | The owner's engineering philosophy and clean-code policy (unified across every repo). |
| `GOVERNANCE.md` | required | This file: repo map, documentation policy, sync policy, archiving rules. |
| `CHANGELOG.md` | standard | Dated user-visible changes. |
| `LICENSE` / `LICENSE.md` | standard | MIT, unless the repo states otherwise. |
| `SECURITY.md` | standard | Threat model, vulnerability reporting, secret handling. |

**Everything else lives in `docs/`** — reports, audit logs, execution plans, research
notes, ADRs, runbooks, anything dated or one-off. No stray `.md`/`.txt` at the root.
If a document at the root is not in the table above, move it to `docs/` (or
`docs/archive/` if it is historical) and record the move in the `AGENTS.md` ledger.

### Root files the rule does not cover, recorded so they are not a surprise

- `constitution.me` — a bare file with no `.md`/`.txt` suffix, so the gate does not see
  it, but it **is** a constitution-shaped document: *"Constitution 000 — Day Zero"*.
  Five files link to it (`apps/desktop/README.md`, `apps/desktop/CONTRIBUTING.md`,
  `apps/desktop/docs/ARCHITECTURE.md`, `apps/desktop/docs/OFFLINE_SETUP.md`,
  `docs/ARCHITECTURE.md`), so it is load-bearing and was **not** moved.
- `docs/HELIX_CONSTITUTION.md` — a second constitution-shaped document, referenced from
  `docs/ARCHITECTURE.md` and `docs/AI_RUNTIME.md`, which calls it "governing".

This repository therefore carries **three** constitution-shaped documents: this root
`CONSTITUTION.md` (the portfolio text), `constitution.me`, and
`docs/HELIX_CONSTITUTION.md`. The clean-code policy says *no duplicate files, ever*, so
this is a defect — but it is a defect of history that only the owner may settle, because
the two older texts are referenced from code-adjacent docs. Recorded, not silently
resolved. The next agent should not "tidy" this without the owner's decision.

## 3. Synchronization & harmony policy

The owner's rule: **the repository's actual status must match its README at all times,
locally and remotely.**

1. `README.md` is the canonical account. `index.html` and the marketing pages mirror it;
   they never fork it.
2. When reality changes, update `README.md` **first**, then mirror it to the pages.
3. Every sanctioned change is committed **and pushed** to the default branch, so the
   GitHub copy, the local working copy, and any local platform that reads the repo
   all show the same truth.
4. A number published anywhere (README, page, badge) must be reproducible from this
   repository. A stale figure is removed, not left to rot.

## 4. Archiving rule

- Archive (move to `docs/archive/`), never delete: historical reports, superseded plans,
  dated audits, and one-off execution logs.
- Delete outright only regenerable artifacts: caches, build output, coverage files.
- Record every move in the `AGENTS.md` ledger with date and time.

## 5. Engineering philosophy & clean-code policy (operational summary)

The full text is `CONSTITUTION.md`. The operational reminders, enforced here:

- **Fail closed.** Missing input or missing authority is a refusal, never a default.
- **Evidence before claims.** Published numbers carry a command, a date, and an artifact.
- **No duplicates, no temp files, one file one job, every file explains itself.**
- **Secrets never enter the tree.**
- **Simple English** in code, docs, and UI, so a non-technical professional reader
  (recruiter, partner) can follow.
- **One brand mark:** the Helix Solutions logo, everywhere.

## 6. Definition of done

It works; it has a test or a documented manual check; the `AGENTS.md` ledger has an
entry; the docs reflect the new reality; no temporary file was left behind; and every
published number can be re-run to reproduce itself.
