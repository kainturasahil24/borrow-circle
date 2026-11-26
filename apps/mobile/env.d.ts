/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time, but the mobile
 * tsconfig restricts global type packages (`types: ["react"]`), so `process`
 * is declared here. Keep this file in sync with the EXPO_PUBLIC_ vars the app
 * reads (see .env.example).
 */
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string
    NODE_ENV?: 'development' | 'test' | 'production'
  }
}
