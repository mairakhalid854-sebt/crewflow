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
  outcome?: IntakeOutcome;
  sessionToken: string;
  stage: string;
  status: string;
  version: number;
};

type SlotOffer = {
  endsAt: string;
  id: string;
  startsAt: string;
  status: string;
};

type IntakeOutcome = {
  expiresAt?: string;
  jobStatus?: string;
  options?: SlotOffer[];
  quoteStatus?: string;
  quoteTotalCents?: number;
  serviceName?: string;
  state: string;
  timeZone?: string;
};

type IntakeResponse = {
  conversationId?: string;
  error?: string;
  expiresAt?: string;
  message?: string;
  jobStatus?: string;
  options?: SlotOffer[];
  quoteStatus?: string;
  quoteTotalCents?: number;
  selectionResult?: string;
  serviceName?: string;
  sessionToken?: string;
  stage?: string;
  state?: string;
  status?: string;
  timeZone?: string;
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
  const [selectingOfferId, setSelectingOfferId] = useState<string>();
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

  useEffect(() => {
    const conversationId = session?.conversationId;
    const sessionToken = session?.sessionToken;
    if (
      !endpoint ||
      !conversationId ||
      !sessionToken ||
      session?.status === 'collecting'
    ) {
      return;
    }

    const statusEndpoint = endpoint;
    let cancelled = false;
    async function refreshOutcome() {
      try {
        const result = await request(statusEndpoint, {
          action: 'status',
          conversationId,
          sessionToken,
        });
        if (!cancelled && result.ok && result.body.state) {
          setSession((current) =>
            current
              ? {
                  ...current,
                  outcome: {
                    expiresAt: result.body.expiresAt,
                    jobStatus: result.body.jobStatus,
                    options: result.body.options,
                    quoteStatus: result.body.quoteStatus,
                    quoteTotalCents: result.body.quoteTotalCents,
                    serviceName: result.body.serviceName,
                    state: result.body.state ?? 'awaiting_office',
                    timeZone: result.body.timeZone,
                  },
                }
              : current,
          );
        }
      } catch {
        // The durable session remains visible; the next bounded poll retries.
      }
    }

    void refreshOutcome();
    const pollId = window.setInterval(() => void refreshOutcome(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [
    endpoint,
    session?.conversationId,
    session?.sessionToken,
    session?.status,
  ]);

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

  async function selectSlot(offerId: string) {
    if (!endpoint || !session || selectingOfferId) return;
    setSelectingOfferId(offerId);
    try {
      const result = await request(endpoint, {
        action: 'select_slot',
        conversationId: session.conversationId,
        offerId,
        sessionToken: session.sessionToken,
      });
      if (!result.ok) {
        throw new Error(result.body.error ?? 'Unable to select this time.');
      }
      setSession((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                message(
                  'assistant',
                  result.body.message ??
                    'Your preferred time was sent to the office.',
                ),
              ],
              outcome: current.outcome
                ? { ...current.outcome, state: 'selection_pending_office' }
                : current.outcome,
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
                    : 'Unable to select this time.',
                  true,
                ),
              ],
            }
          : current,
      );
    } finally {
      setSelectingOfferId(undefined);
    }
  }

  function slotLabel(offer: SlotOffer, timeZone?: string) {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(offer.startsAt));
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

        {session?.outcome?.state === 'slots_available' ? (
          <section className={styles.slotPanel} aria-labelledby="slot-title">
            <p className={styles.slotKicker}>OFFICE-PREPARED OPTIONS</p>
            <h2 id="slot-title">Choose your preferred time</h2>
            <p>
              {session.outcome.serviceName ?? 'Service'} estimate:{' '}
              <strong>
                {new Intl.NumberFormat('en-US', {
                  currency: 'USD',
                  style: 'currency',
                }).format((session.outcome.quoteTotalCents ?? 0) / 100)}
              </strong>
              . The office sends the final quote separately.
            </p>
            <div className={styles.slotList}>
              {session.outcome.options
                ?.filter((offer) => offer.status === 'offered')
                .map((offer) => (
                  <button
                    disabled={Boolean(selectingOfferId)}
                    key={offer.id}
                    onClick={() => void selectSlot(offer.id)}
                    type="button"
                  >
                    <span>{slotLabel(offer, session.outcome?.timeZone)}</span>
                    <small>Select preference</small>
                  </button>
                ))}
            </div>
            <p className={styles.slotNotice}>
              Selecting a time does not book it. The office rechecks
              availability and confirms after quote acceptance.
            </p>
          </section>
        ) : null}

        {session?.outcome?.state === 'selection_pending_office' ? (
          <div className={styles.selectionState} role="status">
            Preferred time sent. Waiting for office confirmation and quote
            acceptance.
          </div>
        ) : null}

        {session?.outcome?.state === 'confirmed' ? (
          <div className={styles.selectionState} role="status">
            Your appointment time is confirmed by the office.
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
