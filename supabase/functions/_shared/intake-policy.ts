export type IntakeStage =
  | 'address'
  | 'complete'
  | 'contact'
  | 'name'
  | 'problem'
  | 'service_confirmation';

export type IntakeStatus =
  'collecting' | 'escalated' | 'ready_for_human_review';

export type IntakeService = {
  description?: string;
  enabled: boolean;
  id: string;
  name: string;
  unitPriceCents?: number;
};

export type IntakeValues = {
  address?: string;
  contact?: { kind: 'email' | 'phone'; value: string };
  customerName?: string;
  problem?: string;
  serviceId?: string;
  serviceName?: string;
};

export type IntakeSession = {
  escalationReason?: string;
  stage: IntakeStage;
  status: IntakeStatus;
  values: IntakeValues;
};

export type IntakeTurn = {
  error?: string;
  question?: string;
  session: IntakeSession;
};

const questions: Record<Exclude<IntakeStage, 'complete'>, string> = {
  address: 'What is the full service address, including city, state, and ZIP?',
  contact: 'What email address or US phone number should the office use?',
  name: 'What is your full name?',
  problem: 'Please briefly describe the service problem you need help with.',
  service_confirmation:
    'Does that service match what you need? Reply yes or no.',
};

const injectionPatterns = [
  /ignore (all |any )?(previous|prior|system) instructions/i,
  /(show|reveal|print|return).{0,30}(system prompt|api key|secret|token)/i,
  /(another|other).{0,20}(tenant|company|customer|workspace).{0,20}(data|record|information)/i,
  /bypass.{0,20}(approval|authorization|policy|security)/i,
];

function normalizedInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function safeInput(input: string, maximumLength: number): string | undefined {
  const normalized = normalizedInput(input);
  return normalized && normalized.length <= maximumLength
    ? normalized
    : undefined;
}

function parseContact(input: string): IntakeValues['contact'] | undefined {
  const normalized = normalizedInput(input);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { kind: 'email', value: normalized.toLowerCase() };
  }

  const digits = normalized.replace(/\D/g, '');
  if (digits.length === 10) return { kind: 'phone', value: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith('1')) {
    return { kind: 'phone', value: `+${digits}` };
  }
  return undefined;
}

function tokens(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

export function matchIntakeService(
  problem: string,
  catalog: readonly IntakeService[],
): IntakeService | undefined {
  const problemTokens = tokens(problem);
  const ranked = catalog
    .filter((service) => service.enabled)
    .map((service) => {
      const serviceTokens = tokens(
        `${service.name} ${service.description ?? ''}`,
      );
      const score = [...problemTokens].filter((token) =>
        serviceTokens.has(token),
      ).length;
      return { score, service };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  if (!ranked[0] || ranked[0].score === ranked[1]?.score) return undefined;
  return ranked[0].service;
}

export function requestHumanTakeover(
  session: IntakeSession,
  reason = 'A human team member was requested.',
): IntakeTurn {
  return {
    question: 'A team member will continue this conversation.',
    session: { ...session, escalationReason: reason, status: 'escalated' },
  };
}

export function advanceIntakeSession(
  session: IntakeSession,
  reply: string,
  catalog: readonly IntakeService[],
): IntakeTurn {
  if (session.status !== 'collecting') return { session };

  const normalized = normalizedInput(reply);
  if (injectionPatterns.some((pattern) => pattern.test(normalized))) {
    return requestHumanTakeover(
      session,
      'The message requested restricted instructions, secrets, or cross-workspace data.',
    );
  }

  if (
    /^(human|agent|person|office|representative|call me)$/i.test(normalized)
  ) {
    return requestHumanTakeover(session);
  }

  if (session.stage === 'name') {
    const customerName = safeInput(reply, 120);
    if (!customerName || customerName.length < 2) {
      return {
        error: 'Enter a name between 2 and 120 characters.',
        question: questions.name,
        session,
      };
    }
    return {
      question: questions.contact,
      session: {
        stage: 'contact',
        status: 'collecting',
        values: { ...session.values, customerName },
      },
    };
  }

  if (session.stage === 'contact') {
    const contact = parseContact(reply);
    if (!contact) {
      return {
        error: 'Enter a valid email address or 10-digit US phone number.',
        question: questions.contact,
        session,
      };
    }
    return {
      question: questions.address,
      session: {
        stage: 'address',
        status: 'collecting',
        values: { ...session.values, contact },
      },
    };
  }

  if (session.stage === 'address') {
    const address = safeInput(reply, 300);
    if (!address || address.length < 10 || !/\d/.test(address)) {
      return {
        error: 'Enter a complete service address with a street number.',
        question: questions.address,
        session,
      };
    }
    return {
      question: questions.problem,
      session: {
        stage: 'problem',
        status: 'collecting',
        values: { ...session.values, address },
      },
    };
  }

  if (session.stage === 'problem') {
    const problem = safeInput(reply, 2000);
    if (!problem || problem.length < 10) {
      return {
        error: 'Describe the problem using at least 10 characters.',
        question: questions.problem,
        session,
      };
    }
    const service = matchIntakeService(problem, catalog);
    if (!service) {
      return requestHumanTakeover(
        { ...session, values: { ...session.values, problem } },
        'The request could not be matched confidently to one enabled catalog service.',
      );
    }
    return {
      question: `This looks like ${service.name}. ${questions.service_confirmation}`,
      session: {
        stage: 'service_confirmation',
        status: 'collecting',
        values: {
          ...session.values,
          problem,
          serviceId: service.id,
          serviceName: service.name,
        },
      },
    };
  }

  if (session.stage === 'service_confirmation') {
    if (/^(yes|y|correct|right)$/i.test(normalized)) {
      return {
        question:
          'Thanks. The office will review these details before any customer or quote is created.',
        session: {
          ...session,
          stage: 'complete',
          status: 'ready_for_human_review',
        },
      };
    }
    if (/^(no|n|wrong|incorrect)$/i.test(normalized)) {
      return requestHumanTakeover(
        session,
        'The customer rejected the deterministic service match.',
      );
    }
    return {
      error: 'Reply yes or no so the service match is explicit.',
      question: questions.service_confirmation,
      session,
    };
  }

  return { session };
}
