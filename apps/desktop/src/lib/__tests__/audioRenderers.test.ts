import {
  AudioRendererError,
  DEFAULT_AUDIO_RENDERER_PREFERENCES,
  getAudioRendererPreferences,
  saveAudioRendererPreferences,
  selectAudioRenderer,
  voiceStudioAudioRenderer,
} from "@/lib/audioRenderers";

describe("audio renderer preferences", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
  });

  it("defaults existing installs to Piper with fallback disabled", () => {
    expect(getAudioRendererPreferences()).toEqual(DEFAULT_AUDIO_RENDERER_PREFERENCES);
  });

  it("reads legacy unwrapped preferences and writes the versioned form", () => {
    localStorage.setItem(
      "study-studio-audio-renderer",
      JSON.stringify({ renderer: "automatic", fallbackToPiper: true })
    );
    expect(getAudioRendererPreferences()).toEqual({
      renderer: "automatic",
      fallbackToPiper: true,
    });

    expect(
      saveAudioRendererPreferences({ renderer: "voicestudio", fallbackToPiper: false })
    ).toBe(true);
    expect(getAudioRendererPreferences()).toEqual({
      renderer: "voicestudio",
      fallbackToPiper: false,
    });
  });

  it("rejects malformed saved preferences and preserves the safe default", () => {
    localStorage.setItem(
      "study-studio-audio-renderer",
      JSON.stringify({ renderer: "unknown", fallbackToPiper: true })
    );
    expect(getAudioRendererPreferences()).toEqual(DEFAULT_AUDIO_RENDERER_PREFERENCES);
  });
});

describe("VoiceStudio rendering selection", () => {
  const status = jest.spyOn(voiceStudioAudioRenderer, "status");

  afterEach(() => {
    status.mockReset();
  });

  it("does not claim rendering support for the documented transcription-only API", async () => {
    status.mockResolvedValue({
      state: "available",
      service: "VoiceStudio",
      version: "0.5.7",
      protocol: "voicestudio.speech.v1",
      automatedRenderingSupported: false,
      message: "VoiceStudio is reachable, but its documented local API supports transcription only.",
    });

    await expect(
      selectAudioRenderer({ renderer: "voicestudio", fallbackToPiper: false })
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("falls back to Piper only when the preference explicitly allows it", async () => {
    status.mockResolvedValue({
      state: "available",
      service: "VoiceStudio",
      version: "0.5.7",
      protocol: "voicestudio.speech.v1",
      automatedRenderingSupported: false,
      message: "Transcription only.",
    });

    expect((await selectAudioRenderer({
      renderer: "automatic",
      fallbackToPiper: true,
    })).id).toBe("piper");
  });

  it("does not silently substitute Piper after a VoiceStudio render failure", async () => {
    status.mockResolvedValue({
      state: "available",
      service: "VoiceStudio",
      automatedRenderingSupported: true,
      message: "TTS supported.",
    });
    expect((await selectAudioRenderer({
      renderer: "voicestudio",
      fallbackToPiper: true,
    })).id).toBe("voicestudio");
    await expect((await selectAudioRenderer({
      renderer: "voicestudio",
      fallbackToPiper: true,
    })).render({
      lessonId: "lesson-1",
      format: "wav",
      text: "A private script.",
      voice: "voice-1",
    })).rejects.toBeInstanceOf(AudioRendererError);
  });
});
