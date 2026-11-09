/* global Deno */

import { PADDLE_ENVIRONMENTS } from '../_shared/paddle-environments.js';
import { createPaddleWebhookHandler } from '../_shared/paddle-webhook.js';

Deno.serve(createPaddleWebhookHandler(PADDLE_ENVIRONMENTS.live));
