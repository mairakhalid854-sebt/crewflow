import { describe, expect, it } from 'vitest';

import { resolveVoiceCommand } from './voice-commands';

describe('resolveVoiceCommand', () => {
  it('navigates to a page the role can see', () => {
    expect(
      resolveVoiceCommand({ command: 'navigate', page: 'dispatch' }, 'office'),
    ).toEqual({ kind: 'navigate', href: '/app/dispatch', label: 'Dispatch' });
  });

  it('refuses pages outside the role', () => {
    expect(
      resolveVoiceCommand({ command: 'navigate', page: 'settings' }, 'office'),
    ).toBeUndefined();
    expect(
      resolveVoiceCommand(
        { command: 'navigate', page: 'customers' },
        'technician',
      ),
    ).toBeUndefined();
  });

  it('ignores unknown pages and inherited keys', () => {
    expect(
      resolveVoiceCommand({ command: 'navigate', page: 'admin' }, 'owner'),
    ).toBeUndefined();
    expect(
      resolveVoiceCommand({ command: 'navigate', page: 'toString' }, 'owner'),
    ).toBeUndefined();
  });

  it('builds job searches with only known statuses', () => {
    expect(
      resolveVoiceCommand(
        { command: 'searchJobs', query: ' AC  repair ', status: 'Scheduled' },
        'owner',
      ),
    ).toEqual({
      kind: 'navigate',
      href: '/app/jobs?q=AC+repair&status=scheduled',
      label: 'Jobs',
    });
    expect(
      resolveVoiceCommand(
        { command: 'searchJobs', status: 'deleted' },
        'owner',
      ),
    ).toEqual({ kind: 'navigate', href: '/app/jobs', label: 'Jobs' });
  });

  it('searches customers for office roles only', () => {
    expect(
      resolveVoiceCommand(
        { command: 'searchCustomers', query: 'John Smith' },
        'office',
      ),
    ).toEqual({
      kind: 'navigate',
      href: '/app/customers?q=John+Smith',
      label: 'Customers',
    });
    expect(
      resolveVoiceCommand(
        { command: 'searchCustomers', query: 'John' },
        'technician',
      ),
    ).toBeUndefined();
  });

  it('supports going back and rejects junk', () => {
    expect(resolveVoiceCommand({ command: 'goBack' }, 'owner')).toEqual({
      kind: 'back',
    });
    expect(resolveVoiceCommand('navigate', 'owner')).toBeUndefined();
    expect(resolveVoiceCommand(null, 'owner')).toBeUndefined();
  });
});
