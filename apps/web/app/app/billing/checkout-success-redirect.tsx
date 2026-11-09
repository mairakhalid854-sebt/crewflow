'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const REFRESH_INTERVAL_MS = 2500;
const MAX_REFRESHES = 24;

interface CheckoutSuccessRedirectProps {
  readonly isSandbox: boolean;
  /** Subscription status once Paddle has synced, otherwise null. */
  readonly syncedStatus: 'active' | 'trialing' | null;
}

/**
 * After Paddle checkout, waits for the webhook to sync the subscription and
 * then sends the owner to the dashboard, which celebrates the new plan.
 */
export function CheckoutSuccessRedirect({
  isSandbox,
  syncedStatus,
}: CheckoutSuccessRedirectProps) {
  const router = useRouter();
  const [refreshes, setRefreshes] = useState(0);
  const timedOut = refreshes >= MAX_REFRESHES;

  useEffect(() => {
    if (syncedStatus) {
      router.replace(`/app?welcome=${syncedStatus}`);
      return;
    }
    if (timedOut) return;
    const timer = window.setTimeout(() => {
      setRefreshes((count) => count + 1);
      router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [refreshes, router, syncedStatus, timedOut]);

  if (timedOut) {
    return (
      <p className="billing-checkout-success" role="status">
        {isSandbox ? 'Test checkout completed.' : 'Checkout completed.'} Paddle
        is still confirming your subscription. Refresh this page in a minute, or
        contact support@crewflow360.com if it does not update.
      </p>
    );
  }

  return (
    <p
      aria-live="polite"
      className="billing-checkout-success billing-checkout-syncing"
      role="status"
    >
      <span aria-hidden="true" className="billing-sync-spinner" />
      {syncedStatus
        ? 'All set! Taking you to your dashboard…'
        : 'Payment received. Finishing your setup…'}
    </p>
  );
}
