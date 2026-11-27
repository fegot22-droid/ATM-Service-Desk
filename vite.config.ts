import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const rawBase = process.env.VITE_BASE_PATH || '/';
const basePath = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

const pwaManifest = {
  id: basePath,
  name: 'ATM Service Desk',
  short_name: 'ATM Desk',
  description:
    'Справочник инженера банкоматов: коды ошибок GRG, Wincor CCDM и CMD-V4, схемы датчиков и инструкции.',
  theme_color: '#1d4ed8',
  background_color: '#f8fafc',
  display: 'standalone' as const,
  orientation: 'any' as const,
  start_url: basePath,
  scope: basePath,
  lang: 'ru',
  icons: [
    {
      src: `${basePath}pwa-192x192.png`,
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: `${basePath}pwa-512x512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: `${basePath}pwa-maskable-512x512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

export default defineConfig(() => {
  const hmrEnabled = process.env.DISABLE_HMR !== 'true';

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: pwaManifest,
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,json,md,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/aistudio\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'atm-assets-cache',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 90,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: hmrEnabled,
          type: 'module',
        },
      }),
      // When HMR is disabled (DISABLE_HMR=true), vite-plugin-pwa's dev SW registration
      // crashes calling import.meta.hot.send on a null transport. Serve the manifest
      // cleanly in dev without HMR injection, while keeping full SW in production builds.
      ...(!hmrEnabled
        ? [
            {
              name: 'dev-pwa-manifest-no-hmr',
              apply: 'serve' as const,
              configureServer(server: {
                middlewares: {
                  use: (
                    path: string,
                    handler: (
                      req: unknown,
                      res: {setHeader: (k: string, v: string) => void; end: (s: string) => void},
                    ) => void,
                  ) => void;
                };
              }) {
                server.middlewares.use('/manifest.webmanifest', (_req, res) => {
                  res.setHeader('Content-Type', 'application/manifest+json');
                  res.end(JSON.stringify(pwaManifest, null, 2));
                });
              },
              transformIndexHtml(html: string) {
                return html.includes('rel="manifest"')
                  ? html
                  : html.replace(
                      '</head>',
                      '<link rel="manifest" href="/manifest.webmanifest" /></head>',
                    );
              },
            },
          ]
        : []),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
