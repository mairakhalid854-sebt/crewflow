// Extends app.json with values that must not live in Git.
//
// GOOGLE_SERVICES_JSON is an EAS file environment variable (preview and
// production) holding the Firebase Android config. Android needs it to get an
// FCM device token, which Expo push notifications use. Local builds fall back
// to an untracked ./google-services.json when one exists.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const localGoogleServicesFile = './google-services.json';

function googleServicesFile(): string | undefined {
  const fromEas = process.env.GOOGLE_SERVICES_JSON;
  if (typeof fromEas === 'string' && fromEas.trim()) return fromEas.trim();
  return existsSync(join(__dirname, localGoogleServicesFile))
    ? localGoogleServicesFile
    : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const file = googleServicesFile();
  const base = config as ExpoConfig;
  if (!file) return base;
  return { ...base, android: { ...base.android, googleServicesFile: file } };
};
