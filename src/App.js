// src/App.js — Public Storage 4.0 Acquisition Tracker
// © 2026 DJR Real Estate LLC. All rights reserved.
// Proprietary and confidential. Unauthorized reproduction or distribution prohibited.
// Firebase Realtime Database — live shared data across all 3 users

import { useState, useEffect, useCallback, useRef } from "react";
import { db, storage } from "./firebase";
import { ref, onValue, set, push, remove, update } from "firebase/database";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import * as XLSX from "xlsx";

// ─── CSV Parser ───
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = [];
    let cur = "",
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) {
        vals.push(cur.trim());
        cur = "";
      } else cur += c;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] || "";
    });
    return obj;
  });
}

// ─── Constants ───
const REGIONS = {
  southwest: { label: "Daniel Wollent", color: "#1565C0", accent: "#42A5F5" },
  east: { label: "Matthew Toussaint", color: "#2D5F2D", accent: "#4CAF50" },
};
const STATUS_COLORS = {
  pending: { bg: "#FFF3E0", text: "#E65100", dot: "#F37C33" },
  approved: { bg: "#E8F5E9", text: "#2E7D32", dot: "#4CAF50" },
  declined: { bg: "#FFEBEE", text: "#B71C1C", dot: "#EF5350" },
  tracking: { bg: "#FFF8F0", text: "#BF360C", dot: "#F37C33" },
};
const PHASES = [
  "Prospect",
  "LOI Sent",
  "LOI Signed",
  "Under Contract",
  "Due Diligence",
  "Closed",
];
const PRIORITIES = ["🔥 Hot", "🟡 Warm", "🔵 Cold", "⚪ None"];
const PRIORITY_COLORS = {
  "🔥 Hot": "#EF4444",
  "🟡 Warm": "#F59E0B",
  "🔵 Cold": "#3B82F6",
  "⚪ None": "#CBD5E1",
};
const MSG_COLORS = {
  "Dan R": { bg: "#FFF3E0", border: "#F37C33", text: "#E65100" },
  "Daniel Wollent": { bg: "#EFF6FF", border: "#42A5F5", text: "#1565C0" },
  "Matthew Toussaint": { bg: "#F0FDF4", border: "#4CAF50", text: "#2D5F2D" },
};
const DOC_TYPES = [
  "Flyer",
  "Survey",
  "Geotech",
  "PSA",
  "LOI",
  "Appraisal",
  "Environmental",
  "Title",
  "Plat",
  "Other",
];

// ─── Helpers ───
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt$ = (v) => {
  if (!v) return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? v : "$" + n.toLocaleString();
};
const fmtN = (v) => {
  if (!v) return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? v : n.toLocaleString();
};
const mapsLink = (c) =>
  c ? `https://www.google.com/maps?q=${encodeURIComponent(c)}` : "";
const earthLink = (c) =>
  c ? `https://earth.google.com/web/search/${encodeURIComponent(c)}` : "";

// ─── Components ───
function Badge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: s.bg,
        color: s.text,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: s.dot,
          animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        }}
      />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || "#CBD5E1";
  return priority && priority !== "⚪ None" ? (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: c,
        background: c + "18",
        padding: "2px 8px",
        borderRadius: 6,
      }}
    >
      {priority}
    </span>
  ) : null;
}

function EF({ label, value, onSave, placeholder, multi }) {
  const [local, setLocal] = useState(value || "");
  const prevValue = useRef(value);
  useEffect(() => {
    if (value !== prevValue.current) {
      setLocal(value || "");
      prevValue.current = value;
    }
  }, [value]);
  const st = {
    width: "100%",
    padding: multi ? "8px 10px" : "6px 10px",
    borderRadius: 8,
    border: "1px solid #E2E8F0",
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    background: "#FAFBFC",
    color: "#2C2C2C",
    outline: "none",
    boxSizing: "border-box",
    resize: multi ? "vertical" : "none",
  };
  const handleBlur = () => {
    if (local !== (value || "")) onSave(local);
  };
  return (
    <div>
      {label && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#94A3B8",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 3,
          }}
        >
          {label}
        </div>
      )}
      {multi ? (
        <textarea
          style={{ ...st, minHeight: 60 }}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
        />
      ) : (
        <input
          style={st}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// ─── Seed Data ───
const DW_SEED = [
  { name: "7515 Faught Road", address: "7515 Faught Road", city: "Argyle", state: "TX", askingPrice: "6.50/sf (10 ac)", sellerBroker: "Mike - seller", summary: "Under Contract 03/02/2026", market: "DFW", coordinates: "" },
  { name: "616 Spring Hill Road", address: "616 Spring Hill Road", city: "Aubrey", state: "TX", askingPrice: "$2.75M (14 ac)", sellerBroker: "Coryann Johnson", summary: "Under Contract 1/22/2026. Offered 2m for front 6 acres.", market: "DFW", coordinates: "" },
  { name: "6405 S FM Rd 741", address: "6405 S FM Rd 741", city: "Forney", state: "TX", askingPrice: "10/sf (5.73 ac)", sellerBroker: "Dharani Halliyur", summary: "Off market — will consider anything north of 10/sf.", market: "DFW", coordinates: "" },
  { name: "32596 Ronald Reagan Blvd", address: "32596 Ronald Reagan Blvd.", city: "Georgetown", state: "TX", askingPrice: "12/sf", sellerBroker: "Mason Turner", summary: "LOI at 1.8m. They countered 13.50/sf ($2,646,270). C1 needs SUP.", market: "Austin", coordinates: "" },
  { name: "NWC Center Point & Roy Warren", address: "NWC Center Point Ln & Roy Warren Pkwy", city: "Greenville", state: "TX", askingPrice: "6.50/sf (200k sf)", sellerBroker: "Jason Hawkins", summary: "Show DW 200k sf pad we drew up, quoted 6.50/sf.", market: "DFW", coordinates: "" },
  { name: "16010 Warren Ranch Rd", address: "16010 Warren Ranch Rd", city: "Hockley", state: "TX", askingPrice: "$3.3M (10 ac)", internalPrice: "$1.6-1.7M (5 ac)", sellerBroker: "Carrie Lynch", summary: "Strong site unrestricted. Take half — seller wants N or S.", market: "Houston", coordinates: "" },
  { name: "Hwy 99 & Beckendorff", address: "Hwy 99 and Beckendorff", city: "Katy", state: "TX", askingPrice: "$1.2M (6.45 ac)", sellerBroker: "Oleh Bryndzia", summary: "Good location, cheap. Lighter floodplain, 215' frontage.", market: "Houston", coordinates: "" },
  { name: "FM 529 & Katy Hockley Rd", address: "FM 529 & Katy Hockley Road", city: "Katy", state: "TX", askingPrice: "14/sf (6 ac)", internalPrice: "$1.75M (4 ac Tract B)", sellerBroker: "Brent Fredericks", summary: "LOI at 1.75M for N 4 acres Tract B. Price needs improvement per broker.", market: "Houston", coordinates: "" },
  { name: "8850 Katy Hockley Road", address: "8850 Katy Hockley Road", city: "Katy", state: "TX", askingPrice: "$1.6M", internalPrice: "$1.65M agreed", sellerBroker: "Sarah Underwood", summary: "Agreement at 1.65M. DW checking rollback taxes.", market: "Houston", coordinates: "" },
  { name: "4000 W Stan Schlueter Loop", address: "4000 W Stan Schlueter Loop", city: "Killeen", state: "TX", askingPrice: "$4.25/sf (14 ac)", internalPrice: "$1M (6 ac)", sellerBroker: "Barry Hinshaw & Lauren Reider", summary: "LOI at $1M for 6 ac w/ 300' frontage. B3 by right.", market: "Houston", coordinates: "" },
  { name: "1416 Sparkle Lane", address: "1416 Sparkle Lane", city: "Leander", state: "TX", askingPrice: "See summary", sellerBroker: "Austin Cotton", summary: "Indian Reservation owner. Can take 2.9-ac 'Ivy Hotel' pad or portion of 7.5-ac parcel.", market: "Austin", coordinates: "" },
  { name: "FM 1488 Magnolia", address: "FM 1488", city: "Magnolia", state: "TX", askingPrice: "$2.4M (9.68 ac)", internalPrice: "$1.4-1.5M (half)", sellerBroker: "Bob Lewis", summary: "Excellent Houston expansion — 470' frontage. Take half. On market 9 days.", market: "Houston", coordinates: "" },
  { name: "5400 E Howard Lane", address: "5400 E Howard Lane", city: "Manor", state: "TX", askingPrice: "$2.15M (4.54 ac)", internalPrice: "$1.85M counter", sellerBroker: "Chris Anderson", summary: "LOI at 1.7m, countered 2m, we countered 1.85m. On market 600 days.", market: "Austin", coordinates: "" },
  { name: "6159 FM543", address: "6159 FM543", city: "McKinney", state: "TX", askingPrice: "$3.6M (13 ac)", sellerBroker: "Ray Eckenrode", summary: "Strong site 6.4mi from Wilmeth. Can we offer and leave the house?", market: "DFW", coordinates: "" },
  { name: "622 S Kowald Lane", address: "622 S Kowald Lane", city: "New Braunfels", state: "TX", askingPrice: "$1.65M (11.12 ac)", internalPrice: "$1.2M", sellerBroker: "Adam Schneider", summary: "LOI at 1.2M. Signed at 90 days w/ phased EMD 3/4. MU-B by right. 865 days on market.", market: "San Antonio", coordinates: "" },
  { name: "US 59 New Caney", address: "US 59", city: "New Caney", state: "TX", askingPrice: "$2.5M ($11/sf, 5.29 ac)", sellerBroker: "Anne Vickery", summary: "Awaiting PSA/REIC — fully signed LOI. 286' frontage.", market: "Houston", coordinates: "" },
  { name: "FM 664 Ovilla", address: "FM 664", city: "Ovilla", state: "TX", askingPrice: "18/sf front, 10/sf back (9.5 ac)", sellerBroker: "Ty Underwood", summary: "Awaiting PSA/REIC — fully signed LOI. Take half.", market: "DFW", coordinates: "" },
  { name: "Hwy 35 & English Drive", address: "Hwy 35 & English Drive", city: "Pearland", state: "TX", askingPrice: "$2.338M (5.239 ac)", internalPrice: "$1.82M signed", sellerBroker: "Faye Ausmus", summary: "Signed LOI 3/3 at 1.82m. Setback issue discovered.", market: "Houston", coordinates: "" },
  { name: "991 FM1377", address: "991 FM1377", city: "Princeton", state: "TX", askingPrice: "$2.7M (4.86 ac)", sellerBroker: "Jim Landsaw", summary: "Keep on list but on east side. House owner.", market: "DFW", coordinates: "" },
  { name: "6007 FM 2218 Road", address: "6007 FM 2218 Road", city: "Richmond", state: "TX", askingPrice: "$1.14M (8 ac)", sellerBroker: "Landon Coker", summary: "Great Houston expansion — 5mi from nearest PS. Unrestricted.", market: "Houston", coordinates: "" },
  { name: "2287 S FM 549", address: "2287 S Farm to Market 549", city: "Rockwall", state: "TX", askingPrice: "$1.6M (7.914 ac)", sellerBroker: "James Hauglid", summary: "Like Pullen St but keep on list.", market: "DFW", coordinates: "" },
  { name: "900 Pullen Street", address: "900 Pullen Street", city: "Royse City", state: "TX", askingPrice: "$1.74M (3.33 ac)", internalPrice: "$1.75M (~4.5 ac)", sellerBroker: "Fellowship Church — Shane Hendrix", summary: "Church awaiting site plan for LOI response. Needs SUP + Zoning Overlay.", market: "DFW", coordinates: "" },
  { name: "4607 205 Loop", address: "4607 205 Loop", city: "Temple", state: "TX", askingPrice: "$729K (5+ ac)", sellerBroker: "Scott Motsinger", summary: "Fully signed LOIs. Storage by right.", market: "Austin", coordinates: "" },
  { name: "13009 FM 121", address: "13009 FM 121", city: "Van Alstyne", state: "TX", askingPrice: "$7/sf (29 ac tract)", sellerBroker: "Tom Dosch", summary: "Backup to existing REIC site. Offer on 5-6 ac.", market: "DFW", coordinates: "" },
  { name: "20502 Binford Road", address: "20502 Binford Road", city: "Waller", state: "TX", askingPrice: "$4.50-5.00/sf (6.86 ac)", sellerBroker: "Derek Graber", summary: "Hockley backup. On market 200+ days.", market: "Houston", coordinates: "" },
];

const MT_SEED = [
  { name: "Mason Montgomery Rd", address: "7899 Mason Montgomery Rd", city: "Mason", state: "OH", askingPrice: "TBD", pop3mi: "65000", income3mi: "$120,000", sellerBroker: "TBD", summary: "Seller engaged, asking which pad. Strong demos. Ready to move.", market: "Cincy", coordinates: "39.324314, -84.312880" },
  { name: "Erlanger Turfway", address: "3600 Turfway Rd", city: "Erlanger", state: "KY", askingPrice: "$1.945M (6.48 ac)", pop3mi: "45000", income3mi: "$92,000", sellerBroker: "TBD", summary: "Keep on list. By right — city confirmed. Dead-flat, entitled.", market: "Cincy", coordinates: "39.035142, -84.634118" },
  { name: "Fishers I-69 & 106th", address: "SEQ I-69 and 106th St", city: "Fishers", state: "IN", askingPrice: "$350K/ac (10.87 ac)", pop3mi: "60000", income3mi: "$120,000", sellerBroker: "TBD", summary: "#1 Pad 7.08 ac — prob take entire pad. PUD allows storage.", market: "Indy", coordinates: "39.938513, -86.015306" },
  { name: "Cobblegate Drive", address: "Cobblegate Drive", city: "Moraine", state: "OH", askingPrice: "$735K (4.43 ac)", pop3mi: "56000", income3mi: "$85,000", sellerBroker: "TBD", summary: "Working rate — just ok. Strong zoning. Great price.", market: "Cincy", coordinates: "39.678414, -84.219034" },
  { name: "South Lebanon I-71", address: "I-71 & SR 48", city: "South Lebanon", state: "OH", askingPrice: "TBD (23.62 or 5.29 ac)", pop3mi: "27000", income3mi: "$150,000", sellerBroker: "TBD", summary: "Go after 4.98-ac south pad. Highest income $150K. Village supportive.", market: "Cincy", coordinates: "39.375031, -84.224701" },
  { name: "Shanghai Rd", address: "6465-6525 Shanghai", city: "Indianapolis", state: "IN", askingPrice: "~$225K/ac (5 ac)", pop3mi: "46000", income3mi: "$120,000", sellerBroker: "TBD", summary: "BULLSEYE. By right CS zoning. Strong demos. Michigan Rd triangulation.", market: "Indy", coordinates: "39.873903, -86.278346" },
  { name: "Greenfield New Rd", address: "743 W New Road", city: "Greenfield", state: "IN", askingPrice: "$2M (10.7 ac)", pop3mi: "22000", income3mi: "$85,000", sellerBroker: "TBD", summary: "See if they subdivide. IM zoning confirming. 215 days.", market: "Indy", coordinates: "39.812601, -85.779501" },
  { name: "Indy 46th St", address: "9240 E 46th Street", city: "Indianapolis", state: "IN", askingPrice: "$1.8M (7.68 ac)", pop3mi: "90000", income3mi: "$60,000", sellerBroker: "TBD", summary: "Matt likes but low incomes. Highest 3-mi pop 90K.", market: "Indy", coordinates: "39.841270, -86.006679" },
  { name: "West Chester Tylersville", address: "SEC Tylersville Rd & Cox Rd", city: "West Chester", state: "OH", askingPrice: "~$2.1M (4.3 ac)", pop3mi: "62000", income3mi: "$130,000", sellerBroker: "TBD", summary: "MATT LIKES. $130K income, 62K pop. Next to Kroger.", market: "Cincy", coordinates: "39.348787, -84.365076" },
  { name: "Spring Hill TN", address: "5090 N Main Street", city: "Spring Hill", state: "TN", askingPrice: "$700K (5 ac rear)", pop3mi: "73000", income3mi: "$114,000", sellerBroker: "TBD", summary: "YES! Great spacing and price. C4 by right.", market: "TN", coordinates: "35.764060, -86.919728" },
  { name: "Miami Twp Lyons", address: "SEC Lyons Rd & Newmark Dr", city: "Miami Township", state: "OH", askingPrice: "$1.595M (15.96 ac, ~3.87 usable)", pop3mi: "62000", income3mi: "$105,000", sellerBroker: "TBD", summary: "YES — find 4 usable acres. Flat, dual access. Storage next door.", market: "Cincy", coordinates: "39.626438, -84.211683" },
  { name: "Whitestown Albert", address: "6864 Albert South", city: "Whitestown", state: "IN", askingPrice: "TBD", pop3mi: "18000", income3mi: "$140,000", sellerBroker: "TBD — pending", summary: "Want to make offer — get broker. $140K income. GB by right.", market: "Indy", coordinates: "39.983239, -86.338702" },
];

// ═══ MAIN APP ═══
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [subs, setSubs] = useState([]);
  const [east, setEast] = useState([]);
  const [sw, setSw] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [expandedSite, setExpandedSite] = useState(null);
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [newSiteCount, setNewSiteCount] = useState(0);
  const emptyForm = { name: "", address: "", city: "", state: "", notes: "", region: "southwest" };
  const [form, setForm] = useState(emptyForm);
  const [submitMode, setSubmitMode] = useState("direct");
  const [bulkRows, setBulkRows] = useState(null);
  const [bulkRegion, setBulkRegion] = useState("east");
  const [bulkPhase, setBulkPhase] = useState("Prospect");
  const fileRef = useRef();
  const [reviewInputs, setReviewInputs] = useState({});
  const [msgInputs, setMsgInputs] = useState({});
  const [sortBy, setSortBy] = useState("city");
  const [highlightedSite, setHighlightedSite] = useState(null);
  const [shareLink, setShareLink] = useState(null);
  const [seeded, setSeeded] = useState(false);

  // ─── FONT LOADER ───
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
  }, []);

  // ─── FIREBASE REAL-TIME LISTENERS ───
  useEffect(() => {
    const subsRef = ref(db, "submissions");
    const eastRef = ref(db, "east");
    const swRef = ref(db, "southwest");
    const metaRef = ref(db, "meta/seeded");

    const unsubSeed = onValue(metaRef, (snap) => {
      setSeeded(!!snap.val());
    });

    const unsubSubs = onValue(subsRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSubs(arr);
    });
    const unsubEast = onValue(eastRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setEast(arr);
      setLoaded(true);
    });
    const unsubSw = onValue(swRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSw(arr);
    });

    return () => {
      unsubSubs();
      unsubEast();
      unsubSw();
      unsubSeed();
    };
  }, []);

  // ─── SEED ON FIRST LOAD ───
  useEffect(() => {
    if (!loaded || seeded) return;
    const now = new Date().toISOString();
    const make = (d, reg) => ({
      ...d,
      region: reg,
      id: uid(),
      status: "tracking",
      submittedAt: now,
      approvedAt: now,
      phase: "Prospect",
      acreage: d.acreage || "",
      zoning: d.zoning || "",
      askingPrice: d.askingPrice || "",
      internalPrice: d.internalPrice || "",
      income3mi: d.income3mi || "",
      pop3mi: d.pop3mi || "",
      sellerBroker: d.sellerBroker || "",
      summary: d.summary || "",
      coordinates: d.coordinates || "",
      market: d.market || "",
      priority: "⚪ None",
      messages: {},
      activityLog: {},
      docs: {},
    });
    const dwSites = DW_SEED.map((d) => make(d, "southwest"));
    const mtSites = MT_SEED.map((d) => make(d, "east"));
    const updates = {};
    dwSites.forEach((s) => {
      updates[`southwest/${s.id}`] = s;
    });
    mtSites.forEach((s) => {
      updates[`east/${s.id}`] = s;
    });
    updates["meta/seeded"] = true;
    import("firebase/database").then(({ ref: fbRef, update: fbUpdate }) => {
      fbUpdate(ref(db, "/"), updates).catch(console.error);
    });
  }, [loaded, seeded]);

  // ─── ALERT for pending sites ───
  useEffect(() => {
    if (!loaded) return;
    const pending = subs.filter((s) => s.status === "pending");
    const lastSeen = localStorage.getItem("ps-last-seen");
    const seenTs = lastSeen ? new Date(lastSeen).getTime() : 0;
    const newOnes = pending.filter(
      (x) => new Date(x.submittedAt).getTime() > seenTs
    );
    if (newOnes.length > 0) {
      setNewSiteCount(newOnes.length);
      setShowNewAlert(true);
    }
    localStorage.setItem("ps-last-seen", new Date().toISOString());
    // Deep link review
    try {
      const params = new URLSearchParams(window.location.search);
      const reviewId = params.get("review");
      if (reviewId && subs.find((s) => s.id === reviewId)) {
        setTab("review");
        setHighlightedSite(reviewId);
        setShowNewAlert(false);
        setTimeout(() => {
          const el = document.getElementById(`review-${reviewId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 500);
      }
    } catch {}
  }, [loaded, subs]);

  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  };

  // ─── FIREBASE WRITE HELPERS ───
  const fbSet = (path, value) => set(ref(db, path), value);
  const fbUpdate = (path, value) => update(ref(db, path), value);
  const fbPush = (path, value) => push(ref(db, path), value);
  const fbRemove = (path) => remove(ref(db, path));

  const updateSiteField = (region, id, field, value) => {
    fbUpdate(`${region}/${id}`, { [field]: value });
  };

  const saveField = (region, id, field, value) => {
    const logEntry = {
      action: `${field} updated`,
      ts: new Date().toISOString(),
      by: "User",
    };
    fbUpdate(`${region}/${id}`, { [field]: value });
    fbPush(`${region}/${id}/activityLog`, logEntry);
  };

  const handleSendMsg = (region, id) => {
    const mi = msgInputs[id] || { from: "Dan R", text: "" };
    if (!mi.text.trim()) return;
    const msg = {
      from: mi.from,
      text: mi.text.trim(),
      ts: new Date().toISOString(),
    };
    fbPush(`${region}/${id}/messages`, msg);
    setMsgInputs({ ...msgInputs, [id]: { from: mi.from, text: "" } });
    notify(`Sent from ${mi.from}`);
  };

  const handleRemove = (region, id) => {
    fbRemove(`${region}/${id}`);
    notify("Removed.");
    setExpandedSite(null);
  };

  // ─── SUBMIT ───
  const handleSubmit = () => {
    if (!form.name || !form.address || !form.city || !form.state) {
      notify("Fill name, address, city, state.");
      return;
    }
    const now = new Date().toISOString();
    const id = uid();
    const site = {
      ...form,
      id,
      submittedAt: now,
      phase: "Prospect",
      askingPrice: "",
      internalPrice: "",
      income3mi: "",
      pop3mi: "",
      sellerBroker: "",
      summary: "",
      coordinates: "",
      listingUrl: "",
      dateOnMarket: "",
      acreage: "",
      zoning: "",
      market: "",
      priority: "⚪ None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: "Site submitted", ts: now, by: "User" } },
    };
    if (submitMode === "direct") {
      const t = { ...site, status: "tracking", approvedAt: now };
      fbSet(`${form.region}/${id}`, t);
      fbSet(`submissions/${id}`, { ...site, status: "approved" });
      notify(`Added → ${REGIONS[form.region].label}`);
      setShareLink(null);
    } else {
      fbSet(`submissions/${id}`, { ...site, status: "pending" });
      notify("Submitted for review!");
      setShareLink(id);
    }
    setForm(emptyForm);
  };

  // ─── REVIEW ───
  const handleApprove = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const now = new Date().toISOString();
    const t = {
      ...site,
      status: "tracking",
      approvedAt: now,
      reviewedBy: ri.reviewer || "Unknown",
      reviewNote: ri.note || "",
      askingPrice: site.askingPrice || "",
      internalPrice: "",
      income3mi: "",
      pop3mi: "",
      sellerBroker: "",
      summary: "",
      coordinates: "",
      listingUrl: "",
      dateOnMarket: "",
      acreage: "",
      zoning: "",
      market: "",
      priority: "⚪ None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: `Approved by ${ri.reviewer || "Unknown"}`, ts: now, by: ri.reviewer || "Unknown" } },
    };
    fbSet(`${site.region}/${id}`, t);
    fbUpdate(`submissions/${id}`, { status: "approved", reviewedBy: ri.reviewer, reviewNote: ri.note });
    notify(`Approved by ${ri.reviewer || "Unknown"}`);
  };

  const handleApproveAll = () => {
    const p = subs.filter((s) => s.status === "pending");
    if (!p.length) return;
    const now = new Date().toISOString();
    const updates = {};
    p.forEach((s) => {
      const t = {
        ...s,
        status: "tracking",
        approvedAt: now,
        priority: "⚪ None",
        messages: {},
        docs: {},
        activityLog: { [uid()]: { action: "Bulk approved", ts: now, by: "Dan R" } },
      };
      updates[`${s.region}/${s.id}`] = t;
      updates[`submissions/${s.id}/status`] = "approved";
    });
    import("firebase/database").then(({ ref: fbRef, update: fbUpd }) => {
      fbUpd(ref(db, "/"), updates);
    });
    notify(`Approved ${p.length}!`);
  };

  const handleDecline = (id) => {
    const ri = reviewInputs[id] || {};
    fbUpdate(`submissions/${id}`, { status: "declined", reviewedBy: ri.reviewer, reviewNote: ri.note });
    notify("Declined.");
  };

  const handleClearDeclined = () => {
    subs.filter((s) => s.status === "declined").forEach((s) => fbRemove(`submissions/${s.id}`));
  };

  // ─── DOCUMENT UPLOAD (Firebase Storage) ───
  const handleDocUpload = async (region, siteId, file, docType) => {
    if (!file) return;
    if (file.size > 20e6) { notify("Max 20MB per file"); return; }
    const docId = uid();
    const path = `docs/${siteId}/${docId}_${file.name}`;
    try {
      notify("Uploading…");
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      const docEntry = { id: docId, name: file.name, type: docType, url, path, uploadedAt: new Date().toISOString() };
      fbPush(`${region}/${siteId}/docs`, docEntry);
      notify(`${docType} uploaded!`);
    } catch (e) {
      console.error(e);
      notify("Upload failed — check Firebase Storage rules");
    }
  };

  const handleDocDelete = async (region, siteId, docKey, doc) => {
    try {
      if (doc.path) {
        const sRef = storageRef(storage, doc.path);
        await deleteObject(sRef).catch(() => {});
      }
      fbRemove(`${region}/${siteId}/docs/${docKey}`);
      notify("Document removed.");
    } catch (e) {
      notify("Delete failed");
    }
  };

  // ─── BULK IMPORT ───
  const handleBulkFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext === "csv" || ext === "tsv") {
      const r = new FileReader();
      r.onload = (ev) => {
        try {
          const rows = parseCSV(ev.target.result);
          if (rows.length) setBulkRows(rows);
        } catch { notify("CSV error"); }
      };
      r.readAsText(f);
    } else if (["xlsx", "xls", "xlsm"].includes(ext)) {
      const r = new FileReader();
      r.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          setBulkRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }));
        } catch { notify("Excel error"); }
      };
      r.readAsArrayBuffer(f);
    }
  };

  const normKey = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mapRow = (row) => {
    const m = {};
    Object.entries(row).forEach(([k, v]) => {
      const n = normKey(k);
      const val = String(v).trim();
      if (n.includes("name") || n.includes("facility")) m.name = val;
      else if (n.includes("address") || n.includes("street")) m.address = val;
      else if (n.includes("city")) m.city = val;
      else if (n.includes("state") || n === "st") m.state = val;
      else if (n.includes("acreage") || n.includes("acres")) m.acreage = val;
      else if (n.includes("zoning") || n.includes("zone")) m.zoning = val;
      else if (n.includes("asking")) m.askingPrice = val;
      else if (n.includes("internal") || n.includes("psprice")) m.internalPrice = val;
      else if (n.includes("income")) m.income3mi = val;
      else if (n.includes("pop")) m.pop3mi = val;
      else if (n.includes("broker") || n.includes("seller")) m.sellerBroker = val;
      else if (n.includes("summary") || n.includes("note")) m.summary = val;
      else if (n.includes("coord")) m.coordinates = val;
      else if (n.includes("phase")) m.phase = val;
      else if (n.includes("region")) {
        m.region = val.toLowerCase().includes("sw") || val.toLowerCase().includes("dan") ? "southwest" : "east";
      }
    });
    return m;
  };

  const handleBulkImport = () => {
    if (!bulkRows?.length) return;
    const now = new Date().toISOString();
    let c = 0;
    const updates = {};
    bulkRows.forEach((row) => {
      const m = mapRow(row);
      if (!m.name && !m.address) return;
      const id = uid();
      const site = {
        name: m.name || "Unnamed",
        address: m.address || "",
        city: m.city || "",
        state: m.state || "",
        acreage: m.acreage || "",
        zoning: m.zoning || "",
        notes: "",
        region: m.region || bulkRegion,
        phase: m.phase && PHASES.includes(m.phase) ? m.phase : bulkPhase,
        id,
        status: "tracking",
        submittedAt: now,
        approvedAt: now,
        askingPrice: m.askingPrice || "",
        internalPrice: m.internalPrice || "",
        income3mi: m.income3mi || "",
        pop3mi: m.pop3mi || "",
        sellerBroker: m.sellerBroker || "",
        summary: m.summary || "",
        coordinates: m.coordinates || "",
        listingUrl: "",
        dateOnMarket: "",
        market: "",
        priority: "⚪ None",
        messages: {},
        docs: {},
        activityLog: { [uid()]: { action: "Bulk imported", ts: now, by: "System" } },
      };
      const region = site.region;
      updates[`${region}/${id}`] = site;
      updates[`submissions/${id}`] = { ...site, status: "approved" };
      c++;
    });
    import("firebase/database").then(({ ref: fbRef, update: fbUpd }) => {
      fbUpd(ref(db, "/"), updates);
    });
    setBulkRows(null);
    if (fileRef.current) fileRef.current.value = "";
    notify(`Imported ${c}!`);
  };

  // ─── EXPORT ───
  const handleExport = () => {
    const cols = [
      { key: "name", header: "Facility Name", width: 28 },
      { key: "address", header: "Address", width: 30 },
      { key: "city", header: "City", width: 16 },
      { key: "state", header: "ST", width: 6 },
      { key: "acreage", header: "Acreage", width: 12 },
      { key: "zoning", header: "Zoning", width: 20 },
      { key: "phase", header: "Phase", width: 16 },
      { key: "priority", header: "Priority", width: 12 },
      { key: "askingPrice", header: "Asking Price", width: 22 },
      { key: "internalPrice", header: "PS Internal Price", width: 22 },
      { key: "income3mi", header: "3-Mi Avg Income", width: 18 },
      { key: "pop3mi", header: "3-Mi Population", width: 16 },
      { key: "sellerBroker", header: "Seller / Broker", width: 24 },
      { key: "dateOnMarket", header: "Date on Market", width: 16 },
      { key: "dom", header: "Days on Market", width: 16 },
      { key: "summary", header: "Summary / Notes", width: 50 },
      { key: "coordinates", header: "Coordinates", width: 24 },
      { key: "listingUrl", header: "Listing URL", width: 36 },
      { key: "approvedAt", header: "Date Added", width: 14 },
    ];
    const makeSheet = (sites) => {
      const sorted = [...sites].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      const rows = sorted.map((s) =>
        cols.map((c) => {
          if (c.key === "dom") return s.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) : "";
          if (c.key === "approvedAt") return s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "";
          return s[c.key] || "";
        })
      );
      const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => c.header), ...rows]);
      ws["!cols"] = cols.map((c) => ({ wch: c.width }));
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, makeSheet([...sw, ...east]), "All Sites");
    XLSX.utils.book_append_sheet(wb, makeSheet(sw), "Daniel Wollent");
    XLSX.utils.book_append_sheet(wb, makeSheet(east), "Matthew Toussaint");
    XLSX.writeFile(wb, `PS_Pipeline_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // ─── SORT ───
  const sortData = useCallback(
    (data) =>
      [...data].sort((a, b) => {
        if (sortBy === "city") return (a.city || "").localeCompare(b.city || "");
        if (sortBy === "market") return (a.market || "").localeCompare(b.market || "");
        if (sortBy === "phase") {
          const aIdx = PHASES.indexOf(a.phase || "Prospect");
          const bIdx = PHASES.indexOf(b.phase || "Prospect");
          return aIdx - bIdx;
        }
        return 0;
      }),
    [sortBy]
  );

  const pendingN = subs.filter((s) => s.status === "pending").length;

  const SortBar = () => (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Sort by:</label>
      {["city", "market", "phase"].map((k) => (
        <button
          key={k}
          onClick={() => setSortBy(k)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: sortBy === k ? "1px solid #F37C33" : "1px solid #E2E8F0",
            background: sortBy === k ? "#FFF3E0" : "#fff",
            color: sortBy === k ? "#F37C33" : "#64748B",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {k.charAt(0).toUpperCase() + k.slice(1)}
        </button>
      ))}
    </div>
  );

  const navBtn = (key) => ({
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: tab === key ? "transparent" : "transparent",
    color: tab === key ? "#F37C33" : "#64748B",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'DM Sans'",
    whiteSpace: "nowrap",
    borderBottom: tab === key ? "2px solid #F37C33" : "2px solid transparent",
    transition: "all 0.15s",
  });

  const inp = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #E2E8F0",
    fontSize: 13,
    fontFamily: "'DM Sans'",
    background: "#FAFBFC",
    outline: "none",
    boxSizing: "border-box",
    marginTop: 4,
  };

  // ═══ RENDER ═══
  if (!loaded)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#FAFAF7", fontFamily: "'DM Sans'" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 50, height: 50, border: "4px solid #E2E8F0", borderTopColor: "#F37C33", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
          <div style={{ color: "#64748B", fontSize: 14 }}>Loading…</div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </div>
    );

  // ═══ TRACKER CARDS ═══
  const TrackerCards = ({ regionKey }) => {
    const region = REGIONS[regionKey];
    const data = sortData(regionKey === "east" ? east : sw);

    return (
      <div style={{ animation: "fadeIn 0.3s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: region.accent }} />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: region.color }}>{region.label} — Master Tracker</h2>
          <span style={{ fontSize: 13, color: "#94A3B8" }}>({data.length})</span>
        </div>
        <SortBar />
        {data.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", color: "#94A3B8" }}>No sites yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {data.map((site) => {
              const isOpen = expandedSite === site.id;
              const msgs = site.messages ? Object.values(site.messages) : [];
              const docs = site.docs ? Object.entries(site.docs) : [];
              const logs = site.activityLog ? Object.values(site.activityLog) : [];
              const mi = msgInputs[site.id] || { from: "Dan R", text: "" };
              const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;

              return (
                <div key={site.id} id={`site-${site.id}`} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 6px rgba(0,0,0,0.08)", borderLeft: `5px solid ${PRIORITY_COLORS[site.priority] || region.accent}`, borderTop: `2px solid #F37C33`, overflow: "hidden", transition: "all 0.2s" }} onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)")} onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.08)")}>
                  {/* Collapsed header */}
                  <div onClick={() => setExpandedSite(isOpen ? null : site.id)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#2C2C2C" }}>{site.name}</span>
                        <PriorityBadge priority={site.priority} />
                        <select value={site.phase || "Prospect"} onClick={(e) => e.stopPropagation()} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#475569", cursor: "pointer" }}>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{site.address}{site.city ? `, ${site.city}` : ""}{site.state ? `, ${site.state}` : ""}</div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: "#94A3B8", flexWrap: "wrap" }}>
                        {site.askingPrice && <span>Ask: <strong style={{ color: "#2C2C2C" }}>{site.askingPrice}</strong></span>}
                        {site.internalPrice && <span>PS: <strong style={{ color: "#F37C33" }}>{site.internalPrice}</strong></span>}
                        {site.sellerBroker && <span>Broker: <strong style={{ color: "#475569" }}>{site.sellerBroker}</strong></span>}
                        {docs.length > 0 && <span style={{ color: "#64748B" }}>📁 {docs.length} doc{docs.length !== 1 ? "s" : ""}</span>}
                        {msgs.length > 0 && <span style={{ color: "#F37C33" }}>💬 {msgs.length}</span>}
                        {site.coordinates && <span>📍</span>}
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#E65100", textDecoration: "none", fontWeight: 600 }}>🔗 Listing</a>}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: "#CBD5E1", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</div>
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div style={{ padding: "0 18px 18px", borderTop: "1px solid #F1F5F9" }}>
                      {/* Site Photo */}
                      <div style={{ margin: "14px 0 10px" }}>
                        {site.photoUrl ? (
                          <div style={{ position: "relative" }}>
                            <img src={site.photoUrl} alt={site.name} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10, border: "1px solid #E2E8F0" }} onError={(e) => { e.target.style.display = "none"; }} />
                            <button onClick={() => updateSiteField(regionKey, site.id, "photoUrl", "")} style={{ position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: 6, border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 12, cursor: "pointer" }}>✕</button>
                          </div>
                        ) : null}
                        <div style={{ marginTop: site.photoUrl ? 6 : 0 }}>
                          <EF label={site.photoUrl ? "Photo URL" : "📷 Site Photo URL"} value={site.photoUrl || ""} onSave={(v) => updateSiteField(regionKey, site.id, "photoUrl", v)} placeholder="Paste image URL" />
                        </div>
                      </div>

                      {/* Summary */}
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, margin: "14px 0", border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Recent Summary</div>
                        <EF multi label="" value={site.summary || ""} onSave={(v) => saveField(regionKey, site.id, "summary", v)} placeholder="Deal notes, updates…" />
                      </div>

                      {/* Priority + Phase */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Priority</div>
                          <select value={site.priority || "⚪ None"} onChange={(e) => updateSiteField(regionKey, site.id, "priority", e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `2px solid ${PRIORITY_COLORS[site.priority] || "#E2E8F0"}`, fontSize: 13, fontFamily: "'DM Sans'", background: "#fff", cursor: "pointer", fontWeight: 600, color: PRIORITY_COLORS[site.priority] || "#64748B" }}>
                            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Phase</div>
                          <select value={site.phase || "Prospect"} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, fontFamily: "'DM Sans'", background: "#fff", cursor: "pointer" }}>
                            {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Fields grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                        <EF label="Market" value={site.market || ""} onSave={(v) => saveField(regionKey, site.id, "market", v)} placeholder="DFW, Houston…" />
                        <EF label="Asking Price" value={site.askingPrice || ""} onSave={(v) => saveField(regionKey, site.id, "askingPrice", v)} placeholder="$1.5M" />
                        <EF label="PS Internal Price" value={site.internalPrice || ""} onSave={(v) => saveField(regionKey, site.id, "internalPrice", v)} placeholder="$1.2M" />
                        <EF label="Seller / Broker" value={site.sellerBroker || ""} onSave={(v) => saveField(regionKey, site.id, "sellerBroker", v)} placeholder="John Smith" />
                        <EF label="3-Mile Income" value={site.income3mi || ""} onSave={(v) => saveField(regionKey, site.id, "income3mi", v)} placeholder="$95,000" />
                        <EF label="3-Mile Pop" value={site.pop3mi || ""} onSave={(v) => saveField(regionKey, site.id, "pop3mi", v)} placeholder="45,000" />
                        <EF label="Acreage" value={site.acreage || ""} onSave={(v) => saveField(regionKey, site.id, "acreage", v)} placeholder="4.5 ac" />
                        <EF label="Zoning" value={site.zoning || ""} onSave={(v) => saveField(regionKey, site.id, "zoning", v)} placeholder="C-2, B3…" />
                      </div>

                      {/* Date on Market */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Date on Market</div>
                          <input
                            type="date"
                            value={site.dateOnMarket || ""}
                            onChange={(e) => saveField(regionKey, site.id, "dateOnMarket", e.target.value)}
                            style={inp}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Listing URL</div>
                          <input
                            style={inp}
                            value={site.listingUrl || ""}
                            onChange={(e) => saveField(regionKey, site.id, "listingUrl", e.target.value)}
                            placeholder="costar.com/…"
                          />
                        </div>
                      </div>

                      {/* Maps + Coordinates */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Coordinates</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                          <input
                            style={{ ...inp, marginTop: 0 }}
                            value={site.coordinates || ""}
                            onChange={(e) => saveField(regionKey, site.id, "coordinates", e.target.value)}
                            placeholder="lat, lng"
                          />
                          {site.coordinates && (
                            <>
                              <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "8px 12px", borderRadius: 8, background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center" }}>📍 Maps</a>
                              <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "8px 12px", borderRadius: 8, background: "#2C3E50", color: "#fff", fontSize: 11, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center" }}>🌍 Earth</a>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Messages */}
                      <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>Messages & Notes</div>
                        {msgs.map((m, idx) => {
                          const mc = MSG_COLORS[m.from] || { bg: "#F8FAFC", border: "#E2E8F0", text: "#64748B" };
                          return (
                            <div key={idx} style={{ background: mc.bg, borderLeft: `3px solid ${mc.border}`, borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 11 }}>
                              <div style={{ fontWeight: 700, color: mc.text, marginBottom: 2 }}>{m.from}</div>
                              <div style={{ color: "#475569", whiteSpace: "pre-wrap" }}>{m.text}</div>
                              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{new Date(m.ts).toLocaleString()}</div>
                            </div>
                          );
                        })}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <select
                            value={mi.from}
                            onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, from: e.target.value } })}
                            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 11, background: "#fff", cursor: "pointer", fontFamily: "'DM Sans'" }}
                          >
                            {["Dan R", "Daniel Wollent", "Matthew Toussaint"].map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                          <input
                            style={{ ...inp, marginTop: 0, flex: 1, minWidth: 150 }}
                            value={mi.text}
                            onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, text: e.target.value } })}
                            placeholder="Add note or message…"
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMsg(regionKey, site.id); } }}
                          />
                          <button onClick={() => handleSendMsg(regionKey, site.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Send</button>
                        </div>
                      </div>

                      {/* Documents */}
                      <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>Documents</div>
                        {docs.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#94A3B8", padding: "8px 0" }}>No documents.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                            {docs.map(([k, d]) => (
                              <div key={k} style={{ background: "#F8FAFC", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontSize: 11 }}>
                                  <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: "#F37C33", fontWeight: 700, textDecoration: "none" }}>📄 {d.name}</a>
                                  <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 1 }}>{d.type || "File"} — {new Date(d.uploadedAt).toLocaleDateString()}</div>
                                </div>
                                <button onClick={() => handleDocDelete(regionKey, site.id, k, d)} style={{ padding: "2px 8px", borderRadius: 4, border: "none", background: "#FFE2E2", color: "#B71C1C", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <select
                            onChange={(e) => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.onchange = (ev) => {
                                const file = ev.target.files?.[0];
                                if (file) handleDocUpload(regionKey, site.id, file, e.target.value);
                              };
                              input.click();
                            }}
                            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 11, background: "#fff", cursor: "pointer", fontFamily: "'DM Sans'" }}
                          >
                            <option value="">Upload doc…</option>
                            {DOC_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Activity Log */}
                      <div style={{ paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>Activity Log</div>
                        {logs.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#94A3B8", padding: "8px 0" }}>No activity yet.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {logs.slice().reverse().map((log, idx) => (
                              <div key={idx} style={{ fontSize: 10, display: "flex", gap: 8, color: "#64748B" }}>
                                <span style={{ fontWeight: 600, color: "#94A3B8" }}>{new Date(log.ts).toLocaleString()}</span>
                                <span>{log.action} by {log.by}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Delete */}
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
                        <button onClick={() => handleRemove(regionKey, site.id)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #FFB6B6", background: "#FEF2F2", color: "#B71C1C", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🗑 Remove</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#FAFAF7" }}>
      {/* Alert Banner */}
      {showNewAlert && (
        <div style={{ background: "linear-gradient(90deg, #FFF3E0, #FFFBF0)", borderBottom: "2px solid #F37C33", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#E65100" }}>🆕 {newSiteCount} new site{newSiteCount !== 1 ? "s" : ""} waiting for review</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Review</button>
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1A1A1A 0%, #111111 100%)", padding: "0 20px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", borderTop: "3px solid #F37C33" }}>
        {/* PS Banner */}
        <div style={{ padding: "14px 0 10px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 10, background: "linear-gradient(135deg, #F37C33, #E8650A)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(243, 124, 51, 0.3)" }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono'" }}>PS</span>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>PUBLIC STORAGE 4.0</div>
                <div style={{ fontSize: 11, color: "#94A3B8", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>Acquisition Pipeline 2026</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.06em", textTransform: "uppercase" }}>DJR Real Estate</span>
              <button onClick={handleExport} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(243, 124, 51, 0.4)", background: "rgba(243, 124, 51, 0.1)", color: "#F37C33", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans'" }}>⬇ Export</button>
            </div>
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", gap: 2, overflowX: "auto", padding: "8px 0", scrollbarWidth: "none" }}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "summary", label: "Summary" },
            { key: "southwest", label: "Daniel Wollent" },
            { key: "east", label: "Matthew Toussaint" },
            { key: "submit", label: "Submit Site" },
            { key: "import", label: "Bulk Import" },
            { key: "review", label: pendingN > 0 ? `Review (${pendingN})` : "Review" },
          ].map((n) => (
            <button key={n.key} onClick={() => { setTab(n.key); if (n.key !== "review") setShowNewAlert(false); }} style={{ ...navBtn(n.key), position: "relative" }}
              onMouseEnter={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#F37C33"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
              onMouseLeave={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#64748B"; e.currentTarget.style.transform = "translateY(0)"; } }}
            >
              {n.label}
              {n.key === "review" && pendingN > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "#F37C33", animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, right: 20, background: "#F37C33", color: "#fff", padding: "12px 20px", borderRadius: 8, fontSize: 12, fontWeight: 600, boxShadow: "0 4px 12px rgba(243, 124, 51, 0.4)", animation: "fadeIn 0.3s ease-out", zIndex: 1000 }}>
          {toast}
        </div>
      )}

      {/* Main content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 16px", flex: 1, width: "100%" }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
            <h1 style={{ margin: "0 0 24px", fontSize: 24, fontWeight: 800, color: "#1A1A1A" }}>Pipeline Overview</h1>

            {/* Stat Cards */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
              <div onClick={() => setTab("summary")} style={{ cursor: "pointer", background: "linear-gradient(135deg, #1A1A1A 0%, #2A2A2A 100%)", borderRadius: 16, padding: "24px 28px", minWidth: 140, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", borderTop: "2px solid #F37C33", transition: "all 0.2s" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)"; }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Pipeline</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#F37C33", marginTop: 6, fontFamily: "'Space Mono'" }}>{sw.length + east.length}</div>
                <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>View summary →</div>
              </div>
              <div onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ cursor: "pointer", background: "linear-gradient(135deg, #fff9f0 0%, #fffbf5 100%)", borderRadius: 16, padding: "24px 28px", minWidth: 140, boxShadow: "0 4px 12px rgba(243, 124, 51, 0.1)", borderTop: "2px solid #F37C33", transition: "all 0.2s" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 8px 20px rgba(243, 124, 51, 0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(243, 124, 51, 0.1)"; }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Pending Review</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#F37C33", marginTop: 6, fontFamily: "'Space Mono'" }}>{pendingN}</div>
                <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Review queue →</div>
              </div>
              <div onClick={() => { setTab("southwest"); setExpandedSite(null); }} style={{ cursor: "pointer", background: "linear-gradient(135deg, #EFF6FF 0%, #F0F9FF 100%)", borderRadius: 16, padding: "24px 28px", minWidth: 140, boxShadow: "0 4px 12px rgba(21, 101, 192, 0.1)", borderTop: "2px solid #F37C33", transition: "all 0.2s" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 8px 20px rgba(21, 101, 192, 0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(21, 101, 192, 0.1)"; }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Daniel Wollent</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#1565C0", marginTop: 6, fontFamily: "'Space Mono'" }}>{sw.length}</div>
                <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Open tracker →</div>
              </div>
              <div onClick={() => { setTab("east"); setExpandedSite(null); }} style={{ cursor: "pointer", background: "linear-gradient(135deg, #F0FDF4 0%, #F7FFED 100%)", borderRadius: 16, padding: "24px 28px", minWidth: 140, boxShadow: "0 4px 12px rgba(45, 95, 45, 0.1)", borderTop: "2px solid #F37C33", transition: "all 0.2s" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 8px 20px rgba(45, 95, 45, 0.15)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(45, 95, 45, 0.1)"; }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Matthew Toussaint</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#2D5F2D", marginTop: 6, fontFamily: "'Space Mono'" }}>{east.length}</div>
                <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Open tracker →</div>
              </div>
            </div>

            {/* Phase Pipeline */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 28, borderTop: "2px solid #F37C33" }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "#2C2C2C" }}>Acquisition Pipeline by Phase</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                {PHASES.map((p) => {
                  const count = [...sw, ...east].filter((s) => s.phase === p).length;
                  const total = sw.length + east.length;
                  const width = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={p} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#2C2C2C" }}>{p}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "#F37C33", fontFamily: "'Space Mono'" }}>{count}</span>
                      </div>
                      <div style={{ height: 8, background: "#EFEFEF", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", background: "linear-gradient(90deg, #F37C33, #E8650A)", width: `${width}%`, transition: "width 0.3s ease-out" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Access Cards */}
            {[{ label: "Daniel Wollent", data: sw, color: REGIONS.southwest.color, tabKey: "southwest" }, { label: "Matthew Toussaint", data: east, color: REGIONS.east.color, tabKey: "east" }].map((r) => (
              <div key={r.label} onClick={() => { setTab(r.tabKey); setExpandedSite(null); }} style={{ background: "#fff", borderRadius: 16, padding: 20, marginBottom: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", cursor: "pointer", transition: "all 0.2s", borderTop: "2px solid #F37C33" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: r.color }}>{r.label} — 2026 Pipeline</h3>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {PHASES.map((p) => { const c = r.data.filter((s) => s.phase === p).length; return <div key={p} style={{ flex: "1 1 100px", textAlign: "center", padding: "12px 8px", borderRadius: 12, background: c > 0 ? `${r.color}15` : "#F8FAFC", border: c > 0 ? `1px solid ${r.color}40` : "1px solid #E2E8F0" }}><div style={{ fontSize: 24, fontWeight: 800, color: c > 0 ? r.color : "#CBD5E1", fontFamily: "'Space Mono'" }}>{c}</div><div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginTop: 3 }}>{p}</div></div>; })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══ SUMMARY ═══ */}
        {tab === "summary" && (() => {
          const th = { padding: "12px 14px", textAlign: "left", fontSize: 10, fontWeight: 800, color: "#fff", textTransform: "uppercase", borderBottom: "none", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#1A1A1A", zIndex: 1 };
          const td = { padding: "12px 14px", fontSize: 11, color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" };
          const tdW = { ...td, whiteSpace: "normal", maxWidth: 200, minWidth: 120 };
          const SumTable = ({ rk }) => {
            const r = REGIONS[rk];
            const d = sortData(rk === "east" ? east : sw);
            return (
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.accent }} />
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: r.color }}>{r.label}</h3>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>({d.length})</span>
                </div>
                {d.length === 0 ? <div style={{ background: "#fff", borderRadius: 12, padding: 24, textAlign: "center", color: "#94A3B8" }}>No sites.</div> : (
                  <div style={{ overflow: "auto", borderRadius: 12, border: "1px solid #E2E8F0", maxHeight: 520 }}>
                    <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", background: "#fff" }}>
                      <thead>
                        <tr style={{ background: "#1A1A1A" }}>{["Name", "Address", "City", "ST", "Priority", "Ask", "PS Price", "3mi Inc", "3mi Pop", "Broker", "DOM", "Summary", "Added"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {d.map((s, i) => (
                          <tr key={s.id} onClick={() => { setTab(rk); setExpandedSite(s.id); setTimeout(() => { const el = document.getElementById(`site-${s.id}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 350); }} style={{ background: i % 2 ? "#FAFAF7" : "#fff", cursor: "pointer", transition: "background 0.15s" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#FFF3E0")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 ? "#FAFAF7" : "#fff")}
                          >
                            <td style={{ ...td, fontWeight: 700, color: "#2C2C2C" }}>{s.name}</td>
                            <td style={td}>{s.address || "—"}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.city || "—"}</td>
                            <td style={td}>{s.state || "—"}</td>
                            <td style={td}><PriorityBadge priority={s.priority} /></td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.askingPrice || "—"}</td>
                            <td style={{ ...td, color: "#F37C33", fontWeight: 700 }}>{s.internalPrice || "—"}</td>
                            <td style={td}>{s.income3mi || "—"}</td>
                            <td style={td}>{s.pop3mi ? fmtN(s.pop3mi) : "—"}</td>
                            <td style={td}>{s.sellerBroker || "—"}</td>
                            <td style={{ ...td, textAlign: "center", fontSize: 12, color: s.dateOnMarket && s.dateOnMarket !== "N/A" ? (Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 365 ? "#EF4444" : Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 180 ? "#F59E0B" : "#22C55E") : "#94A3B8" }}>{s.dateOnMarket && s.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) + "d" : "—"}</td>
                            <td style={tdW}>{s.summary ? (s.summary.length > 70 ? s.summary.slice(0, 70) + "…" : s.summary) : "—"}</td>
                            <td style={td}>{s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          };
          return (
            <div style={{ animation: "fadeIn .3s ease-out" }}>
              <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, color: "#1A1A1A" }}>Summary</h1>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#94A3B8" }}>All tracked sites by region. Click any row to open.</p>
              <SortBar />
              <SumTable rk="southwest" />
              <SumTable rk="east" />
            </div>
          );
        })()}

        {/* ═══ SUBMIT ═══ */}
        {tab === "submit" && (
          <div style={{ animation: "fadeIn .3s ease-out", maxWidth: 600 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", borderTop: "2px solid #F37C33" }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 800, color: "#1A1A1A" }}>Submit Site</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 20, background: "#FAFAF7", borderRadius: 10, padding: 4 }}>
                {[["direct", "⚡ Direct to Tracker"], ["review", "📋 Send to Review"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSubmitMode(k)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans'", background: submitMode === k ? "#fff" : "transparent", color: submitMode === k ? "#F37C33" : "#94A3B8", boxShadow: submitMode === k ? "0 2px 6px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>{l}</button>
                ))}
              </div>
              <div style={{ display: "grid", gap: 14 }}>
                <div><label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Name *</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Facility name" /></div>
                <div><label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Address *</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>City *</label><input style={inp} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>State *</label><input style={inp} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                </div>
                <div><label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Region *</label><select style={{ ...inp, cursor: "pointer" }} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="southwest">Daniel Wollent</option><option value="east">Matthew Toussaint</option></select></div>
                <button onClick={handleSubmit} style={{ padding: "14px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: submitMode === "direct" ? "linear-gradient(135deg, #F37C33, #E8650A)" : "linear-gradient(135deg, #1A1A1A, #2A2A2A)", color: "#fff", fontSize: 14, fontWeight: 800, transition: "all 0.2s", boxShadow: submitMode === "direct" ? "0 4px 12px rgba(243, 124, 51, 0.3)" : "0 4px 12px rgba(0,0,0,0.2)" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>
                  {submitMode === "direct" ? "⚡ Add Now" : "📋 Submit for Review"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 12 }}>Documents and details can be added after.</div>
              {shareLink && (
                <div style={{ marginTop: 16, padding: 12, background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", textTransform: "uppercase", marginBottom: 4 }}>Review Link</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}${window.location.pathname}?review=${shareLink}`}
                      style={{ ...inp, marginTop: 0, fontSize: 11 }}
                      onClick={(e) => { e.target.select(); navigator.clipboard.writeText(e.target.value); notify("Copied!"); }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ IMPORT ═══ */}
        {tab === "import" && (
          <div style={{ animation: "fadeIn .3s ease-out", maxWidth: 600 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", borderTop: "2px solid #F37C33" }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 800, color: "#1A1A1A" }}>Bulk Import</h2>
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>File (CSV or Excel)</label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.tsv,.xlsx,.xls,.xlsm"
                    onChange={handleBulkFile}
                    style={{ ...inp, cursor: "pointer" }}
                  />
                </div>
                {bulkRows && (
                  <>
                    <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, border: "1px solid #E2E8F0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>Preview: {bulkRows.length} rows</div>
                      <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 11, color: "#475569" }}>
                        {bulkRows.slice(0, 5).map((r, i) => (
                          <div key={i} style={{ padding: 4, borderBottom: i < 4 ? "1px solid #E2E8F0" : "none" }}>
                            {r.name || r.facility || "—"} / {r.city || "—"}, {r.state || "—"}
                          </div>
                        ))}
                        {bulkRows.length > 5 && <div style={{ padding: 4, color: "#94A3B8" }}>… and {bulkRows.length - 5} more</div>}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Default Region</label>
                        <select style={{ ...inp, cursor: "pointer" }} value={bulkRegion} onChange={(e) => setBulkRegion(e.target.value)}>
                          <option value="southwest">Daniel Wollent</option>
                          <option value="east">Matthew Toussaint</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Default Phase</label>
                        <select style={{ ...inp, cursor: "pointer" }} value={bulkPhase} onChange={(e) => setBulkPhase(e.target.value)}>
                          {PHASES.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button onClick={handleBulkImport} style={{ padding: "14px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #F37C33, #E8650A)", color: "#fff", fontSize: 14, fontWeight: 800, transition: "all 0.2s", boxShadow: "0 4px 12px rgba(243, 124, 51, 0.3)" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>
                      ✓ Import {bulkRows.length}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {tab === "review" && (() => {
          return (
            <div style={{ animation: "fadeIn .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1A1A1A" }}>Review Queue</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  {pendingN > 0 && <button onClick={handleApproveAll} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 12px rgba(243, 124, 51, 0.3)" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>✓ Approve All ({pendingN})</button>}
                  {subs.some((s) => s.status === "declined") && <button onClick={handleClearDeclined} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Clear Declined</button>}
                </div>
              </div>
              <SortBar />
              {subs.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: 16, padding: 40, textAlign: "center", color: "#94A3B8", borderTop: "2px solid #F37C33" }}>No submissions.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {sortData(subs).map((site) => {
                    const ri = reviewInputs[site.id] || { reviewer: "", note: "" };
                    const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
                    const isHL = highlightedSite === site.id;
                    return (
                      <div key={site.id} id={`review-${site.id}`} style={{ background: isHL ? "#FFF3E0" : "#fff", borderRadius: 14, padding: 18, boxShadow: isHL ? "0 0 0 3px #F37C33" : "0 2px 6px rgba(0,0,0,0.08)", opacity: site.status === "declined" ? 0.5 : 1, borderLeft: `4px solid ${REGIONS[site.region]?.accent || "#94A3B8"}`, borderTop: "2px solid #F37C33", transition: "all 0.3s" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: "#2C2C2C" }}>{site.name}</span>
                          <Badge status={site.status} />
                          {site.status === "pending" && <button onClick={() => { const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#64748B", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🔗 Copy Link</button>}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>{site.address}, {site.city}, {site.state} → {REGIONS[site.region]?.label}</div>
                        {site.status === "pending" ? (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1F5F9" }}>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                              <select value={ri.reviewer} onChange={(e) => setRI("reviewer", e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", cursor: "pointer", minWidth: 140, fontFamily: "'DM Sans'" }}>
                                <option value="">Reviewer…</option>
                                <option>Daniel Wollent</option>
                                <option>Matthew Toussaint</option>
                                <option>Dan R</option>
                              </select>
                              <input value={ri.note} onChange={(e) => setRI("note", e.target.value)} placeholder="Review note…" style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, outline: "none", fontFamily: "'DM Sans'" }} />
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={() => { if (!ri.reviewer) { notify("Select reviewer"); return; } handleApprove(site.id); setHighlightedSite(null); }} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer", transition: "all 0.2s", boxShadow: "0 4px 12px rgba(243, 124, 51, 0.3)" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>✓ Approve</button>
                              <button onClick={() => { handleDecline(site.id); setHighlightedSite(null); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✗ Decline</button>
                            </div>
                          </div>
                        ) : (site.reviewedBy || site.reviewNote) && (
                          <div style={{ marginTop: 10, fontSize: 11, color: "#94A3B8" }}>
                            {site.reviewedBy && <span>By: <strong style={{ color: "#2C2C2C" }}>{site.reviewedBy}</strong></span>}
                            {site.reviewNote && <span style={{ marginLeft: 10, fontStyle: "italic" }}>"{site.reviewNote}"</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ═══ TRACKERS ═══ */}
        {tab === "southwest" && <TrackerCards regionKey="southwest" />}
        {tab === "east" && <TrackerCards regionKey="east" />}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "20px 16px", borderTop: "1px solid #E2E8F0", marginTop: 32, color: "#94A3B8", fontSize: 11, letterSpacing: 0.3, background: "#fff" }}>
        © {new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. Proprietary software — unauthorized reproduction prohibited.
      </div>

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
