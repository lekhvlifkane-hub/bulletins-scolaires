/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL absolue de l'API (ex. `http://localhost:4000`). Vide = proxy Vite en dev, auto en Tauri packagé. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
