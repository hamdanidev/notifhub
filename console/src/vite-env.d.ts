/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTIFHUB_API_URL?: string;
  readonly VITE_PLATFORM_CONSOLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
