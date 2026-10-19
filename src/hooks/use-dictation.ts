import { useAction } from "convex/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { errorMessage, throwIfRefused } from "@/lib/errors";
import { api } from "../../convex/_generated/api";

// Dictation's client, and with convex/dictation.ts the only code that knows
// about Deepgram (ADR 0012). It streams the mic straight to Deepgram over a
// WebSocket. See https://developers.deepgram.com/docs/live-streaming-audio

const SAMPLE_RATE = 16_000;
/** Samples per frame sent to Deepgram: 40ms of audio. */
const FRAME_SAMPLES = 640;
// Without mip_opt_out, Deepgram trains on the audio.
const LISTEN_URL = `wss://api.deepgram.com/v1/listen?${new URLSearchParams({
  model: "nova-3",
  language: "multi",
  interim_results: "true",
  smart_format: "true",
  punctuate: "true",
  endpointing: "100",
  mip_opt_out: "true",
  encoding: "linear16",
  sample_rate: String(SAMPLE_RATE),
  channels: "1",
})}`;
/** A dictation stops after this long without new words. */
const SILENCE_TIMEOUT_MS = 30_000;
/** A dictation stops after this long, however it's going. */
const MAX_SESSION_MS = 5 * 60_000;
/** How long stop() waits for the last words. */
const FINAL_WORDS_TIMEOUT_MS = 1_000;

/**
 * Turns the mic's audio into 16 kHz mono PCM16 frames, and the loudness of
 * each frame. Each output sample is the mean of the input samples it covers.
 * The mean is a rough low-pass filter, good enough for speech.
 */
const WORKLET_SOURCE = `
class Pcm16Frames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${SAMPLE_RATE};
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.length = 0;
    this.covered = 0;
    this.sum = 0;
    this.count = 0;
    this.squares = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      this.sum += sample;
      this.count += 1;
      this.covered += 1;
      if (this.covered < this.ratio) continue;
      this.covered -= this.ratio;
      const mean = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.squares += mean * mean;
      this.frame[this.length++] = mean < 0 ? mean * 0x8000 : mean * 0x7fff;
      if (this.length === this.frame.length) {
        const rms = Math.sqrt(this.squares / this.length);
        const pcm = this.frame.slice().buffer;
        this.port.postMessage({ pcm, rms }, [pcm]);
        this.length = 0;
        this.squares = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm16-frames", Pcm16Frames);
`;

export type DictationState = "idle" | "connecting" | "listening" | "error";

export type DictationCallbacks = {
  /**
   * The words still being heard, replacing the last ones passed. An empty
   * string clears them.
   */
  onInterim: (text: string) => void;
  /** Words Deepgram confirmed. The interim words they replace are cleared. */
  onFinal: (text: string) => void;
  /** Why a dictation failed or couldn't start, in words safe to show. */
  onError: (message: string) => void;
};

/** One dictation, from start() until it's torn down. */
type Session = {
  stream?: MediaStream;
  audio?: AudioContext;
  socket?: WebSocket;
  timers: number[];
  silenceTimer?: number;
  /** Set once the socket opens. */
  opened: boolean;
  /** Set by the first stop(), so later calls wait for the same stop. */
  stopped?: Promise<void>;
  /** Resolves stop() once the socket closes. */
  closed: Promise<void>;
  markClosed: () => void;
};

/**
 * Dictation into any text box. start() asks for the system default mic,
 * gets a token from convex/dictation.ts and streams the mic to Deepgram.
 * Words come back through the callbacks. stop() asks Deepgram for the last
 * words and resolves once they arrive, or after 1s. cancel() drops the
 * dictation at once, with no more callbacks.
 *
 * A dictation stops by itself after 30s without new words, or after 5
 * minutes. A lost connection keeps the words so far, calls onError and
 * leaves the state at "error" until the next start(). `level` is the mic's
 * loudness while listening, from 0 to 1.
 */
export function useDictation(callbacks: DictationCallbacks) {
  const [state, setState] = useState<DictationState>("idle");
  const [level, setLevel] = useState(0);
  const getToken = useAction(api.dictation.token);
  const sessionRef = useRef<Session | null>(null);
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Frees the mic, the audio graph and the socket. Callbacks check that
  // their session is still the current one, so none fire after this.
  function tearDown(session: Session) {
    if (sessionRef.current === session) sessionRef.current = null;
    for (const timer of session.timers) window.clearTimeout(timer);
    window.clearTimeout(session.silenceTimer);
    stopAudio(session);
    session.socket?.close();
    session.markClosed();
  }

  function stopAudio(session: Session) {
    for (const track of session.stream?.getTracks() ?? []) track.stop();
    void session.audio?.close().catch(() => {});
    setLevel(0);
  }

  function fail(session: Session, message: string) {
    if (sessionRef.current !== session) return;
    tearDown(session);
    setState("error");
    callbacksRef.current.onError(message);
  }

  function resetSilenceTimer(session: Session) {
    window.clearTimeout(session.silenceTimer);
    session.silenceTimer = window.setTimeout(
      () => void stopSession(session),
      SILENCE_TIMEOUT_MS,
    );
  }

  function stopSession(session: Session) {
    if (sessionRef.current !== session) return Promise.resolve();
    session.stopped ??= finishSession(session);
    return session.stopped;
  }

  async function finishSession(session: Session) {
    const { socket } = session;
    if (socket?.readyState !== WebSocket.OPEN) {
      tearDown(session);
      setState("idle");
      return;
    }
    // Stop the audio, then ask Deepgram to send what it has and close.
    stopAudio(session);
    socket.send(JSON.stringify({ type: "CloseStream" }));
    await Promise.race([
      session.closed,
      new Promise((resolve) =>
        window.setTimeout(resolve, FINAL_WORDS_TIMEOUT_MS),
      ),
    ]);
    if (sessionRef.current !== session) return;
    tearDown(session);
    setState("idle");
  }

  async function start() {
    if (sessionRef.current) return;
    let markClosed = () => {};
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    const session: Session = {
      timers: [],
      opened: false,
      closed,
      markClosed,
    };
    sessionRef.current = session;
    setState("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      fail(session, micErrorMessage(error));
      return;
    }
    session.stream = stream;
    // Stopped or cancelled while the mic was starting.
    if (sessionRef.current !== session) {
      tearDown(session);
      return;
    }

    let token: string;
    try {
      [{ token }] = await Promise.all([
        getToken().then(throwIfRefused),
        startAudio(session, stream),
      ]);
    } catch (error) {
      fail(session, errorMessage(error));
      return;
    }
    if (sessionRef.current !== session) {
      tearDown(session);
      return;
    }

    const socket = new WebSocket(LISTEN_URL, ["bearer", token]);
    session.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (sessionRef.current !== session) return;
      session.opened = true;
      setState("listening");
      resetSilenceTimer(session);
      session.timers.push(
        window.setTimeout(() => void stopSession(session), MAX_SESSION_MS),
      );
    };
    socket.onmessage = (event) => {
      if (sessionRef.current !== session) return;
      const result = parseResult(event.data);
      if (!result) return;
      if (result.text !== "") resetSilenceTimer(session);
      if (result.isFinal) {
        callbacksRef.current.onInterim("");
        if (result.text !== "") callbacksRef.current.onFinal(result.text);
      } else {
        callbacksRef.current.onInterim(result.text);
      }
    };
    socket.onclose = () => {
      session.markClosed();
      // A close we didn't ask for.
      if (sessionRef.current !== session || session.stopped) return;
      fail(
        session,
        session.opened
          ? "Dictation lost its connection, so it stopped."
          : "Dictation couldn't connect. Please try again.",
      );
    };
  }

  // Connects the mic to the worklet. The worklet sends each frame once the
  // socket is open, and drops frames until then, while the button shows
  // connecting. It stops sending once stop() asks for the last words.
  async function startAudio(session: Session, stream: MediaStream) {
    const audio = new AudioContext();
    session.audio = audio;
    const moduleUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "text/javascript" }),
    );
    try {
      await audio.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const source = audio.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audio, "pcm16-frames");
    worklet.port.onmessage = (
      event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>,
    ) => {
      if (sessionRef.current !== session) return;
      if (session.socket?.readyState === WebSocket.OPEN && !session.stopped) {
        session.socket.send(event.data.pcm);
      }
      setLevel(levelFromRms(event.data.rms));
    };
    // Some browsers only run a node connected to the speakers. The worklet
    // writes nothing to its output, so it plays silence.
    source.connect(worklet).connect(audio.destination);
    for (const track of stream.getAudioTracks()) {
      track.onended = () =>
        fail(session, "The mic disconnected, so dictation stopped.");
    }
    // A context made without a click can start suspended.
    await audio.resume();
  }

  const tearDownOnUnmount = useEffectEvent(() => {
    if (sessionRef.current) tearDown(sessionRef.current);
  });
  useEffect(() => () => tearDownOnUnmount(), []);

  return {
    state,
    level,
    /** Starts a dictation, unless one is running. */
    start: () => void start(),
    /** Stops the dictation once its last words arrive, or after 1s. */
    stop: async () => {
      if (sessionRef.current) await stopSession(sessionRef.current);
    },
    /** Drops the dictation at once. No more callbacks fire. */
    cancel: () => {
      if (!sessionRef.current) return;
      tearDown(sessionRef.current);
      setState("idle");
    },
  };
}

/** A Deepgram transcript message, or null for any other message. */
function parseResult(data: unknown): { text: string; isFinal: boolean } | null {
  if (typeof data !== "string") return null;
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== "Results"
  ) {
    return null;
  }
  const result = message as {
    is_final?: boolean;
    channel?: { alternatives?: { transcript?: string }[] };
  };
  return {
    text: result.channel?.alternatives?.[0]?.transcript?.trim() ?? "",
    isFinal: result.is_final === true,
  };
}

/** Maps a frame's RMS to 0 to 1 on a log scale, from -60 dB to -10 dB. */
function levelFromRms(rms: number) {
  if (rms <= 0) return 0;
  const decibels = 20 * Math.log10(rms);
  const level = (decibels + 60) / 50;
  // Rounded so near-equal levels don't re-render.
  return Math.round(Math.min(1, Math.max(0, level)) * 20) / 20;
}

function micErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return "a8 can't use your mic. Allow it in your browser's site settings, then try again.";
  }
  if (name === "NotFoundError")
    return "No mic found. Connect one and try again.";
  return "Your mic couldn't start. Please try again.";
}
