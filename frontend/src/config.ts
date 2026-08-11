export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  (globalThis as { __API_BASE_URL?: string }).__API_BASE_URL?.trim() ||
  "http://localhost:3000";
