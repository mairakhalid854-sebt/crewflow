/* global Deno */

import { PADDLE_ENVIRONMENTS } from '../_shared/paddle-environments.js';
import { createPaddleReconcileHandler } from '../_shared/paddle-reconcile.js';

Deno.serve(createPaddleReconcileHandler(PADDLE_ENVIRONMENTS.live));
