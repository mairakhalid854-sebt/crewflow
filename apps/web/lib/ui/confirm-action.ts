// One place for "are you sure?" prompts on destructive buttons. Voice control
// shows its own confirmation first and then calls preconfirmNextAction(), so
// the user is not asked twice for the same click.

let preconfirmedUntil = 0;

export function preconfirmNextAction(): void {
  preconfirmedUntil = Date.now() + 3000;
}

export function confirmAction(message: string): boolean {
  if (Date.now() < preconfirmedUntil) {
    preconfirmedUntil = 0;
    return true;
  }
  return window.confirm(message);
}
