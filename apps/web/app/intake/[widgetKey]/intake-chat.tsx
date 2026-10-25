'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import styles from './intake.module.css';

type Message = {
  id: string;
  sender: 'assistant' | 'customer';
  text: string;
  validation?: boolean;
};

type IntakeSession = {
  conversationId: string;
  expiresAt: string;
  messages: Message[];
  sessionToken: string;
  stage: string;
  status: string;
  version: number;
};

type IntakeResponse = {
  conversationId?: string;
  error?: string;
  expiresAt?: string;
  message?: string;
  sessionToken?: string;
  stage?: string;
  status?: string;
  version?: number;
};

type IntakeChatProps = {
  endpoint?: string;
  widgetKey: string;
};

function message(sender: Message['sender'], text: string, validation = false) {
  return {
    id: crypto.randomUUID(),
    sender,
    text,
    validation,
  } satisfies Message;
}

async function request(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ body: IntakeResponse; ok: boolean; status: number }> {
  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const responseBody = (await response.json()) as IntakeResponse;
  return { body: responseBody, ok: response.ok, status: response.status };
}

export function IntakeChat({ endpoint, widgetKey }: IntakeChatProps) {
  const storageKey = useMemo(() => `crewflow:intake:${widgetKey}`, [widgetKey]);
  const [draft, setDraft] = useState('');
  const [fatalError, setFatalError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [session, setSession] = useState<IntakeSession>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!endpoint) {
        setFatalError('This service form is not configured yet.');
        setLoading(false);
        return;
      }

      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as IntakeSession;
          if (
            parsed.conversationId &&
            parsed.sessionToken &&
            Array.isArray(parsed.messages) &&
            new Date(parsed.expiresAt).getTime() > Date.now()
          ) {
            setSession(parsed);
            setLoading(false);
            return;
          }
        } catch {
          sessionStorage.removeItem(storageKey);
        }
      }

      try {
        const result = await request(endpoint, { action: 'start', widgetKey });
        if (
          !result.ok ||
          !result.body.conversationId ||
          !result.body.sessionToken ||
          !result.body.expiresAt ||
          !result.body.message
        ) {
          throw new Error(
            result.body.error ?? 'Unable to start the service request.',
          );
        }

        if (!cancelled) {
          setSession({
            conversationId: result.body.conversationId,
            expiresAt: result.body.expiresAt,
            messages: [message('assistant', result.body.message)],
            sessionToken: result.body.sessionToken,
            stage: result.body.stage ?? 'name',
            status: result.body.status ?? 'collecting',
            version: result.body.version ?? 1,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setFatalError(
            error instanceof Error
              ? error.message
              : 'Unable to start the service request.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [endpoint, storageKey, widgetKey]);

  useEffect(() => {
    if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session, storageKey]);

  async function send(value: string) {
    const customerMessage = value.trim();
    if (!endpoint || !session || !customerMessage || sending) return;

    setDraft('');
    setSending(true);
    setSession((current) =>
      current
        ? {
            ...current,
            messages: [
              ...current.messages,
              message('customer', customerMessage),
            ],
          }
        : current,
    );

    try {
      const result = await request(endpoint, {
        action: 'message',
        conversationId: session.conversationId,
        message: customerMessage,
        sessionToken: session.sessionToken,
      });
      if (!result.ok || !result.body.message) {
        throw new Error(result.body.error ?? 'Unable to send this message.');
      }
      const assistantText = result.body.error
        ? `${result.body.error} ${result.body.message}`
        : result.body.message;

      setSession((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                message('assistant', assistantText, Boolean(result.body.error)),
              ],
              stage: result.body.stage ?? current.stage,
              status: result.body.status ?? current.status,
              version: result.body.version ?? current.version,
            }
          : current,
      );
    } catch (error) {
      setSession((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                message(
                  'assistant',
                  error instanceof Error
                    ? error.message
                    : 'Unable to send this message.',
                  true,
                ),
              ],
            }
          : current,
      );
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  const collecting = session?.status === 'collecting';

  return (
    <div className={styles.shell}>
      <section className={styles.card} aria-labelledby="intake-title">
        <header className={styles.header}>
          <div className={styles.mark} aria-hidden="true">
            C
          </div>
          <div>
            <p className={styles.eyebrow}>CREWFLOW SERVICE REQUEST</p>
            <h1 id="intake-title">How can we help?</h1>
            <p>Share a few details. The office reviews every request.</p>
          </div>
        </header>

        <div className={styles.privacy}>
          No booking or price is confirmed by this chat. You can ask for a
          person at any time.
        </div>

        <div className={styles.transcript} aria-live="polite">
          {loading ? (
            <p className={styles.center}>Starting secure chat…</p>
          ) : null}
          {fatalError ? <p className={styles.fatal}>{fatalError}</p> : null}
          {session?.messages.map((item) => (
            <div
              className={`${styles.message} ${
                item.sender === 'customer' ? styles.customer : styles.assistant
              } ${item.validation ? styles.validation : ''}`}
              key={item.id}
            >
              <span>{item.sender === 'customer' ? 'You' : 'CrewFlow'}</span>
              <p>{item.text}</p>
            </div>
          ))}
          {sending ? (
            <p className={styles.typing}>CrewFlow is checking…</p>
          ) : null}
          <div ref={endRef} />
        </div>

        {session && !collecting ? (
          <div className={styles.complete} role="status">
            {session.status === 'ready_for_human_review'
              ? 'Request received. The office will review it before taking action.'
              : 'A team member will continue this request.'}
          </div>
        ) : null}

        {session && collecting ? (
          <form className={styles.composer} onSubmit={submit}>
            <label htmlFor="intake-reply">Your reply</label>
            <div>
              <input
                autoComplete="off"
                disabled={sending}
                id="intake-reply"
                maxLength={4000}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type your answer"
                required
                value={draft}
              />
              <button disabled={sending || !draft.trim()} type="submit">
                Send
              </button>
            </div>
            <button
              className={styles.human}
              disabled={sending}
              onClick={() => void send('human')}
              type="button"
            >
              Talk to a person
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
