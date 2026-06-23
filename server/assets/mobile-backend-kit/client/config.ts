// The ONE place the app points at its backend. After you publish the backend
// (publish_app → it returns a live https URL), set API_BASE_URL to that URL.
// Until then it falls back to localhost for the dev server.
//
// You can also override at build time with EXPO_PUBLIC_API_URL.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
