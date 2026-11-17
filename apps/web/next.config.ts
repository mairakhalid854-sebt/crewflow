import path from 'node:path';

import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), geolocation=(), microphone=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
] as const;

// Self-hosted production (Docker on the VPS) builds a standalone server.
// Vercel builds leave this unset.
const standalone = process.env.CREWFLOW_STANDALONE === '1';

const nextConfig: NextConfig = {
  ...(standalone
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: path.join(process.cwd(), '../..'),
      }
    : {}),
  headers() {
    return Promise.resolve([
      {
        headers: [...securityHeaders],
        source: '/:path*',
      },
    ]);
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@crewflow/types', '@crewflow/ui'],
};

export default nextConfig;
