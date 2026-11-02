import { readVersioned, writeVersioned } from "./storage";
import { isTauri, invokeTauri } from "./tauri";
import { aiRuntime } from "./ai-runtime";
import { workloadCoordinator } from "./workloadCoordinator";

const PREFERENCE_KEY = "study-studio-audio-renderer";
const VOICESTUDIO_UNSUPPORTED =
  "VoiceStudio's documented local API supports transcription, not TTS rendering. Use VoiceStudio manually or choose Piper.";

export type AudioRendererId = "piper" | "voicestudio";
export type AudioRendererPreference = AudioRendererId | "automatic";

export interface AudioRendererPreferences {
  renderer: AudioRendererPreference;
  fallbackToPiper: boolean;
}

export interface AudioRendererStatus {
  state: "available" | "unavailable" | "unsupported";
  service: string;
  version?: string;
  protocol?: string;
  automatedRenderingSupported: boolean;
  message: string;
}

export interface AudioRenderRequest {
  lessonId: string;
  format: "wav" | "mp3";
  text: string;
  voice?: string;
  podcastScript?: { speaker: "Host A" | "Host B"; text: string }[];
  voiceB?: string;
}

export interface AudioRenderResult {
  path: string;
  size: number;
  renderer: AudioRendererId;
}

export interface AudioRenderer {
  readonly id: AudioRendererId;
  status(): Promise<AudioRendererStatus>;
  discoverVoices(language?: string): Promise<{ id: string; language: string }[]>;
  render(request: AudioRenderRequest): Promise<AudioRenderResult>;
  cancel(jobId: string): Promise<boolean>;
}

export const DEFAULT_AUDIO_RENDERER_PREFERENCES: AudioRendererPreferences = {
  renderer: "piper",
  fallbackToPiper: false,
};

function isPreferences(value: unknown): value is AudioRendererPreferences {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AudioRendererPreferences>;
  return (
    (candidate.renderer === "piper" ||
      candidate.renderer === "voicestudio" ||
      candidate.renderer === "automatic") &&
    typeof candidate.fallbackToPiper === "boolean"
  );
}

export function getAudioRendererPreferences(): AudioRendererPreferences {
  return readVersioned(
    PREFERENCE_KEY,
    (raw) => (isPreferences(raw) ? raw : null),
    DEFAULT_AUDIO_RENDERER_PREFERENCES
  );
}

export function saveAudioRendererPreferences(
  preferences: AudioRendererPreferences
): boolean {
  if (!isPreferences(preferences)) {
    throw new Error("Invalid audio renderer preferences.");
  }
  return writeVersioned(PREFERENCE_KEY, preferences);
}

export class AudioRendererError extends Error {
  constructor(
    readonly code: "unsupported" | "unavailable" | "render_failed",
    message: string
  ) {
    super(message);
    this.name = "AudioRendererError";
  }
}

export class VoiceStudioAudioRenderer implements AudioRenderer {
  readonly id = "voicestudio" as const;

  async status(): Promise<AudioRendererStatus> {
    if (!isTauri()) {
      return {
        state: "unavailable",
        service: "VoiceStudio",
        automatedRenderingSupported: false,
        message: "VoiceStudio status is available in the Study Studio desktop app.",
      };
    }

    return invokeTauri<AudioRendererStatus>("voice_studio_status");
  }

  async discoverVoices(): Promise<{ id: string; language: string }[]> {
    return [];
  }

  async render(_request: AudioRenderRequest): Promise<AudioRenderResult> {
    throw new AudioRendererError("unsupported", VOICESTUDIO_UNSUPPORTED);
  }

  async cancel(_jobId: string): Promise<boolean> {
    return false;
  }
}

export class PiperAudioRenderer implements AudioRenderer {
  readonly id = "piper" as const;

  async status(): Promise<AudioRendererStatus> {
    if (!isTauri()) {
      return {
        state: "unavailable",
        service: "Piper",
        automatedRenderingSupported: false,
        message: "Piper file rendering is available in the Study Studio desktop app.",
      };
    }
    const voices = await invokeTauri<{ id: string; language: string }[]>("discover_tts_voices");
    return {
      state: voices.length > 0 ? "available" : "unavailable",
      service: "Piper",
      automatedRenderingSupported: voices.length > 0,
      message: voices.length > 0
        ? `${voices.length} Piper voice${voices.length === 1 ? "" : "s"} installed.`
        : "Install a Piper voice in Settings to render audio.",
    };
  }

  async discoverVoices(language?: string): Promise<{ id: string; language: string }[]> {
    if (!isTauri()) return [];
    const voices = await invokeTauri<{ id: string; language: string }[]>("discover_tts_voices");
    return language
      ? voices.filter((voice) => voice.language.toLowerCase() === language.toLowerCase())
      : voices;
  }

  async render(request: AudioRenderRequest): Promise<AudioRenderResult> {
    if (!isTauri()) {
      throw new AudioRendererError(
        "unavailable",
        "Audio files can only be generated inside the Study Studio desktop app."
      );
    }
    return workloadCoordinator.run("audio", async (context) => {
      await aiRuntime.prepareForAudio(context.setState, context.signal);
      context.setState("running");
      const info = request.podcastScript?.length
        ? await invokeTauri<{ path: string; size: number }>("tts_synthesize_podcast", {
            script: request.podcastScript,
            voiceA: request.voice ?? "",
            voiceB: request.voiceB ?? request.voice ?? "",
            lessonId: request.lessonId,
            format: request.format,
          })
        : await invokeTauri<{ path: string; size: number }>("tts_synthesize", {
            text: request.text,
            voice: request.voice ?? null,
            lessonId: request.lessonId,
            format: request.format,
          });
      return { ...info, renderer: this.id };
    });
  }

  async cancel(_jobId: string): Promise<boolean> {
    return false;
  }
}

export const piperAudioRenderer = new PiperAudioRenderer();
export const voiceStudioAudioRenderer = new VoiceStudioAudioRenderer();

export async function selectAudioRenderer(
  preferences: AudioRendererPreferences
): Promise<AudioRenderer> {
  if (preferences.renderer === "piper") return piperAudioRenderer;

  const status = await voiceStudioAudioRenderer.status();
  if (status.automatedRenderingSupported) return voiceStudioAudioRenderer;
  if (preferences.fallbackToPiper) return piperAudioRenderer;

  throw new AudioRendererError(
    status.state === "unavailable" ? "unavailable" : "unsupported",
    `${status.message} ${VOICESTUDIO_UNSUPPORTED}`
  );
}
