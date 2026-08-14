import path from 'node:path';
import type { NextConfig } from 'next';

const developmentBackendOrigin = process.env.FRONTEND_DEV_BACKEND_ORIGIN ??
  'http://127.0.0.1:3000';
const isDevelopment = process.env.NODE_ENV === 'development';

try {
  const parsedBackendOrigin = new URL(developmentBackendOrigin);
  if (!['http:', 'https:'].includes(parsedBackendOrigin.protocol)) {
    throw new Error('unsupported protocol');
  }
} catch {
  throw new Error(
    'FRONTEND_DEV_BACKEND_ORIGIN muss ein vollständiger HTTP(S)-Ursprung sein.',
  );
}

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: path.resolve(process.cwd(), '..'),
  },
  ...(isDevelopment
    ? {
        async rewrites() {
          return {
            // Next-Seiten und -Assets gewinnen zuerst. Alle übrigen relativen
            // Pfade (API, Uploads, Favicons) laufen im Dev-Modus same-origin
            // über Express, damit Session- und CSRF-Cookies korrekt bleiben.
            afterFiles: [
              {
                source: '/:path*',
                destination: `${developmentBackendOrigin}/:path*`,
              },
            ],
          };
        },
      }
    : { output: 'export' }),
};

export default nextConfig;
