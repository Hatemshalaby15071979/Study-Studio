# Rollback runbook — Study Studio

What to do when a shipped build is wrong, and what "rolled back" can and
cannot undo.

The short version: **a rollback is a reinstall of the previous version.**
Study Studio is a desktop application. There is no server to roll back,
no database to migrate, and no state that outlives the app except what
the user has already created in their library.

---

## 1. Decide whether a rollback is the right move

| Symptom | Roll back? |
| --- | --- |
| The app crashes on launch after an update | **Yes.** |
| Quiz scoring fails: "the scoring service is not available" | **No.** That is the Helix Core sidecar, not the app. See §5. |
| A generation feature behaves differently than expected | **Usually not.** It is a model or provider problem. See §5. |
| The app works but a new feature is wrong | **No.** Wait for a fixed release. |

Rolling back loses nothing the user created: the lesson library, the
journeys and the quiz history live in the app's data directory, not in
the installer.

---

## 2. Before you roll back

**Take a copy of the user's data directory.** A rollback does not
delete it, but a reinstall can.

Windows:

```powershell
Copy-Item -Recurse "$env:APPDATA\com.studio.study" "$env:USERPROFILE\Desktop\study-studio-data-backup"
```

macOS / Linux:

```bash
cp -R ~/.local/share/com.studio.study ~/study-studio-data-backup
```

**Find out which version is running.** Help → About, or the version in
the window title.

---

## 3. Roll back to the previous version

1. Download the previous installer from the
   [releases page](https://github.com/Hatemshalaby15071979/Study-Studio/releases).
2. Run it. The installer replaces the current installation.
3. Launch the app and check Help → About shows the previous version.

The installers are per-platform, and they are named for the product and
the version:

| Platform | File |
| --- | --- |
| Windows (NSIS) | `study-studio_<version>_x64-setup.exe` |
| Windows (MSI) | `study-studio_<version>_x64_en-US.msi` |

They are produced by `npm run tauri:build` and land in
`apps/desktop/src-tauri/target/release/bundle/`.

**Install the older version over the newer one.** Do not uninstall
first. Uninstalling removes the app but not the data directory, and
running the old installer over the new one is the smaller operation.

---

## 4. If the previous version is not enough

The releases page keeps the last three versions. Beyond that, build
from source at the tag you need:

```bash
git clone https://github.com/Hatemshalaby15071979/Study-Studio
cd Study-Studio
git checkout v<version>
npm ci --prefix apps/desktop
npm run tauri:build --prefix apps/desktop
```

The installers land in `apps/desktop/src-tauri/target/release/bundle/`.

---

## 5. What a rollback does NOT fix

**The Helix Core sidecar.** The desktop app bundles the core as a
sidecar; it is not a separate installation and there is nothing to roll
back on the user's machine. If the app reports that the scoring service
is unavailable, the problem is the bundled core, and the fix is a newer
app build.

To build the app against a different core version, point the sidecar
build at that source and rebuild:

```bash
HELIX_CORE_SRC=/path/to/Helix-Education/packages/helix-core \
  npm run sidecar:build:force --prefix apps/desktop
```

The sidecar must be built for the platform it runs on. The build script
refuses to cross-compile, and says so, rather than producing a binary
with the wrong architecture.

**Generated content.** Lessons, podcasts and quizzes already generated
stay as they are. A rollback does not regenerate them.

---

## 6. Verify the rollback

- [ ] The app launches and shows the expected version in Help → About.
- [ ] The library still lists the user's existing lessons.
- [ ] A quiz can be answered and scored (this exercises the sidecar:
      see §5).
- [ ] Generation still works, if the machine has a model runtime.

---

## 7. Data recovery, if the data directory is damaged

The app's data directory holds the lesson library and the app settings.
It is not the Helix Core's database: the core keeps its own SQLite file
and its own sealing key, in a **separate** directory that follows the
platform's data-directory convention, not the app's.

| What | Windows | macOS / Linux |
| --- | --- | --- |
| The app's data | `%APPDATA%\com.studio.study` | `~/.local/share/com.studio.study` |
| The core's database | `%LOCALAPPDATA%\helix-core\core.db` | `~/.local/share/helix-core/core.db` |
| The core's sealing key | `%LOCALAPPDATA%\helix-core\secret.key` | `~/.local/share/helix-core/secret.key` |

The core's paths can be overridden with `HELIX_CORE_DB` and
`HELIX_CORE_SECRET_FILE`.

Restore the copy taken in §2 over the damaged directory:

Windows:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.studio.study"
Copy-Item -Recurse "$env:USERPROFILE\Desktop\study-studio-data-backup" "$env:APPDATA\com.studio.study"
```

macOS / Linux:

```bash
rm -rf ~/.local/share/com.studio.study
cp -R ~/study-studio-data-backup ~/.local/share/com.studio.study
```

**Never delete `helix-core/secret.key` to "fix" a scoring problem.**
The sealed answer keys are verified against it with an HMAC; without it
the core refuses to score rather than scoring against the wrong answer.
If the key is gone, the affected quizzes cannot be scored and must be
re-registered.
