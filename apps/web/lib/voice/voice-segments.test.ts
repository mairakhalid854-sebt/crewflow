import { describe, expect, it } from 'vitest';

import { splitCommands } from './voice-segments';

const known = (piece: string) =>
  /^(first name|last name|email|phone|save|go to|open|zip)\b/i.test(piece);

describe('splitCommands', () => {
  it('splits commands joined by and, then, and commas', () => {
    expect(
      splitCommands('first name put Hassaan and last name Khan', known),
    ).toEqual(['first name put Hassaan', 'last name Khan']);
    expect(
      splitCommands(
        'first name Hassaan, last name Khan then email is a at b dot com and then save',
        known,
      ),
    ).toEqual([
      'first name Hassaan',
      'last name Khan',
      'email is a at b dot com',
      'save',
    ]);
  });

  it('keeps "and" inside a value', () => {
    expect(splitCommands('last name Smith and Sons', known)).toEqual([
      'last name Smith and Sons',
    ]);
    expect(splitCommands('first name Hassaan and Ali and save', known)).toEqual(
      ['first name Hassaan and Ali', 'save'],
    );
  });

  it('returns a single command unchanged', () => {
    expect(splitCommands('open customers', known)).toEqual(['open customers']);
  });
});
