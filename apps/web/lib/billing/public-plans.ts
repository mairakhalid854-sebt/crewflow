// Public monthly prices shown on the marketing pages. They must match the
// live Paddle catalog; update both together.
export const publicPlans = [
  {
    code: 'starter',
    description: 'For an owner-operator and a small crew.',
    monthlyPriceUsd: 29,
    name: 'Starter',
    seatLimit: 3,
  },
  {
    code: 'growth',
    description: 'For growing teams running several crews a day.',
    monthlyPriceUsd: 79,
    name: 'Growth',
    seatLimit: 10,
  },
  {
    code: 'pro',
    description: 'For established companies with a larger field team.',
    monthlyPriceUsd: 149,
    name: 'Pro',
    seatLimit: 30,
  },
] as const;

export const trialDays = 14;

export const includedFeatures = [
  'Customer records and service history',
  'Jobs, scheduling, and dispatch board',
  'Quotes customers approve online',
  'Invoices and work reports',
  'Team roles, skills, and time off',
  'Website intake form for new requests',
  'Email notifications to customers and crew',
] as const;
