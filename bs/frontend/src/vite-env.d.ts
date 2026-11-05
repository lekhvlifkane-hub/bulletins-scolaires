/// <reference types="vite/client" />

/** Version de l'application, injectée par Vite depuis `package.json`. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** URL absolue de l'API. Vide = proxy Vite en dev, valeur par défaut adaptée en Tauri. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
