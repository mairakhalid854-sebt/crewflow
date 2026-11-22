// Splits one spoken sentence into several commands: "first name Hassaan and
// last name Khan then save". A piece only becomes its own command when it
// reads as one on this page; otherwise it stays part of the value before it,
// so "Smith and Sons" or "Main and 5th" are not broken up.

const JOINERS =
  /\s*(?:,|;|\band then\b|\bthen\b|\band also\b|\band\b|\balso\b|\bafter that\b|\bnext\b)\s*/i;

export function splitCommands(
  text: string,
  isCommand: (piece: string) => boolean,
): string[] {
  const parts: string[] = [];
  const joiners: string[] = [];
  let rest = text.trim();
  while (rest) {
    const match = JOINERS.exec(rest);
    if (!match || match.index === undefined) {
      parts.push(rest);
      break;
    }
    if (match.index === 0) {
      rest = rest.slice(match[0].length);
      continue;
    }
    parts.push(rest.slice(0, match.index));
    joiners.push(match[0]);
    rest = rest.slice(match.index + match[0].length);
  }

  const commands: string[] = [];
  parts.forEach((part, index) => {
    const piece = part.trim();
    if (!piece) return;
    const previous = commands.at(-1);
    if (previous === undefined || isCommand(piece)) {
      commands.push(piece);
    } else {
      commands[commands.length - 1] =
        `${previous}${joiners[index - 1] ?? ' '}${piece}`;
    }
  });
  return commands;
}
