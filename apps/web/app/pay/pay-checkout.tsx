'use client';

import { useEffect, useState } from 'react';

import { initializePaddle } from '@paddle/paddle-js';

import { paddleEnvironmentFromToken } from '../app/billing/paddle-checkout';

const TRANSACTION_ID = /^txn_[a-z\d]{26}$/;

type PayState = 'idle' | 'opening' | 'missing' | 'error';

export function PayCheckout({
  clientToken,
}: Readonly<{ clientToken: string | undefined }>) {
  const [state, setState] = useState<PayState>('idle');

  useEffect(() => {
    const transactionId = new URLSearchParams(window.location.search).get(
      '_ptxn',
    );
    const environment = paddleEnvironmentFromToken(clientToken);
    if (!transactionId || !TRANSACTION_ID.test(transactionId)) {
      setState('missing');
      return;
    }
    if (!environment || !clientToken) {
      setState('error');
      return;
    }

    setState('opening');
    // Paddle.js opens checkout for the `_ptxn` transaction in the URL as soon
    // as it is initialized on an approved domain.
    initializePaddle({ environment, token: clientToken }).catch(() =>
      setState('error'),
    );
  }, [clientToken]);

  if (state === 'missing') {
    return (
      <p>
        This payment link is incomplete. Open the link from your Paddle email
        again, or sign in and visit CrewFlow360 billing.
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p role="alert">
        Secure checkout could not be opened. Please try again or contact
        support@crewflow360.com.
      </p>
    );
  }
  return <p role="status">Opening secure checkout…</p>;
}
