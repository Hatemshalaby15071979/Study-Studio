#!/usr/bin/env node
// Release-consistency guard.
//
// A release is only real if the same version appears in four places:
//
//   1. the version manifests (checked by scripts/check-versions.mjs)
//   2. the CHANGELOG
//   3. a git tag
//   4. the published GitHub Release
//
// This script checks the parts it can check locally — the CHANGELOG and the
// tags — and states the rest. It exits non-zero when the repository is in a
// state that would make a release lie about what it contains.
//
// Usage: npm run check:release
// Exits 0 when consistent, 1 otherwise.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, "..");
const ROOT = resolve(APP_DIR, "..", "..");
const CHANGELOG = join(ROOT, "CHANGELOG.md");

/**
 * Tags that exist in this repository but do not correspond to a release.
 *
 * Each entry says what the tag actually is. These are not exceptions to
 * hide behind — they are history that the CHANGELOG cannot describe
 * because it describes releases, and a release is a version plus a tag.
 *
 * v1.0.0 — the repository's very first tag, on the third commit of the
 *   project (2026-08-27). The tree it points at already declared version
 *   0.2.0 in its manifests, so the tag name never matched the code it
 *   marked. It predates the current release line, which starts at 0.1.0.
 *   Removing a published tag is the owner's call, not this script's.
 */
const LEGACY_TAGS = new Map([
  ["v1.0.0", "first tag of the repository (2026-08-27); the tree it points at already declared 0.2.0"],
]);

/**
 * Released versions in the CHANGELOG that were never tagged.
 *
 * A section can be dated and untagged when the release happened without a
 * tag. That is a real gap in the history, and it is recorded here rather
 * than inferred, so the check does not claim a tag exists when it does not.
 */
const UNTAGGED_RELEASES = new Map([["0.1.0", "released 2026-08-02 without a tag"]]);

function fail(message) {
  console.error(`check:release — ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

if (!existsSync(CHANGELOG)) fail(`no CHANGELOG at ${CHANGELOG}`);

const changelog = readFileSync(CHANGELOG, "utf8");

// ── the version the manifests declare ────────────────────────────────────
const manifestVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// ── the versions the CHANGELOG declares ───────────────────────────────────
// A heading is `## [x.y.z] - date` or `## [x.y.z] - Unreleased`.
const sections = [];
for (const match of changelog.matchAll(/^## \[([^\]]+)\][^\n]*$/gm)) {
  const heading = match[0];
  const version = match[1];
  const released = !/Unreleased/i.test(heading);
  sections.push({ version, heading, released });
}

if (sections.length === 0) fail("the CHANGELOG has no version sections");

const top = sections[0];
const unreleased = top.version === "Unreleased";

// ── the tags ──────────────────────────────────────────────────────────────
const tags = git(["tag", "--list"]).split("\n").filter(Boolean);
const taggedVersions = new Set(tags.map((t) => t.replace(/^v/, "")));

// ── the checks ────────────────────────────────────────────────────────────
const problems = [];

if (!unreleased && top.version !== manifestVersion) {
  problems.push(
    `the top released CHANGELOG entry is ${top.version} but the manifests declare ${manifestVersion}. ` +
      `Either the manifests or the CHANGELOG is out of date.`
  );
}

if (unreleased) {
  // The unreleased section carries no version, so the version being prepared
  // is the one in the section below it, plus whatever the manifests say.
  const prepared = sections.slice(1).find((s) => s.released);
  if (prepared && prepared.version !== manifestVersion) {
    problems.push(
      `the CHANGELOG's latest released version is ${prepared.version} but the manifests declare ` +
        `${manifestVersion}; the unreleased section does not say which version is being prepared.`
    );
  }
}

for (const section of sections) {
  if (!section.released) continue;
  if (taggedVersions.has(section.version)) continue;
  if (UNTAGGED_RELEASES.has(section.version)) continue;
  problems.push(
    `the CHANGELOG records ${section.version} as released but there is no v${section.version} tag. ` +
      `Either tag the release or record the gap.`
  );
}

for (const tag of tags) {
  const version = tag.replace(/^v/, "");
  if (LEGACY_TAGS.has(tag)) continue;
  if (sections.some((s) => s.version === version)) continue;
  problems.push(
    `the tag ${tag} has no CHANGELOG entry. A tag without a changelog entry is a release nobody ` +
      `can find out about.`
  );
}

// ── the report ────────────────────────────────────────────────────────────
console.log(`  manifests        ${manifestVersion}`);
console.log(`  changelog top    ${top.version}${unreleased ? " (unreleased section)" : ""}`);
console.log(`  tags             ${tags.join(", ") || "(none)"}`);

for (const [tag, why] of LEGACY_TAGS) {
  if (tags.includes(tag)) console.log(`  legacy tag       ${tag} — ${why}`);
}
for (const [version, why] of UNTAGGED_RELEASES) {
  if (sections.some((s) => s.version === version)) {
    console.log(`  untagged release ${version} — ${why}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`\n  - ${problem}`);
  console.error(`\ncheck:release — ${problems.length} problem(s).`);
  process.exit(1);
}

console.log("\ncheck:release — OK. The CHANGELOG and the tags agree.");
process.exit(0);
