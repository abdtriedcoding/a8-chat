import { useAction } from "convex/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { prefetchDNS } from "react-dom";
import { errorMessage, throwIfRefused } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import type { RateLimited } from "../../convex/rateLimits";

// Dictation's client, and with convex/dictation.ts the only code that knows
// about Deepgram (ADR 0012). It streams the mic straight to Deepgram's Flux
// model over a WebSocket. See https://developers.deepgram.com/docs/flux/quickstart

const SAMPLE_RATE = 16_000;
/** Samples per frame sent to Deepgram: 80ms of audio, as Flux asks. */
const FRAME_SAMPLES = 1280;
// Without mip_opt_out, Deepgram trains on the audio.
const LISTEN_URL = `wss://api.deepgram.com/v2/listen?${new URLSearchParams({
  model: "flux-general-multi",
  mip_opt_out: "true",
  encoding: "linear16",
  sample_rate: String(SAMPLE_RATE),
})}`;
/** A dictation stops after this long without new words. */
const SILENCE_TIMEOUT_MS = 30_000;
/** A dictation stops after this long, however it's going. */
const MAX_SESSION_MS = 5 * 60_000;
/**
 * How long stop() waits for the last words. Flux usually sends them within
 * half a second, but it can fall more than a second behind the audio.
 */
const FINAL_WORDS_TIMEOUT_MS = 2_500;
/** A dictation fails if its socket isn't open this long after it starts. */
const CONNECT_TIMEOUT_MS = 10_000;
/**
 * How long a socket opened ahead of a dictation waits to be used. Deepgram
 * closes a Flux socket after 60s without audio, and a browser can't send
 * the pings that would keep it open.
 */
const WARM_SOCKET_MS = 50_000;

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

/**
 * "stopping" means the mic is off and the last words are on their way. A
 * start() then waits for them before it starts.
 */
export type DictationState =
  | "idle"
  | "connecting"
  | "listening"
  | "stopping"
  | "error";

type DictationCallbacks = {
  /** A dictation starts. The words that follow belong to it. */
  onStart: () => void;
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
  /** Resolves to the session's socket. `socket` holds it once it's here. */
  connection?: Promise<WebSocket>;
  socket?: WebSocket;
  /** Frames recorded before the socket opened, sent once it does. */
  heldFrames: ArrayBuffer[];
  timers: number[];
  connectTimer?: number;
  silenceTimer?: number;
  /** The words of the last result, so only new words reset the timer. */
  lastText: string;
  /** Set once the socket opens. */
  opened: boolean;
  /** Resolves true once the socket opens, or false once it can't. */
  ready: Promise<boolean>;
  markReady: (opened: boolean) => void;
  /** Set by the first stop(), so later calls wait for the same stop. */
  stopped?: Promise<void>;
  /** Resolves stop() once the socket closes. */
  closed: Promise<void>;
  markClosed: () => void;
};

type GetToken = () => Promise<{ token: string } | RateLimited>;

/**
 * A socket opened before the user taps the mic (useDictation's prewarm), so
 * dictation doesn't wait for a token and a connection. There's one for the
 * tab, and any message box can take it.
 */
let warmSocket: { connection: Promise<WebSocket>; expiresAt: number } | null =
  null;

type Audio = {
  context: AudioContext;
  /** Resolves once the context can run the worklet. */
  loaded: Promise<void>;
};

/**
 * An audio context with the worklet loaded, made by prewarm so a tap doesn't
 * wait for it. There's one for the tab, and it stays suspended until a
 * start() takes it.
 */
let warmAudio: Audio | null = null;

function makeAudio(): Audio {
  const context = new AudioContext();
  const loaded = loadWorklet(context);
  // start() reports a failed load. A warm context nobody takes reports none.
  loaded.catch(() => {});
  return { context, loaded };
}

async function loadWorklet(context: AudioContext) {
  const moduleUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "text/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

/** The warm audio context if there's one, or else a new one. */
function takeAudio() {
  const warm = warmAudio;
  warmAudio = null;
  if (warm && warm.context.state !== "closed") return warm;
  return makeAudio();
}

/** Gets a token from convex/dictation.ts and opens a socket with it. */
async function connect(getToken: GetToken) {
  const { token } = throwIfRefused(await getToken());
  const socket = new WebSocket(LISTEN_URL, ["bearer", token]);
  socket.binaryType = "arraybuffer";
  return socket;
}

/**
 * Makes the tab's warm audio context and opens its warm socket, unless
 * they're there already.
 */
function warmUp(getToken: GetToken) {
  if (!warmAudio) {
    warmAudio = makeAudio();
    // Made outside a tap, it may start running, and an idle running context
    // keeps the speakers busy.
    void warmAudio.context.suspend().catch(() => {});
  }
  if (warmSocket && warmSocket.expiresAt > Date.now()) return;
  const entry = {
    connection: connect(getToken),
    expiresAt: Date.now() + WARM_SOCKET_MS,
  };
  warmSocket = entry;
  entry.connection.then(
    (socket) => {
      // Closed unless a dictation takes it first.
      const timer = window.setTimeout(() => {
        if (warmSocket !== entry) return;
        warmSocket = null;
        socket.close();
      }, WARM_SOCKET_MS);
      socket.addEventListener("close", () => {
        window.clearTimeout(timer);
        if (warmSocket === entry) warmSocket = null;
      });
    },
    // A refused or failed warm-up shows nothing. The tap that follows
    // tries again and shows why.
    () => {
      if (warmSocket === entry) warmSocket = null;
    },
  );
}

/** The warm socket if there's a live one, or else a new one. */
async function takeSocket(getToken: GetToken) {
  const warm = warmSocket;
  warmSocket = null;
  if (warm && warm.expiresAt > Date.now()) {
    const socket = await warm.connection.catch(() => null);
    if (socket && isLive(socket)) return socket;
  }
  return connect(getToken);
}

/** Whether a socket is open or still opening. */
function isLive(socket: WebSocket) {
  return (
    socket.readyState === WebSocket.CONNECTING ||
    socket.readyState === WebSocket.OPEN
  );
}

const DICTATED_KEY = "a8:dictated";

/**
 * Whether this browser has dictated before. Only then does prewarm open a
 * socket, so people who never dictate don't use up the dictation limits.
 */
function hasDictated() {
  try {
    return localStorage.getItem(DICTATED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDictated() {
  try {
    localStorage.setItem(DICTATED_KEY, "1");
  } catch {
    // Without storage, every dictation starts cold.
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Dictation into any text box. start() asks for the system default mic and
 * streams it to Deepgram. Words come back through the callbacks. stop() asks
 * Deepgram for the last words and resolves once they arrive, or after
 * FINAL_WORDS_TIMEOUT_MS. A socket still connecting gets until
 * CONNECT_TIMEOUT_MS to open first, so the audio held for it isn't lost.
 * cancel() drops the dictation at once, with no more callbacks.
 *
 * prewarm() opens a socket and loads the audio worklet ahead of start(), so
 * a tap that follows within WARM_SOCKET_MS waits only for the mic. It does
 * nothing in a hidden tab, or in a browser that has never dictated unless
 * `likely` is set. Without a warm socket, start() listens as soon as the mic
 * is on and holds the audio until its socket opens. The state is
 * "connecting" only while the mic starts.
 *
 * Once stop() is called the state is "stopping", which looks idle, while the
 * last words arrive.
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
  /** Set while a start() waits for the last dictation's last words. */
  const pendingStartRef = useRef<object | null>(null);
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });
  // Saves the DNS lookup from the first socket's wait.
  prefetchDNS("https://api.deepgram.com");

  // Frees the mic, the audio graph and the socket. Callbacks check that
  // their session is still the current one, so none fire after this.
  function tearDown(session: Session) {
    if (sessionRef.current === session) sessionRef.current = null;
    for (const timer of session.timers) window.clearTimeout(timer);
    window.clearTimeout(session.connectTimer);
    window.clearTimeout(session.silenceTimer);
    stopAudio(session);
    session.socket?.close();
    void session.connection?.then(
      (socket) => socket.close(),
      () => {},
    );
    session.markReady(false);
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
    if (!session.stopped) {
      setState("stopping");
      session.stopped = finishSession(session);
      // Someone who just dictated may dictate again, so the next one starts
      // warm even if it's tapped before this one's last words are in.
      if (!document.hidden) warmUp(getToken);
    }
    return session.stopped;
  }

  async function finishSession(session: Session) {
    // Stop the audio. Frames held while connecting still go once the socket
    // opens, so a socket still connecting gets as long as it would have to
    // open while listening.
    stopAudio(session);
    const opened = await Promise.race([
      session.ready,
      wait(CONNECT_TIMEOUT_MS).then(() => false),
    ]);
    if (!opened) {
      fail(session, "Dictation couldn't connect, so it stopped.");
      return;
    }
    const { socket } = session;
    if (sessionRef.current !== session || !socket) return;
    // Ask Deepgram to end the turn, which sends its last words, and close.
    socket.send(JSON.stringify({ type: "ForceEndTurn" }));
    socket.send(JSON.stringify({ type: "CloseStream" }));
    await Promise.race([session.closed, wait(FINAL_WORDS_TIMEOUT_MS)]);
    if (sessionRef.current !== session) return;
    tearDown(session);
    setState("idle");
  }

  async function start() {
    const previous = sessionRef.current;
    if ((previous && !previous.stopped) || pendingStartRef.current) return;
    // Taken and resumed before the first await, so it's part of the tap or
    // key press. Safari on iOS keeps a context resumed later suspended, and
    // the mic would send nothing.
    const audio = takeAudio();
    void audio.context.resume().catch(() => {});
    if (previous?.stopped) {
      const pending = {};
      pendingStartRef.current = pending;
      setState("connecting");
      await previous.stopped;
      // A cancel() or an unmount while it waited drops this start.
      if (pendingStartRef.current !== pending || sessionRef.current) {
        void audio.context.close().catch(() => {});
        return;
      }
      pendingStartRef.current = null;
    }
    let markClosed = () => {};
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    let markReady: (opened: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => {
      markReady = resolve;
    });
    const session: Session = {
      heldFrames: [],
      timers: [],
      lastText: "",
      opened: false,
      ready,
      markReady,
      closed,
      markClosed,
    };
    sessionRef.current = session;
    session.audio = audio.context;
    setState("connecting");
    rememberDictated();
    callbacksRef.current.onStart();
    const connection = takeSocket(getToken);
    session.connection = connection;

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
    if (endedWhileStarting(session)) return;
    try {
      await startAudio(session, audio, stream);
    } catch {
      fail(session, "Your mic couldn't start. Please try again.");
      return;
    }
    if (endedWhileStarting(session)) return;
    setState("listening");
    resetSilenceTimer(session);
    session.timers.push(
      window.setTimeout(() => void stopSession(session), MAX_SESSION_MS),
    );
    session.connectTimer = window.setTimeout(
      () => fail(session, "Dictation couldn't connect. Please try again."),
      CONNECT_TIMEOUT_MS,
    );

    let socket: WebSocket;
    try {
      socket = await connection;
      // A warm socket can close while the mic starts, such as while the
      // browser asks for mic access, so the session opens a new one.
      if (!isLive(socket)) socket = await connect(getToken);
    } catch (error) {
      fail(session, errorMessage(error));
      return;
    }
    if (sessionRef.current !== session) {
      socket.close();
      return;
    }
    session.socket = socket;
    const onOpen = () => {
      if (sessionRef.current !== session) return;
      session.opened = true;
      window.clearTimeout(session.connectTimer);
      for (const frame of session.heldFrames) socket.send(frame);
      session.heldFrames = [];
      session.markReady(true);
    };
    socket.onmessage = (event) => {
      if (sessionRef.current !== session) return;
      const result = parseResult(event.data);
      if (!result) return;
      if (result.text !== "" && result.text !== session.lastText) {
        resetSilenceTimer(session);
      }
      session.lastText = result.isFinal ? "" : result.text;
      if (result.isFinal) {
        callbacksRef.current.onInterim("");
        if (result.text !== "") callbacksRef.current.onFinal(result.text);
      } else {
        callbacksRef.current.onInterim(result.text);
      }
    };
    socket.onclose = () => {
      session.markClosed();
      // A close we didn't ask for. A stop asks for one only once the socket
      // is open.
      if (sessionRef.current !== session) return;
      if (session.stopped && session.opened) return;
      fail(
        session,
        session.opened
          ? "Dictation lost its connection, so it stopped."
          : "Dictation couldn't connect. Please try again.",
      );
    };
    if (socket.readyState === WebSocket.OPEN) onOpen();
    else socket.onopen = onOpen;
  }

  // True, after tearing the session down, if it was stopped or cancelled
  // while the mic or the audio graph was starting.
  function endedWhileStarting(session: Session) {
    if (sessionRef.current === session && !session.stopped) return false;
    const stopped = sessionRef.current === session;
    tearDown(session);
    if (stopped) setState("idle");
    return true;
  }

  // Connects the mic to the worklet. The worklet sends each frame once the
  // socket is open, and holds frames until then. It stops recording once
  // stop() asks for the last words.
  async function startAudio(
    session: Session,
    { context: audio, loaded }: Audio,
    stream: MediaStream,
  ) {
    await loaded;
    const source = audio.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audio, "pcm16-frames");
    worklet.port.onmessage = (
      event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>,
    ) => {
      if (sessionRef.current !== session || session.stopped) return;
      if (session.opened) session.socket?.send(event.data.pcm);
      else session.heldFrames.push(event.data.pcm);
      setLevel(levelFromRms(event.data.rms));
    };
    // Some browsers only run a node connected to the speakers. The worklet
    // writes nothing to its output, so it plays silence.
    source.connect(worklet).connect(audio.destination);
    for (const track of stream.getAudioTracks()) {
      track.onended = () =>
        fail(session, "The mic disconnected, so dictation stopped.");
    }
    await audio.resume();
  }

  const tearDownOnUnmount = useEffectEvent(() => {
    pendingStartRef.current = null;
    if (sessionRef.current) tearDown(sessionRef.current);
  });
  useEffect(() => () => tearDownOnUnmount(), []);

  return {
    state,
    level,
    /**
     * Gets the next start() ready, unless a dictation is running. Set
     * `likely` when the user is reaching for the mic.
     */
    prewarm: ({ likely = false }: { likely?: boolean } = {}) => {
      if (sessionRef.current || document.hidden) return;
      if (!likely && !hasDictated()) return;
      warmUp(getToken);
    },
    /** Starts a dictation, unless one is running. */
    start: () => void start(),
    /** Stops the dictation once its last words arrive, or after a wait. */
    stop: async () => {
      if (sessionRef.current) await stopSession(sessionRef.current);
    },
    /** Drops the dictation at once. No more callbacks fire. */
    cancel: () => {
      const pending = pendingStartRef.current;
      pendingStartRef.current = null;
      if (!sessionRef.current && !pending) return;
      if (sessionRef.current) tearDown(sessionRef.current);
      setState("idle");
    },
  };
}

/**
 * A Flux transcript message, or null for any other message. Each message
 * holds the whole turn so far, and the turn's last one is final.
 */
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
    message.type !== "TurnInfo"
  ) {
    return null;
  }
  const turn = message as { event?: string; transcript?: string };
  return {
    text: turn.transcript?.trim() ?? "",
    isFinal: turn.event === "EndOfTurn",
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
