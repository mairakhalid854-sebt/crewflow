import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@crewflow/types', '@crewflow/ui'],
};

export default nextConfig;
