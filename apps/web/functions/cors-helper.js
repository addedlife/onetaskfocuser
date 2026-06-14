const ALLOWED_ORIGINS = [
  "https://onetaskonly-app.web.app",
  "https://onetaskonly-app.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function allowedOrigin(origin = "") {
  if (!origin) return "*";
  return isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(origin = "", methods = "GET, POST, OPTIONS") {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
}

module.exports = { ALLOWED_ORIGINS, isAllowedOrigin, allowedOrigin, corsHeaders };
