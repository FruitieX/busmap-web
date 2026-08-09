import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

const appVersion = process.env.npm_package_version ?? '0.0.0';

const appVersionAsset: PluginOption = {
  name: 'app-version-asset',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'app-version.json',
      source: `${JSON.stringify({ version: appVersion })}\n`,
    });
  },
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    appVersionAsset,
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.png'],
      manifest: {
        name: 'busmap',
        short_name: 'busmap',
        description: 'Real-time public transport vehicle tracker',
        theme_color: '#007ac9',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Keep app-version.json out of the precache so old clients can read the latest deployed version.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
            },
          },
          {
            urlPattern: /^https:\/\/api\.digitransit\.fi\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 1 day
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
