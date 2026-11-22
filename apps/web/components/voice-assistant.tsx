'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { preconfirmNextAction } from '../lib/ui/confirm-action';
import { parseConfirmReply, parsePageAction } from '../lib/voice/voice-actions';
import {
  resolveVoiceCommand,
  type VoiceRole,
} from '../lib/voice/voice-commands';
import { parseFillCommand } from '../lib/voice/voice-fill';
import {
  type ParsedVoiceCommand,
  parseVoiceText,
  voiceHelpText,
} from '../lib/voice/voice-parser';
import { splitCommands } from '../lib/voice/voice-segments';
import styles from './voice-assistant.module.css';
import { findPageAction, pressControl, tryVoiceFill } from './voice-form-fill';

// CrewFlow360 voice control. Uses the browser's built-in speech recognition
// and speech synthesis, so there is no third-party account or cost. Off unless
// NEXT_PUBLIC_VOICE_CONTROL_ENABLED=true at build time.
const enabled = process.env.NEXT_PUBLIC_VOICE_CONTROL_ENABLED === 'true';

type RecognitionResultList = ArrayLike<
  ArrayLike<{ transcript: string }> & { isFinal: boolean }
>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult:
    | ((event: {
        readonly resultIndex: number;
        readonly results: RecognitionResultList;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as Record<string, unknown>;
  const candidate =
    scope['SpeechRecognition'] ?? scope['webkitSpeechRecognition'];
  return typeof candidate === 'function'
    ? (candidate as RecognitionConstructor)
    : undefined;
}

function speak(text: string, onEnd?: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.05;
    if (onEnd) {
      utterance.onend = () => onEnd();
      utterance.onerror = () => onEnd();
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // Spoken replies are optional; the text reply is always shown.
    onEnd?.();
  }
}

interface PendingPress {
  readonly element: HTMLElement;
  readonly label: string;
}

type MicAccess = 'granted' | 'blocked' | 'missing' | 'unknown';

async function permissionState(): Promise<PermissionState | undefined> {
  try {
    const status = await navigator.permissions.query({
      name: 'microphone',
    });
    return status.state;
  } catch {
    return undefined;
  }
}

// Asks the browser for the microphone before speech recognition starts. When
// the permission is still "ask", this shows the browser's Allow/Block popup.
// The test stream is closed right away; recognition opens its own.
async function requestMicrophone(): Promise<MicAccess> {
  if (typeof navigator === 'undefined') return 'unknown';
  if ((await permissionState()) === 'granted') return 'granted';
  if (!navigator.mediaDevices?.getUserMedia) return 'unknown';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return 'granted';
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'blocked';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'missing';
    }
    return 'unknown';
  }
}

const blockedMessage =
  'Microphone access is blocked for this site. Allow it, then tap "Try again". You can also type a command below.';

const errorMessages: Record<string, string> = {
  'not-allowed': blockedMessage,
  'service-not-allowed': blockedMessage,
  'audio-capture': 'No microphone was found. You can type a command instead.',
  network:
    'Voice needs an internet connection. You can type a command instead.',
};

const STOP_WORDS =
  /^(?:please )?(?:stop|stop listening|stop voice|turn off voice|mic off|that's all|that is all|bas)$/i;

// Common field names, so "add a new customer and first name Hassaan" splits
// even before the new customer form is on screen.
const FIELD_WORDS =
  /^(?:first name|last name|name|email|phone|mobile|address|street|city|state|zip|postal code|notes?|title|description|price|quantity|customer|service|priority|date|time)\b/i;

export function VoiceAssistant({ role }: { readonly role: VoiceRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const recognitionRef = useRef<Recognition | null>(null);
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [typed, setTyped] = useState('');
  const [supported, setSupported] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [checkingMic, setCheckingMic] = useState(false);
  const [pending, setPendingState] = useState<PendingPress | null>(null);
  // Speech results arrive in callbacks created on an earlier render, so
  // anything they read lives in refs.
  const pendingRef = useRef<PendingPress | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastFormRef = useRef<HTMLFormElement | null>(null);
  // True while hands-free listening is on: recognition restarts itself after
  // each pause until the user taps the mic or says "stop listening".
  const sessionRef = useRef(false);
  // True while the assistant is talking, so it does not hear itself.
  const speakingRef = useRef(false);
  // Replies from one sentence with several commands, shown together.
  const batchRef = useRef<string[] | null>(null);
  // Commands said after a page change ("add a new customer and first name
  // Hassaan") wait here until the new page has rendered.
  const queuedRef = useRef<string[]>([]);
  const navigatedRef = useRef(false);
  const runAllRef = useRef<(commands: readonly string[]) => void>(() => {});

  useEffect(() => {
    setSupported(Boolean(recognitionConstructor()));
    return () => {
      sessionRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!sessionRef.current) recognitionRef.current?.abort();
    pendingRef.current = null;
    setPendingState(null);
    lastFormRef.current = null;
    const queued = queuedRef.current;
    queuedRef.current = [];
    if (queued.length === 0) return;
    const timer = window.setTimeout(() => runAllRef.current(queued), 700);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (!enabled) return null;

  function setPending(next: PendingPress | null) {
    pendingRef.current = next;
    setPendingState(next);
  }

  function speakOut(text: string, onEnd?: () => void) {
    speakingRef.current = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      // A short gap so the tail of the reply is not heard as a command.
      window.setTimeout(() => {
        speakingRef.current = false;
        onEnd?.();
      }, 250);
    };
    window.setTimeout(finish, 1500 + text.length * 90);
    speak(text, finish);
  }

  function say(message: string, spoken = message) {
    if (batchRef.current) {
      batchRef.current.push(message);
      return;
    }
    setReply(message);
    speakOut(spoken);
  }

  function press(element: HTMLElement, label: string, confirmed = false) {
    setPending(null);
    if (!element.isConnected) {
      say('That button is no longer on the page.');
      return;
    }
    // Only a press the user just confirmed may skip the page's own prompt.
    if (confirmed) preconfirmNextAction();
    pressControl(element);
    say(`Done: ${label}.`);
  }

  function askToConfirm(element: HTMLElement, label: string) {
    setPending({ element, label });
    const question = `Are you sure you want to ${label.toLowerCase()}?`;
    if (batchRef.current) {
      batchRef.current.push(`${question} Say yes or no.`);
      return;
    }
    setReply(`${question} Say yes or no, or use the buttons.`);
    speakOut(`${question} Say yes or no.`, () => {
      if (!sessionRef.current) void startListening();
    });
  }

  function run(text: string) {
    const waiting = pendingRef.current;
    if (waiting) {
      const answer = parseConfirmReply(text);
      if (answer === 'yes') {
        press(waiting.element, waiting.label, true);
        return;
      }
      setPending(null);
      if (answer === 'no') {
        say('Cancelled. Nothing was changed.');
        return;
      }
    }

    const parsed = parseVoiceText(text);
    if (parsed?.command === 'help' || parsed?.command === 'goBack') {
      runNavigation(parsed);
      return;
    }

    const fill = tryVoiceFill(text, rootRef.current);
    if (fill?.ok) {
      if (fill.form) lastFormRef.current = fill.form;
      say(fill.message);
      return;
    }

    const action = findPageAction(text, rootRef.current, lastFormRef.current);
    if (action?.kind === 'press') {
      if (action.confirm) askToConfirm(action.element, action.label);
      else press(action.element, action.label);
      return;
    }

    if (parsed) {
      runNavigation(parsed);
      return;
    }

    // "open Hassaan Khan": a link or button with that text on this page.
    const openTarget = text
      .trim()
      .match(/^(?:please )?(?:open|show|view|go to)(?: the| my)? (.+)$/i)?.[1];
    if (openTarget) {
      const link = findPageAction(`click ${openTarget}`, rootRef.current, null);
      if (link?.kind === 'press' && !link.confirm) {
        press(link.element, link.label);
        return;
      }
    }

    if (action?.kind === 'message') {
      say(action.message);
      return;
    }
    if (fill) {
      say(fill.message);
      return;
    }
    say(
      `Sorry, I didn't understand "${text}". Say "help" to hear what I can do.`,
      "Sorry, I didn't understand that.",
    );
  }

  function runNavigation(parsed: ParsedVoiceCommand) {
    if (parsed.command === 'help') {
      say(voiceHelpText);
      return;
    }
    const action = resolveVoiceCommand(parsed, role);
    if (!action) {
      say('Your role cannot open that page.');
      return;
    }
    navigatedRef.current = true;
    if (action.kind === 'back') {
      say('Going back.');
      router.back();
      return;
    }
    say(`Opening ${action.label}.`);
    router.push(action.href);
  }

  // Does this piece of a sentence stand on its own as a command? Used to
  // split "first name Hassaan and last name Khan" without breaking values.
  function isCommand(piece: string): boolean {
    return (
      Boolean(parseVoiceText(piece)) ||
      Boolean(parsePageAction(piece)) ||
      Boolean(parseFillCommand(piece)) ||
      Boolean(tryVoiceFill(piece, rootRef.current, false)?.ok) ||
      FIELD_WORDS.test(piece)
    );
  }

  function runAll(commands: readonly string[]) {
    batchRef.current = [];
    navigatedRef.current = false;
    let index = 0;
    for (; index < commands.length; index += 1) {
      const command = commands[index];
      if (command) run(command);
      if (navigatedRef.current) break;
    }
    const replies = batchRef.current;
    batchRef.current = null;
    queuedRef.current = navigatedRef.current ? commands.slice(index + 1) : [];
    if (replies.length === 0) return;
    const text = replies.join(' ');
    setReply(text);
    if (pendingRef.current) {
      speakOut(replies.at(-1) ?? text, () => {
        if (!sessionRef.current) void startListening();
      });
    } else {
      speakOut(replies.length > 2 ? `Done, ${replies.length} steps.` : text);
    }
  }
  runAllRef.current = runAll;

  function handleUtterance(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setHeard(clean);
    if (STOP_WORDS.test(clean)) {
      stopListening();
      say('Stopped listening.');
      return;
    }
    runAll(splitCommands(clean, isCommand));
  }

  function stopListening() {
    sessionRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }

  function startRecognition() {
    const Constructor = recognitionConstructor();
    if (!Constructor || !sessionRef.current) return;
    const recognition = new Constructor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;
    let handled = -1;
    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      for (let index = event.resultIndex; index < results.length; index += 1) {
        const result = results[index];
        const transcript = result?.[0]?.transcript.trim() ?? '';
        if (!result || !transcript) continue;
        if (speakingRef.current) {
          // The assistant is talking: whatever was heard is its own voice.
          if (result.isFinal) handled = Math.max(handled, index);
          continue;
        }
        if (!result.isFinal) {
          setHeard(transcript);
        } else if (index > handled) {
          handled = index;
          handleUtterance(transcript);
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed'
      ) {
        setBlocked(true);
      }
      stopListening();
      setReply(
        errorMessages[event.error] ??
          'Voice is not available right now. You can type a command.',
      );
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      if (!sessionRef.current) {
        setListening(false);
        return;
      }
      // Browsers end recognition after a pause; keep listening.
      window.setTimeout(() => {
        if (sessionRef.current && recognitionRef.current === recognition) {
          startRecognition();
        }
      }, 250);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      stopListening();
    }
  }

  async function startListening() {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setSupported(false);
      setOpen(true);
      return;
    }
    if (sessionRef.current || checkingMic) return;
    setOpen(true);
    if (!pendingRef.current) setReply('');
    setHeard('');
    setCheckingMic(true);
    const access = await requestMicrophone();
    setCheckingMic(false);
    if (access === 'blocked') {
      setBlocked(true);
      setReply(blockedMessage);
      return;
    }
    if (access === 'missing') {
      setReply(errorMessages['audio-capture'] ?? '');
      return;
    }
    setBlocked(false);
    sessionRef.current = true;
    startRecognition();
  }

  function toggleListening() {
    if (sessionRef.current) stopListening();
    else void startListening();
  }

  function submitTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    handleUtterance(text);
  }

  return (
    <div className={styles.root} ref={rootRef}>
      {open ? (
        <section
          aria-label="Voice control"
          aria-live="polite"
          className={styles.panel}
        >
          <header className={styles.header}>
            <strong>Voice control</strong>
            <button
              aria-label="Close voice control"
              className={styles.close}
              onClick={() => {
                stopListening();
                setOpen(false);
              }}
              type="button"
            >
              ×
            </button>
          </header>
          {checkingMic ? (
            <p className={styles.hint}>Waiting for microphone permission…</p>
          ) : null}
          {listening ? (
            <p className={styles.listening}>
              Listening… keep talking. Say &quot;stop listening&quot; or tap the
              mic to stop.
            </p>
          ) : null}
          {heard ? (
            <p className={styles.heard}>
              <span>You said</span> “{heard}”
            </p>
          ) : null}
          {reply ? <p className={styles.reply}>{reply}</p> : null}
          {pending ? (
            <div
              aria-label="Confirm voice action"
              className={styles.confirm}
              role="alertdialog"
            >
              <p>
                Confirm: <strong>{pending.label}</strong>
              </p>
              <div className={styles.confirmButtons}>
                <button
                  className={styles.confirmYes}
                  onClick={() => press(pending.element, pending.label, true)}
                  type="button"
                >
                  Yes, {pending.label.toLowerCase()}
                </button>
                <button
                  className={styles.retry}
                  onClick={() => {
                    setPending(null);
                    say('Cancelled. Nothing was changed.');
                  }}
                  type="button"
                >
                  No
                </button>
              </div>
            </div>
          ) : null}
          {blocked ? (
            <div className={styles.hint}>
              <ol className={styles.steps}>
                <li>Click the lock icon left of the web address.</li>
                <li>Set Microphone to Allow.</li>
                <li>
                  On Windows or Mac, check privacy settings let the browser use
                  the microphone.
                </li>
              </ol>
              <button
                className={styles.retry}
                onClick={() => void startListening()}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : null}
          {!heard && !reply && !listening ? (
            <p className={styles.hint}>{voiceHelpText}</p>
          ) : null}
          {!supported ? (
            <p className={styles.hint}>
              This browser has no voice input. Use Chrome, Edge, or Safari for
              voice, or type below.
            </p>
          ) : null}
          <form className={styles.form} onSubmit={submitTyped}>
            <label className={styles.srOnly} htmlFor="voice-command-input">
              Type a command
            </label>
            <input
              autoComplete="off"
              id="voice-command-input"
              maxLength={300}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Type a command, e.g. open jobs"
              value={typed}
            />
            <button type="submit">Go</button>
          </form>
        </section>
      ) : null}
      <button
        aria-label={listening ? 'Stop listening' : 'Start voice control'}
        aria-pressed={listening}
        className={`${styles.mic} ${listening ? styles.micActive : ''}`}
        onClick={toggleListening}
        title={listening ? 'Stop listening' : 'Voice control'}
        type="button"
      >
        <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
          <path
            d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
