/** @type {import('next').NextConfig} */
const nextConfig = {
    // Static HTML export: Express serves the generated files from frontend/out,
    // so the backend, its session handling and its CSP stay unchanged.
    output: 'export',
    trailingSlash: false,
    reactStrictMode: true,
    poweredByHeader: false,
    productionBrowserSourceMaps: false,
    images: { unoptimized: true },
    eslint: { ignoreDuringBuilds: true },
    // shared/ holds code that runs on the server and in the browser (rental tariffs).
    experimental: { externalDir: true }
};

export default nextConfig;
