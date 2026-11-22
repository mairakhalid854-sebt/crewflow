'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  resolveVoiceCommand,
  type VoiceRole,
} from '../lib/voice/voice-commands';
import { parseVoiceText, voiceHelpText } from '../lib/voice/voice-parser';
import styles from './voice-assistant.module.css';

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
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
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

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Spoken replies are optional; the text reply is always shown.
  }
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
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
  'audio-capture': 'No microphone was found. You can type a command instead.',
  network:
    'Voice needs an internet connection. You can type a command instead.',
};

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

  useEffect(() => {
    setSupported(Boolean(recognitionConstructor()));
    return () => recognitionRef.current?.abort();
  }, []);

  useEffect(() => {
    recognitionRef.current?.abort();
  }, [pathname]);

  if (!enabled) return null;

  function run(text: string) {
    setHeard(text);
    const parsed = parseVoiceText(text);
    if (!parsed) {
      const message = `Sorry, I didn't understand "${text}". Say "help" to hear what I can do.`;
      setReply(message);
      speak("Sorry, I didn't understand that.");
      return;
    }
    if (parsed.command === 'help') {
      setReply(voiceHelpText);
      speak(voiceHelpText);
      return;
    }
    const action = resolveVoiceCommand(parsed, role);
    if (!action) {
      setReply('Your role cannot open that page.');
      speak('Sorry, your role cannot open that page.');
      return;
    }
    if (action.kind === 'back') {
      setReply('Going back.');
      speak('Going back.');
      router.back();
      return;
    }
    setReply(`Opening ${action.label}.`);
    speak(`Opening ${action.label}.`);
    router.push(action.href);
  }

  async function listen() {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setSupported(false);
      setOpen(true);
      return;
    }
    if (listening) {
      recognitionRef.current?.abort();
      return;
    }
    if (checkingMic) return;
    setOpen(true);
    setReply('');
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
    const recognition = new Constructor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      const transcript = results
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();
      setHeard(transcript);
      if (results.at(-1)?.isFinal && transcript) run(transcript);
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed'
      ) {
        setBlocked(true);
      }
      setReply(
        errorMessages[event.error] ??
          'Voice is not available right now. You can type a command.',
      );
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function submitTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typed.trim();
    if (!text) return;
    recognitionRef.current?.abort();
    setTyped('');
    run(text);
  }

  return (
    <div className={styles.root}>
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
                recognitionRef.current?.abort();
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
          {listening ? <p className={styles.listening}>Listening…</p> : null}
          {heard ? (
            <p className={styles.heard}>
              <span>You said</span> “{heard}”
            </p>
          ) : null}
          {reply ? <p className={styles.reply}>{reply}</p> : null}
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
                onClick={() => void listen()}
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
              maxLength={200}
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
        onClick={() => void listen()}
        title="Voice control"
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
