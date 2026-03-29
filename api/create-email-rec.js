// Vercel Serverless Function — Creates Gmail draft via REST API (no googleapis dep)
const https = require("https");

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: "POST", headers };
    const req = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { subject, html } = req.body || {};
  if (!subject || !html) return res.status(400).json({ error: "subject and html required" });

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ error: "Gmail OAuth credentials not configured" });
  }

  try {
    // Step 1: Exchange refresh token for access token
    const tokenBody = `client_id=${encodeURIComponent(GMAIL_CLIENT_ID)}&client_secret=${encodeURIComponent(GMAIL_CLIENT_SECRET)}&refresh_token=${encodeURIComponent(GMAIL_REFRESH_TOKEN)}&grant_type=refresh_token`;
    const tokenResp = await httpsPost("https://oauth2.googleapis.com/token", { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(tokenBody) }, tokenBody);
    const tokenData = JSON.parse(tokenResp.body);
    if (!tokenData.access_token) {
      console.error("Token exchange failed:", tokenResp.body);
      return res.status(500).json({ error: "Token exchange failed: " + (tokenData.error_description || tokenData.error || "unknown") });
    }

    // Step 2: Build RFC 2822 MIME message
    const mime = [
      "Content-Type: text/html; charset=utf-8",
      "MIME-Version: 1.0",
      `Subject: ${subject}`,
      "",
      html
    ].join("\r\n");

    const encoded = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    // Step 3: Create Gmail draft via REST API
    const draftBody = JSON.stringify({ message: { raw: encoded } });
    const draftResp = await httpsPost("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      "Authorization": `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(draftBody)
    }, draftBody);

    const draftData = JSON.parse(draftResp.body);
    if (draftData.id) {
      const messageId = draftData.message?.id;
      const draftUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`;
      return res.status(200).json({ success: true, draftId: draftData.id, messageId, draftUrl });
    } else {
      console.error("Draft creation failed:", draftResp.body);
      return res.status(500).json({ error: "Draft creation failed: " + (draftData.error?.message || "unknown") });
    }
  } catch (err) {
    console.error("Gmail draft creation failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
