// Customer-facing wording for the public quote, invoice, and work report
// pages. Spanish is fixed, human-written text, not machine translation.
// Business-written content (job titles, line items, report text) is always
// shown exactly as the business wrote it.

export type PublicLocale = 'en' | 'es';

/** Explicit ?lang= wins, then the browser's preferred languages, then English. */
export function resolvePublicLocale(
  langParam: string | string[] | undefined,
  acceptLanguage: string | null,
): PublicLocale {
  const explicit = Array.isArray(langParam) ? langParam[0] : langParam;
  if (explicit === 'es' || explicit === 'en') return explicit;

  const preferred = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='));
      return { q: q ? Number(q.slice(2)) : 1, tag: tag.toLowerCase() };
    })
    .filter((entry) => entry.tag && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of preferred) {
    if (tag === 'es' || tag.startsWith('es-')) return 'es';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}

export function dateLocale(locale: PublicLocale): string {
  return locale === 'es' ? 'es-US' : 'en-US';
}

const en = {
  common: {
    discount: 'Discount',
    languageLabel: 'Language',
    nonTaxable: 'non-taxable',
    preparedBy: (company: string) => `Prepared by ${company}`,
    subtotal: 'Subtotal',
    tax: 'Tax',
    total: 'Total',
  },
  invoice: {
    contactForPayment: (company: string) =>
      `Contact ${company} for payment instructions.`,
    download: (paid: boolean): string =>
      paid ? 'Download paid receipt' : 'Download invoice PDF',
    due: 'Due',
    for: (customer: string) => `For ${customer}`,
    kicker: (number: string) => `INVOICE ${number}`,
    leaveNotice:
      'You will leave CrewFlow360. The service business—not CrewFlow360—is the payee and controls that page.',
    outstanding: 'Outstanding',
    paid: (company: string) =>
      `This invoice is recorded as paid by ${company}.`,
    payButton: (company: string) => `Open ${company}'s payment page`,
    recordedPaid: 'Recorded paid',
    security:
      'Opening an external payment page never marks this invoice paid. CrewFlow360 updates the balance only after the business records or verifies receipt.',
    void: 'This invoice is void.',
  },
  quote: {
    accept: 'Accept quote',
    decline: 'Decline',
    error:
      'This quote could not be updated. It may be expired or already decided.',
    expires: 'Expires',
    kicker: (customer: string) => `QUOTE FOR ${customer}`,
    result: (result: string, company: string) =>
      `Quote ${result}. ${company} has been notified in CrewFlow360.`,
    security:
      'This secure link is only for this quote. CrewFlow360 does not collect your payment.',
    status: (status: string) => `This quote is ${status}.`,
    statusWord: (status: string) => status,
  },
  report: {
    approved: (company: string, date: string | null) =>
      `Reviewed and approved by ${company} on ${date ?? ''}.`,
    kicker: 'WORK REPORT',
    partsUsed: 'Parts used',
    preparedFor: (customer: string) => `Prepared for ${customer}`,
    recommendations: 'Recommendations',
    security: (company: string) =>
      `This secure page contains the approved report snapshot. Contact ${company} if any service detail needs clarification.`,
    serviceDate: (date: string) => `Service date: ${date}`,
    summary: 'Summary',
    workPerformed: 'Work performed',
  },
};

const quoteStatusEs: Readonly<Record<string, string>> = {
  accepted: 'aceptada',
  declined: 'rechazada',
  draft: 'en borrador',
  expired: 'vencida',
  sent: 'pendiente',
  void: 'anulada',
};

const es: typeof en = {
  common: {
    discount: 'Descuento',
    languageLabel: 'Idioma',
    nonTaxable: 'sin impuesto',
    preparedBy: (company) => `Preparado por ${company}`,
    subtotal: 'Subtotal',
    tax: 'Impuesto',
    total: 'Total',
  },
  invoice: {
    contactForPayment: (company) =>
      `Comuníquese con ${company} para recibir instrucciones de pago.`,
    download: (paid) =>
      paid ? 'Descargar recibo de pago' : 'Descargar factura en PDF',
    due: 'Vence el',
    for: (customer) => `Para ${customer}`,
    kicker: (number) => `FACTURA ${number}`,
    leaveNotice:
      'Saldrá de CrewFlow360. La empresa de servicio, no CrewFlow360, recibe el pago y controla esa página.',
    outstanding: 'Saldo pendiente',
    paid: (company) => `${company} registró esta factura como pagada.`,
    payButton: (company) => `Abrir la página de pago de ${company}`,
    recordedPaid: 'Pagos registrados',
    security:
      'Abrir una página de pago externa no marca esta factura como pagada. CrewFlow360 actualiza el saldo solo después de que la empresa registra o verifica el pago.',
    void: 'Esta factura fue anulada.',
  },
  quote: {
    accept: 'Aceptar cotización',
    decline: 'Rechazar',
    error:
      'No se pudo actualizar esta cotización. Es posible que haya vencido o que ya se haya respondido.',
    expires: 'Vence el',
    kicker: (customer) => `COTIZACIÓN PARA ${customer}`,
    result: (result, company) =>
      `Cotización ${quoteStatusEs[result] ?? result}. Se notificó a ${company} en CrewFlow360.`,
    security:
      'Este enlace seguro es solo para esta cotización. CrewFlow360 no cobra su pago.',
    status: (status) =>
      `Esta cotización está ${quoteStatusEs[status] ?? status}.`,
    statusWord: (status) => quoteStatusEs[status] ?? status,
  },
  report: {
    approved: (company, date) =>
      `Revisado y aprobado por ${company} el ${date ?? ''}.`,
    kicker: 'INFORME DE SERVICIO',
    partsUsed: 'Piezas utilizadas',
    preparedFor: (customer) => `Preparado para ${customer}`,
    recommendations: 'Recomendaciones',
    security: (company) =>
      `Esta página segura contiene el informe aprobado. Comuníquese con ${company} si necesita aclarar algún detalle del servicio.`,
    serviceDate: (date) => `Fecha del servicio: ${date}`,
    summary: 'Resumen',
    workPerformed: 'Trabajo realizado',
  },
};

export function publicCopy(locale: PublicLocale): typeof en {
  return locale === 'es' ? es : en;
}
