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
// A section is unreleased when its heading says so. The section still names
// the version it is preparing — `## [0.2.1] - Unreleased` means 0.2.1 is
// being prepared and has no tag yet.
const topReleased = top.released;
const unreleased = !topReleased;

// ── the tags ──────────────────────────────────────────────────────────────
// A shallow clone has no tags, and "this release was never tagged" would
// be the wrong conclusion from it. Detect it and say so, rather than
// reporting a false problem for every release.
if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
  console.error(
    "check:release — this is a shallow clone, so the tags are not available.\n" +
      "              Fetch the history (`git fetch --unshallow`) and run this again."
  );
  process.exit(1);
}

const tags = git(["tag", "--list"]).split("\n").filter(Boolean);
const taggedVersions = new Set(tags.map((t) => t.replace(/^v/, "")));

// ── the checks ────────────────────────────────────────────────────────────
const problems = [];

// The top CHANGELOG section names the version being prepared. It must be
// the version the manifests declare — whether that section is released or
// still unreleased.
if (top.version !== manifestVersion) {
  problems.push(
    `the top CHANGELOG entry is ${top.version} but the manifests declare ${manifestVersion}. ` +
      `Either the manifests or the CHANGELOG is out of date.`
  );
}

// A released section must have a tag. An unreleased one must not have one
// yet: the tag is created when the release is cut.
for (const section of sections) {
  if (!section.released) {
    if (taggedVersions.has(section.version)) {
      problems.push(
        `the CHANGELOG records ${section.version} as unreleased, but there is a v${section.version} tag. ` +
          `Either the release was cut — mark it released — or the tag was made by mistake.`
      );
    }
    continue;
  }
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
console.log(`  changelog top    ${top.version}${unreleased ? " (unreleased — no tag yet)" : ""}`);
console.log(`  tags             ${tags.join(", ") || "(none)"}`);

if (unreleased) {
  console.log(
    `                   the ${top.version} tag is created when the release is cut: git tag v${top.version}`
  );
}

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
