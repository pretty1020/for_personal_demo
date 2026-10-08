import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const portalScript = existsSync('scripts/prepare-portal.mjs')
  ? 'scripts/prepare-portal.mjs'
  : 'data-quality/scripts/prepare-portal.mjs'

if (!existsSync('public/portal-index.html')) {
  const prepared = spawnSync('node', [portalScript], { stdio: 'inherit' })
  if ((prepared.status ?? 1) !== 0) {
    throw new Error('Portal build failed.')
  }
}

const PORTAL_PATHS = [
  '/workspace',
  '/workspace/:path*',
  '/setup',
  '/executive',
  '/users',
  '/formulas',
  '/capacity-plan',
  '/capacity-plan/:path*',
  '/forecasting',
  '/roster',
  '/roster/:path*',
  '/scheduling',
  '/scheduling/:path*',
  '/planning',
  '/planning/:path*',
  '/financial',
  '/financial/:path*',
  '/process-audit',
  '/governance',
  '/certified-data',
  '/anomaly-detection',
  '/planner/:path*',
  '/ideal-financial/:path*',
  '/advanced-staffing-capacity-plan',
  '/summary',
  '/dbe/:path*',
  '/choose',
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/portal-index.html' },
        { source: '/chunks/:path*', destination: '/capacity/chunks/:path*' },
      ],
      fallback: PORTAL_PATHS.map((source) => ({ source, destination: '/portal-index.html' })),
    }
  },
  webpack: (config) => {
    config.resolve ??= {}
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/capacity/embed.:ext(js|css)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
      {
        source: '/capacity/chunks/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
