#!/usr/bin/env node
// Build the Helix Core sidecar that Tauri bundles as `externalBin`.
//
// Tauri requires the file to be named `<name>-<target-triple>` (with `.exe`
// on Windows), so this script asks rustc for the host triple and stages the
// PyInstaller output under that name in src-tauri/binaries/.
//
// Source of truth: the `helix-core` distribution lives in the Helix Education
// repository. Point at it with HELIX_CORE_SRC, or check the two repos out
// side by side (the default assumes ../Helix-Education/packages/helix-core).
//
//   node scripts/build-sidecar.mjs            # build if stale
//   node scripts/build-sidecar.mjs --force    # always rebuild
//
// Exit codes: 0 built or already current, 1 build failed, 2 usage/environment.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, chmodSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, "..");
const OUT_DIR = join(APP_DIR, "src-tauri", "binaries");

const DEFAULT_SRC = resolve(APP_DIR, "..", "..", "..", "Helix-Education", "packages", "helix-core");

const force = process.argv.includes("--force");

function fail(message, code = 1) {
  console.error(`sidecar: ${message}`);
  process.exit(code);
}

function hostTriple() {
  if (process.env["TAURI_ENV_TARGET_TRIPLE"]) return process.env["TAURI_ENV_TARGET_TRIPLE"];
  const out = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (out.status !== 0) fail("rustc not found — install the Rust toolchain first", 2);
  const host = (out.stdout ?? "").split("\n").find((l) => l.startsWith("host: "));
  if (!host) fail("could not read the host triple from `rustc -vV`", 2);
  return host.slice("host: ".length).trim();
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__" || entry.name === "build" || entry.name === "dist") continue;
      newest = Math.max(newest, newestMtime(path));
    } else if (entry.name.endsWith(".py")) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

const src = resolve(process.env["HELIX_CORE_SRC"] ?? DEFAULT_SRC);
if (!existsSync(join(src, "helix_core", "__main__.py"))) {
  fail(
    `no helix-core source at ${src}\n` +
      `       set HELIX_CORE_SRC=/path/to/Helix-Education/packages/helix-core`,
    2
  );
}

const triple = hostTriple();
const isWindows = triple.includes("windows");
const outName = `helix-core-${triple}${isWindows ? ".exe" : ""}`;
const outPath = join(OUT_DIR, outName);

mkdirSync(OUT_DIR, { recursive: true });

if (!force && existsSync(outPath) && statSync(outPath).mtimeMs >= newestMtime(join(src, "helix_core"))) {
  console.log(`sidecar: ${outName} is current`);
  process.exit(0);
}

const python = process.env["PYTHON"] ?? (isWindows ? "python" : "python3");

const probe = spawnSync(python, ["-m", "PyInstaller", "--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  fail(`PyInstaller is not installed for ${python}\n       ${python} -m pip install pyinstaller`, 2);
}

const work = join(OUT_DIR, ".build");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const entry = join(work, "entry.py");
writeFileSync(
  entry,
  [
    '"""Generated sidecar entry point — do not edit."""',
    "import sys",
    "",
    "from helix_core.__main__ import main",
    "",
    "if __name__ == '__main__':",
    "    sys.exit(main())",
    "",
  ].join("\n"),
  "utf8"
);

// uvicorn resolves its protocol, loop and lifespan implementations by name at
// runtime, which static analysis cannot follow. Without these the frozen
// binary starts and then dies with "Could not import module".
const hiddenImports = [
  "uvicorn.logging",
  "uvicorn.loops.auto",
  "uvicorn.loops.asyncio",
  "uvicorn.protocols.http.auto",
  "uvicorn.protocols.http.h11_impl",
  "uvicorn.protocols.websockets.auto",
  "uvicorn.lifespan.on",
  "uvicorn.lifespan.off",
];

const args = [
  "-m",
  "PyInstaller",
  "--onefile",
  "--clean",
  "--noconfirm",
  "--name",
  "helix-core",
  "--paths",
  src,
  "--distpath",
  join(work, "dist"),
  "--workpath",
  join(work, "pyi"),
  "--specpath",
  work,
  ...hiddenImports.flatMap((name) => ["--hidden-import", name]),
  entry,
];

console.log(`sidecar: building ${outName} from ${src}`);
const build = spawnSync(python, args, { stdio: "inherit" });
if (build.status !== 0) fail("PyInstaller failed", 1);

const built = join(work, "dist", isWindows ? "helix-core.exe" : "helix-core");
if (!existsSync(built)) fail(`PyInstaller reported success but ${built} does not exist`);

copyFileSync(built, outPath);
if (!isWindows) chmodSync(outPath, 0o755);
rmSync(work, { recursive: true, force: true });

console.log(`sidecar: wrote ${outPath} (${Math.round(statSync(outPath).size / 1024)} KB)`);
