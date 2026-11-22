import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function resolveAppBuildMeta(command: 'build' | 'serve'): {
  appVersion: string;
  buildTime: string;
  buildId: string;
  isProdBuild: boolean;
} {
  const metaPath = path.resolve(__dirname, 'build-meta.json');
  let deployCount = 1;
  try {
    if (fs.existsSync(metaPath)) {
      const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (typeof raw?.deployCount === 'number' && Number.isFinite(raw.deployCount) && raw.deployCount >= 1) {
        deployCount = raw.deployCount;
      }
    }
  } catch {}

  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  const hh = get('hour') === '24' ? '00' : get('hour');
  const buildTime = `${get('year')}${get('month')}${get('day')}${hh}${get('minute')}`;
  const buildId = `${buildTime}${get('second')}`;
  const appVersion = `Ver 1.${String(deployCount).padStart(3, '0')}`;
  return { appVersion, buildTime, buildId, isProdBuild: command === 'build' };
}

export default defineConfig(({ command }) => {
  const { appVersion, buildTime, buildId, isProdBuild } = resolveAppBuildMeta(command);

  return {
    base: '/',
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
      __APP_BUILD_ID__: JSON.stringify(buildId),
      __IS_PROD_BUILD__: JSON.stringify(isProdBuild),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          id: '/',
          name: "Hill's Blog",
          short_name: "HillsBlog",
          description: "실시간 위치와 사진을 연동하여 자전거 여행 기록과 라이딩 코스를 오프라인에서도 기록하는 블로그",
          theme_color: "#1c1917",
          background_color: "#1c1917",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/assets/aistudio/**', '**/pwa-*.png'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/__\//],
          ignoreURLParametersMatching: [/.*/],
          runtimeCaching: [
            {
              urlPattern: ({ sameOrigin, url }) =>
                sameOrigin &&
                !url.pathname.startsWith('/api/') &&
                !url.pathname.startsWith('/__/') &&
                /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|css|js)$/i.test(url.pathname),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-assets-cache-v1',
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'osm-tile-cache-v2',
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      allowedHosts: true,
    },
    preview: {
      allowedHosts: true,
    },
  };
});
