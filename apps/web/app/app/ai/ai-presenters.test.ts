import { describe, expect, it } from 'vitest';

import {
  fieldLabel,
  humanize,
  proposedChangeLines,
  readableChangeLines,
} from './ai-presenters';

describe('AI operations presenters', () => {
  it('makes machine labels readable', () => {
    expect(humanize('dispatcher.assignment_proposed')).toBe(
      'dispatcher › assignment proposed',
    );
  });

  it('flattens nested exact changes without emitting JSON markup', () => {
    expect(
      proposedChangeLines({
        assignment: { technician: 'Hiba', urgent: true },
        slots: ['9:00 AM', '11:00 AM'],
      }),
    ).toEqual([
      { path: 'assignment.technician', value: 'Hiba' },
      { path: 'assignment.urgent', value: 'Yes' },
      { path: 'slots[1]', value: '9:00 AM' },
      { path: 'slots[2]', value: '11:00 AM' },
    ]);
  });

  it('shows an invoice draft proposal in plain money, percent and dates', () => {
    expect(
      readableChangeLines(
        {
          discountCents: { from: null, to: 0 },
          dueAt: { from: null, to: '2026-12-06T15:11:02.792156+00:00' },
          lineItems: {
            from: null,
            to: [
              {
                description: 'AC Repair',
                quantity: 1,
                taxable: true,
                unitPriceCents: 14_900,
              },
            ],
          },
          paymentUrl: { from: null, to: null },
          taxRateBps: { from: 100, to: 200 },
          totalCents: { from: null, to: 15_198 },
        },
        'America/Denver',
      ),
    ).toEqual([
      { path: 'Discount', value: '$0.00' },
      { path: 'Due date', value: 'Dec 6, 2026, 8:11 AM' },
      { path: 'Line items', value: 'AC Repair · 1 × $149.00 · taxable' },
      { path: 'Payment link', value: 'None' },
      { path: 'Tax rate', value: '2% (was 1%)' },
      { path: 'Total', value: '$151.98' },
    ]);
  });

  it('falls back to the flattened view for other shapes', () => {
    expect(readableChangeLines({ slots: ['9:00 AM'] }, 'UTC')).toEqual([
      { path: 'slots[1]', value: '9:00 AM' },
    ]);
  });

  it('labels camelCase fields for people', () => {
    expect(fieldLabel('unitPriceCents')).toBe('Unit price');
    expect(fieldLabel('scheduledStartAt')).toBe('Scheduled start');
    expect(fieldLabel('assignedMembershipId')).toBe('Technician');
  });

  it('bounds unusually large change sets', () => {
    const lines = proposedChangeLines(
      Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [`field${index}`, index]),
      ),
      10,
    );
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toEqual({
      path: 'More changes',
      value: 'Open the audit trace for the complete bounded payload.',
    });
  });
});
