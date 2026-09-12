import "dotenv/config";
import express from "express";
import cors from "cors";
import { mpesaRouter } from "./routes/mpesa.js";
import { darajaService } from "./services/daraja.js";
import { getSupabaseAdmin } from "./services/supabase.js";
const app = express();
const port = process.env.PORT || 8080;
// Helper to mask PII (Kenyan phone numbers: e.g. 254712345678 -> 254712***678)
function maskPii(str) {
    return str.replace(/\b(254|0)([17]\d{2})(\d{3})(\d{3})\b/g, "$1$2***$4");
}
export const liveLogs = [];
export function logEvent(level, message, details, tag = "GENERAL") {
    let maskedDetails;
    if (details) {
        const raw = typeof details === "string" ? details : JSON.stringify(details, null, 2);
        maskedDetails = maskPii(raw);
    }
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        time: new Date().toISOString(),
        level,
        tag,
        message: maskPii(message),
        details: maskedDetails,
    };
    liveLogs.unshift(entry);
    if (liveLogs.length > 200)
        liveLogs.pop(); // keep last 200 entries
    console.log(`[${entry.time}] [${level}] [${tag}] ${entry.message}`, maskedDetails ? maskedDetails : "");
}
// Strict CORS: Restrict to configured origins
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:8080,https://ephphathakenya.co.ke")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""));
app.use(cors({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        const clean = origin.replace(/\/$/, "");
        if (allowedOrigins.includes(clean) || process.env.NODE_ENV !== "production") {
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Request logging middleware
app.use((req, _res, next) => {
    if (req.path !== "/health" && req.path !== "/api/mpesa/logs" && req.path !== "/favicon.ico") {
        logEvent("INFO", `${req.method} ${req.originalUrl}`, {
            ip: req.ip || req.headers["x-forwarded-for"],
            body: req.method === "POST" ? req.body : undefined,
        }, "HTTP");
    }
    next();
});
// Admin Authorization Guard for sensitive endpoints
function isAuthorizedAdmin(req) {
    if (process.env.NODE_ENV !== "production")
        return true;
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    if (!adminSecret)
        return true; // If not configured, allow with warning
    const key = req.headers["x-admin-key"] || req.query.key;
    return key === adminSecret;
}
// Health check endpoint
app.get("/health", (_req, res) => {
    const hasDarajaKey = Boolean(process.env.DARAJA_CONSUMER_KEY);
    const hasDarajaSecret = Boolean(process.env.DARAJA_CONSUMER_SECRET);
    const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const hasBrevoKey = Boolean(process.env.BREVO_API_KEY);
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime()) + "s",
        service: "ksl-payments-backend",
        environment: darajaService.environment,
        configuration: {
            daraja_consumer_key: hasDarajaKey ? "configured" : "MISSING",
            daraja_consumer_secret: hasDarajaSecret ? "configured" : "MISSING",
            supabase_service_role_key: hasSupabaseKey ? "configured" : "MISSING",
            brevo_api_key: hasBrevoKey ? "configured" : "MISSING",
            shortcode: darajaService.shortcode,
            till_number: darajaService.tillNumber,
            party_b: darajaService.partyB,
            transaction_type: darajaService.transactionType,
            callback_url: darajaService.callbackUrl || "NOT_SET",
            whatsapp_enabled: process.env.ENABLE_WHATSAPP === "true",
            admin_key_configured: Boolean(process.env.ADMIN_SECRET_KEY),
        },
        total_logged_events: liveLogs.length,
    });
});
// Diagnostics test route (Tests Daraja OAuth and Supabase connectivity)
app.get("/api/mpesa/test-diagnostics", async (req, res) => {
    if (!isAuthorizedAdmin(req)) {
        res.status(401).json({ error: "Unauthorized: Admin key required in production" });
        return;
    }
    const results = { timestamp: new Date().toISOString() };
    // 1. Daraja OAuth test
    try {
        const token = await darajaService.getAccessToken();
        results.daraja_oauth = {
            status: "SUCCESS",
            token_preview: `${token.substring(0, 8)}...`,
            environment: darajaService.environment,
            party_b: darajaService.partyB,
            transaction_type: darajaService.transactionType,
        };
        logEvent("SUCCESS", "Daraja OAuth self-test passed", results.daraja_oauth, "DIAGNOSTICS");
    }
    catch (err) {
        results.daraja_oauth = {
            status: "FAILED",
            error: err.message,
        };
        logEvent("ERROR", "Daraja OAuth self-test failed", err.message, "DIAGNOSTICS");
    }
    // 2. Supabase DB test
    try {
        const client = getSupabaseAdmin();
        const { count, error } = await client
            .from("payment_confirmations")
            .select("id", { count: "exact", head: true });
        if (error)
            throw error;
        results.supabase = {
            status: "SUCCESS",
            url: process.env.SUPABASE_URL,
            table: "payment_confirmations",
            records_count: count,
        };
        logEvent("SUCCESS", "Supabase DB self-test passed", results.supabase, "DIAGNOSTICS");
    }
    catch (err) {
        results.supabase = {
            status: "FAILED",
            error: err.message,
        };
        logEvent("ERROR", "Supabase DB self-test failed", err.message, "DIAGNOSTICS");
    }
    res.json(results);
});
// Clear logs endpoint (Protected in production)
app.post("/api/mpesa/clear-logs", (req, res) => {
    if (!isAuthorizedAdmin(req)) {
        res.status(401).json({ error: "Unauthorized: Admin key required in production" });
        return;
    }
    liveLogs.length = 0;
    logEvent("INFO", "Logs cleared by admin", undefined, "SYSTEM");
    res.json({ success: true, message: "Logs cleared" });
});
// Live log monitor endpoint (Protected in production)
app.get("/api/mpesa/logs", (req, res) => {
    if (!isAuthorizedAdmin(req)) {
        res.status(401).send(`<!DOCTYPE html>
<html><body style="font-family:sans-serif;background:#0f172a;color:#f87171;padding:40px;text-align:center;">
<h2>401 Unauthorized</h2><p style="color:#94a3b8">Admin authentication required to access live logs in production.<br>Pass <code>?key=YOUR_ADMIN_SECRET_KEY</code> in the URL.</p>
</body></html>`);
        return;
    }
    if (req.query.format === "json") {
        res.json(liveLogs);
        return;
    }
    const rows = liveLogs
        .map((l) => {
        const badgeColor = l.level === "ERROR"
            ? "background:#fee2e2;color:#b91c1c;border:1px solid #f87171"
            : l.level === "SUCCESS"
                ? "background:#dcfce7;color:#15803d;border:1px solid #4ade80"
                : l.level === "WARN"
                    ? "background:#fef3c7;color:#b45309;border:1px solid #fcd34d"
                    : "background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc";
        return `<tr style="border-bottom: 1px solid #334155;">
        <td style="padding:10px 12px;font-family:monospace;font-size:12px;color:#94a3b8;white-space:nowrap">${l.time.replace("T", " ").replace("Z", "")}</td>
        <td style="padding:10px 12px;white-space:nowrap">
          <span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:bold;${badgeColor}">${l.level}</span>
        </td>
        <td style="padding:10px 12px;font-size:12px;font-weight:600;color:#cbd5e1;white-space:nowrap">${l.tag || "SYS"}</td>
        <td style="padding:10px 12px;color:#f1f5f9;font-size:13px;font-weight:500">${l.message}</td>
        <td style="padding:10px 12px;font-family:monospace;font-size:11px;color:#93c5fd;max-width:350px;word-break:break-all">
          ${l.details ? `<pre style="margin:0;white-space:pre-wrap;background:#0f172a;padding:6px;border-radius:4px;border:1px solid #1e293b;">${l.details}</pre>` : ""}
        </td>
      </tr>`;
    })
        .join("");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>KSL Payments - Live System Monitor</title>
  <meta http-equiv="refresh" content="4">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 22px; color: #f8fafc; margin: 0; display: flex; align-items: center; gap: 10px; }
    .live-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 999px; color: #34d399; font-size: 11px; font-weight: bold; }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.3); } }
    .actions { display: flex; gap: 8px; }
    button, a.btn { padding: 8px 14px; background: #1e293b; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s; }
    button:hover, a.btn:hover { background: #334155; border-color: #64748b; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 12px; background: #1e293b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; border-bottom: 1px solid #334155; }
    .stats { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat-pill { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 6px 12px; font-size: 12px; color: #cbd5e1; }
    .stat-pill strong { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>
        KSL M-Pesa Live System Monitor
        <span class="live-badge"><span class="live-dot"></span> REAL-TIME (4s Auto-Refresh)</span>
      </h1>
      <p style="margin:4px 0 0 0;font-size:13px;color:#94a3b8">Shows incoming STK pushes, Daraja responses, callbacks, Supabase syncs, and errors (PII masked).</p>
    </div>
    <div class="actions">
      <a href="/api/mpesa/test-diagnostics" target="_blank" class="btn">Run Self-Test</a>
      <a href="/health" target="_blank" class="btn">View Health JSON</a>
      <button onclick="clearLogs()">Clear Logs</button>
    </div>
  </div>

  <div class="stats">
    <div class="stat-pill">Environment: <strong>${darajaService.environment}</strong></div>
    <div class="stat-pill">Shortcode: <strong>${darajaService.shortcode}</strong></div>
    <div class="stat-pill">PartyB / Till: <strong>${darajaService.partyB}</strong></div>
    <div class="stat-pill">Type: <strong>${darajaService.transactionType}</strong></div>
    <div class="stat-pill">Total Events: <strong>${liveLogs.length}</strong></div>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Level</th>
          <th>Category</th>
          <th>Event Summary</th>
          <th>Details / Payload</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" style="padding:32px;text-align:center;color:#64748b;font-size:14px">No events logged yet. Trigger an STK push on the website to see real-time output here!</td></tr>'}
      </tbody>
    </table>
  </div>

  <script>
    async function clearLogs() {
      if (confirm('Clear all logs?')) {
        await fetch('/api/mpesa/clear-logs', { method: 'POST' });
        window.location.reload();
      }
    }
  </script>
</body>
</html>`);
});
app.use("/api/mpesa", mpesaRouter);
app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
});
app.listen(port, () => {
    logEvent("INFO", `KSL Payments server running on port ${port}`, {
        port,
        nodeEnv: process.env.NODE_ENV,
        environment: darajaService.environment,
        partyB: darajaService.partyB,
    }, "SYSTEM");
});
