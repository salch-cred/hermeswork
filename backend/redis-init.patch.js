// Redis URL sanitization helper
// Strips accidental quotes or VARNAME= prefix from env values
// Usage: const cleanUrl = sanitizeEnvValue(process.env.UPSTASH_REDIS_REST_URL)
function sanitizeEnvValue(raw) {
  if (!raw) return '';
  let v = String(raw).trim();
  // Remove: VARNAME="value" or VARNAME=value formats
  v = v.replace(/^[A-Z_0-9]+=/, '');
  // Remove surrounding quotes
  v = v.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  return v.trim();
}
module.exports = { sanitizeEnvValue };
