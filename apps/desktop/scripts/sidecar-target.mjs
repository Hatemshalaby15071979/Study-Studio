#!/usr/bin/env node
// Decide whether the sidecar can be built for the requested target.
//
// PyInstaller compiles for the machine it runs on. It cannot produce a
// Windows binary on Linux, nor an arm64 binary on x86_64. The sidecar
// script, however, is invoked by Tauri with TAURI_ENV_TARGET_TRIPLE set to
// the *target* triple — so on a cross-compile the two disagree.
//
// The failure mode this module exists to prevent: the script names its
// output after the target triple, so a Linux ELF built on an x86_64 host
// can end up saved as `helix-core-aarch64-apple-darwin` — a file with the
// wrong architecture under a name that claims the right one. Tauri then
// bundles it, and it fails at runtime on a machine that never sees the
// error.
//
// So: refuse, loudly, with the reason and the fix.

import { platform, arch } from "node:os";

/** Map a Rust target triple onto the platform it targets. */
export function triplePlatform(triple) {
  if (triple.includes("windows")) return "windows";
  if (triple.includes("darwin")) return "darwin";
  if (triple.includes("linux")) return "linux";
  return null;
}

/** Map a Node platform name onto the Rust target triple for it. */
export function hostTriple(archName = arch(), platformName = platform()) {
  const base = {
    x64: "x86_64",
    arm64: "aarch64",
    ia32: "i686",
    arm: "armv7",
  }[archName];

  if (!base) return null;
  if (platformName === "win32") return `${base}-pc-windows-msvc`;
  if (platformName === "darwin") return `${base}-apple-darwin`;
  if (platformName === "linux") return `${base}-unknown-linux-gnu`;
  return null;
}

/**
 * Compare a requested target triple with the machine doing the build.
 *
 * Returns `{ ok: true }` when they agree, and `{ ok: false, reason }` when
 * they do not — including when the triple is for a different architecture on
 * the same operating system, which is just as unbuildable.
 */
export function checkBuildable(targetTriple, host = { platform: platform(), arch: arch() }) {
  const targetPlatform = triplePlatform(targetTriple);
  if (!targetPlatform) {
    return { ok: false, reason: `cannot tell what platform the target triple "${targetTriple}" targets` };
  }

  const hostPlatformName = host.platform === "win32" ? "windows" : host.platform === "darwin" ? "darwin" : "linux";
  const hostTripleName = hostTriple(host.arch, host.platform);

  if (targetPlatform !== hostPlatformName) {
    return {
      ok: false,
      reason:
        `the target is ${targetPlatform} but this machine is ${hostPlatformName}. ` +
        `PyInstaller compiles for the machine it runs on, so it cannot produce a ${targetPlatform} binary here.`,
    };
  }

  // Same operating system, different architecture: also unbuildable.
  const targetArch = targetTriple.startsWith("aarch64") || targetTriple.startsWith("arm")
    ? "arm64"
    : targetTriple.startsWith("x86_64")
      ? "x64"
      : null;

  if (targetArch && targetArch !== host.arch) {
    return {
      ok: false,
      reason:
        `the target architecture is ${targetArch} but this machine is ${host.arch}. ` +
        `PyInstaller compiles for the machine it runs on, so it cannot produce a ${targetArch} binary here.`,
    };
  }

  return { ok: true, hostTriple: hostTripleName };
}
