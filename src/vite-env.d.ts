/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_DIGITRANSIT_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
