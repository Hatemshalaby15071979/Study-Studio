import { test } from "node:test";
import assert from "node:assert/strict";

import { checkBuildable, hostTriple, triplePlatform } from "./sidecar-target.mjs";

test("reads the platform out of a target triple", () => {
  assert.equal(triplePlatform("x86_64-pc-windows-msvc"), "windows");
  assert.equal(triplePlatform("aarch64-apple-darwin"), "darwin");
  assert.equal(triplePlatform("x86_64-unknown-linux-gnu"), "linux");
  assert.equal(triplePlatform("something-unrecognised"), null);
});

test("builds the host triple for the machine doing the build", () => {
  assert.equal(hostTriple("x64", "win32"), "x86_64-pc-windows-msvc");
  assert.equal(hostTriple("x64", "darwin"), "x86_64-apple-darwin");
  assert.equal(hostTriple("x64", "linux"), "x86_64-unknown-linux-gnu");
  assert.equal(hostTriple("arm64", "linux"), "aarch64-unknown-linux-gnu");
});

test("a native build is allowed", () => {
  const result = checkBuildable("x86_64-unknown-linux-gnu", { platform: "linux", arch: "x64" });
  assert.equal(result.ok, true);
});

test("a Windows target on a Linux host is refused", () => {
  // This is the case the shipping target depends on: the desktop app ships
  // as a Windows installer, so the sidecar must be a Windows binary. If the
  // build runs on Linux, the sidecar must be built on Windows — not
  // cross-compiled and mislabelled.
  const result = checkBuildable("x86_64-pc-windows-msvc", { platform: "linux", arch: "x64" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /PyInstaller compiles for the machine it runs on/);
});

test("a macOS target on a Linux host is refused", () => {
  const result = checkBuildable("aarch64-apple-darwin", { platform: "linux", arch: "x64" });
  assert.equal(result.ok, false);
});

test("a different architecture on the same operating system is refused", () => {
  const result = checkBuildable("aarch64-unknown-linux-gnu", { platform: "linux", arch: "x64" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /target architecture is arm64/);
});

test("a native Windows build is allowed", () => {
  const result = checkBuildable("x86_64-pc-windows-msvc", { platform: "win32", arch: "x64" });
  assert.equal(result.ok, true);
});
