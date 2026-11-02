# Local audio rendering

Study Studio keeps text generation and audio rendering separate. Lesson and
podcast scripts continue to use the selected AI provider. The current file
renderer is Piper, which runs locally and remains the default.

## VoiceStudio status

VoiceStudio is an optional, separately installed application. Study Studio
checks only the documented loopback capability endpoint:

```text
GET http://127.0.0.1:3900/.well-known/voicestudio-speech
```

The request is made by the Rust desktop backend, has a short timeout, does not
follow redirects, and sends no script, audio, prompt, or credentials. The
`voicestudio.speech.v1` contract currently documents batch/streaming
transcription and MCP interfaces; it does not advertise text-to-speech
rendering, TTS voice/language discovery, render progress, cancellation, or
engine unload. Therefore Study Studio does not send text to an undocumented
VoiceStudio route and does not claim that VoiceStudio can render from this app.

The VoiceStudio AppImage inspected on 2026-11-02 reports backend version
`0.5.7`. Its local speech API was not running during inspection. VoiceStudio's
own interface can be used manually, but Study Studio does not automate that
handoff or import the resulting file.

## Preferences and fallback

Open **Settings → Audio Renderer**:

- **Piper** is the backward-compatible default.
- **VoiceStudio** reports whether the documented local service is reachable.
  Rendering fails with an actionable unsupported-interface message until
  VoiceStudio documents a supported local TTS API.
- **Automatic** is available for future compatible renderers. It uses Piper
  only when **Allow Piper fallback** is explicitly enabled and the preferred
  renderer is unavailable or does not support automated TTS before rendering.
  It never switches engines after a render begins or retries a failed render
  on another engine.

Existing lessons and audio paths are unchanged. Piper voices remain discoverable
and downloadable in Settings. VoiceStudio's transcription contract does not
provide a TTS voice or language catalog, so no VoiceStudio voices, languages,
or audio formats are shown as supported by Study Studio.

## Workload sequencing

Text completions (including streamed chat and embeddings), model lifecycle
operations, and audio rendering share a FIFO workload queue. Before Piper
starts, Study Studio checks local runtimes and unloads the selected resident
text model only after the runtime confirms its identity and subsequently
confirms it is idle. A busy second local runtime or an unknown residency state
stops rendering rather than risking competing model allocations. This does not
delete or modify lesson data. Closing a frontend stream forwards cancellation
to providers that support `AbortSignal`; an in-progress Piper Tauri command
cannot currently be interrupted by the frontend.

VoiceStudio, its weights, and its models are never bundled or downloaded by
Study Studio. Install and configure it separately, and review its application,
model, voice, and output licenses before redistribution or use.

## Packaging status

`src-tauri/tauri.conf.json` currently selects Windows NSIS and MSI bundle
targets. The Linux `deb` section is not selected as a bundle target, and no
Linux AppImage or macOS target is configured. This feature adds no renderer
binary or model payload to any Study Studio package. A Windows installer build
does not install or configure VoiceStudio.
