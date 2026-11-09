import { describe, expect, it } from 'vitest';

import { dateLocale, publicCopy, resolvePublicLocale } from './public-copy';

describe('resolvePublicLocale', () => {
  it('uses an explicit ?lang= first', () => {
    expect(resolvePublicLocale('es', 'en-US,en;q=0.9')).toBe('es');
    expect(resolvePublicLocale('en', 'es-MX,es;q=0.9')).toBe('en');
    expect(resolvePublicLocale(['es'], null)).toBe('es');
  });

  it('follows the browser language when no choice was made', () => {
    expect(resolvePublicLocale(undefined, 'es-US,es;q=0.9,en;q=0.8')).toBe(
      'es',
    );
    expect(resolvePublicLocale(undefined, 'en-US,es;q=0.5')).toBe('en');
    expect(resolvePublicLocale(undefined, 'fr-FR,es;q=0.7,en;q=0.6')).toBe(
      'es',
    );
  });

  it('respects quality values and ignores unsupported input', () => {
    expect(resolvePublicLocale(undefined, 'en;q=0.4,es;q=0.9')).toBe('es');
    expect(resolvePublicLocale('de', 'de-DE')).toBe('en');
    expect(resolvePublicLocale(undefined, null)).toBe('en');
    expect(resolvePublicLocale(undefined, 'es;q=0')).toBe('en');
  });
});

describe('publicCopy', () => {
  it('has Spanish for every English string', () => {
    const en = publicCopy('en');
    const es = publicCopy('es');
    for (const section of Object.keys(en) as (keyof typeof en)[]) {
      expect(Object.keys(es[section]).sort()).toEqual(
        Object.keys(en[section]).sort(),
      );
    }
  });

  it('renders natural Spanish for quotes, invoices, and reports', () => {
    const es = publicCopy('es');
    expect(es.quote.accept).toBe('Aceptar cotización');
    expect(es.quote.kicker('Ana López')).toBe('COTIZACIÓN PARA Ana López');
    expect(es.quote.result('accepted', 'ABC HVAC')).toBe(
      'Cotización aceptada. Se notificó a ABC HVAC en CrewFlow360.',
    );
    expect(es.quote.status('expired')).toBe('Esta cotización está vencida.');
    expect(es.invoice.payButton('ABC HVAC')).toBe(
      'Abrir la página de pago de ABC HVAC',
    );
    expect(es.report.workPerformed).toBe('Trabajo realizado');
  });

  it('formats dates with a US Spanish locale', () => {
    expect(
      new Intl.DateTimeFormat(dateLocale('es'), {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date('2026-11-10T12:00:00Z')),
    ).toBe('10 de noviembre de 2026');
    expect(dateLocale('en')).toBe('en-US');
  });
});
