<div align="center">

# Study Studio

[![CI](https://github.com/Hatemshalaby15071979/Study-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/Hatemshalaby15071979/Study-Studio/actions)
![licence](https://img.shields.io/badge/licence-MIT-blue)
![typescript](https://img.shields.io/badge/typescript-app-3178c6)
![status](https://img.shields.io/badge/status-0.2.1%20released-brightgreen)

**A private AI tutor that runs on your own computer — your lessons never leave the machine.**

</div>

## What it is

Study Studio is a desktop and browser app that turns any topic into a **lesson,
a quiz, a glossary, and a bilingual podcast script**. It uses an AI model that
runs on *your* machine, so your notes and answers stay with you. There is no
account to create and nothing is sent to the cloud.

If you are a student who wants to study with AI help — without handing your
material to a hosted service — this is built for you. You do not need to be a
programmer to use it.

## What you can do

- **Lessons** — turn a topic into structured sections with a glossary and a quiz.
- **Podcasts** — generate a dual-host script in English and Arabic.
- **Quizzes** — test yourself; answers are scored privately by a local service,
  so the answer key never reaches the app.
- **Audio** — export lessons to speech with Piper, when voice models and ffmpeg
  are installed.
- **Learning Journey** — track progress, streaks, and quiz scores.
- **Your library** — lessons are saved on your computer (IndexedDB).

## Before you start

You will need a **local AI model runtime** — LM Studio (port `1234`) or Ollama
(port `11434`) — with a model loaded. For audio export, install Piper voice
models and ffmpeg.

## Get it and run it

- **Windows:** download the installer (**NSIS .exe** or **MSI**) from the
  [Releases](releases) page, install, and open it.
- **Any computer (browser):** clone the repo, run `npm install` then
  `npm run dev`, and open `http://localhost:3000`. (Needs Node.js.)
- **From source (desktop):** `npm run tauri:build` packages the app for your
  operating system.

If no model is installed, the app tells you what is missing instead of calling a
hosted service.

## Is it private and safe? Straight answers

- **Local-first.** It talks to a model on your own machine. Your lessons and
  answers do not leave the computer.
- **No account, no cloud.** Nothing is uploaded and there is no sign-up.
- **Verified.** 1,040 automated tests pass, the code is 86% covered, and all CI
  checks are green (including mutation testing). The current release is **v0.2.1**.
- **Scored privately.** Quiz answers are checked by a local scoring service
  (Helix Core); the answer key stays sealed and is verified before every score.
- Like any personal project, it has had **no external security audit** yet.

## Status

<!-- docs-sync:start -->
**Version 0.2.1 — released 10 November 2026.** 1040 automated tests pass, the code is 86% covered, and all CI checks are green (including mutation testing). Packaged Windows installers are on the [Releases](releases) page; the CI badge at the top is the live build status.
<!-- docs-sync:end -->

## For developers

- TypeScript + Next.js inside a Tauri 2 shell (Rust). Quiz scoring runs in a
  local Helix Core sidecar (from the Helix-Education repository).
- Architecture, CI details, and the cross-repo contract live in `docs/`.
- Full, dated evidence (test counts, coverage, mutation testing, the sidecar
  contract test) is in the repository docs; CI is the live status, so no frozen
  number is printed here.

## Author

Built by **Hatem Shalaby** — Contact Centre Operations & AI Implementation Lead,
WFM & CX Transformation.

## Licence

MIT
