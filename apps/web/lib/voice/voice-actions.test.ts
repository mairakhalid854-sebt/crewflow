import { describe, expect, it } from 'vitest';

import {
  matchControl,
  matchDestructiveControl,
  needsConfirmation,
  parseConfirmReply,
  parsePageAction,
} from './voice-actions';

describe('parsePageAction', () => {
  it.each(['save', 'Save.', 'submit', 'save changes', 'save the form', 'done'])(
    'saves for "%s"',
    (spoken) => {
      expect(parsePageAction(spoken)).toEqual({ kind: 'save' });
    },
  );

  it('parses click, edit, and delete', () => {
    expect(parsePageAction('click Create quote')).toEqual({
      kind: 'click',
      target: 'create quote',
    });
    expect(parsePageAction('press the filter button')).toEqual({
      kind: 'click',
      target: 'filter',
    });
    expect(parsePageAction('edit this customer')).toEqual({
      kind: 'edit',
      target: 'customer',
    });
    expect(parsePageAction('edit')).toEqual({ kind: 'edit', target: '' });
    expect(parsePageAction('Archive this job')).toEqual({
      kind: 'delete',
      target: 'job',
      verb: 'archive',
    });
    expect(parsePageAction('delete customer')).toEqual({
      kind: 'delete',
      target: 'customer',
      verb: 'delete',
    });
  });

  it('leaves navigation and form filling alone', () => {
    expect(parsePageAction('open jobs')).toBeUndefined();
    expect(parsePageAction('first name Hassaan')).toBeUndefined();
    expect(parsePageAction('send')).toBeUndefined();
  });
});

describe('parseConfirmReply', () => {
  it.each(['yes', 'Yes please', 'confirm', 'ok', 'haan', 'go ahead'])(
    '"%s" is yes',
    (spoken) => {
      expect(parseConfirmReply(spoken)).toBe('yes');
    },
  );
  it.each(['no', 'cancel', 'nahi', 'never mind'])('"%s" is no', (spoken) => {
    expect(parseConfirmReply(spoken)).toBe('no');
  });
  it('ignores other text', () => {
    expect(parseConfirmReply('open jobs')).toBeUndefined();
  });
});

describe('needsConfirmation', () => {
  it('flags destructive and outward actions', () => {
    expect(needsConfirmation('Archive job')).toBe(true);
    expect(needsConfirmation('Send and create customer link')).toBe(true);
    expect(needsConfirmation('Deactivate')).toBe(true);
    expect(needsConfirmation('Save customer')).toBe(false);
    expect(needsConfirmation('Create quote')).toBe(false);
  });
});

describe('matchControl', () => {
  const texts = ['Edit customer', 'Create quote', 'Filter', 'Archive customer'];
  it('finds buttons by their text', () => {
    expect(matchControl('create quote', texts)).toBe(1);
    expect(matchControl('filter', texts)).toBe(2);
    expect(matchControl('quote', texts)).toBe(1);
    expect(matchControl('pizza', texts)).toBeUndefined();
  });

  it('finds the destructive button for delete and archive', () => {
    expect(matchDestructiveControl('archive', 'customer', texts)).toBe(3);
    expect(matchDestructiveControl('delete', '', texts)).toBe(3);
    expect(matchDestructiveControl('void', '', texts)).toBeUndefined();
  });
});
