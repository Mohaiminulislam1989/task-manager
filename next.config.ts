import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '200mb' } },
};

export default config;
