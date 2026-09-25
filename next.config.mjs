// `STATIC_EXPORT=true next build` writes a fully static site to out/ for GitHub Pages
// (see .github/workflows/deploy-pages.yml). Otherwise the app runs as a Next.js
// server, where /api/revalidate refreshes pages after each push.
const isStaticExport = process.env.STATIC_EXPORT === 'true';

const nextConfig = isStaticExport
  ? {
      output: 'export',
      // GitHub Pages serves project sites from /<repository>; the workflow passes that prefix.
      basePath: process.env.PAGES_BASE_PATH || '',
      // Emit hello-world/index.html rather than hello-world.html, which GitHub Pages
      // can't reliably serve next to the hello-world/ folder of prefetch data.
      trailingSlash: true,
    }
  : {};

export default nextConfig;
