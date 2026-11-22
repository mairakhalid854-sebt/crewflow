// Browser side of voice form filling: finds the fillable fields on the open
// page, matches the spoken field name to a label, and sets the value the same
// way typing would, so React forms see the change. It never submits a form.

import {
  matchControl,
  matchDestructiveControl,
  needsConfirmation,
  parsePageAction,
} from '../lib/voice/voice-actions';
import {
  matchField,
  matchLeadingField,
  normalizeSpokenValue,
  parseFillCommand,
} from '../lib/voice/voice-fill';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIPPED_TYPES = new Set([
  'button',
  'file',
  'hidden',
  'image',
  'password',
  'reset',
  'submit',
]);

function labelText(field: Field): string {
  const label = field.labels?.[0];
  if (label) {
    const span = label.querySelector('span');
    const text =
      span && !span.contains(field) ? span.textContent : label.textContent;
    if (text?.trim()) return text.trim();
  }
  return (
    field.getAttribute('aria-label') ??
    field.getAttribute('placeholder') ??
    field.name.replace(/([a-z])([A-Z])/g, '$1 $2')
  ).trim();
}

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function pageFields(exclude: HTMLElement | null): Field[] {
  return Array.from(
    document.querySelectorAll<Field>('input, textarea, select'),
  ).filter(
    (field) =>
      !(field instanceof HTMLInputElement && SKIPPED_TYPES.has(field.type)) &&
      !field.disabled &&
      !(field instanceof HTMLInputElement && field.readOnly) &&
      !exclude?.contains(field) &&
      isVisible(field),
  );
}

// React tracks input values itself, so assign through the native setter and
// fire the events a real keystroke would.
function setNativeValue(field: Field, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  // Runs the prototype's value setter with the field as `this`.
  if (!Reflect.set(prototype, 'value', value, field)) field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChecked(field: HTMLInputElement, checked: boolean) {
  if (field.checked !== checked) field.click();
}

function selectOption(field: HTMLSelectElement, spoken: string): boolean {
  const target = spoken.toLowerCase().trim();
  const options = Array.from(field.options);
  const option =
    options.find((item) => item.text.toLowerCase().trim() === target) ??
    options.find((item) => item.value.toLowerCase() === target) ??
    options.find((item) => item.text.toLowerCase().startsWith(target)) ??
    options.find((item) => item.text.toLowerCase().includes(target));
  if (!option) return false;
  setNativeValue(field, option.value);
  return true;
}

function fieldType(field: Field): string {
  return field instanceof HTMLInputElement ? field.type : field.tagName;
}

export interface FillResult {
  readonly form?: HTMLFormElement | null;
  readonly message: string;
  readonly ok: boolean;
}

function fillField(field: Field, label: string, rawValue: string): FillResult {
  const name = label.replace(/\s*\*$/, '');
  if (field instanceof HTMLSelectElement) {
    return selectOption(field, rawValue)
      ? { message: `${name} set to ${rawValue}.`, ok: true }
      : { message: `"${rawValue}" is not a choice for ${name}.`, ok: false };
  }
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    const on = /^(yes|on|true|checked|tick|allow)$/i.test(rawValue.trim());
    setChecked(field, on);
    return { message: `${name} ${on ? 'checked' : 'unchecked'}.`, ok: true };
  }
  const value = normalizeSpokenValue(rawValue, fieldType(field));
  setNativeValue(field, value);
  field.focus();
  return { form: field.form, message: `${name}: ${value}`, ok: true };
}

// Returns undefined when the text is not a form command for this page, so the
// caller can try navigation instead.
export function tryVoiceFill(
  text: string,
  exclude: HTMLElement | null,
): FillResult | undefined {
  if (typeof document === 'undefined') return undefined;
  const fields = pageFields(exclude);
  if (fields.length === 0) return undefined;
  const labels = fields.map(labelText);

  const command = parseFillCommand(text);
  if (command) {
    const index = matchField(command.field, labels);
    const field = index === undefined ? undefined : fields[index];
    const label = index === undefined ? undefined : labels[index];
    if (field && label) {
      if (command.kind === 'clear') {
        if (field instanceof HTMLInputElement && field.type === 'checkbox') {
          setChecked(field, false);
        } else if (!(field instanceof HTMLSelectElement)) {
          setNativeValue(field, '');
        }
        return { message: `${label.replace(/\s*\*$/, '')} cleared.`, ok: true };
      }
      if (command.kind === 'check') {
        if (field instanceof HTMLInputElement && field.type === 'checkbox') {
          setChecked(field, command.checked);
          return {
            message: `${label} ${command.checked ? 'checked' : 'unchecked'}.`,
            ok: true,
          };
        }
        return undefined;
      }
      return fillField(field, label, command.value);
    }
  }

  const leading = matchLeadingField(text, labels);
  const field = leading ? fields[leading.index] : undefined;
  const label = leading ? labels[leading.index] : undefined;
  if (leading && field && label) return fillField(field, label, leading.value);

  if (command?.kind === 'fill') {
    return {
      message: `I couldn't find a "${command.field}" field on this page.`,
      ok: false,
    };
  }
  return undefined;
}

// ---- Buttons and links: save, click, edit, delete --------------------------

type Control = HTMLElement;

function controlText(control: Control): string {
  const text =
    control instanceof HTMLInputElement
      ? control.value
      : (control.innerText || control.textContent || '').trim();
  return (text || control.getAttribute('aria-label') || control.title || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageControls(exclude: HTMLElement | null): Control[] {
  return Array.from(
    document.querySelectorAll<Control>(
      'button, a[href], [role="button"], input[type="submit"], input[type="button"]',
    ),
  ).filter(
    (control) =>
      !exclude?.contains(control) &&
      !(control as HTMLButtonElement).disabled &&
      control.getAttribute('aria-disabled') !== 'true' &&
      isVisible(control) &&
      controlText(control).length > 0,
  );
}

function submitButtonOf(form: HTMLFormElement): Control | undefined {
  const buttons = Array.from(
    form.querySelectorAll<HTMLElement>(
      'button[type="submit"], button:not([type]), input[type="submit"]',
    ),
  ).filter(
    (button) => isVisible(button) && !(button as HTMLButtonElement).disabled,
  );
  return (
    buttons.find((button) => button.classList.contains('primary-button')) ??
    buttons.find((button) => !needsConfirmation(controlText(button))) ??
    buttons[0]
  );
}

function formToSave(
  exclude: HTMLElement | null,
  lastForm: HTMLFormElement | null,
): HTMLFormElement | undefined {
  if (lastForm?.isConnected && isVisible(lastForm)) return lastForm;
  const active = document.activeElement;
  if (active instanceof HTMLElement && !exclude?.contains(active)) {
    const form = active.closest('form');
    if (form) return form;
  }
  return Array.from(document.querySelectorAll('form')).find(
    (form) =>
      !exclude?.contains(form) &&
      isVisible(form) &&
      pageFields(exclude).some((field) => form.contains(field)) &&
      submitButtonOf(form) !== undefined,
  );
}

export type PageActionResult =
  | {
      readonly kind: 'press';
      readonly element: Control;
      readonly label: string;
      readonly confirm: boolean;
    }
  | { readonly kind: 'message'; readonly message: string };

export function findPageAction(
  text: string,
  exclude: HTMLElement | null,
  lastForm: HTMLFormElement | null,
): PageActionResult | undefined {
  if (typeof document === 'undefined') return undefined;
  const command = parsePageAction(text);
  if (!command) return undefined;

  if (command.kind === 'save') {
    const form = formToSave(exclude, lastForm);
    const button = form ? submitButtonOf(form) : undefined;
    if (!button) {
      return { kind: 'message', message: 'There is no form to save here.' };
    }
    const label = controlText(button);
    return {
      confirm: needsConfirmation(label),
      element: button,
      kind: 'press',
      label,
    };
  }

  const controls = pageControls(exclude);
  const texts = controls.map(controlText);

  if (command.kind === 'delete') {
    const index = matchDestructiveControl(command.verb, command.target, texts);
    const element = index === undefined ? undefined : controls[index];
    if (!element || index === undefined) {
      return {
        kind: 'message',
        message: `There is no ${command.verb} button on this page. Open the record first.`,
      };
    }
    return { confirm: true, element, kind: 'press', label: texts[index] ?? '' };
  }

  if (command.kind === 'edit') {
    const editable = controls
      .map((control, index) => ({ control, text: texts[index] ?? '' }))
      .filter(({ text: label }) => /^(edit|update|change)\b/i.test(label));
    const index = command.target
      ? matchControl(
          command.target,
          editable.map(({ text: label }) => label.replace(/^\w+\s*/, '')),
        )
      : 0;
    const match = index === undefined ? undefined : editable[index];
    if (!match) {
      return { kind: 'message', message: 'There is nothing to edit here.' };
    }
    return {
      confirm: false,
      element: match.control,
      kind: 'press',
      label: match.text,
    };
  }

  const index = matchControl(command.target, texts);
  const element = index === undefined ? undefined : controls[index];
  if (!element || index === undefined) {
    return {
      kind: 'message',
      message: `I couldn't find "${command.target}" on this page.`,
    };
  }
  const label = texts[index] ?? command.target;
  return {
    confirm: needsConfirmation(label),
    element,
    kind: 'press',
    label,
  };
}

export function pressControl(element: Control): void {
  if (element.isConnected) element.click();
}
