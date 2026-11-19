import { describe, expect, it } from 'vitest';

import { parseVoiceText } from './voice-parser';

describe('parseVoiceText', () => {
  it.each([
    ['Open jobs', 'jobs'],
    ['go to the dispatch board', 'dispatch'],
    ['Show my invoices.', 'invoices'],
    ['take me to settings page', 'settings'],
    ['dashboard', 'overview'],
    ['Create a new job', 'new-job'],
    ['add a new customer', 'new-customer'],
    ['open profit guard', 'profit'],
  ])('navigates for "%s"', (spoken, page) => {
    expect(parseVoiceText(spoken)).toEqual({ command: 'navigate', page });
  });

  it('filters jobs by status', () => {
    expect(parseVoiceText('Show scheduled jobs')).toEqual({
      command: 'searchJobs',
      status: 'scheduled',
    });
    expect(parseVoiceText('show me all in progress jobs')).toEqual({
      command: 'searchJobs',
      status: 'in_progress',
    });
  });

  it('searches jobs and customers', () => {
    expect(parseVoiceText('find job AC repair')).toEqual({
      command: 'searchJobs',
      query: 'ac repair',
    });
    expect(parseVoiceText('Search for customer John Smith')).toEqual({
      command: 'searchCustomers',
      query: 'john smith',
    });
  });

  it('understands back and help', () => {
    expect(parseVoiceText('Go back')).toEqual({ command: 'goBack' });
    expect(parseVoiceText('what can I say?')).toEqual({ command: 'help' });
  });

  it('returns nothing for unknown or oversized input', () => {
    expect(parseVoiceText('order a pizza')).toBeUndefined();
    expect(parseVoiceText('')).toBeUndefined();
    expect(parseVoiceText('open '.repeat(60))).toBeUndefined();
  });
});
