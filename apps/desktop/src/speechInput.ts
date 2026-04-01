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
  onActivity?: (activity: SpeechInputActivity) => void;
};

export type SpeechInputSession = {
  stop: () => void;
};

export type SpeechInputActivity = {
  level: number;
  hearing: boolean;
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
    webkitAudioContext?: typeof AudioContext;
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
  const AudioContextConstructor =
    sourceWindow.AudioContext ?? sourceWindow.webkitAudioContext;
  const RecognitionConstructor = getSpeechRecognitionConstructor(sourceWindow);
  let recognition: SpeechRecognitionInstance | null = null;
  let stopped = false;
  let audioContext: AudioContext | null = null;
  let analyserNode: AnalyserNode | null = null;
  let mediaSource: MediaStreamAudioSourceNode | null = null;
  let activityTimer: number | null = null;

  const stopActivityTracking = () => {
    if (activityTimer !== null) {
      sourceWindow.clearInterval(activityTimer);
      activityTimer = null;
    }
    mediaSource?.disconnect();
    analyserNode?.disconnect();
    mediaSource = null;
    analyserNode = null;
    void audioContext?.close();
    audioContext = null;
    options.onActivity?.({
      level: 0,
      hearing: false,
    });
  };

  const stopTracks = () => {
    mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
  };

  if (typeof AudioContextConstructor === "function") {
    audioContext = new AudioContextConstructor();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.72;
    mediaSource = audioContext.createMediaStreamSource(mediaStream);
    mediaSource.connect(analyserNode);

    const sampleBuffer = new Uint8Array(analyserNode.fftSize);
    activityTimer = sourceWindow.setInterval(() => {
      if (stopped || analyserNode === null) {
        return;
      }

      analyserNode.getByteTimeDomainData(sampleBuffer);
      let sumSquares = 0;
      for (const sample of sampleBuffer) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / sampleBuffer.length);
      const level = Number(Math.min(1, rms * 8).toFixed(2));
      options.onActivity?.({
        level,
        hearing: level >= 0.08,
      });
    }, 120);
  }

  if (RecognitionConstructor === null || options.transcriptionEnabled === false) {
    options.onStatusChange("listening");
    return {
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        stopActivityTracking();
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
      options.onActivity?.({
        level: 1,
        hearing: true,
      });
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
      stopActivityTracking();
      stopTracks();
      options.onStatusChange("idle");
    },
  };
}
