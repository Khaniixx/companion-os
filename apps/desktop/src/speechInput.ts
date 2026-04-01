export type SpeechInputSupport = {
  microphone: boolean;
  transcription: boolean;
  vad: boolean;
};

export type SpeechInputSessionStatus =
  | "idle"
  | "starting"
  | "listening"
  | "hearing"
  | "unsupported"
  | "error";

export type SpeechInputSessionOptions = {
  locale?: string | null;
  transcriptionEnabled?: boolean;
  onStatusChange: (status: SpeechInputSessionStatus) => void;
  onTranscript: (transcript: string) => void;
  onError: (message: string) => void;
};

export type SpeechInputSession = {
  stop: () => void;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang?: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type BrowserSpeechWindow = Window &
  typeof globalThis & {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  };

function getSpeechRecognitionConstructor(
  sourceWindow: BrowserSpeechWindow,
): SpeechRecognitionConstructor | null {
  if (typeof sourceWindow.SpeechRecognition === "function") {
    return sourceWindow.SpeechRecognition;
  }
  if (typeof sourceWindow.webkitSpeechRecognition === "function") {
    return sourceWindow.webkitSpeechRecognition;
  }
  return null;
}

function formatRecognitionError(errorCode?: string): string {
  if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
    return "Microphone access was blocked, so speech input cannot start yet.";
  }
  if (errorCode === "audio-capture") {
    return "No usable microphone was available for speech input.";
  }
  if (errorCode === "network") {
    return "Browser speech recognition lost its connection before finishing.";
  }
  return "Speech input stopped before the browser could finish listening.";
}

export function getSpeechInputSupport(
  sourceWindow: BrowserSpeechWindow = window as BrowserSpeechWindow,
): SpeechInputSupport {
  const microphone =
    typeof sourceWindow.navigator?.mediaDevices?.getUserMedia === "function";
  const transcription = getSpeechRecognitionConstructor(sourceWindow) !== null;
  const vad =
    microphone &&
    (typeof sourceWindow.AudioContext === "function" ||
      typeof (sourceWindow as { webkitAudioContext?: unknown }).webkitAudioContext ===
        "function");

  return {
    microphone,
    transcription,
    vad,
  };
}

export async function startSpeechInputSession(
  options: SpeechInputSessionOptions,
  sourceWindow: BrowserSpeechWindow = window as BrowserSpeechWindow,
): Promise<SpeechInputSession> {
  const support = getSpeechInputSupport(sourceWindow);
  if (!support.microphone) {
    options.onStatusChange("unsupported");
    throw new Error("This desktop shell does not expose microphone capture.");
  }

  options.onStatusChange("starting");
  const mediaStream = await sourceWindow.navigator.mediaDevices.getUserMedia({
    audio: true,
  });
  const RecognitionConstructor = getSpeechRecognitionConstructor(sourceWindow);
  let recognition: SpeechRecognitionInstance | null = null;
  let stopped = false;

  const stopTracks = () => {
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
  };

  if (RecognitionConstructor === null || options.transcriptionEnabled === false) {
    options.onStatusChange("listening");
    return {
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        stopTracks();
        options.onStatusChange("idle");
      },
    };
  }

  recognition = new RecognitionConstructor();
  recognition.continuous = true;
  recognition.interimResults = true;
  if (options.locale) {
    recognition.lang = options.locale;
  }

  recognition.onstart = () => {
    if (!stopped) {
      options.onStatusChange("listening");
    }
  };
  recognition.onresult = (event) => {
    if (stopped) {
      return;
    }

    const finalChunks: string[] = [];
    let heardSomething = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = Array.from(result)
        .map((alternative) => alternative.transcript)
        .join(" ")
        .trim();

      if (!transcript) {
        continue;
      }

      heardSomething = true;
      if (result.isFinal) {
        finalChunks.push(transcript);
      }
    }

    options.onStatusChange(heardSomething ? "hearing" : "listening");
    const finalTranscript = finalChunks.join(" ").trim();
    if (finalTranscript) {
      options.onTranscript(finalTranscript);
    }
  };
  recognition.onerror = (event) => {
    if (stopped) {
      return;
    }
    options.onStatusChange("error");
    options.onError(formatRecognitionError(event.error));
  };
  recognition.onend = () => {
    if (stopped) {
      return;
    }
    options.onStatusChange("idle");
  };

  recognition.start();

  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      recognition?.stop();
      stopTracks();
      options.onStatusChange("idle");
    },
  };
}
