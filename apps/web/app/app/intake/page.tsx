import Link from 'next/link';

import type { Database, Json } from '@crewflow/database';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { appUrl } from '../../../lib/app-url';
import { createClient } from '../../../lib/supabase/server';

import {
  ConfirmIntakeSlotButton,
  IntakeProposalButton,
  TakeoverButton,
  WidgetControls,
} from './intake-controls';
import styles from './intake.module.css';

export const dynamic = 'force-dynamic';

type IntakeMessage = Pick<
  Database['public']['Tables']['intake_messages']['Row'],
  | 'body'
  | 'conversation_id'
  | 'created_at'
  | 'id'
  | 'sender'
  | 'sequence_number'
>;

type SlotOffer = Pick<
  Database['public']['Tables']['intake_slot_offers']['Row'],
  'conversation_id' | 'ends_at' | 'job_id' | 'starts_at' | 'status'
>;

function formatDate(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

function object(value: Json): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function text(value: Json | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function contactLabel(value: Json | undefined): string | undefined {
  const contact = object(value ?? null);
  return text(contact.value);
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export default async function IntakeInboxPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [settingsResult, conversationsResult] = await Promise.all([
    supabase
      .from('tenant_settings')
      .select('intake_widget_enabled,intake_widget_key')
      .eq('tenant_id', context.tenantId)
      .single(),
    supabase
      .from('intake_conversations')
      .select(
        'id,status,stage,collected_values,escalation_reason,created_at,updated_at,expires_at,version',
      )
      .eq('tenant_id', context.tenantId)
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);

  if (
    settingsResult.error ||
    !settingsResult.data ||
    conversationsResult.error
  ) {
    throw new Error('Intake inbox could not be loaded.');
  }

  const conversations = conversationsResult.data ?? [];
  const conversationIds = conversations.map((conversation) => conversation.id);
  const messagesResult = conversationIds.length
    ? await supabase
        .from('intake_messages')
        .select('id,conversation_id,sender,body,sequence_number,created_at')
        .in('conversation_id', conversationIds)
        .order('sequence_number', { ascending: true })
    : { data: [], error: null };

  if (messagesResult.error)
    throw new Error('Intake messages could not be loaded.');

  const slotOffersResult = conversationIds.length
    ? await supabase
        .from('intake_slot_offers')
        .select('conversation_id,ends_at,job_id,starts_at,status')
        .in('conversation_id', conversationIds)
        .in('status', ['selected', 'confirmed'])
    : { data: [], error: null };
  if (slotOffersResult.error)
    throw new Error('Intake slot selections could not be loaded.');

  const slotByConversation = new Map<string, SlotOffer>();
  for (const offer of slotOffersResult.data ?? []) {
    slotByConversation.set(offer.conversation_id, offer);
  }

  const messagesByConversation = new Map<string, IntakeMessage[]>();
  for (const message of messagesResult.data ?? []) {
    const existing = messagesByConversation.get(message.conversation_id) ?? [];
    existing.push(message);
    messagesByConversation.set(message.conversation_id, existing);
  }

  const shareUrl = `${appUrl()}/intake/${settingsResult.data.intake_widget_key}`;

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">AI-assisted lead intake</p>
          <h1>Intake inbox</h1>
          <p>
            Review public service requests and step in whenever a customer needs
            a person.
          </p>
        </div>
      </header>

      {context.role === 'owner' ? (
        <WidgetControls
          enabled={settingsResult.data.intake_widget_enabled}
          shareUrl={shareUrl}
        />
      ) : null}

      <section className={styles.summary} aria-label="Intake summary">
        <div>
          <span>Needs attention</span>
          <strong>
            {
              conversations.filter((conversation) =>
                ['human_takeover', 'ready_for_human_review'].includes(
                  conversation.status,
                ),
              ).length
            }
          </strong>
        </div>
        <div>
          <span>Collecting</span>
          <strong>
            {
              conversations.filter(
                (conversation) => conversation.status === 'collecting',
              ).length
            }
          </strong>
        </div>
        <div>
          <span>Recent conversations</span>
          <strong>{conversations.length}</strong>
        </div>
      </section>

      {conversations.length ? (
        <div className={styles.inbox}>
          {conversations.map((conversation) => {
            const values = object(conversation.collected_values);
            const messages = messagesByConversation.get(conversation.id) ?? [];
            const selectedSlot = slotByConversation.get(conversation.id);
            return (
              <article className={styles.conversation} key={conversation.id}>
                <div className={styles.conversationHeader}>
                  <div>
                    <span
                      className={styles.status}
                      data-status={conversation.status}
                    >
                      {statusLabel(conversation.status)}
                    </span>
                    <h2>
                      {text(values.customerName) ?? 'New service request'}
                    </h2>
                    <p>Updated {formatDate(conversation.updated_at)}</p>
                  </div>
                  <div className={styles.conversationActions}>
                    {conversation.status === 'ready_for_human_review' ? (
                      <IntakeProposalButton conversationId={conversation.id} />
                    ) : null}
                    {['collecting', 'ready_for_human_review'].includes(
                      conversation.status,
                    ) ? (
                      <TakeoverButton conversationId={conversation.id} />
                    ) : null}
                  </div>
                </div>

                <dl className={styles.details}>
                  <div>
                    <dt>Contact</dt>
                    <dd>
                      {contactLabel(values.contact) ?? 'Not collected yet'}
                    </dd>
                  </div>
                  <div>
                    <dt>Service</dt>
                    <dd>{text(values.serviceName) ?? 'Not matched yet'}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{text(values.address) ?? 'Not collected yet'}</dd>
                  </div>
                  <div>
                    <dt>Problem</dt>
                    <dd>{text(values.problem) ?? 'Not collected yet'}</dd>
                  </div>
                </dl>

                {selectedSlot ? (
                  <section className={styles.selectedSlot}>
                    <div>
                      <p className={styles.kicker}>Customer-selected time</p>
                      <strong>
                        {formatDate(selectedSlot.starts_at, context.timeZone)}
                      </strong>
                      <span>
                        {selectedSlot.status === 'confirmed'
                          ? 'Confirmed and scheduled'
                          : 'Preference only — quote acceptance and office confirmation required'}
                      </span>
                      <Link href={`/app/jobs/${selectedSlot.job_id}`}>
                        Open job
                      </Link>
                    </div>
                    {selectedSlot.status === 'selected' ? (
                      <ConfirmIntakeSlotButton
                        conversationId={conversation.id}
                      />
                    ) : null}
                  </section>
                ) : null}

                {conversation.escalation_reason ? (
                  <p className={styles.escalation}>
                    <strong>Why office attention is needed:</strong>{' '}
                    {conversation.escalation_reason}
                  </p>
                ) : null}

                <details className={styles.transcript}>
                  <summary>
                    View transcript ({messages.length} messages)
                  </summary>
                  <div>
                    {messages.map((message) => (
                      <div
                        className={styles.transcriptMessage}
                        key={message.id}
                      >
                        <span>{statusLabel(message.sender)}</span>
                        <p>{message.body}</p>
                        <time dateTime={message.created_at}>
                          {formatDate(message.created_at, context.timeZone)}
                        </time>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No Intake conversations yet</h2>
          <p>
            {settingsResult.data.intake_widget_enabled
              ? 'Share the public link to receive the first service request.'
              : 'The owner can enable the public link when the service catalog is ready.'}
          </p>
        </section>
      )}
    </div>
  );
}
