/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional REST API base URL for remote data (scenarios, financial facts). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
