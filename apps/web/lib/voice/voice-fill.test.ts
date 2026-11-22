import { describe, expect, it } from 'vitest';

import {
  matchField,
  matchLeadingField,
  normalizeSpokenValue,
  parseFillCommand,
} from './voice-fill';

const customerLabels = [
  'First name *',
  'Last name *',
  'Email',
  'Phone',
  'Street address',
  'Address line 2',
  'City',
  'State',
  'ZIP code',
  'Internal notes',
  'Email language',
  'Allow service and transactional emails',
];

describe('parseFillCommand', () => {
  it.each([
    ['Add a First name as "Hassaan"', 'first name', 'Hassaan'],
    ['set the last name to Khan.', 'last name', 'Khan'],
    ['first name is Hassaan', 'first name', 'Hassaan'],
    ['Phone number is 555 123 4567', 'phone number', '555 123 4567'],
    ['enter email as john at gmail dot com', 'email', 'john at gmail dot com'],
    ['city: Austin', 'city', 'Austin'],
    ['change the zip code field to 78701', 'zip code', '78701'],
  ])('fills for "%s"', (spoken, field, value) => {
    expect(parseFillCommand(spoken)).toEqual({ field, kind: 'fill', value });
  });

  it('clears and checks fields', () => {
    expect(parseFillCommand('clear the phone')).toEqual({
      field: 'phone',
      kind: 'clear',
    });
    expect(parseFillCommand('uncheck marketing emails')).toEqual({
      checked: false,
      field: 'marketing emails',
      kind: 'check',
    });
    expect(parseFillCommand('tick transactional emails')).toEqual({
      checked: true,
      field: 'transactional emails',
      kind: 'check',
    });
  });

  it('ignores navigation commands', () => {
    expect(parseFillCommand('go to customers')).toBeUndefined();
    expect(parseFillCommand('add a new customer')).toBeUndefined();
  });
});

describe('matchField', () => {
  it.each([
    ['first name', 0],
    ['last name', 1],
    ['email address', 2],
    ['phone number', 3],
    ['mobile', 3],
    ['address', 4],
    ['zip', 8],
    ['postal code', 8],
    ['notes', 9],
    ['email language', 10],
    ['transactional emails', 11],
  ])('matches "%s"', (spoken, index) => {
    expect(matchField(spoken, customerLabels)).toBe(index);
  });

  it('returns undefined when nothing matches', () => {
    expect(matchField('favourite colour', customerLabels)).toBeUndefined();
  });
});

describe('matchLeadingField', () => {
  it('splits a field name from its value', () => {
    expect(matchLeadingField('first name Hassaan', customerLabels)).toEqual({
      index: 0,
      value: 'Hassaan',
    });
    expect(matchLeadingField('Add ZIP code 78701', customerLabels)).toEqual({
      index: 8,
      value: '78701',
    });
    expect(matchLeadingField('phone 555 1234', customerLabels)).toEqual({
      index: 3,
      value: '555 1234',
    });
  });

  it('returns undefined without a value', () => {
    expect(matchLeadingField('open jobs', customerLabels)).toBeUndefined();
  });
});

describe('normalizeSpokenValue', () => {
  it('turns spoken emails and numbers into field text', () => {
    expect(normalizeSpokenValue('John at Gmail dot com', 'email')).toBe(
      'john@gmail.com',
    );
    expect(normalizeSpokenValue('(555) 123-4567', 'tel')).toBe('5551234567');
    expect(normalizeSpokenValue('Hassaan', 'text')).toBe('Hassaan');
  });
});
