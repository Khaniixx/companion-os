export type SpeechOutputSupport = {
  synthesis: boolean;
  voices: boolean;
};

export type SpeechOutputStatus = "idle" | "starting" | "speaking" | "error" | "unsupported";

export type SpeechOutputOptions = {
  text: string;
  locale?: string | null;
  voiceHint?: string | null;
  onStatusChange: (status: SpeechOutputStatus) => void;
  onError: (message: string) => void;
};

export type SpeechOutputSession = {
  stop: () => void;
};

type BrowserSpeechWindow = Window &
  typeof globalThis & {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
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
    }
  };
  utterance.onend = () => {
    if (!stopped) {
      options.onStatusChange("idle");
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
