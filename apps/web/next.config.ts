import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dashboard imports the shared TypeScript in ../../packages/core directly.
  turbopack: {
    root: path.join(__dirname, '..', '..'),
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
