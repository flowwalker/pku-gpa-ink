import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  ...(isGitHubPages ? {
    output: 'export' as const,
    basePath: '/pku-gpa-ink',
    assetPrefix: '/pku-gpa-ink',
    trailingSlash: true,
  } : {}),
};

export default nextConfig;
