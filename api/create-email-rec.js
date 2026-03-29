// Vercel Serverless Function — Creates Gmail draft with full HTML email rec
// POST /api/create-email-rec
// Body: { subject, html } — returns { draftId, draftUrl }
// Requires env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER_EMAIL

const { google } = require("googleapis");

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { subject, html } = req.body;
  if (!subject || !html) return res.status(400).json({ error: "subject and html required" });

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER_EMAIL } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ error: "Gmail OAuth credentials not configured" });
  }

  try {
    const oauth2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const userEmail = GMAIL_USER_EMAIL || "me";

    // Build RFC 2822 MIME message
    const boundary = "boundary_" + Date.now();
    const mimeMessage = [
      `From: ${userEmail}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      subject, // plain text fallback
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      ``,
      html,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    // Base64url encode
    const encoded = Buffer.from(mimeMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const draft = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw: encoded },
      },
    });

    const draftId = draft.data.id;
    const messageId = draft.data.message?.id;
    const draftUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`;

    return res.status(200).json({
      success: true,
      draftId,
      messageId,
      draftUrl,
    });
  } catch (err) {
    console.error("Gmail draft creation failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
