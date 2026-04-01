export type SpeechOutputSupport = {
  synthesis: boolean;
  voices: boolean;
};

export type SpeechOutputStatus = "idle" | "starting" | "speaking" | "error" | "unsupported";

export type SpeechOutputOptions = {
  text: string;
  locale?: string | null;
  voiceHint?: string | null;
  apiBaseUrl?: string;
  outputMode?: "browser" | "pack";
  provider?: string | null;
  fallbackProvider?: string | null;
  localEngineReady?: boolean;
  onStatusChange: (status: SpeechOutputStatus) => void;
  onError: (message: string) => void;
  onProgress?: (progress: SpeechOutputProgress) => void;
};

export type SpeechOutputSession = {
  stop: () => void;
};

export type SpeechOutputProgress = {
  charIndex: number;
  progress: number;
  textLength: number;
};

type BrowserSpeechWindow = Window &
  typeof globalThis & {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
    Audio?: typeof Audio;
  };

function chooseVoice(
  synthesis: SpeechSynthesis,
  locale: string | null | undefined,
  voiceHint: string | null | undefined,
): SpeechSynthesisVoice | null {
  const voices = synthesis.getVoices();
  if (voices.length === 0) {
    return null;
  }

  const normalizedHint = voiceHint?.trim().toLowerCase() ?? "";
  const normalizedLocale = locale?.trim().toLowerCase() ?? "";

  if (normalizedHint) {
    const matchedByHint = voices.find((voice) =>
      voice.name.toLowerCase().includes(normalizedHint),
    );
    if (matchedByHint) {
      return matchedByHint;
    }
  }

  if (normalizedLocale) {
    const matchedByLocale = voices.find(
      (voice) => voice.lang.toLowerCase() === normalizedLocale,
    );
    if (matchedByLocale) {
      return matchedByLocale;
    }
  }

  return voices.find((voice) => voice.default) ?? voices[0] ?? null;
}

function formatSpeechError(error?: string): string {
  if (error === "not-allowed") {
    return "Browser speech playback was blocked before it could begin.";
  }
  if (error === "interrupted") {
    return "Speech playback was interrupted before it finished.";
  }
  return "Speech playback stopped before the browser could finish speaking.";
}

function toSpeechProgress(
  text: string,
  charIndex: number,
): SpeechOutputProgress {
  const textLength = Math.max(text.length, 1);
  const boundedCharIndex = Math.max(0, Math.min(charIndex, textLength));
  return {
    charIndex: boundedCharIndex,
    progress: boundedCharIndex / textLength,
    textLength,
  };
}

export function getSpeechOutputSupport(
  sourceWindow: BrowserSpeechWindow = window as BrowserSpeechWindow,
): SpeechOutputSupport {
  const synthesis =
    typeof sourceWindow.speechSynthesis !== "undefined" &&
    sourceWindow.speechSynthesis !== null;
  const voices = synthesis && sourceWindow.speechSynthesis.getVoices().length > 0;

  return {
    synthesis,
    voices,
  };
}

export function startSpeechOutput(
  options: SpeechOutputOptions,
  sourceWindow: BrowserSpeechWindow = window as BrowserSpeechWindow,
): SpeechOutputSession {
  const shouldUseLocalPackVoice =
    options.outputMode === "pack" &&
    options.localEngineReady === true &&
    options.provider === "chatterbox";

  if (shouldUseLocalPackVoice) {
    return startLocalPackSpeechOutput(options, sourceWindow);
  }

  return startBrowserSpeechOutput(options, sourceWindow);
}

function startLocalPackSpeechOutput(
  options: SpeechOutputOptions,
  sourceWindow: BrowserSpeechWindow,
): SpeechOutputSession {
  if (typeof sourceWindow.Audio !== "function") {
    return startBrowserSpeechOutput(options, sourceWindow);
  }

  const AbortControllerConstructor = sourceWindow.AbortController ?? AbortController;
  const abortController = new AbortControllerConstructor();
  const audioElement = new sourceWindow.Audio();
  let objectUrl: string | null = null;
  let stopped = false;
  let delegatedSession: SpeechOutputSession | null = null;

  const cleanup = () => {
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    audioElement.src = "";
  };

  const stopPlayback = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    abortController.abort();
    delegatedSession?.stop();
    audioElement.pause();
    cleanup();
    options.onStatusChange("idle");
  };

  audioElement.onplay = () => {
    if (!stopped) {
      options.onStatusChange("speaking");
      options.onProgress?.(toSpeechProgress(options.text, 0));
    }
  };
  audioElement.ontimeupdate = () => {
    if (stopped) {
      return;
    }
    const duration = Number.isFinite(audioElement.duration) && audioElement.duration > 0
      ? audioElement.duration
      : null;
    if (duration === null) {
      return;
    }
    const progress = Math.max(0, Math.min(audioElement.currentTime / duration, 1));
    options.onProgress?.(
      toSpeechProgress(options.text, Math.round(options.text.length * progress)),
    );
  };
  audioElement.onended = () => {
    if (!stopped) {
      options.onProgress?.(toSpeechProgress(options.text, options.text.length));
      cleanup();
      options.onStatusChange("idle");
    }
  };
  audioElement.onerror = () => {
    if (!stopped) {
      cleanup();
      options.onStatusChange("error");
      options.onError("Local pack voice playback stopped before the audio could finish.");
    }
  };

  options.onStatusChange("starting");
  void fetch(`${options.apiBaseUrl ?? "http://127.0.0.1:8000"}/api/voice/synthesize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: options.text,
    }),
    signal: abortController.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        throw new Error(
          errorPayload?.detail ?? `Local voice runtime returned ${response.status}.`,
        );
      }
      return response.blob();
    })
    .then(async (blob) => {
      if (stopped) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      audioElement.src = objectUrl;
      await audioElement.play();
    })
    .catch((error: unknown) => {
      if (stopped) {
        return;
      }
      cleanup();
      if (options.fallbackProvider === "browser") {
        options.onError(
          error instanceof Error
            ? `${error.message} Using browser fallback instead.`
            : "Local pack voice playback failed. Using browser fallback instead.",
        );
        delegatedSession = startBrowserSpeechOutput(options, sourceWindow);
        audioElement.onplay = null;
        audioElement.ontimeupdate = null;
        audioElement.onended = null;
        audioElement.onerror = null;
        return;
      }
      options.onStatusChange("error");
      options.onError(
        error instanceof Error
          ? error.message
          : "Local pack voice playback failed before it could begin.",
      );
    });

  return {
    stop: stopPlayback,
  };
}

function startBrowserSpeechOutput(
  options: SpeechOutputOptions,
  sourceWindow: BrowserSpeechWindow,
): SpeechOutputSession {
  if (
    typeof sourceWindow.speechSynthesis === "undefined" ||
    sourceWindow.speechSynthesis === null ||
    typeof sourceWindow.SpeechSynthesisUtterance !== "function"
  ) {
    options.onStatusChange("unsupported");
    throw new Error("This desktop shell does not expose browser speech playback.");
  }

  const synthesis = sourceWindow.speechSynthesis;
  const Utterance = sourceWindow.SpeechSynthesisUtterance;
  const utterance = new Utterance(options.text);
  const selectedVoice = chooseVoice(
    synthesis,
    options.locale,
    options.voiceHint,
  );
  if (options.locale) {
    utterance.lang = options.locale;
  }
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  let stopped = false;
  options.onStatusChange("starting");

  utterance.onstart = () => {
    if (!stopped) {
      options.onStatusChange("speaking");
      options.onProgress?.(toSpeechProgress(options.text, 0));
    }
  };
  utterance.onend = () => {
    if (!stopped) {
      options.onProgress?.(toSpeechProgress(options.text, options.text.length));
      options.onStatusChange("idle");
    }
  };
  utterance.onboundary = (event) => {
    if (!stopped) {
      options.onProgress?.(
        toSpeechProgress(options.text, event.charIndex ?? 0),
      );
    }
  };
  utterance.onerror = (event) => {
    if (!stopped) {
      options.onStatusChange("error");
      options.onError(formatSpeechError(event.error));
    }
  };

  synthesis.cancel();
  synthesis.speak(utterance);

  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      synthesis.cancel();
      options.onStatusChange("idle");
    },
  };
}
