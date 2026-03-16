// src/SessionLogger.js - User Session & Activity Logging
// Writes login events and page views to Firebase userLogs/ path
import { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, onValue, push, set } from "firebase/database";
// ---- SESSION LOGGING ----
export function logSession(user) {
  if (!user || !user.email) return;
  const uid = user.uid;
  const sessionRef = push(ref(db, "userLogs/" + uid + "/sessions"));
  set(sessionRef, {
    email: user.email,
    loginAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screen: window.innerWidth + "x" + window.innerHeight,
    platform: navigator.platform || "unknown"
  });
  set(ref(db, "userLogs/" + uid + "/profile"), {
    email: user.email,
    lastLogin: new Date().toISOString(),
    displayName: user.displayName || user.email.split("@")[0]
  });
}

export function logPageView(user, page) {
  if (!user || !user.uid) return;
  const pvRef = push(ref(db, "userLogs/" + user.uid + "/pageViews"));
  set(pvRef, { page, viewedAt: new Date().toISOString() });
}
// ---- ACTIVITY LOG PANEL (Admin Only) ----
export function ActivityLogPanel({ currentUserEmail }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = currentUserEmail === "daniel.p.roscoe@gmail.com";

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    const logsRef = ref(db, "userLogs");
    const unsub = onValue(logsRef, (snap) => {
      if (!snap.exists()) { setLogs([]); setLoading(false); return; }
      const data = snap.val();
      const entries = [];
      Object.keys(data).forEach(uid => {
        const u = data[uid];
        const profile = u.profile || {};
        if (u.sessions) {
          Object.values(u.sessions).forEach(s => {
            entries.push({ type: "login", email: s.email || profile.email || "unknown", time: s.loginAt, detail: (s.platform || "") + " | " + (s.screen || ""), userAgent: s.userAgent || "" });
          });
        }
        if (u.pageViews) {
          Object.values(u.pageViews).forEach(pv => {
            entries.push({ type: "pageview", email: profile.email || "unknown", time: pv.viewedAt, detail: pv.page });
          });
        }
      });
      entries.sort((a, b) => new Date(b.time) - new Date(a.time));
      setLogs(entries);
      setLoading(false);
    });
    return () => unsub();
  }, [isAdmin]);

  if (!isAdmin) return null;

  const fmt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = Date.now() - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const getBrowser = (ua) => {
    if (!ua) return "";
    if (ua.includes("Chrome") && !ua.includes("Edg")) return "Chrome";
    if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Edg")) return "Edge";
    return "Other";
  };

  const uniqueUsers = [...new Set(logs.filter(l => l.type === "login").map(l => l.email))];
  const loginCount = logs.filter(l => l.type === "login").length;
  return (
    <div style={{ padding: "20px 0" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", borderRadius: 12, padding: "16px 24px", border: "1px solid #334155", minWidth: 140 }}>
          <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2 }}>Total Logins</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#3B82F6", marginTop: 4 }}>{loginCount}</div>
        </div>
        <div style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", borderRadius: 12, padding: "16px 24px", border: "1px solid #334155", minWidth: 140 }}>
          <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2 }}>Unique Users</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#22C55E", marginTop: 4 }}>{uniqueUsers.length}</div>
        </div>
        {uniqueUsers.map(email => {
          const lastLogin = logs.find(l => l.type === "login" && l.email === email);
          const count = logs.filter(l => l.type === "login" && l.email === email).length;
          return (
            <div key={email} style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", borderRadius: 12, padding: "16px 24px", border: "1px solid #334155", minWidth: 180 }}>
              <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2 }}>{email.split("@")[0]}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0", marginTop: 4 }}>{count} logins</div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>Last: {fmt(lastLogin?.time)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ background: "#0F172A", borderRadius: 12, border: "1px solid #1E293B", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1E293B", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0", letterSpacing: 0.5 }}>Activity Timeline</span>
          <span style={{ fontSize: 11, color: "#64748B" }}>{logs.length} events</span>
        </div>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#64748B" }}>Loading...</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#64748B" }}>No activity recorded yet</div>
        ) : (
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {logs.slice(0, 100).map((entry, i) => (
              <div key={i} style={{ padding: "10px 20px", borderBottom: "1px solid #1E293B", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16, width: 28, textAlign: "center" }}>{entry.type === "login" ? "\uD83D\uDD13" : "\uD83D\uDCC4"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>
                    {entry.email.split("@")[0]}
                    <span style={{ color: "#64748B", fontWeight: 400, marginLeft: 8 }}>
                      {entry.type === "login" ? "signed in" : "viewed " + entry.detail}
                    </span>
                  </div>
                  {entry.type === "login" && (
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{getBrowser(entry.userAgent)} | {entry.detail}</div>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "#64748B", whiteSpace: "nowrap" }}>{fmt(entry.time)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
