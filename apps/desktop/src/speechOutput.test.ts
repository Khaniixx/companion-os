import { describe, expect, it, vi } from "vitest";

import { startSpeechOutput } from "./speechOutput";

class MockAudio {
  src = "";
  currentTime = 0;
  duration = 2;
  onplay: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();

  async play(): Promise<void> {
    this.onplay?.();
    this.currentTime = 1;
    this.ontimeupdate?.();
    this.currentTime = 2;
    this.onended?.();
  }
}

class MockUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onboundary: ((event: { charIndex?: number }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function createBrowserWindow() {
  const voices = [{ name: "Sunrise", lang: "en-US", default: true }] as SpeechSynthesisVoice[];
  const synth = {
    getVoices: () => voices,
    cancel: vi.fn(),
    speak: vi.fn((utterance: MockUtterance) => {
      utterance.onstart?.();
      utterance.onboundary?.({ charIndex: Math.floor(utterance.text.length / 2) });
      utterance.onend?.();
    }),
  };

  return {
    speechSynthesis: synth as unknown as SpeechSynthesis,
    SpeechSynthesisUtterance: MockUtterance as unknown as typeof SpeechSynthesisUtterance,
    Audio: MockAudio as unknown as typeof Audio,
    AbortController,
  } as Window & typeof globalThis;
}

describe("speechOutput", () => {
  it("plays through the local chatterbox bridge when the pack voice engine is ready", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Blob(["RIFFdemo"], { type: "audio/wav" }), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      }),
    );
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrlMock = vi.fn(() => "blob:voice");
    const revokeObjectUrlMock = vi.fn();
    URL.createObjectURL = createObjectUrlMock;
    URL.revokeObjectURL = revokeObjectUrlMock;
    const statuses: string[] = [];
    const errors: string[] = [];
    const progressEvents: number[] = [];
    const sourceWindow = {
      ...createBrowserWindow(),
      fetch: fetchMock,
    } as unknown as Window & typeof globalThis;

    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      startSpeechOutput(
        {
          text: "Hello there",
          apiBaseUrl: "http://127.0.0.1:8000",
          outputMode: "pack",
          provider: "chatterbox",
          fallbackProvider: "browser",
          localEngineReady: true,
          onStatusChange: (status) => statuses.push(status),
          onError: (message) => errors.push(message),
          onProgress: (progress) => progressEvents.push(progress.charIndex),
        },
        sourceWindow,
      );

      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/api/voice/synthesize",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(statuses).toEqual(["starting", "speaking", "idle"]);
      expect(errors).toEqual([]);
      expect(progressEvents[progressEvents.length - 1]).toBe("Hello there".length);
      expect(createObjectUrlMock).toHaveBeenCalled();
      expect(revokeObjectUrlMock).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it("falls back to browser speech when local chatterbox playback fails", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "Chatterbox offline." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const statuses: string[] = [];
    const errors: string[] = [];
    const sourceWindow = {
      ...createBrowserWindow(),
      fetch: fetchMock,
    } as unknown as Window & typeof globalThis;

    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      startSpeechOutput(
        {
          text: "Hello there",
          locale: "en-US",
          voiceHint: "Sunrise",
          apiBaseUrl: "http://127.0.0.1:8000",
          outputMode: "pack",
          provider: "chatterbox",
          fallbackProvider: "browser",
          localEngineReady: true,
          onStatusChange: (status) => statuses.push(status),
          onError: (message) => errors.push(message),
        },
        sourceWindow,
      );

      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(errors).toContain("Chatterbox offline. Using browser fallback instead.");
      expect(statuses).toEqual(["starting", "starting", "speaking", "idle"]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
