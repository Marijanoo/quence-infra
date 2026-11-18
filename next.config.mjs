/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' } : {}),
  images: { unoptimized: true },
  turbopack: {},
  experimental: { workerThreads: false, cpus: 1 },
}

export default nextConfig
