// src/App.js — SiteScore Acquisition Tracker (Refactored)
// © 2026 DJR Real Estate LLC. All rights reserved.
// Proprietary and confidential. Unauthorized reproduction or distribution prohibited.
// Firebase Realtime Database — live shared data across all 3 users

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, storage } from "./firebase";
import { ref, update } from "firebase/database";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
// xlsx is lazy-loaded on demand (Export Excel) to reduce initial bundle ~500KB

// ─── Extracted Modules ───
import {
  parseCSV, uid, fmt$, fmtN, fmtPrice, mapsLink, earthLink,
  debounce, safeNum, escapeHtml, buildDemoReport, fetchDemographics,
  stripEmoji, cleanPriority,
  sanitizeString, isValidCoordinates, isValidState, isValidPrice, isValidAcreage,
  REGIONS, STATUS_COLORS, PHASES, PHASE_MIGRATION, PRIORITIES, PRIORITY_COLORS,
  MSG_COLORS, DOC_TYPES, SITE_SCORE_DEFAULTS, STYLES,
  normalizeSiteScoreWeights,
} from './utils';
import { computeSiteScore as _computeSiteScore, computeSiteFinancials } from './scoring';
import {
  generateVettingReport as _generateVettingReport,
  generatePricingReport as _generatePricingReport,
  generateRECPackage as _generateRECPackage,
  generateDemographicsReport,
} from './reports';
import { SiteScoreBadge as _SiteScoreBadge, Badge, PriorityBadge, normalizePriority, EF } from './components';
import { SortBar, SORT_OPTIONS } from './components/SortBar';
import { SiteScoreConfigModal } from './components/SiteScoreConfigModal';
import ValuationInputs from './components/ValuationInputs';
import { useFirebaseData } from './hooks/useFirebaseData';
import { useNavigation } from './hooks/useNavigation';
import './App.css';

// ─── Mutable SiteScore Config (merged with Firebase overrides at runtime) ───
let SITE_SCORE_CONFIG = SITE_SCORE_DEFAULTS.map(d => ({ ...d }));

// ─── Mutable Valuation Overrides (merged from Firebase config/valuation_overrides at runtime) ───
let VALUATION_OVERRIDES = {};

const getIQWeight = (key) => {
  const dim = SITE_SCORE_CONFIG.find(d => d.key === key);
  return dim ? dim.weight : 0;
};

// ─── Wrappers — pass mutable config automatically so call sites don't change ───
const computeSiteScore = (site) => _computeSiteScore(site, SITE_SCORE_CONFIG);
const generateVettingReport = (site, psD, iq) => _generateVettingReport(site, psD, iq, SITE_SCORE_CONFIG);
const generatePricingReport = (site, iq, allSites) => _generatePricingReport(site, iq, SITE_SCORE_CONFIG, VALUATION_OVERRIDES, allSites);
const generateRECPackage = (site, iq) => _generateRECPackage(site, iq, SITE_SCORE_CONFIG, VALUATION_OVERRIDES);
// SiteScoreBadge wrapper — auto-injects computeSiteScore so call sites stay clean
const SiteScoreBadge = (props) => <_SiteScoreBadge {...props} computeSiteScore={computeSiteScore} />;

// ─── Module-scope sort orders (stable, never change) ───
const PRIORITY_ORDER = { "🔥 Hot": 0, "🟡 Warm": 1, "🔵 Cold": 2, "⚪ None": 3 };
const PHASE_ORDER = Object.fromEntries(PHASES.map((p, i) => [p, i]));

// ─── Error Boundary — prevents total app crash on report/render errors ───
class ErrorBoundary extends React.PureComponent {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("ErrorBoundary caught:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: "center", background: "#0A0E2A", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#9888;&#65039;</div>
          <h1 style={{ color: "#C9A84C", fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: "#94A3B8", fontSize: 14, maxWidth: 500, marginBottom: 24 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ padding: "12px 24px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══ MAIN APP ═══
function AppInner() {
  // UI-only state that stays in AppInner
  const [toast, setToast] = useState(null);
  const [expandedSite, setExpandedSite] = useState(null);
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [filterPhase, setFilterPhase] = useState("all");

  // ─── FIREBASE DATA HOOK ───
  const {
    authReady, loaded,
    subs, setSubs,
    east, setEast,
    sw, setSw,
    configVersion, setConfigVersion,
    iqWeights, setIqWeights,
    fbSet, fbUpdate, fbPush, fbRemove,
  } = useFirebaseData({
    onWeightsChange: (normalized) => {
      SITE_SCORE_CONFIG = normalizeSiteScoreWeights(normalized);
    },
  });

  // ─── NAVIGATION HOOK ───
  const {
    tab, setTab,
    transitioning, setTransitioning,
    detailView, setDetailView,
    reviewDetailSite, setReviewDetailSite,
    pushNav,
    navigateTo,
    goToDetail,
  } = useNavigation({ setExpandedSite, setFilterPhase, setShowNewAlert });
  const [newSiteCount, setNewSiteCount] = useState(0);
  const emptyForm = { name: "", address: "", city: "", state: "", notes: "", region: "southwest", acreage: "", askingPrice: "", zoning: "", sellerBroker: "", coordinates: "", listingUrl: "" };
  const [form, setForm] = useState(emptyForm);
  const [submitMode, setSubmitMode] = useState("review");
  const [flyerFile, setFlyerFile] = useState(null);
  const [flyerParsing, setFlyerParsing] = useState(false);
  const [flyerPreview, setFlyerPreview] = useState(null);
  const flyerRef = useRef();
  const [attachments, setAttachments] = useState([]); // [{file, type, id}]
  const attachRef = useRef();
  const [reviewInputs, setReviewInputs] = useState({});
  const [msgInputs, setMsgInputs] = useState({});
  const [sortBy, setSortBy] = useState("city");
  const [filterState, setFilterState] = useState("all");
  const [highlightedSite, setHighlightedSite] = useState(null);
  // reviewExpandedSite removed — replaced by reviewDetailSite (full-page detail)
  const [reviewTab, setReviewTab] = useState("mine");
  const [shareLink, setShareLink] = useState(null);
  const [demoLoading, setDemoLoading] = useState({});
  const [demoReport, setDemoReport] = useState({});
  const [showSiteScoreDetail, setShowSiteScoreDetail] = useState({});
  // vettingReport removed — auto-generates on site add
  const [showIQConfig, setShowIQConfig] = useState(false);
  const [demoExpanded, setDemoExpanded] = useState(false);
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const [scoreDimExpanded, setScoreDimExpanded] = useState(null); // which SiteScore dimension row is expanded (key string)
  const [demoRowExpanded, setDemoRowExpanded] = useState(null); // which demographics row is expanded (key string)
  const [hoveredMetric, setHoveredMetric] = useState(null); // which key metric box tooltip is showing
  // hoveredCard removed — tooltip hover is now local per-card to prevent full re-render flicker
  const [valuationOverrides, setValuationOverrides] = useState({}); // Valuation Inputs page overrides

  // ─── LOAD VALUATION OVERRIDES FROM FIREBASE ───
  useEffect(() => {
    if (!loaded) return;
    const { onValue, ref: dbRef } = require("firebase/database");
    const unsub = onValue(dbRef(db, "config/valuation_overrides"), (snap) => {
      const val = snap.val() || {};
      setValuationOverrides(val);
      VALUATION_OVERRIDES = val; // Sync module-level mutable for report wrappers
    });
    return () => unsub();
  }, [loaded]);

  // ─── KEYBOARD NAVIGATION — Arrow keys to toggle between properties ───
  useEffect(() => {
    const handleKeyNav = (e) => {
      // Only navigate on tracker tabs
      if (tab !== "southwest" && tab !== "east") return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
      // Don't intercept if user is typing in an input/textarea/select
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      const sites = sortData(tab === "east" ? east : sw);
      if (!sites.length) return;
      const ids = sites.map(s => s.id);
      if (e.key === "Escape") { setExpandedSite(null); return; }
      const curIdx = expandedSite ? ids.indexOf(expandedSite) : -1;
      let nextIdx;
      if (e.key === "ArrowDown") {
        nextIdx = curIdx < ids.length - 1 ? curIdx + 1 : 0;
      } else {
        nextIdx = curIdx > 0 ? curIdx - 1 : ids.length - 1;
      }
      const nextId = ids[nextIdx];
      setExpandedSite(nextId);
      setTimeout(() => {
        const el = document.getElementById(`site-${nextId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    };
    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [tab, expandedSite, sw, east, sortBy]);

  // ─── FONT LOADER ───
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
  }, []);

  // Auth and Firebase listeners are now in useFirebaseData hook

  // ─── PHASE MIGRATION — one-time remap of legacy phases ───
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    if (!loaded || migrated) return;
    const now = new Date().toISOString();
    const migrate = (sites, region) => {
      sites.forEach(s => {
        if (PHASE_MIGRATION[s.phase]) {
          const newPhase = PHASE_MIGRATION[s.phase];
          fbUpdate(`${region}/${s.id}`, { phase: newPhase });
          fbPush(`${region}/${s.id}/activityLog`, { action: `Phase migrated: ${s.phase} → ${newPhase}`, ts: now, by: "System" });
        }
      });
    };
    migrate(sw, "southwest");
    migrate(east, "east");
    subs.forEach(s => {
      if (PHASE_MIGRATION[s.phase]) {
        fbUpdate(`submissions/${s.id}`, { phase: PHASE_MIGRATION[s.phase] });
      }
    });
    setMigrated(true);
  }, [loaded, sw, east, subs, migrated]);

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
    // Deep link review — opens full property detail page directly
    try {
      const params = new URLSearchParams(window.location.search);
      const reviewId = params.get("review") || params.get("reviewSite");
      if (reviewId && subs.find((s) => s.id === reviewId)) {
        setTab("review");
        setReviewDetailSite(reviewId);
        setShowNewAlert(false);
        window.scrollTo({ top: 0 });
      }
    } catch {}
  }, [loaded, subs]);

  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  };

  const handleSaveWeights = () => {
    const totalW = iqWeights.reduce((s, d) => s + d.weight, 0);
    if (totalW <= 0) { setToast("Error: weights sum to zero — cannot save"); return; }
    const normalized = iqWeights.map(d => ({ ...d, weight: d.weight / totalW }));
    SITE_SCORE_CONFIG = SITE_SCORE_DEFAULTS.map((def, i) => ({ ...def, weight: normalized[i].weight }));
    normalizeSiteScoreWeights(SITE_SCORE_CONFIG);
    setConfigVersion(v => v + 1); // Invalidate siteScoreCache
    fbSet("config/siteiq_weights", {
      dimensions: normalized.map(d => ({ key: d.key, weight: Math.round(d.weight * 1000) / 1000 })),
      updatedAt: new Date().toISOString(),
      updatedBy: "Dashboard",
      version: "2.0",
    });
    setShowIQConfig(false);
    notify("SiteScore weights saved & applied");
  };

  const updateSiteField = (region, id, field, value) => {
    // Sanitize string values on write
    const cleanVal = typeof value === "string" ? sanitizeString(value) : value;
    fbUpdate(`${region}/${id}`, { [field]: cleanVal });
    // --- Pipeline Velocity: Track phase transitions ---
    if (field === "phase") {
      const site = [...sw, ...east].find(s => s.id === id);
      const oldPhase = site?.phase || "Unknown";
      if (oldPhase !== value) {
        fbPush(`${region}/${id}/phaseHistory`, {
          from: oldPhase,
          to: value,
          changedAt: new Date().toISOString(),
          by: "User",
        });
        fbPush(`${region}/${id}/activityLog`, {
          action: `Phase: ${oldPhase} → ${value}`,
          ts: new Date().toISOString(),
          by: "User",
        });
      }
    }
  };

  const saveField = (region, id, field, value) => {
    const cleanVal = typeof value === "string" ? sanitizeString(value) : value;
    const logEntry = {
      action: `${sanitizeString(field)} updated`,
      ts: new Date().toISOString(),
      by: "User",
    };
    fbUpdate(`${region}/${id}`, { [field]: cleanVal });
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

  const handleSendToReview = (region, id, site) => {
    const now = new Date().toISOString();
    const sub = { ...site, status: "pending", region, submittedAt: now, sentBackToReview: true };
    delete sub.messages; delete sub.docs; delete sub.activityLog;
    fbSet(`submissions/${id}`, sub);
    fbRemove(`${region}/${id}`);
    fbPush(`${region}/${id}/activityLog`, { action: "Sent back to Review Queue", ts: now, by: "Dan R" });
    setExpandedSite(null);
    notify(`${site.name} → Review Queue`);
  };

  // ─── GEOCODE & DEMOGRAPHICS ───
  const handleFetchDemos = async (region, site) => {
    if (!site.coordinates) { notify("Add coordinates first"); return; }
    setDemoLoading((prev) => ({ ...prev, [site.id]: true }));
    try {
      // Try ESRI data already in Firebase first
      const esriReport = buildDemoReport(site);
      if (esriReport) {
        setDemoReport((prev) => ({ ...prev, [site.id]: esriReport }));
        notify("ESRI 2025 demographics loaded");
      } else {
        // Fallback to Census API if ESRI data not yet available
        const result = await fetchDemographics(site.coordinates);
        if (result?.error) {
          notify(result.error);
        } else if (result) {
          const updates = {};
          if (result.income3mi && !site.income3mi) updates.income3mi = result.income3mi;
          if (result.pop3mi && !site.pop3mi) updates.pop3mi = result.pop3mi;
          if (Object.keys(updates).length > 0) {
            fbUpdate(`${region}/${site.id}`, updates);
            fbPush(`${region}/${site.id}/activityLog`, {
              action: `Demographics pulled: Pop ${result.pop3mi || "?"}, HHI ${result.income3mi || "?"} (${result.source})`,
              ts: new Date().toISOString(), by: "System",
            });
          }
          setDemoReport((prev) => ({ ...prev, [site.id]: result }));
          notify("Demographics loaded (Census fallback)");
        }
      }
    } catch (err) {
      notify("Demographics fetch failed");
      console.error(err);
    }
    setDemoLoading((prev) => ({ ...prev, [site.id]: false }));
  };

  // ─── AUTO VETTING REPORT — runs on site add, saves to Firebase Storage ───
  const autoGenerateVettingReport = (region, siteId, site) => {
    try {
      const iqR = computeSiteScore(site);
      const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null;
      const report = generateVettingReport(site, psD, iqR);
      const docId = uid();
      const now = new Date().toISOString();
      const blob = new Blob([report], { type: "text/html;charset=utf-8" });
      const fileName = `Vetting_Report_${site.city || "Site"}_${site.state || ""}_${now.slice(0, 10)}.html`;
      const file = new File([blob], fileName, { type: "text/html;charset=utf-8" });
      const path = `docs/${siteId}/${docId}_${fileName}`;
      const sRef = storageRef(storage, path);
      uploadBytes(sRef, file).then(() => getDownloadURL(sRef)).then((url) => {
        fbPush(`${region}/${siteId}/docs`, { id: docId, name: fileName, type: "Other", url, path, uploadedAt: now });
        fbPush(`${region}/${siteId}/activityLog`, { action: "Vetting report auto-generated & saved", ts: now, by: "System" });
      }).catch((err) => console.error("Vetting report auto-save error:", err));
    } catch (err) {
      console.error("Vetting report generation error:", err);
    }
  };

  // ─── FLYER PARSING ───
  const parseFlyer = async (file) => {
    setFlyerParsing(true);
    setFlyerFile(file);
    // Preview
    if (file.type.startsWith("image/")) {
      if (flyerPreview) URL.revokeObjectURL(flyerPreview); // Prevent blob URL memory leak
      setFlyerPreview(URL.createObjectURL(file));
    } else {
      if (flyerPreview) URL.revokeObjectURL(flyerPreview);
      setFlyerPreview(null);
    }
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        // Load pdf.js from CDN
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          text += tc.items.map((item) => item.str).join(" ") + "\n";
        }
      }
      // Parse extracted text into form fields
      if (text.trim()) {
        const parsed = {};
        // Acreage patterns
        const acreMatch = text.match(/([\d,.]+)\s*(?:\+\/-)?\s*(?:acres?|ac\b|AC\b)/i) || text.match(/(?:acres?|acreage|ac)[:\s]*([\d,.]+)/i);
        if (acreMatch) parsed.acreage = acreMatch[1].replace(/,/g, "");
        // Price patterns
        const priceMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:million|M\b)/i);
        if (priceMatch) {
          const v = parseFloat(priceMatch[1].replace(/,/g, ""));
          parsed.askingPrice = "$" + (v * (priceMatch[0].toLowerCase().includes("million") || priceMatch[0].includes("M") ? 1000000 : 1)).toLocaleString();
        } else {
          const pMatch = text.match(/(?:price|asking|list(?:ed)?)[:\s]*\$\s*([\d,]+)/i) || text.match(/\$\s*([\d,]{5,})/);
          if (pMatch) parsed.askingPrice = "$" + pMatch[1];
        }
        // Zoning
        const zoneMatch = text.match(/(?:zon(?:ing|ed?)|district)[:\s]*([A-Z0-9][\w\s-]{0,20})/i);
        if (zoneMatch) parsed.zoning = zoneMatch[1].trim();
        // Broker / contact
        const brokerMatch = text.match(/(?:broker|agent|contact|listed by|exclusive)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/i);
        if (brokerMatch) parsed.sellerBroker = brokerMatch[1];
        // Address patterns — look for street number + street name
        const addrMatch = text.match(/(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Hwy|Highway|Way|Ct|Court|Pkwy|Parkway|Pl|Place|Cir|Circle)\.?)/i);
        if (addrMatch && !form.address) parsed.address = addrMatch[1];
        // City, State pattern
        const csMatch = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s+([A-Z]{2})\s+\d{5}/);
        if (csMatch) {
          if (!form.city) parsed.city = csMatch[1];
          if (!form.state) parsed.state = csMatch[2];
        }
        // Apply parsed values — only fill empty fields
        setForm((prev) => {
          const updated = { ...prev };
          Object.entries(parsed).forEach(([k, v]) => {
            if (!updated[k]) updated[k] = v;
          });
          return updated;
        });
        notify(`Extracted ${Object.keys(parsed).length} field(s) from flyer`);
      } else if (file.type.startsWith("image/")) {
        notify("Flyer attached — image files can't be auto-parsed (fill fields manually)");
      } else {
        notify("Flyer attached — no text found to extract");
      }
    } catch (err) {
      console.error("Flyer parse error:", err);
      notify("Flyer attached — couldn't extract text");
    }
    setFlyerParsing(false);
  };

  // ─── SUBMIT ───
  const handleSubmit = async () => {
    // Required field validation
    if (!form.name || !form.address || !form.city || !form.state) {
      notify("Fill name, address, city, state.");
      return;
    }
    // Field-level validation
    if (!isValidState(form.state)) { notify("Invalid state abbreviation."); return; }
    if (form.coordinates && !isValidCoordinates(form.coordinates)) { notify("Invalid coordinates format. Use: lat, lng"); return; }
    if (form.askingPrice && !isValidPrice(form.askingPrice)) { notify("Invalid asking price."); return; }
    if (form.acreage && !isValidAcreage(form.acreage)) { notify("Invalid acreage value."); return; }
    if (!REGIONS[form.region]) { notify("Invalid region."); return; }

    const now = new Date().toISOString();
    const id = uid();
    const site = {
      name: sanitizeString(form.name),
      address: sanitizeString(form.address),
      city: sanitizeString(form.city),
      state: sanitizeString(form.state).toUpperCase().slice(0, 2),
      region: form.region,
      id,
      submittedAt: now,
      phase: "Prospect",
      askingPrice: sanitizeString(form.askingPrice),
      internalPrice: "",
      income3mi: "",
      pop3mi: "",
      sellerBroker: sanitizeString(form.sellerBroker),
      summary: sanitizeString(form.notes),
      coordinates: sanitizeString(form.coordinates),
      listingUrl: sanitizeString(form.listingUrl),
      dateOnMarket: "",
      acreage: sanitizeString(form.acreage),
      zoning: sanitizeString(form.zoning),
      market: "",
      priority: "⚪ None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: "Site submitted", ts: now, by: "User" } },
    };
    // Upload all attached files to Firebase Storage
    const allFiles = [];
    if (flyerFile) allFiles.push({ file: flyerFile, type: "Flyer" });
    attachments.forEach((a) => allFiles.push({ file: a.file, type: a.type }));
    if (allFiles.length > 0) {
      const docsObj = {};
      for (const { file, type } of allFiles) {
        try {
          const docId = uid();
          const path = `docs/${id}/${docId}_${file.name}`;
          const sRef = storageRef(storage, path);
          await uploadBytes(sRef, file);
          const url = await getDownloadURL(sRef);
          docsObj[docId] = { id: docId, name: file.name, type, url, path, uploadedAt: now };
        } catch (e) {
          console.error(`Upload error (${type}):`, e);
        }
      }
      site.docs = docsObj;
    }
    if (submitMode === "direct") {
      const t = { ...site, status: "tracking", approvedAt: now };
      fbSet(`${form.region}/${id}`, t);
      fbSet(`submissions/${id}`, { ...site, status: "approved" });
      notify(`Added → ${REGIONS[form.region].label}`);
      setShareLink(null);
      autoGenerateVettingReport(form.region, id, site);
    } else {
      fbSet(`submissions/${id}`, { ...site, status: "pending" });
      notify("Submitted for review!");
      setShareLink(id);
    }
    setForm(emptyForm);
    setFlyerFile(null);
    if (flyerPreview) URL.revokeObjectURL(flyerPreview);
    setFlyerPreview(null);
    setAttachments([]);
    if (flyerRef.current) flyerRef.current.value = "";
    if (attachRef.current) attachRef.current.value = "";
  };

  // ─── REVIEW — TWO-STEP APPROVAL ───
  // Step 1: Dan recommends & assigns route (site stays in review queue)
  const handleRecommend = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const routeTo = ri.routeTo || site.region || "southwest";
    const routeLabel = REGIONS[routeTo]?.label || routeTo;
    const now = new Date().toISOString();
    fbUpdate(`submissions/${id}`, {
      status: "recommended",
      region: routeTo,
      recommendedBy: "Dan R.",
      recommendedAt: now,
      reviewNote: ri.note || "",
      routedTo: routeTo,
    });
    notify(`Recommended → ${routeLabel} (awaiting PS approval)`);
    autoGenerateVettingReport(routeTo, id, { ...site, region: routeTo });
  };

  // Step 2: PS (DW/MT/Jarrod) approves — moves to tracker
  const handlePSApprove = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const routeTo = site.routedTo || site.region || "southwest";
    const routeLabel = REGIONS[routeTo]?.label || routeTo;
    const now = new Date().toISOString();
    const t = {
      ...site,
      region: routeTo,
      status: "tracking",
      approvedAt: now,
      approvedBy: ri.reviewer || "PS",
      reviewedBy: site.recommendedBy || "Dan R",
      reviewNote: site.reviewNote || ri.note || "",
      askingPrice: site.askingPrice || "",
      internalPrice: site.internalPrice || "",
      income3mi: site.income3mi || "",
      pop3mi: site.pop3mi || "",
      sellerBroker: site.sellerBroker || "",
      summary: site.summary || "",
      coordinates: site.coordinates || "",
      listingUrl: site.listingUrl || "",
      dateOnMarket: site.dateOnMarket || "",
      acreage: site.acreage || "",
      zoning: site.zoning || "",
      market: site.market || "",
      priority: "⚪ None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: `PS Approved → routed to ${routeLabel}`, ts: now, by: ri.reviewer || "PS" } },
    };
    fbSet(`${routeTo}/${id}`, t);
    fbUpdate(`submissions/${id}`, { status: "approved", approvedBy: ri.reviewer || "PS", approvedAt: now });
    // Log to scoring calibration — approved sites help calibrate model accuracy
    const iqR = computeSiteScore(site);
    fbPush("config/scoring_calibration", {
      siteId: id, siteName: site.name || "", action: "approved_by_ps",
      siteScore: iqR ? iqR.score : null,
      classification: iqR ? iqR.classification : null,
      address: site.address || "", state: site.state || "",
      ts: now, by: ri.reviewer || "PS", routedTo: routeTo,
    });
    notify(`PS Approved → ${routeLabel} tracker`);
  };

  // handleApprove removed — replaced by two-step: handleRecommend (Dan) → handlePSApprove (PS)

  const handleApproveAll = () => {
    const p = subs.filter((s) => s.status === "pending");
    if (!p.length) return;
    const now = new Date().toISOString();
    const updates = {};
    p.forEach((s) => {
      const ri = reviewInputs[s.id] || {};
      const routeTo = ri.routeTo || s.region || "southwest";
      updates[`submissions/${s.id}/status`] = "recommended";
      updates[`submissions/${s.id}/region`] = routeTo;
      updates[`submissions/${s.id}/routedTo`] = routeTo;
      updates[`submissions/${s.id}/recommendedBy`] = "Dan R.";
      updates[`submissions/${s.id}/recommendedAt`] = now;
    });
    update(ref(db, "/"), updates).then(() => {
      notify(`Recommended ${p.length} sites (awaiting PS approval)`);
    }).catch((err) => {
      console.error(err);
      notify(`Error saving recommendations: ${err.message}`);
    });
  };

  const DECLINE_REASONS = [
    "Zoning — prohibited or rezone too risky",
    "Demographics — population or income too low",
    "Pricing — asking price too high",
    "Competition — market oversaturated",
    "Access — landlocked or poor ingress/egress",
    "Utilities — no water or sewer access",
    "Environmental — flood zone, wetlands, contamination",
    "Size — too small or too large",
    "Location — too far from nearest PS",
    "Duplicate — already in pipeline",
    "PS Feedback — declined by PS stakeholder",
    "Other",
  ];

  // Dan declines a site from his review queue (never sent to PS)
  const handleDecline = (id, declineReason) => {
    const ri = reviewInputs[id] || {};
    const site = subs.find(s => s.id === id);
    const iqR = site ? computeSiteScore(site) : null;
    const reason = declineReason || ri.declineReason || "Other";
    fbUpdate(`submissions/${id}`, {
      status: "declined",
      reviewedBy: ri.reviewer || "Dan R",
      reviewNote: ri.note || "",
      declineReason: reason,
      declinedAt: new Date().toISOString(),
      siteScoreAtDecline: iqR ? iqR.composite : null,
      classificationAtDecline: iqR ? iqR.classification : null,
    });
    fbPush("config/scoring_calibration", {
      siteId: id, siteName: site?.name || "", action: "declined_by_dan",
      reason, siteScore: iqR ? iqR.score : null,
      classification: iqR ? iqR.classification : null,
      address: site?.address || "", state: site?.state || "",
      ts: new Date().toISOString(), by: "Dan R",
    });
    notify("Declined — " + reason);
  };

  // PS (DW/MT/Brian) rejects a site — routes BACK to Dan's queue with feedback
  const handlePSReject = (id) => {
    const ri = reviewInputs[id] || {};
    const site = subs.find(s => s.id === id);
    const iqR = site ? computeSiteScore(site) : null;
    const reason = ri.declineReason || "PS Feedback — declined by PS stakeholder";
    const feedback = ri.psFeedback || ri.note || "";
    const rejectedBy = ri.reviewer || "PS";
    fbUpdate(`submissions/${id}`, {
      status: "ps-rejected",
      psRejectedBy: rejectedBy,
      psRejectReason: reason,
      psFeedback: feedback,
      psRejectedAt: new Date().toISOString(),
      siteScoreAtDecline: iqR ? iqR.composite : null,
      classificationAtDecline: iqR ? iqR.classification : null,
    });
    fbPush("config/scoring_calibration", {
      siteId: id, siteName: site?.name || "", action: "rejected_by_ps",
      reason, feedback, siteScore: iqR ? iqR.score : null,
      classification: iqR ? iqR.classification : null,
      address: site?.address || "", state: site?.state || "",
      ts: new Date().toISOString(), by: rejectedBy,
    });
    notify(`PS Rejected by ${rejectedBy} — routed back to Dan for review`);
  };

  // Dan permanently kills a site after reading PS feedback — address logged to never-resubmit
  const handleDiscard = (id) => {
    const site = subs.find(s => s.id === id);
    if (!site) { fbRemove(`submissions/${id}`); return; }
    // Log to killed sites registry — prevents re-submission
    fbPush("config/killed_sites", {
      siteId: id,
      name: site.name || "",
      address: site.address || "",
      city: site.city || "",
      state: site.state || "",
      coordinates: site.coordinates || "",
      declineReason: site.psRejectReason || site.declineReason || "Discarded",
      psFeedback: site.psFeedback || "",
      psRejectedBy: site.psRejectedBy || "",
      siteScore: site.siteScoreAtDecline || null,
      killedAt: new Date().toISOString(),
    });
    fbRemove(`submissions/${id}`);
    notify(`${site.name || "Site"} permanently discarded — will not be re-submitted.`);
  };

  const handleClearDeclined = () => {
    const declined = subs.filter((s) => s.status === "declined");
    if (!declined.length) return;
    const batchUpdates = {};
    const now = new Date().toISOString();
    declined.forEach((site) => {
      // Log to killed sites registry
      const killId = uid();
      batchUpdates[`config/killed_sites/${killId}`] = {
        siteId: site.id, name: site.name || "", address: site.address || "",
        city: site.city || "", state: site.state || "", coordinates: site.coordinates || "",
        declineReason: site.psRejectReason || site.declineReason || "Discarded",
        psFeedback: site.psFeedback || "", psRejectedBy: site.psRejectedBy || "",
        siteScore: site.siteScoreAtDecline || null, killedAt: now,
      };
      // Remove from submissions
      batchUpdates[`submissions/${site.id}`] = null;
    });
    update(ref(db, "/"), batchUpdates).then(() => {
      notify(`${declined.length} declined site${declined.length !== 1 ? "s" : ""} permanently discarded.`);
    }).catch((err) => {
      console.error(err);
      notify(`Error discarding sites: ${err.message}`);
    });
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

  // ─── EXPORT ───
  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const cols = [
      { key: "sitescore", header: "SiteScore™", width: 10 },
      { key: "name", header: "Facility Name", width: 28 },
      { key: "address", header: "Address", width: 30 },
      { key: "city", header: "City", width: 16 },
      { key: "state", header: "ST", width: 6 },
      { key: "acreage", header: "Acreage", width: 12 },
      { key: "zoning", header: "Zoning", width: 20 },
      { key: "phase", header: "Phase", width: 16 },
      { key: "priority", header: "Priority", width: 12 },
      { key: "askingPrice", header: "Asking Price", width: 22 },
      { key: "pricePerAcre", header: "Price/Acre", width: 16 },
      { key: "internalPrice", header: "Internal Price", width: 22 },
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
          if (c.key === "sitescore") return getSiteScore(s).score;
          if (c.key === "pricePerAcre") {
            const p = parseFloat(String(s.askingPrice || "").replace(/[^0-9.]/g, ""));
            const a = parseFloat(String(s.acreage || "").replace(/[^0-9.]/g, ""));
            return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() : "";
          }
          if (c.key === "dom") return s.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) : "";
          if (c.key === "approvedAt") return s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "";
          return s[c.key] || "";
        })
      );
      const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => c.header), ...rows]);
      ws["!cols"] = cols.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: cols.length - 1 } }) };
      return ws;
    };
    const wb = XLSX.utils.book_new();
    const allSorted = [
      ...sw.map((s) => ({ ...s, _region: "Daniel Wollent" })),
      ...east.map((s) => ({ ...s, _region: "Matthew Toussaint" })),
    ].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const summCols = [{ key: "_region", header: "Region", width: 18 }, ...cols];
    const summRows = allSorted.map((s) =>
      summCols.map((c) => {
        if (c.key === "sitescore") return getSiteScore(s).score;
        if (c.key === "pricePerAcre") {
          const p = parseFloat(String(s.askingPrice || "").replace(/[^0-9.]/g, ""));
          const a = parseFloat(String(s.acreage || "").replace(/[^0-9.]/g, ""));
          return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() : "";
        }
        if (c.key === "dom") return s.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) : "";
        if (c.key === "approvedAt") return s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "";
        return s[c.key] || "";
      })
    );
    const summWs = XLSX.utils.aoa_to_sheet([summCols.map((c) => c.header), ...summRows]);
    summWs["!cols"] = summCols.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, summWs, "Full Pipeline");
    XLSX.utils.book_append_sheet(wb, makeSheet(sw), "Daniel Wollent");
    XLSX.utils.book_append_sheet(wb, makeSheet(east), "Matthew Toussaint");
    XLSX.writeFile(wb, `SiteScore_Acquisition_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify("Exported!");
  };

  // ─── SORT ───
  const SORT_OPTIONS = [
    { key: "sitescore", label: "SiteScore™ (Best)" },
    { key: "name", label: "Name (A→Z)" },
    { key: "city", label: "City (A→Z)" },
    { key: "recent", label: "Recently Added" },
    { key: "dom", label: "Days on Market" },
    { key: "priority", label: "Priority" },
    { key: "phase", label: "Phase" },
  ];
  // ─── MEMOIZED SiteScore CACHE ───
  // Computes SiteScore once per site when data changes. Eliminates ~188 redundant calls per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const siteScoreCache = useMemo(() => {
    const cache = new Map();
    [...sw, ...east].forEach((s) => { if (s && s.id) cache.set(s.id, computeSiteScore(s)); });
    return cache;
  }, [sw, east, configVersion]);
  const getSiteScore = useCallback((site) => siteScoreCache.get(site.id) || computeSiteScore(site), [siteScoreCache]);

  // ─── MEMOIZED SORT — stabilized to prevent re-sort on every render ───
  const sortData = useCallback((arr) => {
    const sorted = [...arr];
    switch (sortBy) {
      case "sitescore": return sorted.sort((a, b) => getSiteScore(b).score - getSiteScore(a).score);
      case "city": return sorted.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
      case "recent": return sorted.sort((a, b) => new Date(b.approvedAt || b.submittedAt || 0) - new Date(a.approvedAt || a.submittedAt || 0));
      case "dom": return sorted.sort((a, b) => { const da = a.dateOnMarket ? Date.now() - new Date(a.dateOnMarket).getTime() : 0; const db2 = b.dateOnMarket ? Date.now() - new Date(b.dateOnMarket).getTime() : 0; return db2 - da; });
      case "priority": return sorted.sort((a, b) => (PRIORITY_ORDER[normalizePriority(a.priority)] ?? 9) - (PRIORITY_ORDER[normalizePriority(b.priority)] ?? 9));
      case "phase": return sorted.sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9));
      default: return sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
  }, [sortBy, getSiteScore]);

  // ─── STYLES ───
  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.15)", fontSize: 14, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.6)", color: "#E2E8F0", outline: "none", boxSizing: "border-box" };
  const navBtn = (key) => ({ padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", transition: "all 0.15s cubic-bezier(0.22,1,0.36,1)", background: tab === key ? "rgba(232,122,46,0.15)" : "transparent", color: tab === key ? "#E87A2E" : "#6B7394", whiteSpace: "nowrap", boxShadow: tab === key ? "0 0 16px rgba(232,122,46,0.12), inset 0 0 0 1px rgba(232,122,46,0.2)" : "none" });
  const pendingSubsN = subs.filter((s) => s.status === "pending" || s.status === "recommended").length;
  const assignedReviewN = [...sw, ...east].filter(s => s.assignedTo && s.needsReview).length;
  const pendingN = pendingSubsN + assignedReviewN;

  if (!authReady || !loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(165deg, #0F1538 0%, #1E2761 40%, #0F1538 100%)", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, border: "3px solid rgba(201,168,76,0.15)", borderTopColor: "#C9A84C", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 16px", boxShadow: "0 0 20px rgba(201,168,76,0.2)" }} />
        <div style={{ color: "#6B7394", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {!authReady ? "Authenticating…" : <>Initializing Storvex<sup style={{fontSize:"60%",verticalAlign:"super"}}>™</sup> — AI-Powered Storage Engine</>}
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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
          {data.some(s => s.phase === "Dead" || s.phase === "Declined") && <button onClick={() => { if (window.confirm("Remove all Dead/Declined sites from this tracker?")) { data.filter(s => s.phase === "Dead" || s.phase === "Declined").forEach(s => handleRemove(regionKey, s.id)); } }} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🗑 Remove Dead ({data.filter(s => s.phase === "Dead" || s.phase === "Declined").length})</button>}
        </div>
        <SortBar sortBy={sortBy} setSortBy={setSortBy} />
        {data.length === 0 ? (
          <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 40, textAlign: "center", color: "#6B7394", border: "1px solid rgba(201,168,76,0.06)" }}>No sites yet.</div>
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
                <div key={site.id} id={`site-${site.id}`} className={`site-card${isOpen ? " site-card-open" : ""}`} style={{ ...STYLES.cardBase, borderLeft: `4px solid ${isOpen ? "#E87A2E" : (PRIORITY_COLORS[normalizePriority(site.priority)] || region.accent)}`, ...(isOpen ? { boxShadow: "0 12px 48px rgba(232,122,46,0.15), 0 0 0 1px rgba(232,122,46,0.2), 0 0 60px rgba(232,122,46,0.06)", transform: "scale(1.003)", background: "rgba(15,21,56,0.75)" } : {}) }}>
                  {/* Collapsed header */}
                  <IntelCardHeader site={site} onClick={() => { goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span onClick={(e) => { e.stopPropagation(); goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ fontSize: 15, fontWeight: 700, color: "#F4F6FA", cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={(e) => e.currentTarget.style.color = "#E87A2E"} onMouseLeave={(e) => e.currentTarget.style.color = "#F4F6FA"}>{site.name}</span>
                        <SiteScoreBadge site={site} size="small" iq={getSiteScore(site)} />
                        <PriorityBadge priority={site.priority} />
                        <select value={site.phase || "Prospect"} onClick={(e) => e.stopPropagation()} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(15,21,56,0.6)", color: "#C9A84C", cursor: "pointer" }}>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={site.assignedTo || ""} onClick={(e) => e.stopPropagation()} onChange={(e) => { const val = e.target.value; if (val) { const now = new Date().toISOString(); const sub = { ...site, status: "pending", region: regionKey, submittedAt: now, assignedTo: val, needsReview: true, sentBackToReview: true }; delete sub.messages; delete sub.docs; delete sub.activityLog; fbSet(`submissions/${site.id}`, sub); fbRemove(`${regionKey}/${site.id}`); setExpandedSite(null); notify(`${site.name} → Review Queue (assigned to ${val})`); } else { updateSiteField(regionKey, site.id, "assignedTo", ""); updateSiteField(regionKey, site.id, "needsReview", false); } }} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: site.assignedTo ? "1px solid #E87A2E" : "1px solid rgba(201,168,76,0.15)", background: site.assignedTo ? "rgba(232,122,46,0.12)" : "rgba(15,21,56,0.6)", color: site.assignedTo ? "#E87A2E" : "#6B7394", cursor: "pointer" }}>
                          <option value="">Assign to...</option>
                          <option value="Dan R">Dan R</option>
                          <option value="Daniel Wollent">Daniel Wollent</option>
                          <option value="Matthew Toussaint">Matthew Toussaint</option>
                        </select>
                        {site.assignedTo && site.needsReview && <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "1px 6px", borderRadius: 4, border: "1px solid #C9A84C", letterSpacing: "0.04em" }}>NEEDS REVIEW</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7394" }}>{site.address}{site.city ? `, ${site.city}` : ""}{site.state ? `, ${site.state}` : ""}</div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: "#6B7394", flexWrap: "wrap" }}>
                        {site.askingPrice && <span>Ask: <strong style={{ color: "#E2E8F0" }}>{site.askingPrice}</strong></span>}
                        {site.internalPrice && <span>Int: <strong style={{ color: "#E87A2E" }}>{site.internalPrice}</strong></span>}
                        {site.sellerBroker && <span>Broker: <strong style={{ color: "#C9A84C" }}>{site.sellerBroker}</strong></span>}
                        {docs.length > 0 && <span style={{ color: "#6B7394" }}>📁 {docs.length} doc{docs.length !== 1 ? "s" : ""}</span>}
                        {msgs.length > 0 && <span style={{ color: "#E87A2E" }}>💬 {msgs.length}</span>}
                        {site.coordinates && <span>📍</span>}
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#E65100", textDecoration: "none", fontWeight: 600 }}>🔗 Listing</a>}
                        {site.latestNote && <span style={{ color: "#C9A84C", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3, background: "rgba(201,168,76,0.08)", padding: "1px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.15)", animation: "pulseOnce 1.5s ease-out" }} title="Hover card for latest intel">🔥 Intel</span>}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "6px 14px", borderRadius: 8, background: "linear-gradient(135deg, #1565C0, #2C3E6B)", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: "0 2px 12px rgba(21,101,192,0.3)", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", transition: "all 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(21,101,192,0.5)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(21,101,192,0.3)"; }}>📊 Detail</button>
                    <div style={{ fontSize: 16, color: "#CBD5E1", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</div>
                  </IntelCardHeader>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="card-expand" style={{ padding: "0 18px 18px", borderTop: "2px solid transparent", borderImage: "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent) 1" }}>
                      {/* ── Nav Strip — Prev/Next + Keyboard hint ── */}
                      {(() => {
                        const sites = sortData(regionKey === "east" ? east : sw);
                        const ids = sites.map(s => s.id);
                        const curIdx = ids.indexOf(site.id);
                        const prevId = curIdx > 0 ? ids[curIdx - 1] : null;
                        const nextId = curIdx < ids.length - 1 ? ids[curIdx + 1] : null;
                        const navBtnStyle = (disabled) => ({ padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(201,168,76,0.1)", background: disabled ? "rgba(15,21,56,0.4)" : "rgba(15,21,56,0.5)", color: disabled ? "#CBD5E1" : "#94A3B8", fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer", transition: "all .15s", display: "flex", alignItems: "center", gap: 4 });
                        return (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 8px", borderBottom: "1px solid rgba(201,168,76,0.1)", marginBottom: 10 }}>
                            <button disabled={!prevId} onClick={() => { if (prevId) { setExpandedSite(prevId); setTimeout(() => { const el = document.getElementById(`site-${prevId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!prevId)}>▲ Prev</button>
                            <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500, letterSpacing: "0.02em" }}>
                              <span style={{ fontWeight: 700, color: "#94A3B8" }}>{curIdx + 1}</span> of {ids.length} · <span style={{ color: "#CBD5E1" }}>↑↓ keys · Esc close</span>
                            </div>
                            <button disabled={!nextId} onClick={() => { if (nextId) { setExpandedSite(nextId); setTimeout(() => { const el = document.getElementById(`site-${nextId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!nextId)}>Next ▼</button>
                          </div>
                        );
                      })()}

                      {/* ── Executive Property Header — Fire Theme ── */}
                      <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #121218 40%, #1a1520 70%, #0f0c14 100%)", borderRadius: 16, padding: "24px 28px 20px", margin: "0 0 14px", overflow: "hidden", position: "relative", boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)" }}>
                        {/* Top fire accent */}
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent 5%, #1E2761 20%, #C9A84C 40%, #FFD700 50%, #C9A84C 60%, #1E2761 80%, transparent 95%)", opacity: 0.8 }} />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                          {/* Left: SiteScore Score + Bars + Key Stats */}
                          <div style={{ flex: 1, minWidth: 280 }}>
                            {/* Score + Label Row */}
                            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                              <div onClick={() => setShowSiteScoreDetail(prev => ({ ...prev, [site.id]: !prev[site.id] }))} style={{ cursor: "pointer", position: "relative" }} title="Click for detailed SiteScore breakdown">
                                <SiteScoreBadge site={site} iq={getSiteScore(site)} />
                                <div style={{ position: "absolute", bottom: -2, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "#6B7394", fontWeight: 600, letterSpacing: "0.06em", whiteSpace: "nowrap", opacity: 0.7 }}>CLICK FOR DETAIL</div>
                              </div>
                              {site.market && <span style={{ background: "rgba(201,168,76,.12)", color: "#C9A84C", fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(201,168,76,.2)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{site.market}</span>}
                            </div>
                            {/* Key Metrics Strip — Larger */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                              {[
                                { label: "ASKING", val: fmtPrice(site.askingPrice), color: "#E2E8F0" },
                                { label: "ZONING", val: site.zoning || "—", color: site.zoning ? (/by.?right|permitted|allowed/i.test(site.summary || "") ? "#22C55E" : /SUP|conditional|special/i.test(site.zoning || "") ? "#FBBF24" : "rgba(201,168,76,0.1)") : "#94A3B8" },
                                { label: "ACREAGE", val: site.acreage ? `${site.acreage} ac` : "—", color: "#E2E8F0" },
                                { label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "—", color: "#E2E8F0" },
                                { label: "3MI MED INC", val: site.income3mi ? (String(site.income3mi).startsWith("$") ? site.income3mi : "$" + fmtN(site.income3mi)) : "—", color: "#E2E8F0" },
                              ].map((m, idx) => (
                                <div key={idx} style={{ background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,.08)" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", letterSpacing: "0.08em", marginBottom: 4 }}>{m.label}</div>
                                  <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                            {/* ── SiteScore Detail Panel — Click-to-expand ── */}
                            {showSiteScoreDetail[site.id] && (() => {
                              const iqD = getSiteScore(site);
                              const dims = [
                                { key: "population", label: "Population (3-mi)", weight: getIQWeight("population"), icon: "👥", tip: "Census / ESRI 3-mi radius population" },
                                { key: "growth", label: "Growth (5yr CAGR)", weight: getIQWeight("growth"), icon: "📈", tip: "ESRI 2025→2030 population growth rate" },
                                { key: "income", label: "Median HHI (3-mi)", weight: getIQWeight("income"), icon: "💰", tip: "Median household income within 3 miles" },
                                { key: "households", label: "Households (3-mi)", weight: getIQWeight("households"), icon: "🏠", tip: "Household count — demand proxy" },
                                { key: "homeValue", label: "Home Value (3-mi)", weight: getIQWeight("homeValue"), icon: "🏡", tip: "Median home value — affluence signal" },
                                { key: "zoning", label: "Zoning", weight: getIQWeight("zoning"), icon: "🏛️", tip: "Storage permissibility in zoning district" },
                                { key: "psProximity", label: "PS Proximity", weight: getIQWeight("psProximity"), icon: "📦", tip: "Distance to nearest PS — closer = validated market" },
                                { key: "access", label: "Site Access & Size", weight: getIQWeight("access"), icon: "🛣️", tip: "Acreage, frontage, flood, access quality" },
                                { key: "competition", label: "Competition", weight: getIQWeight("competition"), icon: "🏪", tip: "Competing storage within 3 mi" },
                                { key: "marketTier", label: "Market Tier", weight: getIQWeight("marketTier"), icon: "🎯", tip: "Target market alignment (MT/DW tiers)" },
                              ];
                              const scoreColor = (v) => v >= 8 ? "#22C55E" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
                              const scoreLabel = (v) => v >= 9 ? "ELITE" : v >= 8 ? "PRIME" : v >= 7 ? "STRONG" : v >= 6 ? "VIABLE" : v >= 4 ? "MARGINAL" : "WEAK";
                              return (
                                <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(243,124,51,.2)", boxShadow: "0 4px 20px rgba(0,0,0,.25)" }}>
                                  <div style={{ background: "linear-gradient(135deg,#1a0a00,#2a1505)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 14 }}>🔬</span>
                                      <span style={{ color: "#FFB347", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>SiteScore™ DETAILED SCORECARD</span>
                                      <span style={{ color: "#6B7394", fontSize: 10 }}>|</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 13, fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>{iqD.score.toFixed(2)}</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 10, fontWeight: 800, background: scoreColor(iqD.score) + "18", padding: "2px 6px", borderRadius: 4 }}>{scoreLabel(iqD.score)}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setShowSiteScoreDetail(prev => ({ ...prev, [site.id]: false })); }} style={{ background: "none", border: "1px solid rgba(255,255,255,.15)", borderRadius: 5, color: "#6B7394", fontSize: 11, cursor: "pointer", padding: "2px 8px" }}>✕</button>
                                  </div>
                                  <div style={{ background: "linear-gradient(180deg,#0F0A05,#0a0a0e)", padding: "8px 12px" }}>
                                    {dims.map((d, i) => {
                                      const v = iqD.scores[d.key] || 0;
                                      const weighted = (v * d.weight).toFixed(2);
                                      const pct = (v / 10) * 100;
                                      return (
                                        <div key={d.key} style={{ display: "grid", gridTemplateColumns: "28px 1fr 50px 80px 50px 60px", alignItems: "center", gap: 6, padding: "6px 4px", borderBottom: i < dims.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }} title={d.tip}>
                                          <span style={{ fontSize: 13, textAlign: "center" }}>{d.icon}</span>
                                          <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{d.label}</div>
                                            <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 600, letterSpacing: "0.04em" }}>{(d.weight * 100).toFixed(0)}% WEIGHT</div>
                                          </div>
                                          <div style={{ textAlign: "right", fontSize: 14, fontWeight: 900, color: scoreColor(v), fontFamily: "'Space Mono', monospace" }}>{v}</div>
                                          <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 4, height: 10, overflow: "hidden", position: "relative" }}>
                                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${scoreColor(v)}88, ${scoreColor(v)})`, borderRadius: 4, transition: "width 0.5s ease" }} />
                                          </div>
                                          <div style={{ textAlign: "right", fontSize: 10, color: "#94A3B8", fontFamily: "'Space Mono', monospace" }}>×{d.weight.toFixed(2)}</div>
                                          <div style={{ textAlign: "right", fontSize: 11, fontWeight: 800, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>{weighted}</div>
                                        </div>
                                      );
                                    })}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px 4px", borderTop: "2px solid rgba(243,124,51,.2)", marginTop: 4 }}>
                                      <div style={{ fontSize: 10, color: "#6B7394", fontWeight: 600 }}>
                                        {iqD.flags && iqD.flags.length > 0 && iqD.flags.map((f, i) => <span key={i} style={{ display: "inline-block", fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "2px 6px", borderRadius: 4, marginRight: 4 }}>{f}</span>)}
                                      </div>
                                      <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>COMPOSITE: <span style={{ color: "#C9A84C", fontWeight: 900, fontSize: 13, fontFamily: "'Space Mono'" }}>{iqD.score.toFixed(2)}</span> / 10</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          {/* Right: Priority + Phase controls */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
                            <select value={normalizePriority(site.priority) || "⚪ None"} onChange={(e) => updateSiteField(regionKey, site.id, "priority", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `2px solid ${PRIORITY_COLORS[normalizePriority(site.priority)] || "rgba(255,255,255,.15)"}`, fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: PRIORITY_COLORS[normalizePriority(site.priority)] || "rgba(201,168,76,0.1)" }}>
                              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <select value={site.phase || "Prospect"} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 600, color: "#E2E8F0" }}>
                              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            {/* Assigned To */}
                            <select value={site.assignedTo || ""} onChange={(e) => { const val = e.target.value; if (val) { const now = new Date().toISOString(); const sub = { ...site, status: "pending", region: regionKey, submittedAt: now, assignedTo: val, needsReview: true, sentBackToReview: true }; delete sub.messages; delete sub.docs; delete sub.activityLog; fbSet(`submissions/${site.id}`, sub); fbRemove(`${regionKey}/${site.id}`); setExpandedSite(null); notify(`${site.name} → Review Queue (assigned to ${val})`); } else { updateSiteField(regionKey, site.id, "assignedTo", ""); updateSiteField(regionKey, site.id, "needsReview", false); } }} style={{ padding: "6px 10px", borderRadius: 7, border: site.assignedTo ? "2px solid #C9A84C" : "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.assignedTo ? "rgba(201,168,76,.12)" : "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: site.assignedTo ? "#FFD700" : "#94A3B8" }}>
                              <option value="">Assign to...</option>
                              <option value="Dan R">Dan R</option>
                              <option value="Daniel Wollent">Daniel Wollent</option>
                              <option value="Matthew Toussaint">Matthew Toussaint</option>
                            </select>
                            {site.assignedTo && site.needsReview && (
                              <button onClick={() => { updateSiteField(regionKey, site.id, "needsReview", false); updateSiteField(regionKey, site.id, "reviewedBy", "Dan R"); updateSiteField(regionKey, site.id, "reviewedAt", new Date().toISOString()); notify(`SiteScore Approved — ${site.name}`); }} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.02em" }}>✓ SiteScore Approved</button>
                            )}
                            {site.reviewedBy && !site.needsReview && (
                              <div style={{ fontSize: 9, color: "#22C55E", fontWeight: 600, textAlign: "right" }}>✓ SiteScore Approved</div>
                            )}
                            {/* Last Updated */}
                            {(() => {
                              const logs2 = Object.values(site.activityLog || {});
                              const lastLog2 = logs2.length > 0 ? logs2.sort((a, b) => new Date(b.ts || b.date || 0) - new Date(a.ts || a.date || 0))[0] : null;
                              const lastDate2 = lastLog2?.date || site.approvedAt;
                              const daysAgo2 = lastDate2 ? Math.floor((Date.now() - new Date(lastDate2).getTime()) / 86400000) : null;
                              return lastDate2 ? (
                                <div style={{ fontSize: 9, color: daysAgo2 > 30 ? "#EF4444" : daysAgo2 > 14 ? "#F59E0B" : "#22C55E", fontWeight: 600, textAlign: "right" }}>
                                  ● {daysAgo2 === 0 ? "Today" : daysAgo2 === 1 ? "Yesterday" : daysAgo2 + "d ago"}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        {/* Broker + Seller Row */}
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {site.sellerBroker && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Broker: <span style={{ color: "#E2E8F0", fontWeight: 700 }}>{site.sellerBroker}</span></span>}
                          {site.internalPrice && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Internal Price: <span style={{ color: "#F37C33", fontWeight: 700 }}>{site.internalPrice}</span></span>}
                          {dom !== null && <span style={{ fontSize: 12, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#94A3B8", fontWeight: 600 }}>{dom}d on market</span>}
                        </div>
                      </div>

                      {/* Aerial / Satellite View */}
                      <div style={{ margin: "0 0 10px" }}>
                        {site.coordinates ? (
                          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(201,168,76,0.1)" }}>
                            <iframe
                              title={`Aerial — ${site.name}`}
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(site.coordinates)}&t=k&z=17&output=embed`}
                              style={{ width: "100%", height: 220, border: "none" }}
                              loading="lazy"
                              allowFullScreen
                            />
                            <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>AERIAL VIEW</div>
                          </div>
                        ) : (
                          <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 10, padding: "24px 14px", textAlign: "center", border: "1px dashed #CBD5E1" }}>
                            <div style={{ fontSize: 18, marginBottom: 4 }}>🛰️</div>
                            <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Add coordinates to generate aerial view</div>
                          </div>
                        )}
                        {/* Flyer Quick Link */}
                        {(() => {
                          const flyerDoc = docs.find(([, d]) => d.type === "Flyer");
                          return flyerDoc ? (
                            <a href={flyerDoc[1].url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "linear-gradient(135deg,#F37C33,#E8650A)", color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", boxShadow: "0 2px 6px rgba(243,124,51,0.25)" }}>📄 View Flyer — {flyerDoc[1].name?.length > 30 ? flyerDoc[1].name.slice(0, 30) + "…" : flyerDoc[1].name}</a>
                          ) : null;
                        })()}
                      </div>

                      {/* ── PREMIUM ACTION BAR ── */}
                      <div style={{ margin: "16px 0", padding: "14px 0", borderTop: "1px solid rgba(201,168,76,0.08)", borderBottom: "1px solid rgba(201,168,76,0.08)" }}>
                        {/* Top Row — Big Report Buttons */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
                          <button onClick={() => {
                            try { const rpt = generateDemographicsReport(site); if (!rpt) { notify("No demographic data — pull ESRI demographics first."); return; } const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("Demographics report failed."); console.error(err); }
                          }} style={{ padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg, #1565C0, #0D47A1)", color: "#fff", fontSize: 11, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(21,101,192,0.4), 0 0 0 1px rgba(21,101,192,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.15s", whiteSpace: "nowrap" }}>📊 Demos</button>
                          <button onClick={() => {
                            try { const iqR = computeSiteScore(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); autoGenerateVettingReport(regionKey, site.id, site); } catch (err) { notify("Report generation failed — some site data may be missing."); console.error("Vet report error:", err); }
                          }} style={{ padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 11, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(232,122,46,0.4), 0 0 0 1px rgba(232,122,46,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.15s", whiteSpace: "nowrap" }}>🔬 Vet Report</button>
                          <button onClick={() => {
                            try { const iqR = computeSiteScore(site); const rpt = generatePricingReport(site, iqR, [...sw, ...east]); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("Pricing report failed — some site data may be missing."); console.error("Pricing report error:", err); }
                          }} style={{ padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg, #2E7D32, #43A047)", color: "#fff", fontSize: 11, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(46,125,50,0.4), 0 0 0 1px rgba(46,125,50,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.15s", whiteSpace: "nowrap" }}>💰 Pricing</button>
                          <button onClick={() => {
                            try { const iqR = computeSiteScore(site); const rpt = generateRECPackage(site, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("REC Package failed — some site data may be missing."); console.error("REC package error:", err); }
                          }} style={{ padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg, #1E2761, #C9A84C)", color: "#fff", fontSize: 11, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(30,39,97,0.4), 0 0 0 1px rgba(201,168,76,0.3)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.15s", whiteSpace: "nowrap" }}>📋 REC Package</button>
                        </div>
                        {/* Bottom Row — Small Icon Links */}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {site.coordinates && <>
                            <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(21,101,192,0.10)", color: "#42A5F5", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.20)", display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s" }}>🗺 Maps</a>
                            <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(46,125,50,0.10)", color: "#66BB6A", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(46,125,50,0.20)", display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s" }}>🌍 Earth</a>
                          </>}
                          {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(232,122,46,0.10)", color: "#E87A2E", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.20)", display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s" }}>🔗 Listing</a>}
                          {(() => { const fd = docs.find(([, d]) => d.type === "Flyer"); return fd ? <a href={fd[1].url} target="_blank" rel="noopener noreferrer" style={{ padding: "7px 14px", borderRadius: 8, background: "rgba(243,124,51,0.10)", color: "#FFB347", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(243,124,51,0.20)", display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s" }}>📄 Flyer</a> : null; })()}
                        </div>
                      </div>

                      {/* Summary */}
                      <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 10, padding: 14, margin: "10px 0", border: "1px solid rgba(201,168,76,0.08)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.08em" }}>Recent Summary</div>
                        <EF multi label="" value={site.summary || ""} onSave={(v) => saveField(regionKey, site.id, "summary", v)} placeholder="Deal notes, updates…" />
                      </div>

                      {/* ── Editable Detail Fields ── */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                        <EF label="Market" value={site.market || ""} onSave={(v) => saveField(regionKey, site.id, "market", v)} placeholder="DFW, Houston…" />
                        <EF label="Asking Price" value={site.askingPrice || ""} onSave={(v) => saveField(regionKey, site.id, "askingPrice", v)} placeholder="$1.5M" />
                        <EF label="Internal Price" value={site.internalPrice || ""} onSave={(v) => saveField(regionKey, site.id, "internalPrice", v)} placeholder="$1.2M" />
                        <EF label="Seller / Broker" value={site.sellerBroker || ""} onSave={(v) => saveField(regionKey, site.id, "sellerBroker", v)} placeholder="John Smith" />
                        <EF label="3-Mile Income" value={site.income3mi || ""} onSave={(v) => saveField(regionKey, site.id, "income3mi", v)} placeholder="$95,000" />
                        <EF label="3-Mile Pop" value={site.pop3mi || ""} onSave={(v) => saveField(regionKey, site.id, "pop3mi", v)} placeholder="45,000" />
                        <EF label="Acreage" value={site.acreage || ""} onSave={(v) => saveField(regionKey, site.id, "acreage", v)} placeholder="4.5 ac" />
                        <EF label="Zoning" value={site.zoning || ""} onSave={(v) => saveField(regionKey, site.id, "zoning", v)} placeholder="C-2, B3…" />
                      </div>

                      {/* Structured SiteScore Fields */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Zoning Class.</div>
                          <select value={site.zoningClassification || "unknown"} onChange={(e) => { updateSiteField(regionKey, site.id, "zoningClassification", e.target.value); fbPush(`${regionKey}/${site.id}/activityLog`, { action: `Zoning class → ${e.target.value}`, ts: new Date().toISOString(), by: "User" }); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 11, fontFamily: "'Inter', sans-serif", background: site.zoningClassification === "by-right" ? "#F0FDF4" : site.zoningClassification === "prohibited" ? "#FEF2F2" : "rgba(15,21,56,0.35)", color: "#E2E8F0", cursor: "pointer" }}>
                            <option value="unknown">Unknown</option>
                            <option value="by-right">By-Right ✅</option>
                            <option value="conditional">Conditional (SUP/CUP)</option>
                            <option value="rezone-required">Rezone Required</option>
                            <option value="prohibited">Prohibited ❌</option>
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Nearest Facility (mi)</div>
                          <input type="number" step="0.1" min="0" value={site.siteiqData?.nearestPS || ""} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) fbUpdate(`${regionKey}/${site.id}/siteiqData`, { nearestPS: v }); }} placeholder="5.2" style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.35)", color: "#E2E8F0" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Competitors</div>
                          <input type="number" step="1" min="0" value={site.siteiqData?.competitorCount ?? ""} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) fbUpdate(`${regionKey}/${site.id}/siteiqData`, { competitorCount: v }); }} placeholder="3" style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.35)", color: "#E2E8F0" }} />
                        </div>
                      </div>

                      {/* ── DEEP VET PANEL — Zoning, Utilities, Topo Research Fields ── */}
                      <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", border: "1px solid rgba(232,122,46,0.15)" }}>
                        <div style={{ background: "linear-gradient(135deg,#0F1538,#1E2761)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>🔬</span>
                            <span style={{ color: "#E87A2E", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>DEEP VET — ZONING &amp; UTILITIES</span>
                          </div>
                          <span style={{ fontSize: 9, color: "#6B7394", fontWeight: 600 }}>Institutional-grade research fields</span>
                        </div>
                        <div style={{ background: "rgba(15,21,56,0.3)", padding: "12px 16px" }}>
                          {/* ZONING RESEARCH */}
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 2, background: "#C9A84C", borderRadius: 1 }} /> Zoning & Entitlements
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                            <EF label="Ordinance Source (URL / Section)" value={site.zoningSource || ""} onSave={(v) => saveField(regionKey, site.id, "zoningSource", v)} placeholder="ecode360.com/CityName §14.3.2" />
                            <EF label="Planning Dept Contact" value={site.planningContact || ""} onSave={(v) => saveField(regionKey, site.id, "planningContact", v)} placeholder="Jane Smith (972) 555-1234" />
                          </div>
                          <EF multi label="Zoning Research Notes" value={site.zoningNotes || ""} onSave={(v) => saveField(regionKey, site.id, "zoningNotes", v)} placeholder="Permitted use table: §14-3, Table 14-1 — 'Storage Warehouse (Mini)' listed as P (Permitted) in C-3 district. No overlay. Setbacks: 25' front, 10' side, 15' rear. Height limit: 35'. Parking: 1 per 50 units." />

                          {/* UTILITIES RESEARCH */}
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.08em", margin: "14px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 2, background: "#16A34A", borderRadius: 1 }} /> Utilities & Water
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="Water Provider" value={site.waterProvider || ""} onSave={(v) => saveField(regionKey, site.id, "waterProvider", v)} placeholder="City of Argyle / Mustang SUD" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Water Available</div>
                              <select value={site.waterAvailable === true ? "yes" : site.waterAvailable === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "waterAvailable", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.waterAvailable === true ? "rgba(22,163,74,0.1)" : site.waterAvailable === false ? "rgba(239,68,68,0.1)" : "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not confirmed</option>
                                <option value="yes">YES — Municipal</option>
                                <option value="no">NO — Extension required</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="Sewer Provider" value={site.sewerProvider || ""} onSave={(v) => saveField(regionKey, site.id, "sewerProvider", v)} placeholder="City Municipal / Septic" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Sewer Available</div>
                              <select value={site.sewerAvailable === true ? "yes" : site.sewerAvailable === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "sewerAvailable", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.sewerAvailable === true ? "rgba(22,163,74,0.1)" : site.sewerAvailable === false ? "rgba(239,68,68,0.1)" : "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not confirmed</option>
                                <option value="yes">YES</option>
                                <option value="no">NO</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="Electric Provider" value={site.electricProvider || ""} onSave={(v) => saveField(regionKey, site.id, "electricProvider", v)} placeholder="Oncor / CoServ" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>3-Phase Power</div>
                              <select value={site.threePhase === true ? "yes" : site.threePhase === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "threePhase", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not confirmed</option>
                                <option value="yes">Available</option>
                                <option value="no">Not available</option>
                              </select>
                            </div>
                            <EF label="Tap/Impact Fees" value={site.tapFees || ""} onSave={(v) => saveField(regionKey, site.id, "tapFees", v)} placeholder="$4,200 commercial" />
                          </div>
                          <EF multi label="Utility Research Notes" value={site.utilityNotes || ""} onSave={(v) => saveField(regionKey, site.id, "utilityNotes", v)} placeholder="Site is inside Mustang SUD CCN boundary. 8&quot; water main on Faught Rd (adjacent). Sewer: city municipal, main at property line. Oncor electric, 3-phase available. Gas: Atmos Energy. Tap fees: $4,200 water, $3,800 sewer per 2026 published schedule." />

                          {/* TOPOGRAPHY & FLOOD */}
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#E87A2E", textTransform: "uppercase", letterSpacing: "0.08em", margin: "14px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 2, background: "#E87A2E", borderRadius: 1 }} /> Topography & Flood
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="FEMA Flood Zone" value={site.floodZone || ""} onSave={(v) => saveField(regionKey, site.id, "floodZone", v)} placeholder="Zone X (no flood)" />
                            <EF label="Terrain" value={site.terrain || ""} onSave={(v) => saveField(regionKey, site.id, "terrain", v)} placeholder="Flat, <2% grade" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Wetlands</div>
                              <select value={site.wetlands === true ? "yes" : site.wetlands === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "wetlands", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not checked</option>
                                <option value="no">None identified</option>
                                <option value="yes">Present</option>
                              </select>
                            </div>
                            <EF label="Grading Risk" value={site.gradingRisk || ""} onSave={(v) => saveField(regionKey, site.id, "gradingRisk", v)} placeholder="Low / Medium / High" />
                          </div>
                          <EF multi label="Topo & Environmental Notes" value={site.topoNotes || ""} onSave={(v) => saveField(regionKey, site.id, "topoNotes", v)} placeholder="FEMA Zone X (Panel 48121C0405G). Flat terrain, ~3ft fall NW to SE across 400ft. No wetlands per NWI. Clay soil per USDA Web Soil Survey — standard for DFW. No environmental flags." />
                        </div>
                      </div>

                      {/* ── Auto Demographics Snapshot — always visible when data exists ── */}
                      {(site.pop3mi || site.income3mi) && (() => {
                        const pN = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                        const fP = (v, pre) => { const n = pN(v); return n != null ? (pre || "") + n.toLocaleString() : null; };
                        const gVal = site.popGrowth3mi ? (typeof site.popGrowth3mi === "number" ? site.popGrowth3mi : parseFloat(site.popGrowth3mi)) : null;
                        const gColor = gVal != null ? (gVal > 0 ? "#22C55E" : gVal < 0 ? "#EF4444" : "#94A3B8") : "#64748B";
                        const gLabel = gVal != null ? ((gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "% /yr") : null;
                        const gOutlook = gVal != null ? (gVal > 1.5 ? "High Growth" : gVal > 0.5 ? "Growing" : gVal > 0 ? "Stable Growth" : gVal > -0.5 ? "Flat" : "Declining") : null;
                        const oColor = gVal != null ? (gVal > 1.5 ? "#22C55E" : gVal > 0.5 ? "#4ADE80" : gVal > 0 ? "#FBBF24" : gVal > -0.5 ? "#94A3B8" : "#EF4444") : "#64748B";
                        const rows = [
                          { label: "Population (3-mi)", val: fP(site.pop3mi), icon: "👥" },
                          { label: "Median HHI (3-mi)", val: fP(site.income3mi, "$"), icon: "💰" },
                          { label: "Pop Growth (ESRI 2025→2030)", val: gLabel, icon: "📈", color: gColor },
                          { label: "Growth Outlook", val: gOutlook, icon: "🔮", color: oColor },
                          { label: "Households (3-mi)", val: fP(site.households3mi), icon: "🏠" },
                          { label: "Median Home Value (3-mi)", val: fP(site.homeValue3mi, "$"), icon: "🏡" },
                          { label: "Acreage", val: site.acreage ? site.acreage + " ac" : null, icon: "📐" },
                          { label: "Price / Acre", val: (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); const a = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() + "/ac" : null; })(), icon: "🏷️" },
                          { label: "Nearest Facility", val: site.siteiqData?.nearestPS ? site.siteiqData.nearestPS.toFixed(1) + " mi" : null, icon: "📍" },
                          { label: "Competitors (3-mi)", val: site.siteiqData?.competitorCount != null ? String(site.siteiqData.competitorCount) : null, icon: "🏪" },
                        ].filter(r => r.val != null);
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.12)", border: "1px solid #E8ECF0" }}>
                            <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#1565C0 100%)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14 }}>📊</span>
                                <span style={{ color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>SITE DEMOGRAPHICS</span>
                                <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 9, fontWeight: 900, padding: "2px 7px", borderRadius: 5, letterSpacing: "0.06em" }}>ESRI 2025</span>
                              </div>
                              <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id]} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)", color: demoLoading[site.id] ? "#64748B" : "#22D3EE", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                {demoLoading[site.id] ? "⏳" : "🔄"} {demoLoading[site.id] ? "Loading..." : "Full Report"}
                              </button>
                            </div>
                            <div style={{ background: "rgba(15,21,56,0.35)", padding: "4px 0" }}>
                              {rows.map((row, i) => (
                                <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", alignItems: "center", padding: "7px 16px", borderBottom: i < rows.length - 1 ? "1px solid rgba(201,168,76,0.1)" : "none", transition: "background .15s" }}>
                                  <span style={{ fontSize: 13, textAlign: "center" }}>{row.icon}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8" }}>{row.label}</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: row.color || "#E2E8F0", fontFamily: "'Space Mono', monospace", textAlign: "right" }}>{row.val}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Pull Demographics — Full ESRI Report */}
                      {!(site.pop3mi || site.income3mi) && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                          <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id] || !site.coordinates} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: demoLoading[site.id] ? "#E8F0FE" : "linear-gradient(135deg,#1565C0,#1976D2)", color: demoLoading[site.id] ? "#1565C0" : "#fff", fontSize: 11, fontWeight: 700, cursor: site.coordinates ? "pointer" : "not-allowed", opacity: site.coordinates ? 1 : 0.5, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(21,101,192,.2)" }}>
                            {demoLoading[site.id] ? "⏳ Fetching…" : "📊 Pull Demographics"}
                          </button>
                        </div>
                      )}

                      {/* ESRI Demographic Report — Executive Dashboard */}
                      {demoReport[site.id] && (() => {
                        const dr = demoReport[site.id];
                        const r = dr.rings || {};
                        const fmtV = (v, prefix) => v != null ? (prefix || "") + (typeof v === "number" ? v.toLocaleString() : v) : "—";
                        const fmtGrowth = (v) => { if (v == null || v === "") return "—"; const n = typeof v === "number" ? v : parseFloat(String(v)); if (isNaN(n)) return String(v); return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; };
                        const growthColor = (s) => { if (!s && s !== 0) return "#64748B"; const n = typeof s === "number" ? s : parseFloat(String(s)); if (!isNaN(n)) return n > 0 ? "#16A34A" : n < 0 ? "#EF4444" : "#64748B"; const str = String(s); return str.includes("+") ? "#16A34A" : str.includes("-") ? "#EF4444" : "#64748B"; };
                        const hdrCell = { padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 800, color: "#CBD5E1", textTransform: "uppercase", letterSpacing: "0.06em" };
                        const metricCell = { padding: "7px 12px", fontWeight: 700, color: "#E2E8F0", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const valCell = { padding: "7px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, fontFamily: "'Inter', monospace", borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const goldVal = { ...valCell, color: "#C9A84C" };
                        const whiteVal = { ...valCell, color: "#E2E8F0" };
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.15)" }}>
                            {/* Header */}
                            <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E3A5F 50%,#1565C0 100%)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 16 }}>📊</span>
                                <div>
                                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>DEMOGRAPHIC INTELLIGENCE <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 5, letterSpacing: "0.06em" }}>2025</span></div>
                                  <div style={{ color: "#94A3B8", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", marginTop: 2 }}>ESRI ArcGIS GeoEnrichment — <span style={{ color: "#22D3EE" }}>Live Geocoded</span> — Current Year + 2030 Projections</div>
                                </div>
                              </div>
                              <button onClick={() => setDemoReport((prev) => { const n = { ...prev }; delete n[site.id]; return n; })} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.05)", color: "#94A3B8", fontSize: 11, cursor: "pointer", transition: "all .2s" }}>✕</button>
                            </div>
                            {/* Ring Radius Table */}
                            <div style={{ background: "linear-gradient(180deg,#1E293B,#0F172A)", padding: "2px 16px 10px" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...hdrCell, textAlign: "left", width: "30%" }}></th>
                                    <th style={hdrCell}>1-MILE</th>
                                    <th style={{ ...hdrCell, background: "rgba(201,168,76,.08)", borderRadius: "8px 8px 0 0" }}>3-MILE</th>
                                    <th style={hdrCell}>5-MILE</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td style={metricCell}>Population</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.pop)}</td>
                                    <td style={{ ...goldVal, background: "rgba(201,168,76,.06)" }}>{fmtV(r[3]?.pop)}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.pop)}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Median HHI</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.medIncome, "$")}</td>
                                    <td style={{ ...goldVal, background: "rgba(201,168,76,.06)" }}>{fmtV(r[3]?.medIncome, "$")}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.medIncome, "$")}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Households</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.hh)}</td>
                                    <td style={{ ...goldVal, background: "rgba(201,168,76,.06)" }}>{fmtV(r[3]?.hh)}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.hh)}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Median Home Value</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.homeValue, "$")}</td>
                                    <td style={{ ...goldVal, background: "rgba(201,168,76,.06)" }}>{fmtV(r[3]?.homeValue, "$")}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.homeValue, "$")}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Renter %</td>
                                    <td style={whiteVal}>{r[1]?.renterPct || "—"}</td>
                                    <td style={{ ...goldVal, background: "rgba(201,168,76,.06)" }}>{r[3]?.renterPct || "—"}</td>
                                    <td style={whiteVal}>{r[5]?.renterPct || "—"}</td>
                                  </tr>
                                  <tr>
                                    <td style={{ ...metricCell, borderBottom: "none" }}>Pop Growth (CAGR)</td>
                                    <td style={{ ...whiteVal, borderBottom: "none", color: growthColor(r[1]?.popGrowth) }}>{fmtGrowth(r[1]?.popGrowth)}</td>
                                    <td style={{ ...goldVal, background: "rgba(201,168,76,.06)", borderBottom: "none", color: growthColor(r[3]?.popGrowth) }}>{fmtGrowth(r[3]?.popGrowth)}</td>
                                    <td style={{ ...whiteVal, borderBottom: "none", color: growthColor(r[5]?.popGrowth) }}>{fmtGrowth(r[5]?.popGrowth)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            {/* 2030 Projections Strip */}
                            {(dr.pop3mi_fy || dr.income3mi_fy) && (
                              <div style={{ background: "linear-gradient(135deg,#0F172A,#1a1a2e)", padding: "10px 16px", borderTop: "1px solid rgba(201,168,76,.15)" }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: "#C9A84C", letterSpacing: "0.1em", marginBottom: 6 }}>2030 FIVE-YEAR PROJECTIONS (3-MILE)</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                                  {[
                                    { label: "Population", val: dr.pop3mi_fy, growth: dr.popGrowth3mi },
                                    { label: "Median HHI", val: dr.income3mi_fy, growth: dr.incomeGrowth3mi },
                                    { label: "Households", val: dr.households3mi_fy, growth: dr.hhGrowth3mi },
                                    { label: "Outlook", val: dr.growthOutlook, isOutlook: true },
                                  ].map((item, idx) => (
                                    <div key={idx} style={{ background: "rgba(255,255,255,.04)", borderRadius: 8, padding: "6px 8px", textAlign: "center", border: "1px solid rgba(255,255,255,.06)" }}>
                                      <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{item.label}</div>
                                      {item.isOutlook ? (
                                        <div style={{ fontSize: 11, fontWeight: 800, color: item.val?.includes("High") || item.val?.includes("Growing") ? "#22C55E" : item.val?.includes("Declining") ? "#EF4444" : "#FBBF24" }}>{item.val || "—"}</div>
                                      ) : (
                                        <>
                                          <div style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F0", fontFamily: "'Inter', monospace" }}>{item.val || "—"}</div>
                                          {item.growth && <div style={{ fontSize: 9, fontWeight: 700, color: growthColor(item.growth), marginTop: 1 }}>{fmtGrowth(item.growth)} /yr</div>}
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Footer */}
                            <div style={{ background: "#0F172A", padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 8, color: "#94A3B8", letterSpacing: "0.04em" }}>ESRI ArcGIS GeoEnrichment (paid)</span>
                              <span style={{ fontSize: 8, color: "#94A3B8" }}>{dr.pulledAt ? `Updated ${new Date(dr.pulledAt).toLocaleDateString()}` : ""}</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Date on Market */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Date on Market</div>
                          <input type="date" value={site.dateOnMarket || ""} onChange={(e) => updateSiteField(regionKey, site.id, "dateOnMarket", e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 13, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.35)", color: "#E2E8F0", outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Days on Market</div>
                          <div style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 13, background: "rgba(15,21,56,0.4)", color: dom !== null ? "#E2E8F0" : "#CBD5E1", fontWeight: dom !== null ? 700 : 400 }}>{dom !== null ? `${dom} days` : "—"}</div>
                        </div>
                      </div>

                      {/* Coordinates */}
                      <div style={{ marginBottom: 12 }}>
                        <EF label="Coordinates (lat, lng)" value={site.coordinates || ""} onSave={(v) => saveField(regionKey, site.id, "coordinates", v)} placeholder="39.123, -84.456" />
                      </div>

                      {/* Listing URL */}
                      <div style={{ marginBottom: 14 }}>
                        <EF label="Listing URL (Crexi / LoopNet)" value={site.listingUrl || ""} onSave={(v) => saveField(regionKey, site.id, "listingUrl", v)} placeholder="https://www.crexi.com/…" />
                      </div>

                      {/* Documents */}
                      <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid rgba(201,168,76,0.1)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 10 }}>📁 Documents</div>
                        {docs.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {docs.map(([docKey, doc]) => (
                              <div key={docKey} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(15,21,56,0.5)", border: "1px solid rgba(201,168,76,0.1)", borderRadius: 8, padding: "5px 10px", fontSize: 11 }}>
                                <span style={{ fontWeight: 600, color: "#94A3B8" }}>{doc.type}: {doc.name?.length > 20 ? doc.name.slice(0, 20) + "…" : doc.name}</span>
                                <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1565C0", fontWeight: 600, textDecoration: "none" }}>↗ View</a>
                                {/* Delete disabled — Dan controls all data */}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Upload disabled — Dan controls all data */}
                      </div>

                      {/* Messages */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>💬 Thread</div>
                        {msgs.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                            {[...msgs].sort((a, b) => new Date(a.ts) - new Date(b.ts)).map((m, i) => {
                              const mc = MSG_COLORS[m.from] || { bg: "rgba(15,21,56,0.4)", border: "rgba(201,168,76,0.1)", text: "#94A3B8" };
                              return (
                                <div key={i} style={{ background: mc.bg, border: `1px solid ${mc.border}`, borderRadius: 8, padding: "8px 10px" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: mc.text, marginBottom: 2 }}>{m.from} · {m.ts ? new Date(m.ts).toLocaleDateString() : ""}</div>
                                  <div style={{ fontSize: 13, color: "#E2E8F0" }}>{m.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6 }}>
                          <select value={mi.from} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, from: e.target.value } })} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 11, background: "rgba(15,21,56,0.5)", cursor: "pointer", minWidth: 130 }}>
                            <option>Dan R</option>
                            <option>Daniel Wollent</option>
                            <option>Matthew Toussaint</option>
                            <option>Brian Karis</option>
                          </select>
                          <input value={mi.text} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, text: e.target.value } })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSendMsg(regionKey, site.id); } }} placeholder="Add message…" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 13, outline: "none", fontFamily: "'Inter', sans-serif" }} />
                          <button type="button" onClick={(e) => { e.preventDefault(); handleSendMsg(regionKey, site.id); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Send</button>
                        </div>
                      </div>

                      {/* Activity Log */}
                      {logs.length > 0 && (
                        <details style={{ marginBottom: 10 }}>
                          <summary style={{ fontSize: 11, color: "#94A3B8", cursor: "pointer", fontWeight: 600 }}>Activity Log ({logs.length})</summary>
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                            {[...logs].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 20).map((l, i) => (
                              <div key={i} style={{ fontSize: 11, color: "#94A3B8" }}>
                                <span style={{ color: "#6B7394" }}>{l.ts ? new Date(l.ts).toLocaleDateString() : ""}</span> — {l.action}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* Send to Review / Remove */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => { if (window.confirm(`Send "${site.name}" back to Review Queue?`)) handleSendToReview(regionKey, site.id, site); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(232,122,46,0.3)", background: "rgba(232,122,46,0.08)", color: "#E87A2E", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>↩ Send to Review</button>
                        <button onClick={() => { if (window.confirm(`Remove "${site.name}"?`)) handleRemove(regionKey, site.id); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #FCA5A5", background: "rgba(153,27,27,0.08)", color: "#FCA5A5", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>🗑 Remove Site</button>
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

  // ═══ RENDER ═══
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg, #0F1538 0%, #1E2761 30%, #0F1538 60%, #0A0E2A 100%)", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#E2E8F0" }}>
      {/* AI NEURAL NETWORK BACKGROUND — Circuit Grid + Data Streams + Lightning */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        {/* Circuit grid pattern */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.03 }}>
          <defs><pattern id="circuit" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M0 40h30M50 40h30M40 0v30M40 50v30" stroke="#E87A2E" strokeWidth="0.5" fill="none"/>
            <circle cx="40" cy="40" r="2" fill="#E87A2E"/>
            <circle cx="0" cy="40" r="1.5" fill="#39FF14"/>
            <circle cx="80" cy="40" r="1.5" fill="#39FF14"/>
            <circle cx="40" cy="0" r="1.5" fill="#00E5FF"/>
            <circle cx="40" cy="80" r="1.5" fill="#00E5FF"/>
          </pattern></defs>
          <rect width="100%" height="100%" fill="url(#circuit)"/>
        </svg>
        {/* Subtle data stream particles — 8 particles, slow, muted */}
        {[...Array(8)].map((_, i) => (
          <div key={i} style={{ position: "absolute", left: `${8 + i * 12}%`, bottom: "-10px", width: 1, height: 1, borderRadius: "50%", background: i % 2 === 0 ? "#C9A84C" : "#2C3E6B", opacity: 0, animation: `dataStream ${8 + (i % 3) * 4}s ${i * 1.5}s infinite cubic-bezier(0.22,1,0.36,1)` }} />
        ))}
        {/* Subtle scan line */}
        <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 20%, rgba(201,168,76,0.03) 50%, transparent 80%)", animation: "scanLine 12s linear infinite" }} />
      </div>
      {transitioning && <div className="tab-transition-overlay" />}
      {/* Styles moved to App.css — only inline overrides below */}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 24, background: "linear-gradient(135deg, rgba(15,15,20,0.97), rgba(30,20,15,0.95))", color: "#fff", padding: "12px 22px", borderRadius: 14, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(243,124,51,0.2), 0 0 30px rgba(243,124,51,0.08)", animation: "toastSlide 0.35s cubic-bezier(0.4,0,0.2,1)", borderLeft: "3px solid transparent", borderImage: "linear-gradient(180deg, #FFB347, #F37C33, #D45500) 1", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFB347, #F37C33)", boxShadow: "0 0 8px rgba(243,124,51,0.6)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate", flexShrink: 0 }} />{toast}</div>
      )}

      {/* SiteScore Weight Config Modal */}
      <SiteScoreConfigModal
        show={showIQConfig}
        onClose={() => setShowIQConfig(false)}
        iqWeights={iqWeights}
        setIqWeights={setIqWeights}
        onSave={handleSaveWeights}
        SITE_SCORE_DEFAULTS={SITE_SCORE_DEFAULTS}
      />

      {/* New site alert */}
      {showNewAlert && (
        <div style={{ background: "linear-gradient(135deg, rgba(243,124,51,0.08), rgba(255,179,71,0.06))", borderBottom: "1px solid rgba(243,124,51,0.2)", padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, animation: "fadeIn 0.35s ease-out", backdropFilter: "blur(8px)" }}>
          <span style={{ fontSize: 13, color: "#92700C", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />{newSiteCount} new site{newSiteCount > 1 ? "s" : ""} pending review</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Review</button>
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      )}

      {/* Header — SiteScore Theme */}
      <div style={STYLES.frostedHeader}>
        {/* Clean header accent */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, #1E2761 15%, #C9A84C 35%, #E87A2E 50%, #C9A84C 65%, #1E2761 85%, transparent 100%)", opacity: 0.5 }} />
        {/* SiteScore Banner */}
        <div style={{ padding: "12px 0 8px", borderBottom: "1px solid rgba(201,168,76,0.08)", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="logo-spin-container" onClick={(e) => { e.currentTarget.querySelector('.logo-img')?.classList.remove('logo-click-spin'); void e.currentTarget.querySelector('.logo-img')?.offsetWidth; e.currentTarget.querySelector('.logo-img')?.classList.add('logo-click-spin'); }} style={{ width: 48, height: 48, borderRadius: 12, cursor: "pointer", position: "relative", boxShadow: "0 4px 20px rgba(232,122,46,0.25), 0 0 0 1px rgba(201,168,76,0.15)", flexShrink: 0 }}>
                <img className="logo-img logo-auto-spin" src="/storvex-logo.png" alt="SiteScore" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.08em", background: "linear-gradient(90deg, #fff 0%, #C9A84C 25%, #FFD700 50%, #C9A84C 75%, #fff 100%)", backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 4s linear infinite" }}>STORVEX</div>
                <div style={{ fontSize: 10, color: "#6B7394", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 1 }}>AI-Powered Data</div>
                <div style={{ fontSize: 8, color: "#6B7394", letterSpacing: "0.06em", marginTop: 2, fontWeight: 600 }}>Powered by DJR Real Estate LLC · <span style={{ color: "#C9A84C" }}>Patent Pending</span></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowIQConfig(true)} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(201,168,76,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >⚙️ SiteScore Config</button>
              <button onClick={handleExport} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(243,124,51,0.25)", background: "rgba(243,124,51,0.06)", color: "#F37C33", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(243,124,51,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >⬇ Export Excel</button>
            </div>
          </div>
        </div>

        {/* Nav — Fire accent tabs */}
        <div style={{ display: "flex", gap: 4, overflowX: "auto", padding: "6px 0 4px", scrollbarWidth: "none" }}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "summary", label: "Summary" },
            { key: "southwest", label: "Daniel Wollent" },
            { key: "east", label: "Matthew Toussaint" },
            { key: "submit", label: "Submit Site" },
            { key: "review", label: pendingN > 0 ? `Review (${pendingN})` : "Review" },
            { key: "inputs", label: "\u26A1 Valuation Engine" },
          ].map((n) => (
            <button key={n.key} onClick={() => navigateTo(n.key)} style={{ ...navBtn(n.key), position: "relative", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" }}
              onMouseEnter={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#E87A2E"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.textShadow = "0 0 16px rgba(232,122,46,0.4)"; } }}
              onMouseLeave={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#6B7394"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.textShadow = "none"; } }}
            >
              {n.label}
              {n.key === "review" && pendingN > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", position: "relative", zIndex: 1 }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Pipeline", value: sw.length + east.length, color: "#F37C33", icon: "📊", action: () => navigateTo("summary"), sub: "View summary →" },
                { label: "Pending", value: pendingN, color: "#F59E0B", icon: "⏳", action: () => navigateTo("review"), sub: "Review queue →" },
                { label: "Daniel Wollent", value: sw.length, color: REGIONS.southwest.accent, icon: "🔷", action: () => navigateTo("southwest"), sub: "Open tracker →" },
                { label: "Matthew Toussaint", value: east.length, color: REGIONS.east.accent, icon: "🟢", action: () => navigateTo("east"), sub: "Open tracker →" },
              ].map((kpi, kpiIdx) => (
                <div key={kpi.label} onClick={kpi.action} className="card-reveal" style={{ ...STYLES.kpiCard(kpi.color), animationDelay: `${kpiIdx * 0.08}s` }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px) scale(1.02)"; e.currentTarget.style.boxShadow = `0 12px 40px rgba(0,0,0,0.3), 0 0 30px ${kpi.color}25, inset 0 1px 0 rgba(255,255,255,0.08)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0) scale(1)"; e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)`; }}>
                  {/* Ambient glow line */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${kpi.color}40, transparent)`, opacity: 0.8 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>{kpi.label}</div>
                    <span style={{ fontSize: 18, opacity: 0.7, filter: "grayscale(0.15)" }}>{kpi.icon}</span>
                  </div>
                  <div className="kpi-number" style={{ fontSize: 38, fontWeight: 900, color: "#fff", marginTop: 8, fontFamily: "'Space Mono', monospace", letterSpacing: "-0.03em", position: "relative", zIndex: 1, textShadow: `0 0 30px ${kpi.color}30` }}>{kpi.value}</div>
                  <div style={{ fontSize: 10, color: kpi.color, marginTop: 6, fontWeight: 700, letterSpacing: "0.02em", position: "relative", zIndex: 1 }}>{kpi.sub}</div>
                  {/* Bottom fire accent line */}
                  <div style={{ position: "absolute", bottom: 0, left: "10%", right: "10%", height: 2, background: `linear-gradient(90deg, transparent, ${kpi.color}50, transparent)`, borderRadius: 2 }} />
                </div>
              ))}
            </div>

            {/* ── ACTION ITEMS BANNER — personalized for DW/MT ── */}
            {(() => {
              const dwQueue = subs.filter(s => s.status === "recommended" && (s.routedTo === "southwest" || s.region === "southwest"));
              const mtQueue = subs.filter(s => s.status === "recommended" && (s.routedTo === "east" || s.region === "east"));
              const myQueue = subs.filter(s => s.status === "pending");
              const actionItems = [];
              if (myQueue.length > 0) {
                const topSite = myQueue.sort((a, b) => (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0))[0];
                actionItems.push({ who: "Dan R.", count: myQueue.length, top: topSite, color: "#C9A84C", tab: "mine", icon: "📋" });
              }
              if (dwQueue.length > 0) {
                const topSite = dwQueue.sort((a, b) => (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0))[0];
                actionItems.push({ who: "Daniel Wollent", count: dwQueue.length, top: topSite, color: "#42A5F5", tab: "dw", icon: "◆" });
              }
              if (mtQueue.length > 0) {
                const topSite = mtQueue.sort((a, b) => (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0))[0];
                actionItems.push({ who: "Matthew Toussaint", count: mtQueue.length, top: topSite, color: "#4CAF50", tab: "mt", icon: "●" });
              }
              if (actionItems.length === 0) return null;
              return (
                <div className="card-reveal" style={{ background: "linear-gradient(135deg, rgba(232,122,46,0.06), rgba(201,168,76,0.04))", borderRadius: 14, padding: 16, marginBottom: 16, border: "1px solid rgba(232,122,46,0.15)", animationDelay: "0.35s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", boxShadow: "0 0 10px rgba(232,122,46,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#E87A2E", textTransform: "uppercase", letterSpacing: "0.08em" }}>Action Required</span>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {actionItems.map(ai => (
                      <div key={ai.who} onClick={() => { navigateTo("review"); setTimeout(() => setReviewTab(ai.tab), 50); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, background: "rgba(15,21,56,0.5)", border: `1px solid ${ai.color}25`, cursor: "pointer", transition: "all 0.2s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${ai.color}50`; e.currentTarget.style.transform = "translateX(4px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${ai.color}25`; e.currentTarget.style.transform = "translateX(0)"; }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>{ai.icon} {ai.who} — <span style={{ color: ai.color }}>{ai.count} site{ai.count !== 1 ? "s" : ""} awaiting review</span></div>
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Top: <strong style={{ color: "#E2E8F0" }}>{ai.top.name}</strong> — SiteScore {getSiteScore(ai.top).score}</div>
                        </div>
                        <span style={{ fontSize: 12, color: ai.color, fontWeight: 700 }}>Review →</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Velocity Stats + Last Updated */}
            {(() => {
              const all = [...sw, ...east];
              const now = Date.now();
              const week = 7 * 86400000;
              const addedThisWeek = all.filter(s => s.approvedAt && (now - new Date(s.approvedAt).getTime()) < week).length;
              const ucCount = all.filter(s => s.phase === "Under Contract").length;
              const loiCount = all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length;
              const greenCount = all.filter(s => getSiteScore(s).score >= 8.0).length;
              return (
                <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap" }}>
                    {[
                      { label: "Added this week", value: addedThisWeek, color: "#3B82F6", action: () => navigateTo("summary") },
                      { label: "Under Contract", value: ucCount, color: "#16A34A", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "LOI Active", value: loiCount, color: "#F59E0B", action: () => navigateTo("summary", { phase: "LOI" }) },
                      { label: "GREEN Sites", value: greenCount, color: "#22C55E", action: () => navigateTo("summary") },
                    ].map((v, vi) => (
                      <div key={v.label} onClick={v.action} className="card-reveal funnel-bar" style={{ flex: "1 1 100px", background: "rgba(255,255,255,0.92)", borderRadius: 12, padding: "10px 14px", border: `1px solid ${v.color}18`, textAlign: "center", animationDelay: `${0.3 + vi * 0.06}s`, backdropFilter: "blur(8px)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", position: "relative", overflow: "hidden", cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 16px ${v.color}18`; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        <div style={{ fontSize: 20, fontWeight: 900, color: v.color, fontFamily: "'Space Mono', monospace", position: "relative", zIndex: 1 }}>{v.value}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em", position: "relative", zIndex: 1 }}>{v.label}</div>
                        <div style={{ position: "absolute", bottom: 0, left: "20%", right: "20%", height: 2, background: `linear-gradient(90deg, transparent, ${v.color}40, transparent)` }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8", textAlign: "right", whiteSpace: "nowrap" }}>
                    Data as of {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}<br />
                    <span style={{ fontWeight: 600 }}>{all.length} active sites</span>
                  </div>
                </div>
              );
            })()}

            {/* ═══ DEAL MOMENTUM — Executive Pulse ═══ */}
            {(() => {
              const all = [...sw, ...east];
              const now = Date.now();
              const DAY = 86400000;
              const WEEK = 7 * DAY;

              // --- Recent phase advances (last 30 days) ---
              const recentMoves = [];
              all.forEach(s => {
                const history = s.phaseHistory ? Object.values(s.phaseHistory) : [];
                history.forEach(h => {
                  if (h.changedAt) {
                    const age = now - new Date(h.changedAt).getTime();
                    if (age < 30 * DAY && age >= 0) {
                      const regionKey = sw.find(x => x.id === s.id) ? "southwest" : "east";
                      recentMoves.push({ name: s.name, from: h.from, to: h.to, date: h.changedAt, daysAgo: Math.floor(age / DAY), region: regionKey === "southwest" ? "DW" : "MT", regionKey, siteId: s.id });
                    }
                  }
                });
              });
              recentMoves.sort((a, b) => a.daysAgo - b.daysAgo);

              // --- Pipeline value by stage ---
              const parsePrice = (p) => { if (!p) return 0; const s = String(p).replace(/[$,]/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s) || 0; };
              const loiValue = all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const ucValue = all.filter(s => s.phase === "Under Contract").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const prospectValue = all.filter(s => s.phase === "Prospect").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const fmtVal = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`;

              // --- Phase distribution for mini bars ---
              const phaseGroups = [
                { label: "Prospect", phases: ["Prospect"], color: "#3B82F6", icon: "🔍", action: () => navigateTo("summary", { phase: "Prospect" }) },
                { label: "Submitted to PS", phases: ["Submitted to PS"], color: "#6366F1", icon: "📤", action: () => navigateTo("summary", { phase: "Submitted to PS" }) },
                { label: "SiteScore Approved", phases: ["SiteScore Approved"], color: "#8B5CF6", icon: "⚡", action: () => navigateTo("summary", { phase: "SiteScore Approved" }) },
                { label: "LOI / PSA", phases: ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"], color: "#F37C33", icon: "📝", action: () => navigateTo("summary", { phase: "LOI" }) },
                { label: "Under Contract", phases: ["Under Contract"], color: "#16A34A", icon: "🤝", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", phases: ["Closed"], color: "#059669", icon: "🏆", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              phaseGroups.forEach(g => { g.count = all.filter(s => g.phases.includes(s.phase)).length; });
              const maxPhaseCount = Math.max(...phaseGroups.map(g => g.count), 1);

              // --- Move type classification ---
              const advancePhases = ["SiteScore Approved", "LOI", "PSA Sent", "Under Contract", "Closed"];
              const moveIcon = (to) => advancePhases.includes(to) ? "🟢" : to === "Dead" || to === "Declined" ? "🔴" : "🔵";
              const moveLabel = (to) => advancePhases.includes(to) ? "ADVANCED" : to === "Dead" || to === "Declined" ? "EXITED" : "MOVED";

              const hasData = recentMoves.length > 0 || all.length > 0;
              if (!hasData) return null;

              return (
                <div className="card-reveal" style={{ background: "linear-gradient(145deg, rgba(15,15,20,0.96) 0%, rgba(25,25,32,0.94) 100%)", borderRadius: 16, padding: 0, marginBottom: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)", backdropFilter: "blur(12px)", animationDelay: "0.5s", position: "relative", overflow: "hidden" }}>
                  {/* Top ember line */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 5%, #F37C33 30%, #FFB347 50%, #F37C33 70%, transparent 95%)" }} />

                  {/* Header */}
                  <div style={{ padding: "18px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #F37C33, #D45500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: "0 2px 8px rgba(243,124,51,0.4)" }}>⚡</div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "rgba(15,21,56,0.4)", letterSpacing: "0.02em" }}>Deal Momentum</h3>
                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.7)", fontWeight: 500, marginTop: 1 }}>Pipeline value & recent activity</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", animation: "fireGlow 2s ease-in-out infinite" }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#86EFAC" }}>{all.length} ACTIVE</span>
                    </div>
                  </div>

                  {/* Pipeline Value Metrics */}
                  <div style={{ padding: "16px 24px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, overflow: "hidden" }}>
                    {[
                      { label: "LOI / PSA PIPELINE", value: fmtVal(loiValue), count: all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length, color: "#F37C33", action: () => navigateTo("summary", { phase: "LOI" }) },
                      { label: "UNDER CONTRACT", value: fmtVal(ucValue), count: all.filter(s => s.phase === "Under Contract").length, color: "#22C55E", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "PROSPECT POOL", value: fmtVal(prospectValue), count: all.filter(s => s.phase === "Prospect").length, color: "#3B82F6", action: () => navigateTo("summary", { phase: "Prospect" }) },
                    ].map(m => (
                      <div key={m.label} onClick={m.action} style={{ textAlign: "center", padding: "12px 8px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", transition: "all 0.25s ease" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(255,255,255,0.07)`; e.currentTarget.style.borderColor = `${m.color}40`; e.currentTarget.style.transform = "translateY(-2px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.transform = "translateY(0)"; }}
                      >
                        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: m.color, lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.value}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(148,163,184,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{m.label}</div>
                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.4)", marginTop: 2 }}>{m.count} site{m.count !== 1 ? "s" : ""}</div>
                      </div>
                    ))}
                  </div>

                  {/* Phase Distribution Mini Bars */}
                  <div style={{ padding: "14px 24px 0" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 40 }}>
                      {phaseGroups.map(g => (
                        <div key={g.label} onClick={g.count > 0 ? g.action : undefined} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: g.count > 0 ? "pointer" : "default", transition: "all 0.2s ease" }}
                          onMouseEnter={(e) => { if (g.count > 0) e.currentTarget.style.transform = "translateY(-2px)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: g.count > 0 ? g.color : "rgba(148,163,184,0.3)" }}>{g.count}</div>
                          <div style={{ width: "100%", height: Math.max(4, (g.count / maxPhaseCount) * 24), borderRadius: 3, background: g.count > 0 ? `linear-gradient(180deg, ${g.color}CC, ${g.color}66)` : "rgba(255,255,255,0.04)", transition: "all 0.5s ease" }} />
                          <div style={{ fontSize: 8, fontWeight: 600, color: "rgba(148,163,184,0.4)", textTransform: "uppercase" }}>{g.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity Feed */}
                  {recentMoves.length > 0 && (
                    <div style={{ padding: "16px 24px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(148,163,184,0.5)", textTransform: "uppercase", letterSpacing: "0.1em" }}>RECENT ACTIVITY</div>
                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.4)" }}>Last 30 days</div>
                      </div>
                      <div style={{ maxHeight: 160, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(243,124,51,0.3) transparent" }}>
                        {recentMoves.slice(0, 10).map((m, idx) => (
                          <div key={m.name + idx + m.date} onClick={() => { goToDetail({ regionKey: m.regionKey, siteId: m.siteId }); setTab(m.regionKey); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", borderRadius: 6, transition: "all 0.2s ease" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.06)"; e.currentTarget.style.paddingLeft = "8px"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.paddingLeft = "0"; }}
                          >
                            <span style={{ fontSize: 12 }}>{moveIcon(m.to)}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{m.name} <span style={{ fontSize: 9, color: "rgba(148,163,184,0.5)" }}>({m.region})</span></div>
                              <div style={{ fontSize: 10, color: "rgba(148,163,184,0.6)" }}>{m.from} → {m.to}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: advancePhases.includes(m.to) ? "rgba(34,197,94,0.1)" : m.to === "Dead" ? "rgba(220,38,38,0.1)" : "rgba(59,130,246,0.1)", color: advancePhases.includes(m.to) ? "#86EFAC" : m.to === "Dead" ? "#FCA5A5" : "#93C5FD", letterSpacing: "0.05em" }}>{moveLabel(m.to)}</span>
                              <div style={{ fontSize: 9, color: "rgba(148,163,184,0.35)", marginTop: 2 }}>{m.daysAgo === 0 ? "Today" : m.daysAgo === 1 ? "Yesterday" : `${m.daysAgo}d ago`}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ═══ PIPELINE FUNNEL — Interactive ═══ */}
            {(() => {
              const all = [...sw, ...east];
              const funnelStages = [
                { label: "Review Queue", count: pendingN, color: "#F59E0B", icon: "⏳", action: () => navigateTo("review") },
                { label: "Prospect", count: all.filter(s => s.phase === "Prospect").length, color: "#3B82F6", icon: "🔍", action: () => navigateTo("summary", { phase: "Prospect" }) },
                { label: "Submitted to PS", count: all.filter(s => s.phase === "Submitted to PS").length, color: "#6366F1", icon: "📤", action: () => navigateTo("summary", { phase: "Submitted to PS" }) },
                { label: "SiteScore Approved", count: all.filter(s => s.phase === "SiteScore Approved").length, color: "#8B5CF6", icon: "⚡", action: () => navigateTo("summary", { phase: "SiteScore Approved" }) },
                { label: "LOI / PSA", count: all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length, color: "#F37C33", icon: "📝", action: () => navigateTo("summary", { phase: "LOI" }) },
                { label: "Under Contract", count: all.filter(s => s.phase === "Under Contract").length, color: "#16A34A", icon: "🤝", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", count: all.filter(s => s.phase === "Closed").length, color: "#059669", icon: "🏆", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              const declined = all.filter(s => s.phase === "Declined" || s.phase === "Dead").length;
              return (
                <div className="card-reveal" style={{ background: "rgba(255,255,255,0.92)", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,.05), 0 0 0 1px rgba(243,124,51,0.04)", backdropFilter: "blur(8px)", animationDelay: "0.6s", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, rgba(243,124,51,0.2), rgba(255,179,71,0.3), rgba(243,124,51,0.2), transparent)" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#F4F6FA" }}>Pipeline Funnel</h3>
                    {declined > 0 && <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{declined} declined/dead</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                    {funnelStages.map((stage, idx) => {
                      const widthPct = stage.count > 0 ? Math.max(25, 30 + (1 - idx / (funnelStages.length - 1)) * 70) : 25;
                      return (
                        <div key={stage.label} onClick={stage.count > 0 ? stage.action : undefined} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, cursor: stage.count > 0 ? "pointer" : "default" }}>
                          <div style={{ width: 90, fontSize: 10, fontWeight: 600, color: "#6B7394", textAlign: "right", flexShrink: 0 }}>{stage.icon} {stage.label}</div>
                          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                            <div className={stage.count > 0 ? "funnel-bar" : ""} style={{
                              width: `${widthPct}%`,
                              background: stage.count > 0 ? `linear-gradient(135deg, ${stage.color}DD, ${stage.color}99)` : "rgba(15,21,56,0.3)",
                              borderRadius: idx === 0 ? "10px 10px 6px 6px" : idx === funnelStages.length - 1 ? "6px 6px 10px 10px" : 6,
                              padding: "8px 12px",
                              display: "flex",
                              justifyContent: "center",
                              alignItems: "center",
                              transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
                              minHeight: 28,
                            }}>
                              <span style={{ fontSize: stage.count > 0 ? 16 : 12, fontWeight: 800, color: stage.count > 0 ? "#fff" : "#CBD5E1", fontFamily: "'Space Mono', monospace", position: "relative", zIndex: 1 }}>
                                {stage.count}
                              </span>
                            </div>
                          </div>
                          <div style={{ width: 50, fontSize: 10, color: "#94A3B8", flexShrink: 0 }}>
                            {stage.count > 0 ? "→" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "#94A3B8", textAlign: "center" }}>
                    Click any stage to navigate — sites flow left to right
                  </div>
                </div>
              );
            })()}

            {/* Pipeline comparison cards removed — side-by-side phase counts created competitive optics between DW and MT trackers */}
          </div>
        )}

        {/* ═══ SUMMARY ═══ */}
        {tab === "summary" && (() => {
          const th = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#C9A84C", textTransform: "uppercase", borderBottom: "2px solid rgba(201,168,76,0.15)", whiteSpace: "nowrap", position: "sticky", top: 0, background: "rgba(15,21,56,0.6)", zIndex: 1 };
          const td = { padding: "8px 10px", fontSize: 11, color: "#E2E8F0", borderBottom: "1px solid rgba(201,168,76,0.08)", whiteSpace: "nowrap" };
          const tdW = { ...td, whiteSpace: "normal", maxWidth: 200, minWidth: 120 };
          const allStates = [...new Set([...sw, ...east].map(s => s.state).filter(Boolean))].sort();
          const SumTable = ({ rk }) => {
            const r = REGIONS[rk];
            const raw = sortData(rk === "east" ? east : sw);
            const matchPhase = (sPhase) => filterPhase === "all" || sPhase === filterPhase;
            const d = raw.filter(s => (filterState === "all" || s.state === filterState) && matchPhase(s.phase));
            return (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.accent }} />
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: r.color }}>{r.label}</h3>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>({d.length}{d.length !== raw.length ? ` of ${raw.length}` : ""})</span>
                </div>
                {d.length === 0 ? <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 10, padding: 20, textAlign: "center", color: "#94A3B8" }}>No sites.</div> : (
                  <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid rgba(201,168,76,0.1)", maxHeight: 420 }}>
                    <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", background: "rgba(15,21,56,0.5)" }}>
                      <thead>
                        <tr>{["SiteScore", "Name", "City", "ST", "Phase", "Ask", "Acres", "3mi Pop", "Broker", "DOM", "Added"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {d.map((s, i) => (
                          <tr key={s.id} onClick={() => { goToDetail({ regionKey: rk, siteId: s.id }); setTab(rk); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ background: (() => { const t = getSiteScore(s).tier; return t === "gold" ? "rgba(201,168,76,0.08)" : t === "steel" ? "rgba(44,62,107,0.15)" : i % 2 ? "rgba(15,21,56,0.35)" : "rgba(15,21,56,0.5)"; })(), cursor: "pointer", transition: "background 0.15s", borderLeft: (() => { const t = getSiteScore(s).tier; return t === "gold" ? "3px solid #C9A84C" : t === "steel" ? "3px solid #2C3E6B" : "3px solid transparent"; })() }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,122,46,0.12)")}
                            onMouseLeave={(e) => { const t = getSiteScore(s).tier; e.currentTarget.style.background = t === "gold" ? "rgba(201,168,76,0.08)" : t === "steel" ? "rgba(44,62,107,0.15)" : i % 2 ? "rgba(15,21,56,0.35)" : "rgba(15,21,56,0.5)"; }}
                          >
                            <td style={{ ...td, textAlign: "center" }}><SiteScoreBadge site={s} size="small" iq={getSiteScore(s)} /></td>
                            <td style={{ ...td, fontWeight: 600, color: "#E2E8F0" }}>{s.name}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.city || "—"}</td>
                            <td style={td}>{s.state || "—"}</td>
                            <td style={{ ...td, fontSize: 11 }}><span style={{ padding: "2px 8px", borderRadius: 6, background: s.phase === "Under Contract" || s.phase === "Closed" ? "#DCFCE7" : s.phase === "PSA Sent" ? "#F5D0FE" : s.phase === "LOI" ? "#FEF3C7" : s.phase === "SiteScore Approved" ? "#E0E7FF" : s.phase === "Submitted to PS" ? "#DBEAFE" : "rgba(15,21,56,0.3)", color: s.phase === "Under Contract" || s.phase === "Closed" ? "#166534" : s.phase === "PSA Sent" ? "#86198F" : s.phase === "LOI" ? "#92400E" : s.phase === "SiteScore Approved" ? "#3730A3" : s.phase === "Submitted to PS" ? "#1E40AF" : "#64748B", fontWeight: 600 }}>{s.phase || "—"}</span></td>
                            <td style={{ ...td, fontWeight: 600 }} title={s.askingPrice || ""}>{fmtPrice(s.askingPrice)}</td>
                            <td style={td}>{s.acreage || "—"}</td>
                            <td style={td}>{s.pop3mi ? fmtN(s.pop3mi) : "—"}</td>
                            <td style={td}>{s.sellerBroker || "—"}</td>
                            <td style={{ ...td, textAlign: "center", fontSize: 12, color: s.dateOnMarket && s.dateOnMarket !== "N/A" ? (Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 365 ? "#EF4444" : Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 180 ? "#F59E0B" : "#22C55E") : "#94A3B8" }}>{s.dateOnMarket && s.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) + "d" : "—"}</td>
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
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#E2E8F0" }}>📊 Summary</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94A3B8" }}>All tracked sites by region. Click any row to open.</p>
              <SortBar sortBy={sortBy} setSortBy={setSortBy} />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>Filter:</span>
                  <select value={filterState} onChange={(e) => setFilterState(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", color: "#94A3B8", background: filterState !== "all" ? "#FFF7ED" : "rgba(15,21,56,0.5)" }}>
                    <option value="all">All States</option>
                    {allStates.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <select value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", color: "#94A3B8", background: filterPhase !== "all" ? "#FFF7ED" : "rgba(15,21,56,0.5)" }}>
                    <option value="all">All Phases</option>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {(filterState !== "all" || filterPhase !== "all") && <button onClick={() => { setFilterState("all"); setFilterPhase("all"); }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", cursor: "pointer" }}>✕ Clear</button>}
              </div>
              <SumTable rk="southwest" />
              <SumTable rk="east" />
            </div>
          );
        })()}

        {/* ═══ SUBMIT ═══ */}
        {tab === "submit" && (
          <div style={{ animation: "fadeIn .3s ease-out", maxWidth: 600 }}>
            <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>Submit Site</h2>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "rgba(15,21,56,0.3)", borderRadius: 10, padding: 3 }}>
                {[["direct", "⚡ Direct to Tracker"], ["review", "📋 Send to Review"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSubmitMode(k)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", background: submitMode === k ? "rgba(15,21,56,0.5)" : "transparent", color: submitMode === k ? "#E2E8F0" : "#94A3B8", boxShadow: submitMode === k ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>{l}</button>
                ))}
              </div>
              {/* ── Flyer Upload Zone ── */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F0", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>📄 Flyer <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>— auto-extracts acreage, price, zoning & broker</span></div>
              <div style={{ border: flyerFile ? "2px solid #F37C33" : "2px dashed #E2E8F0", borderRadius: 12, padding: flyerFile ? 14 : 20, textAlign: "center", background: flyerFile ? "#FFF8F3" : "rgba(15,21,56,0.4)", marginBottom: 16, cursor: "pointer", transition: "all .2s" }} onClick={() => !flyerParsing && flyerRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#F37C33"; }} onDragLeave={(e) => { e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "rgba(201,168,76,0.1)"; }} onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "rgba(201,168,76,0.1)"; const f = e.dataTransfer.files?.[0]; if (f) parseFlyer(f); }}>
                <input ref={flyerRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFlyer(f); }} />
                {flyerParsing ? (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>⏳</div><div style={{ fontSize: 12, color: "#6B7394", fontWeight: 600 }}>Extracting info from flyer…</div></div>
                ) : flyerFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {flyerPreview && <img src={flyerPreview} alt="Flyer preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)" }} />}
                    {!flyerPreview && <div style={{ width: 48, height: 48, borderRadius: 6, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📄</div>}
                    <div style={{ textAlign: "left", flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>{flyerFile.name}</div>
                      <div style={{ fontSize: 11, color: "#6B7394" }}>{(flyerFile.size / 1024).toFixed(0)} KB — fields auto-populated</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFlyerFile(null); setFlyerPreview(null); if (flyerRef.current) flyerRef.current.value = ""; }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                ) : (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>📎</div><div style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Drop a flyer here or click to upload</div><div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>PDF or image — we'll extract acreage, price, zoning, broker & more</div></div>
                )}
              </div>
              {/* Attachments disabled — Dan controls all data input */}
              {/* ── Form Fields ── */}
              <div style={{ display: "grid", gap: 12 }}>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Name *</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Facility / site name" /></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Address *</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>City *</label><input style={inp} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>State *</label><input style={inp} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Acreage</label><input style={inp} value={form.acreage} onChange={(e) => setForm({ ...form, acreage: e.target.value })} placeholder="e.g. 3.5" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Asking Price</label><input style={inp} value={form.askingPrice} onChange={(e) => setForm({ ...form, askingPrice: e.target.value })} placeholder="e.g. $1,200,000" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Zoning</label><input style={inp} value={form.zoning} onChange={(e) => setForm({ ...form, zoning: e.target.value })} placeholder="e.g. C-2, Commercial" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Seller / Broker</label><input style={inp} value={form.sellerBroker} onChange={(e) => setForm({ ...form, sellerBroker: e.target.value })} placeholder="Broker name" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Coordinates</label><input style={inp} value={form.coordinates} onChange={(e) => setForm({ ...form, coordinates: e.target.value })} placeholder="lat, lng" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Listing URL</label><input style={inp} value={form.listingUrl} onChange={(e) => setForm({ ...form, listingUrl: e.target.value })} placeholder="Crexi / LoopNet link" /></div>
                </div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Region *</label><select style={{ ...inp, cursor: "pointer" }} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="southwest">Daniel Wollent</option><option value="east">Matthew Toussaint</option></select></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Notes</label><textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes…" /></div>
                <button onClick={handleSubmit} style={{ padding: "12px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: submitMode === "direct" ? "linear-gradient(135deg,#F37C33,#E8650A)" : "linear-gradient(135deg,#2C2C2C,#3D3D3D)", color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {submitMode === "direct" ? "⚡ Add Now" : "📋 Submit for Review"}
                </button>
              </div>
              {shareLink && (
                <div style={{ background: "#FFF3E0", border: "1px solid #F37C33", borderRadius: 10, padding: 14, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E65100", marginBottom: 6 }}>✅ Submitted! Share this review link:</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input readOnly value={`${window.location.origin}${window.location.pathname}?review=${shareLink}`} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, background: "rgba(15,21,56,0.5)", outline: "none" }} onClick={(e) => e.target.select()} />
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?review=${shareLink}`); notify("Copied!"); }} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📋 Copy</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {tab === "review" && !reviewDetailSite && (
          <div style={{ animation: "fadeIn .3s ease-out" }}>
            {/* Review Queue Sub-Tabs */}
            {(() => {
              const myCount = subs.filter(s => s.status === "pending").length;
              const dwCount = subs.filter(s => s.status === "recommended" && (s.routedTo === "southwest" || s.region === "southwest")).length;
              const mtCount = subs.filter(s => s.status === "recommended" && (s.routedTo === "east" || s.region === "east")).length;
              const reviewTabs = [
                { key: "mine", label: "Dan R.", count: myCount, color: "#C9A84C", icon: "📋" },
                { key: "dw", label: "Daniel Wollent", count: dwCount, color: "#42A5F5", icon: "◆" },
                { key: "mt", label: "Matthew Toussaint", count: mtCount, color: "#4CAF50", icon: "●" },
              ];
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review Queue</h2>
                    <div style={{ display: "flex", gap: 6 }}>
                      {reviewTab === "mine" && myCount > 0 && <button onClick={handleApproveAll} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C9A84C,#1E2761)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.3)" }}>✓ Recommend All ({myCount})</button>}
                      {subs.some((s) => s.status === "declined") && <button onClick={handleClearDeclined} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer" }}>Clear Declined</button>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, background: "rgba(15,21,56,0.6)", borderRadius: 10, padding: 4, marginBottom: 4 }}>
                    {reviewTabs.map(rt => (
                      <button key={rt.key} onClick={() => setReviewTab(rt.key)} style={{
                        flex: 1, padding: "10px 14px", borderRadius: 8, border: "none", cursor: "pointer", transition: "all 0.2s",
                        background: reviewTab === rt.key ? `linear-gradient(135deg, ${rt.color}22, ${rt.color}11)` : "transparent",
                        color: reviewTab === rt.key ? rt.color : "#6B7394",
                        fontWeight: reviewTab === rt.key ? 800 : 600, fontSize: 12,
                        borderBottom: reviewTab === rt.key ? `2px solid ${rt.color}` : "2px solid transparent",
                      }}>
                        <span style={{ marginRight: 6 }}>{rt.icon}</span>
                        {rt.label}
                        {rt.count > 0 && <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 800, background: reviewTab === rt.key ? `${rt.color}30` : "rgba(255,255,255,0.06)", color: reviewTab === rt.key ? rt.color : "#94A3B8" }}>{rt.count}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Assigned Sites Needing Review ── */}
            {(() => {
              const allTracker = [...sw.map(s => ({ ...s, _region: "southwest" })), ...east.map(s => ({ ...s, _region: "east" }))];
              let needsReviewSites = allTracker.filter(s => s.assignedTo && s.needsReview);
              if (reviewTab === "mine") needsReviewSites = needsReviewSites.filter(s => s.assignedTo === "Dan R");
              else if (reviewTab === "dw") needsReviewSites = needsReviewSites.filter(s => s.assignedTo === "Daniel Wollent");
              else if (reviewTab === "mt") needsReviewSites = needsReviewSites.filter(s => s.assignedTo === "Matthew Toussaint");
              const byPerson = {};
              needsReviewSites.forEach(s => {
                if (!byPerson[s.assignedTo]) byPerson[s.assignedTo] = [];
                byPerson[s.assignedTo].push(s);
              });
              if (Object.keys(byPerson).length === 0) return null;
              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#92700C", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />
                    Assigned for Review ({needsReviewSites.length})
                  </div>
                  {Object.entries(byPerson).map(([person, sites]) => (
                    <div key={person} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 6, padding: "4px 10px", background: "rgba(15,21,56,0.4)", borderRadius: 8, display: "inline-block", border: "1px solid rgba(201,168,76,0.1)" }}>{person} ({sites.length})</div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {sites.map(site => (
                          <div key={site.id} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, boxShadow: "0 2px 8px rgba(0,0,0,.1)", borderLeft: "4px solid #C9A84C", transition: "all 0.3s" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 250 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 15, fontWeight: 800, color: "#E2E8F0" }}>{site.name}</span>
                                  <SiteScoreBadge site={site} size="small" iq={getSiteScore(site)} />
                                  <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.3)" }}>NEEDS REVIEW</span>
                                </div>
                                <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 4 }}>{site.address}, {site.city}, {site.state}</div>
                                <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#6B7394", marginBottom: 8, flexWrap: "wrap" }}>
                                  {site.acreage && <span><strong style={{ color: "#E2E8F0" }}>{site.acreage} ac</strong></span>}
                                  {site.askingPrice && <span><strong style={{ color: "#C9A84C" }}>{site.askingPrice}</strong></span>}
                                  <span>Phase: {site.phase || "Prospect"}</span>
                                  <span>Tracker: {site._region === "southwest" ? "DW" : "MT"}</span>
                                </div>
                                {/* Links row */}
                                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                                  {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "4px 12px", borderRadius: 6, background: "rgba(232,122,46,0.1)", color: "#E87A2E", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.2)" }}>🔗 Listing</a>}
                                  {site.coordinates && <a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "4px 12px", borderRadius: 6, background: "rgba(21,101,192,0.1)", color: "#42A5F5", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.2)" }}>📍 Map</a>}
                                  <button onClick={() => { goToDetail({ regionKey: site._region, siteId: site.id }); setTab(site._region); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>View Full Detail →</button>
                                </div>
                              </div>
                              {/* Action buttons — right side */}
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
                                <button onClick={() => { updateSiteField(site._region, site.id, "needsReview", false); updateSiteField(site._region, site.id, "reviewedBy", person); updateSiteField(site._region, site.id, "reviewedAt", new Date().toISOString()); updateSiteField(site._region, site.id, "phase", "SiteScore Approved"); notify(`✓ Approved — ${site.name} stays in ${site._region === "southwest" ? "DW" : "MT"} tracker`); }} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer", boxShadow: "0 2px 12px rgba(22,163,74,0.3)", letterSpacing: "0.02em" }}>✓ Approve</button>
                                <button onClick={() => { if (window.confirm(`Reject "${site.name}"? This will remove it from the tracker.`)) { fbRemove(`${site._region}/${site.id}`); notify(`✗ Rejected — ${site.name} removed`); } }} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✗ Reject</button>
                                <button onClick={() => { updateSiteField(site._region, site.id, "assignedTo", ""); updateSiteField(site._region, site.id, "needsReview", false); notify(`Unassigned: ${site.name}`); }} style={{ padding: "6px 18px", borderRadius: 10, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(148,163,184,0.06)", color: "#94A3B8", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Unassign</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <SortBar sortBy={sortBy} setSortBy={setSortBy} />
            {(() => {
              const filtered = subs.filter(site => {
                if (reviewTab === "mine") return site.status === "pending" || site.status === "declined" || site.status === "ps-rejected";
                if (reviewTab === "dw") return site.status === "recommended" && (site.routedTo === "southwest" || site.region === "southwest");
                if (reviewTab === "mt") return site.status === "recommended" && (site.routedTo === "east" || site.region === "east");
                return true;
              });
              const emptyLabels = { mine: "No sites pending your review. PS-rejected sites with feedback will appear here automatically.", dw: "No sites awaiting Daniel Wollent's approval.", mt: "No sites awaiting Matthew Toussaint's approval." };
              if (filtered.length === 0 && (reviewTab !== "mine" || [...sw, ...east].filter(s => s.assignedTo && s.needsReview).length === 0)) return (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: "40px 30px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{reviewTab === "mine" ? "📋" : reviewTab === "dw" ? "◆" : "●"}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#94A3B8", marginBottom: 6 }}>{reviewTab === "mine" ? "Queue Empty" : "No Sites Pending"}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", maxWidth: 380, margin: "0 auto", lineHeight: 1.5 }}>{emptyLabels[reviewTab]}</div>
                </div>
              );
              return null;
            })()}
            {(() => {
              const filtered = subs.filter(site => {
                if (reviewTab === "mine") return site.status === "pending" || site.status === "declined" || site.status === "ps-rejected";
                if (reviewTab === "dw") return site.status === "recommended" && (site.routedTo === "southwest" || site.region === "southwest");
                if (reviewTab === "mt") return site.status === "recommended" && (site.routedTo === "east" || site.region === "east");
                return true;
              });
              if (filtered.length === 0) return null;
              return (
              <div style={{ display: "grid", gap: 10 }}>
                {sortData(subs).filter(site => {
                  if (reviewTab === "mine") return site.status === "pending" || site.status === "declined" || site.status === "ps-rejected";
                  if (reviewTab === "dw") return site.status === "recommended" && (site.routedTo === "southwest" || site.region === "southwest");
                  if (reviewTab === "mt") return site.status === "recommended" && (site.routedTo === "east" || site.region === "east");
                  return true;
                }).sort((a, b) => {
                  // If user picked a sort, respect it. Otherwise: NEW first, then SiteScore desc.
                  if (sortBy !== "name") return 0; // sortData() already sorted — preserve that order
                  const aIsNew = !a.recommendedAt && !a.approvedAt && a.status === "pending";
                  const bIsNew = !b.recommendedAt && !b.approvedAt && b.status === "pending";
                  if (aIsNew && !bIsNew) return -1;
                  if (!aIsNew && bIsNew) return 1;
                  return (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0);
                }).map((site) => {
                  const ri = reviewInputs[site.id] || { reviewer: "", note: "" };
                  const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
                  const isHL = highlightedSite === site.id;
                  const isExpanded = false; // legacy — full-page detail replaced inline expand
                  return (
                    <div key={site.id} id={`review-${site.id}`} style={{ background: isHL ? "#FFF3E0" : site.status === "ps-rejected" ? "rgba(220,38,38,0.06)" : "rgba(15,21,56,0.5)", borderRadius: 12, padding: 16, boxShadow: isHL ? "0 0 0 2px #F37C33" : site.status === "ps-rejected" ? "0 0 0 1px rgba(220,38,38,0.3)" : "0 1px 3px rgba(0,0,0,.06)", opacity: site.status === "declined" ? 0.5 : 1, borderLeft: `4px solid ${site.status === "ps-rejected" ? "#EF4444" : REGIONS[site.routedTo || site.region]?.accent || "#94A3B8"}`, transition: "all 0.3s", cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); navigateTo("review", { reviewSiteId: site.id }); }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(201,168,76,0.15), 0 0 0 1px rgba(201,168,76,0.2)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = isHL ? "0 0 0 2px #F37C33" : "0 1px 3px rgba(0,0,0,.06)"; e.currentTarget.style.transform = "translateY(0)"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}
                      >
                        <span style={{ fontSize: 15, fontWeight: 700, transition: "color 0.2s" }}>{site.name}</span>
                        <SiteScoreBadge site={site} size="small" />
                        <Badge status={site.status} />
                        {site.status === "ps-rejected" && <span style={{ fontSize: 10, fontWeight: 800, color: "#DC2626", background: "rgba(220,38,38,0.12)", padding: "2px 10px", borderRadius: 5, border: "1px solid rgba(220,38,38,0.25)", textTransform: "uppercase", letterSpacing: "0.06em" }}>PS Rejected — {site.psRejectedBy || "PS"}</span>}
                        {site.status === "pending" && <button onClick={(e) => { e.stopPropagation(); const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.4)", color: "#6B7394", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔗 Copy Link</button>}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7394", marginBottom: 2 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `• ${site.acreage} ac` : ""} {site.askingPrice ? `• ${site.askingPrice}` : ""}</div>
                      {/* PS Rejection Feedback Banner */}
                      {site.status === "ps-rejected" && (site.psFeedback || site.psRejectReason) && (
                        <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "8px 12px", marginTop: 6, marginBottom: 4 }}>
                          {site.psRejectReason && <div style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>Reason: {site.psRejectReason}</div>}
                          {site.psFeedback && <div style={{ fontSize: 11, color: "#FCA5A5", lineHeight: 1.5 }}>Feedback: "{site.psFeedback}"</div>}
                          <button onClick={(e) => { e.stopPropagation(); handleDiscard(site.id); }} style={{ marginTop: 8, padding: "6px 16px", borderRadius: 8, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.15)", color: "#EF4444", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Discard Permanently</button>
                        </div>
                      )}
                      {/* Links */}
                      <div style={{ display: "flex", gap: 6, marginTop: 4, marginBottom: 4, flexWrap: "wrap" }}>
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "2px 8px", borderRadius: 5, background: "rgba(232,122,46,0.1)", color: "#E87A2E", fontSize: 10, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.15)" }}>🔗 Listing</a>}
                        {site.coordinates && <a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "2px 8px", borderRadius: 5, background: "rgba(21,101,192,0.08)", color: "#42A5F5", fontSize: 10, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.15)" }}>📍 Map</a>}
                      </div>
                      {site.summary && <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.4, maxHeight: 36, overflow: "hidden" }}>{site.summary.substring(0, 180)}{site.summary.length > 180 ? "…" : ""}</div>}
                      {/* NEW badge for unreviewed sites */}
                      {!site.recommendedAt && !site.approvedAt && site.status === "pending" && <span style={{ display: "inline-block", marginTop: 4, fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }}>NEW</span>}
                      {site.status === "recommended" && <div style={{ marginTop: 4, fontSize: 10, color: "#16A34A", fontWeight: 600 }}>✓ Dan R. Approved → {REGIONS[site.routedTo || site.region]?.label || "—"}</div>}
                    </div>
                  );
                })}
              </div>
              );
            })()}
          </div>
        )}

        {/* ═══ REVIEW DETAIL VIEW — Full property page from review queue ═══ */}
        {reviewDetailSite && (() => {
          const site = subs.find(s => s.id === reviewDetailSite);
          if (!site) return <div style={{ textAlign: "center", padding: 40, color: "#6B7394" }}>Site not found. <button onClick={() => setReviewDetailSite(null)} style={{ color: "#E87A2E", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>← Back</button></div>;
          const iqR = computeSiteScore(site);
          const ri = reviewInputs[site.id] || {};
          const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
          const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
          return (
            <div style={{ animation: "fadeIn .3s ease-out", position: "relative", maxWidth: 1100, margin: "0 auto" }}>
              <button onClick={() => setReviewDetailSite(null)} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(232,122,46,0.25)", background: "rgba(232,122,46,0.08)", color: "#E87A2E", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>← Back to Review Queue</button>

              {/* Header */}
              <div style={{ background: "linear-gradient(135deg, rgba(15,21,56,0.9), rgba(30,39,97,0.8))", borderRadius: 16, padding: 24, marginBottom: 20, border: "1px solid rgba(201,168,76,0.1)", position: "relative" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, transparent, ${iqR.classColor || "#C9A84C"}60, transparent)` }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{site.name}</h2>
                      <Badge status={site.status} />
                      {!site.recommendedAt && site.status === "pending" && <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", padding: "3px 10px", borderRadius: 5, letterSpacing: "0.1em" }}>NEW</span>}
                    </div>
                    <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 8 }}>{site.address}, {site.city}, {site.state}</div>
                    {/* Key deal metrics — hero strip */}
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                      {site.askingPrice && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Asking Price</div><div style={{ fontSize: 20, fontWeight: 900, color: "#C9A84C" }}>{site.askingPrice.toString().startsWith("$") ? site.askingPrice : `$${Number(site.askingPrice).toLocaleString()}`}</div></div>}
                      {site.acreage && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Acreage</div><div style={{ fontSize: 20, fontWeight: 900, color: "#E2E8F0" }}>{site.acreage} ac</div></div>}
                      {site.zoning && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Zoning</div><div style={{ fontSize: 20, fontWeight: 900, color: "#E2E8F0" }}>{site.zoning}</div></div>}
                      {dom !== null && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Days on Market</div><div style={{ fontSize: 20, fontWeight: 900, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#E2E8F0" }}>{dom}</div></div>}
                    </div>
                  </div>
                  {/* SiteScore Score — large, right-aligned */}
                  <div style={{ flexShrink: 0, textAlign: "center", padding: "8px 16px", borderRadius: 14, background: iqR.score >= 7.5 ? "rgba(22,163,74,0.1)" : iqR.score >= 5.5 ? "rgba(217,119,6,0.1)" : "rgba(220,38,38,0.1)", border: `1px solid ${iqR.score >= 7.5 ? "rgba(22,163,74,0.25)" : iqR.score >= 5.5 ? "rgba(217,119,6,0.25)" : "rgba(220,38,38,0.25)"}` }}>
                    <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>SiteScore</div>
                    <div style={{ fontSize: 42, fontWeight: 900, color: iqR.score >= 7.5 ? "#16A34A" : iqR.score >= 5.5 ? "#D97706" : "#DC2626", lineHeight: 1 }}>{iqR.score}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: iqR.score >= 7.5 ? "#16A34A" : iqR.score >= 5.5 ? "#D97706" : "#DC2626", textTransform: "uppercase", marginTop: 4 }}>{iqR.label || "—"}</div>
                    {iqR.classification && <div style={{ fontSize: 9, color: "#6B7394", marginTop: 2 }}>{iqR.classification}</div>}
                  </div>
                </div>
              </div>

              {/* SiteScore Scorecard */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
                {(iqR.breakdown || []).map((b, i) => (
                  <div key={i} style={{ background: "rgba(15,21,56,0.6)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>{b.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: b.score >= 8 ? "#16A34A" : b.score >= 6 ? "#D97706" : b.score >= 4 ? "#EA580C" : "#DC2626" }}>{b.score}<span style={{ fontSize: 12, color: "#6B7394" }}>/10</span></div>
                    <div style={{ fontSize: 10, color: "#6B7394" }}>{Math.round(b.weight * 100)}% weight</div>
                  </div>
                ))}
              </div>

              {/* Key Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "Acreage", value: site.acreage ? `${site.acreage} ac` : "—" },
                  { label: "Asking Price", value: site.askingPrice || "—" },
                  { label: "Zoning", value: site.zoning || "—" },
                  { label: "3-Mi Population", value: site.pop3mi || "—" },
                  { label: "3-Mi Med. HHI", value: site.income3mi || "—" },
                  { label: "Market", value: site.market || "—" },
                  { label: "Broker", value: site.sellerBroker || "—" },
                  { label: "Nearest PS", value: site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : "—" },
                ].map(m => (
                  <div key={m.label} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 10, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0" }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Aerial */}
              {site.coordinates && (
                <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(201,168,76,0.1)", marginBottom: 20, position: "relative" }}>
                  <iframe title={`Aerial — ${site.name}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(site.coordinates)}&t=k&z=17&output=embed`} style={{ width: "100%", height: 350, border: "none" }} loading="lazy" allowFullScreen />
                  <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>AERIAL VIEW</div>
                </div>
              )}

              {/* Summary */}
              {site.summary && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 12, padding: 16, marginBottom: 20, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.08em" }}>Summary</div>
                  <div style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.6 }}>{site.summary}</div>
                </div>
              )}

              {/* Links */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                {site.coordinates && <a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(21,101,192,0.12)", color: "#42A5F5", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.25)" }}>🗺 Google Maps</a>}
                {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(232,122,46,0.12)", color: "#E87A2E", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.25)" }}>🔗 Property Listing</a>}
                <button onClick={() => { try { const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("Report generation failed — some site data may be missing."); console.error("Vet report error:", err); } }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(232,122,46,0.4)", letterSpacing: "0.05em", textTransform: "uppercase" }}>🔬 Storvex Deep Vet Report</button>
              </div>

              {/* ── ACTIVITY TIMELINE ── */}
              {(() => {
                const events = [];
                if (site.submittedAt) events.push({ ts: site.submittedAt, action: "Site entered review queue", by: "System", icon: "📥", color: "#F59E0B" });
                if (site.recommendedAt) events.push({ ts: site.recommendedAt, action: `Dan R. approved & routed to ${REGIONS[site.routedTo || site.region]?.label || "—"}`, by: site.recommendedBy || "Dan R.", icon: "✓", color: "#C9A84C" });
                if (site.approvedAt && site.approvedBy) events.push({ ts: site.approvedAt, action: `PS approved → moved to tracker`, by: site.approvedBy, icon: "⚡", color: "#16A34A" });
                if (site.psRejectedAt) events.push({ ts: site.psRejectedAt, action: `PS rejected — ${site.psRejectReason || "no reason given"}${site.psFeedback ? `: "${site.psFeedback}"` : ""}`, by: site.psRejectedBy || "PS", icon: "✗", color: "#DC2626" });
                // Pull from activityLog if it exists
                if (site.activityLog) {
                  Object.values(site.activityLog).forEach(log => {
                    if (log.ts && log.action) events.push({ ts: log.ts, action: log.action, by: log.by || "System", icon: "→", color: "#6366F1" });
                  });
                }
                events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
                if (events.length === 0) return null;
                const fmtDate = (ts) => { const d = new Date(ts); const now = Date.now(); const diff = now - d.getTime(); if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`; if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`; return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
                return (
                  <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 16, marginBottom: 20, border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Activity Timeline</div>
                    <div style={{ position: "relative", paddingLeft: 20 }}>
                      <div style={{ position: "absolute", left: 6, top: 4, bottom: 4, width: 2, background: "rgba(201,168,76,0.1)", borderRadius: 1 }} />
                      {events.slice(0, 10).map((ev, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, marginBottom: i < events.length - 1 ? 12 : 0, position: "relative" }}>
                          <div style={{ position: "absolute", left: -14, top: 2, width: 14, height: 14, borderRadius: "50%", background: "rgba(15,21,56,0.9)", border: `2px solid ${ev.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8 }}>{ev.icon}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{ev.action}</div>
                            <div style={{ fontSize: 10, color: "#6B7394", marginTop: 1 }}>{ev.by} · {fmtDate(ev.ts)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── APPROVAL ACTION BAR ── */}
              <div style={{ background: "linear-gradient(135deg, rgba(15,21,56,0.9), rgba(30,39,97,0.8))", borderRadius: 16, padding: 20, border: "1px solid rgba(201,168,76,0.15)", marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                  {site.status === "pending" ? "📋 Your Decision" : site.status === "recommended" ? "⚡ PS Approval Required" : "Decision Made"}
                </div>

                {site.status === "pending" && (
                  <div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                      <select value={ri.routeTo || site.region || ""} onChange={(e) => setRI("routeTo", e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "2px solid #C9A84C", fontSize: 13, background: "#FFFBEB", cursor: "pointer", minWidth: 200, fontWeight: 700, color: "#92700C" }}>
                        <option value="">Route to…</option>
                        <option value="southwest">→ Daniel Wollent (DW)</option>
                        <option value="east">→ Matthew Toussaint (MT)</option>
                      </select>
                      <input value={ri.note || ""} onChange={(e) => setRI("note", e.target.value)} placeholder="Review note…" style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.15)", fontSize: 13, outline: "none", background: "rgba(255,255,255,0.05)", color: "#E2E8F0" }} />
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button onClick={() => { if (!ri.routeTo && !site.region) { notify("Select route (DW or MT)"); return; } handleRecommend(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#C9A84C,#1E2761)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(201,168,76,0.3)", letterSpacing: "0.04em" }}>✓ Approve & Route</button>
                      <select value={ri.declineReason || ""} onChange={(e) => setRI("declineReason", e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(220,38,38,0.2)", fontSize: 12, background: "rgba(220,38,38,0.04)", cursor: "pointer", minWidth: 200, color: "#FCA5A5" }}>
                        <option value="">Decline reason…</option>
                        {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button onClick={() => { handleDecline(site.id, ri.declineReason); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✗ Reject</button>
                    </div>
                  </div>
                )}

                {site.status === "recommended" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#16A34A", background: "#DCFCE7", padding: "4px 12px", borderRadius: 8 }}>Dan R. Approved</span>
                      <span style={{ fontSize: 12, color: "#94A3B8" }}>→ {REGIONS[site.routedTo || site.region]?.label || "Unassigned"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <select value={ri.reviewer || ""} onChange={(e) => setRI("reviewer", e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(22,163,74,0.3)", fontSize: 13, background: "rgba(22,163,74,0.08)", cursor: "pointer", minWidth: 180, fontWeight: 700, color: "#16A34A" }}>
                        <option value="">Approver…</option>
                        <option>Daniel Wollent</option>
                        <option>Matthew Toussaint</option>
                        <option>Brian Karis</option>
                        <option>Jarrod</option>
                      </select>
                      <button onClick={() => { handlePSApprove(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#16A34A,#15803D)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(22,163,74,0.3)", letterSpacing: "0.04em" }}>⚡ Approve → Tracker</button>
                    </div>
                    {/* PS Rejection Section — reason + feedback routes back to Dan */}
                    <div style={{ borderTop: "1px solid rgba(220,38,38,0.15)", paddingTop: 12, marginTop: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>PS Rejection (routes back to Dan with feedback)</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <select value={ri.declineReason || ""} onChange={(e) => setRI("declineReason", e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(220,38,38,0.25)", fontSize: 12, background: "rgba(220,38,38,0.05)", cursor: "pointer", minWidth: 220, color: "#FCA5A5" }}>
                          <option value="">Rejection reason…</option>
                          {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <input value={ri.psFeedback || ""} onChange={(e) => setRI("psFeedback", e.target.value)} placeholder="PS feedback — what did they say?" style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(220,38,38,0.15)", fontSize: 12, outline: "none", background: "rgba(220,38,38,0.04)", color: "#FCA5A5" }} />
                      </div>
                      <button onClick={() => { if (!ri.reviewer) { notify("Select who rejected (DW, MT, Brian, or Jarrod)"); return; } handlePSReject(site.id); setReviewDetailSite(null); }} style={{ padding: "10px 22px", borderRadius: 10, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.1)", color: "#EF4444", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✗ PS Reject → Route Back to Dan</button>
                    </div>
                  </div>
                )}

                {site.status === "ps-rejected" && (
                  <div>
                    <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#DC2626", marginBottom: 8 }}>PS Rejected by {site.psRejectedBy || "PS"}</div>
                      {site.psRejectReason && <div style={{ fontSize: 12, color: "#FCA5A5", marginBottom: 6 }}><strong>Reason:</strong> {site.psRejectReason}</div>}
                      {site.psFeedback && <div style={{ fontSize: 12, color: "#FCA5A5", marginBottom: 6, lineHeight: 1.5, fontStyle: "italic" }}>"{site.psFeedback}"</div>}
                      {site.psRejectedAt && <div style={{ fontSize: 10, color: "#6B7394", marginTop: 4 }}>Rejected: {new Date(site.psRejectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => { handleDiscard(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.15)", color: "#EF4444", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>Discard Permanently</button>
                      <button onClick={() => { fbUpdate(`submissions/${site.id}`, { status: "pending" }); notify("Sent back to pending for re-review."); }} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid rgba(201,168,76,0.3)", background: "rgba(201,168,76,0.08)", color: "#C9A84C", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Re-Review</button>
                    </div>
                  </div>
                )}

                {site.status === "approved" && (
                  <div style={{ fontSize: 13, color: "#16A34A", fontWeight: 700 }}>⚡ Approved and routed to tracker</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ═══ PROPERTY DETAIL VIEW ═══ */}
        {detailView && (() => {
          const dv = detailView;
          const allSites = sortData(dv.regionKey === "east" ? east : sw);
          const site = allSites.find(s => s.id === dv.siteId);
          if (!site) return <div style={{ textAlign: "center", padding: 40, color: "#6B7394" }}>Site not found. <button onClick={() => setDetailView(null)} style={{ color: "#E87A2E", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>← Back</button></div>;
          const idx = allSites.findIndex(s => s.id === dv.siteId);
          const prevSite = idx > 0 ? allSites[idx - 1] : null;
          const nextSite = idx < allSites.length - 1 ? allSites[idx + 1] : null;
          const iqR = getSiteScore(site);
          const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
          const docs = site.docs ? Object.entries(site.docs) : [];
          const flyerDoc = docs.find(([, d]) => d.type === "Flyer");
          const navBtnSt = (disabled) => ({ padding: "10px 20px", borderRadius: 10, border: disabled ? "1px solid rgba(201,168,76,0.06)" : "1px solid rgba(232,122,46,0.25)", background: disabled ? "rgba(15,21,56,0.3)" : "rgba(232,122,46,0.08)", color: disabled ? "#4A5080" : "#E87A2E", fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" });
          // Keyboard nav for detail view
          const handleDetailKey = (e) => {
            if (e.key === "ArrowLeft" && prevSite) { setDemoExpanded(false); setScoreDimExpanded(null); setDemoRowExpanded(null); goToDetail({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }
            if (e.key === "ArrowRight" && nextSite) { setDemoExpanded(false); setScoreDimExpanded(null); setDemoRowExpanded(null); goToDetail({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }
            if (e.key === "Escape") { setDetailView(null); }
          };
          if (!window._detailKeyBound) { window.addEventListener("keydown", handleDetailKey); window._detailKeyBound = true; }

          return (
            <div style={{ animation: "fadeIn 0.15s ease-out" }}>
              {/* TOP NAV BAR */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, padding: "14px 0", borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
                <button onClick={() => { setDetailView(null); window._detailKeyBound = false; navigateTo(dv.regionKey, { siteId: dv.siteId }); }} style={{ padding: "10px 20px", borderRadius: 10, background: "rgba(15,21,56,0.5)", border: "1px solid rgba(201,168,76,0.15)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>← Back to Tracker</button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button disabled={!prevSite} onClick={() => { if (prevSite) { goToDetail({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}} style={navBtnSt(!prevSite)}>← Prev</button>
                  <span style={{ fontSize: 11, color: "#6B7394", fontWeight: 600, padding: "0 8px", letterSpacing: "0.04em" }}>{idx + 1} of {allSites.length}</span>
                  <button disabled={!nextSite} onClick={() => { if (nextSite) { goToDetail({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}} style={navBtnSt(!nextSite)}>Next →</button>
                </div>
                <span style={{ fontSize: 9, color: "#4A5080", fontWeight: 500 }}>← → keys · Esc back</span>
              </div>

              {/* HERO HEADER */}
              <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #1E2761 60%, #2C3E6B 100%)", borderRadius: 16, padding: "32px 36px", marginBottom: 20, position: "relative", overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #C9A84C, #E87A2E, #C9A84C, transparent)", opacity: 0.6 }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent, #E87A2E, #C9A84C, #E87A2E, transparent)" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em", marginBottom: 6 }}>{site.name}</div>
                    <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 12 }}>{site.address}, {site.city}, {site.state}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {site.market && <span style={{ background: "rgba(201,168,76,.12)", color: "#C9A84C", fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(201,168,76,.2)" }}>{site.market}</span>}
                      <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>{site.phase || "Prospect"}</span>
                      {dom !== null && <span style={{ fontSize: 12, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#94A3B8", fontWeight: 600 }}>{dom}d on market</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div onClick={() => setScoreExpanded(!scoreExpanded)} style={{ cursor: "pointer", transition: "transform 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"} title="Click for full SiteScore breakdown">
                      <SiteScoreBadge site={site} iq={iqR} />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: "#94A3B8" }}>Broker: <strong style={{ color: "#E2E8F0" }}>{site.sellerBroker || "—"}</strong></div>
                  </div>
                </div>
              </div>

              {/* ═══ QUICK ACCESS BAR — Premium prominent links ═══ */}
              <div style={{ display: "grid", gridTemplateColumns: site.coordinates ? (site.listingUrl ? (flyerDoc ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr") : (flyerDoc ? "1fr 1fr 1fr" : "1fr 1fr")) : (site.listingUrl ? (flyerDoc ? "1fr 1fr" : "1fr") : flyerDoc ? "1fr" : "none"), gap: 10, marginBottom: 20 }}>
                {site.coordinates && (
                  <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "14px 20px", borderRadius: 12, background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff", fontSize: 14, fontWeight: 800, textDecoration: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 4px 20px rgba(21,101,192,0.35), 0 0 0 1px rgba(21,101,192,0.3)", letterSpacing: "0.04em", transition: "all 0.2s" }}>
                    <span style={{ fontSize: 18 }}>🗺</span> Google Maps
                  </a>
                )}
                {site.coordinates && (
                  <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "14px 20px", borderRadius: 12, background: "linear-gradient(135deg, #2E7D32, #388E3C)", color: "#fff", fontSize: 14, fontWeight: 800, textDecoration: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 4px 20px rgba(46,125,50,0.35), 0 0 0 1px rgba(46,125,50,0.3)", letterSpacing: "0.04em", transition: "all 0.2s" }}>
                    <span style={{ fontSize: 18 }}>🌍</span> Google Earth
                  </a>
                )}
                {site.listingUrl && (
                  <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" style={{ padding: "14px 20px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #F59E0B)", color: "#fff", fontSize: 14, fontWeight: 800, textDecoration: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 4px 20px rgba(232,122,46,0.35), 0 0 0 1px rgba(232,122,46,0.3)", letterSpacing: "0.04em", transition: "all 0.2s" }}>
                    <span style={{ fontSize: 18 }}>🔗</span> Property Listing
                  </a>
                )}
                {flyerDoc && (
                  <a href={flyerDoc[1].url} target="_blank" rel="noopener noreferrer" style={{ padding: "14px 20px", borderRadius: 12, background: "linear-gradient(135deg, #C9A84C, #D4AF37)", color: "#fff", fontSize: 14, fontWeight: 800, textDecoration: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 4px 20px rgba(201,168,76,0.35), 0 0 0 1px rgba(201,168,76,0.3)", letterSpacing: "0.04em", transition: "all 0.2s" }}>
                    <span style={{ fontSize: 18 }}>📄</span> Broker Flyer
                  </a>
                )}
              </div>

              {/* ═══ INTERACTIVE AERIAL MAP with PS Pins ═══ */}
              {site.coordinates && (() => {
                const mapId = `leaflet-map-${site.id}`;
                const coords = site.coordinates.split(",").map(c => parseFloat(c.trim()));
                if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) return null;
                const [siteLat, siteLng] = coords;
                // Haversine helper
                const haversine = (lat1, lon1, lat2, lon2) => {
                  const R = 3958.8; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
                  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
                  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                };
                return (
                  <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(201,168,76,0.15)", marginBottom: 24, position: "relative", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
                    <div style={{ position: "absolute", top: 12, left: 12, zIndex: 1000, display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", color: "#fff", padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", border: "1px solid rgba(201,168,76,0.2)" }}>INTERACTIVE AERIAL</div>
                      <div style={{ background: "rgba(21,101,192,0.9)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", display: "inline-block" }}></span> SUBJECT SITE
                      </div>
                      <div style={{ background: "rgba(232,122,46,0.9)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1a1a1a", display: "inline-block", border: "1px solid #E87A2E" }}></span> PS LOCATIONS
                      </div>
                    </div>
                    <div id={mapId} style={{ width: "100%", height: 420 }} ref={(el) => {
                      if (!el || el._leafletInit) return;
                      el._leafletInit = true;
                      // Load Leaflet CSS + JS from CDN
                      if (!document.getElementById("leaflet-css")) {
                        const css = document.createElement("link"); css.id = "leaflet-css"; css.rel = "stylesheet";
                        css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
                      }
                      const initMap = () => {
                        if (!window.L) { setTimeout(initMap, 100); return; }
                        const L = window.L;
                        const map = L.map(el, { zoomControl: true, attributionControl: false }).setView([siteLat, siteLng], 14);
                        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }).addTo(map);
                        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: 0.6 }).addTo(map);
                        // Site marker — blue with white border + pulsing ring
                        const siteIcon = L.divIcon({ className: "", html: '<div style="position:relative;width:32px;height:32px"><div style="position:absolute;inset:0;background:rgba(21,101,192,0.2);border-radius:50%;animation:sitePulse 2s ease-in-out infinite"></div><div style="position:absolute;top:4px;left:4px;width:24px;height:24px;background:linear-gradient(135deg,#1565C0,#1976D2);border:3px solid #fff;border-radius:50%;box-shadow:0 2px 16px rgba(21,101,192,0.6)"></div></div><style>@keyframes sitePulse{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.5);opacity:0}}</style>', iconSize: [32, 32], iconAnchor: [16, 16] });
                        L.marker([siteLat, siteLng], { icon: siteIcon, zIndexOffset: 1000 }).addTo(map).bindPopup(`<div style="font-weight:900;font-size:14px;color:#1565C0;letter-spacing:-0.01em">${site.name || "Subject Site"}</div><div style="font-size:11px;color:#64748B;margin-top:3px">${site.address || ""}, ${site.city || ""} ${site.state || ""}</div><div style="display:flex;gap:8px;margin-top:6px"><span style="font-size:11px;color:#1E2761;font-weight:700;background:#E8F0FE;padding:2px 8px;border-radius:4px">${site.acreage ? site.acreage + " ac" : ""}</span>${site.askingPrice ? `<span style="font-size:11px;color:#1E2761;font-weight:700;background:#E8F0FE;padding:2px 8px;border-radius:4px">${site.askingPrice}</span>` : ""}</div>`);
                        // Load PS locations and show nearby pins
                        fetch("/ps-locations.csv").then(r => r.text()).then(csv => {
                          const lines = csv.trim().split("\n");
                          let psCount = 0;
                          const psIcon = L.divIcon({ className: "", html: '<div style="width:18px;height:18px;background:linear-gradient(135deg,#E87A2E,#F59E0B);border:2px solid #1a1a1a;border-radius:50%;box-shadow:0 2px 8px rgba(232,122,46,0.5),0 0 0 1px rgba(232,122,46,0.3)"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
                          for (let i = 1; i < lines.length; i++) {
                            const parts = lines[i].split(",");
                            if (parts.length < 7) continue;
                            const pLat = parseFloat(parts[5]), pLng = parseFloat(parts[6]);
                            if (isNaN(pLat) || isNaN(pLng)) continue;
                            const dist = haversine(siteLat, siteLng, pLat, pLng);
                            if (dist <= 25) {
                              psCount++;
                              const pNum = parts[0], pName = parts[1], pAddr = parts[2], pCity = parts[3], pState = parts[4];
                              const marker = L.marker([pLat, pLng], { icon: psIcon }).addTo(map);
                              marker.bindTooltip(`<div style="font-weight:800;font-size:11px;color:#1565C0">${pNum}</div><div style="font-size:10px;color:#334155">${pAddr}</div><div style="font-size:10px;color:#64748B">${pCity}, ${pState}</div><div style="font-size:10px;color:#E87A2E;font-weight:700;margin-top:3px">${dist.toFixed(1)} mi</div>`, { direction: "auto", offset: [0, -8] });
                              marker.bindPopup(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><div style="width:10px;height:10px;background:linear-gradient(135deg,#E87A2E,#F59E0B);border:1.5px solid #1a1a1a;border-radius:50%"></div><span style="font-weight:900;font-size:13px;color:#E87A2E">${pNum}</span></div><div style="font-size:12px;font-weight:600;color:#334155">${pName}</div><div style="font-size:11px;color:#64748B;margin-top:3px">${pAddr}</div><div style="font-size:11px;color:#64748B">${pCity}, ${pState}</div><div style="margin-top:6px;padding-top:6px;border-top:1px solid #E2E8F0"><span style="font-size:12px;color:#1565C0;font-weight:800">${dist.toFixed(1)} mi</span><span style="font-size:10px;color:#94A3B8;margin-left:4px">from subject</span></div>`);
                            }
                          }
                          // Add count badge
                          const badge = document.createElement("div");
                          badge.style.cssText = "position:absolute;bottom:12px;right:12px;z-index:1000;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);color:#fff;padding:8px 16px;border-radius:10px;font-size:12px;font-weight:700;border:1px solid rgba(232,122,46,0.3);display:flex;align-items:center;gap:8px";
                          badge.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:linear-gradient(135deg,#E87A2E,#F59E0B);border-radius:6px;font-size:13px;font-weight:900;color:#1a1a1a">${psCount}</span><span>PS locations within 25 mi</span>`;
                          el.appendChild(badge);
                        }).catch(() => {});
                        // 3-mile radius ring
                        L.circle([siteLat, siteLng], { radius: 4828, color: "#C9A84C", weight: 2, opacity: 0.5, fillColor: "#C9A84C", fillOpacity: 0.04, dashArray: "8,6" }).addTo(map).bindPopup("<div style='font-weight:700;font-size:11px;color:#C9A84C'>3-Mile Radius</div><div style='font-size:10px;color:#64748B'>Primary trade area</div>");
                      };
                      if (!document.getElementById("leaflet-js")) {
                        const js = document.createElement("script"); js.id = "leaflet-js";
                        js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
                        js.onload = initMap; document.head.appendChild(js);
                      } else { initMap(); }
                    }} />
                  </div>
                );
              })()}

              {/* SITESCORE DEEP BREAKDOWN — expandable (moved below map) */}
              {scoreExpanded && (() => {
                const bd = iqR.breakdown || [];
                const wSum = bd.reduce((a, b) => a + b.weight, 0);
                return (
                  <div style={{ borderRadius: 16, marginBottom: 20, overflow: "hidden", border: "1px solid rgba(201,168,76,0.15)", background: "rgba(10,10,14,0.95)", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
                    <div style={{ background: "linear-gradient(135deg,#0F172A,#1E2761,#1565C0)", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 18 }}>🎯</span>
                        <span style={{ color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: "0.06em" }}>SITESCORE<span style={{ fontSize: 10, verticalAlign: "super" }}>™</span> BREAKDOWN</span>
                        <span style={{ background: iqR.classColor + "25", color: iqR.classColor, fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6 }}>{iqR.classification}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ fontSize: 32, fontWeight: 900, color: iqR.tier === "gold" ? "#FFD700" : "#E2E8F0", fontFamily: "'Space Mono', monospace", textShadow: iqR.tier === "gold" ? "0 0 20px rgba(255,215,0,0.4)" : "none" }}>{iqR.score.toFixed(2)}</div>
                        <span style={{ fontSize: 12, color: "#94A3B8" }}>/10</span>
                        <button onClick={() => setScoreExpanded(false)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "#94A3B8", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✕</button>
                      </div>
                    </div>
                    {/* Dimension rows — CLICKABLE with expandable deep-dive panels */}
                    <div style={{ padding: "8px 0" }}>
                      {bd.map((dim, i) => {
                        const pct = (dim.score / 10) * 100;
                        const barC = dim.score >= 8 ? "#22C55E" : dim.score >= 6 ? "#3B82F6" : dim.score >= 4 ? "#F59E0B" : "#EF4444";
                        const wPct = wSum > 0 ? ((dim.weight / wSum) * 100).toFixed(0) : "0";
                        const contrib = (dim.score * dim.weight / wSum).toFixed(2);
                        const dimIcons = ["👥","📈","💰","🏠","🏡","🏷️","🏛","📍","🚗","🏪","🗺"];
                        const isExpanded = scoreDimExpanded === dim.key;
                        const pN = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                        const popRaw = pN(site.pop3mi); const pop1Raw = pN(site.pop1mi); const hhiRaw = pN(site.income3mi);
                        const hhRaw = pN(site.households3mi); const hvRaw = pN(site.homeValue3mi);
                        const gVal = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : null;
                        const iq = site.siteiqData || {};
                        const pricePerAc = (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); const a = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? Math.round(p / a) : null; })();
                        // Helper: metric row inside expansion
                        const MRow = ({ label, value, bench, benchLabel, color, pctOf }) => (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(201,168,76,0.04)" }}>
                            <div style={{ width: 140, fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>{label}</div>
                            <div style={{ flex: 1, position: "relative", height: 10, borderRadius: 5, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (pctOf || 0))}%`, borderRadius: 5, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                            </div>
                            <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{value || "—"}</div>
                            {bench && <div style={{ width: 100, textAlign: "right", fontSize: 9, color: "#6B7394" }}>vs {benchLabel}</div>}
                          </div>
                        );
                        // Helper: SiteScore analysis box
                        const StorvexAnalysis = ({ text, signal, signalColor }) => (
                          <div style={{ marginTop: 16, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(201,168,76,0.12)" }}>
                            <div style={{ background: "linear-gradient(135deg, #1E2761, #0F172A)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 12 }}>🔬</span>
                              <span style={{ fontSize: 10, fontWeight: 900, color: "#C9A84C", letterSpacing: "0.1em" }}>STORVEX SUMMARY ANALYSIS</span>
                              {signal && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, padding: "2px 10px", borderRadius: 5, background: (signalColor || "#C9A84C") + "18", color: signalColor || "#C9A84C" }}>{signal}</span>}
                            </div>
                            <div style={{ padding: "12px 16px", background: "rgba(10,10,14,0.6)", fontSize: 11, color: "#CBD5E1", lineHeight: 1.7 }}>{text}</div>
                          </div>
                        );
                        // Build expansion content per dimension key
                        const renderDimExpansion = () => {
                          const dK = dim.key;
                          if (dK === "population") {
                            const popBench = 40000; const minPop = 5000;
                            const popPct = popRaw ? Math.min(100, (popRaw / popBench) * 100) : 0;
                            const pop1Pct = pop1Raw ? Math.min(100, (pop1Raw / 10000) * 100) : 0;
                            const futurePop = popRaw && gVal != null ? Math.round(popRaw * Math.pow(1 + gVal / 100, 5)) : null;
                            const futPct = futurePop ? Math.min(100, (futurePop / popBench) * 100) : 0;
                            const signal = popRaw >= 40000 ? "DENSE MARKET" : popRaw >= 25000 ? "SOLID DEMAND" : popRaw >= 10000 ? "EMERGING" : "THIN";
                            const sigColor = popRaw >= 40000 ? "#22C55E" : popRaw >= 25000 ? "#3B82F6" : popRaw >= 10000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>RADIUS POPULATION BREAKDOWN</div>
                                  <MRow label="1-Mile Radius" value={pop1Raw ? pop1Raw.toLocaleString() : "—"} color="#8B5CF6" pctOf={pop1Pct} bench benchLabel="10K" />
                                  <MRow label="3-Mile Radius" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popPct} bench benchLabel="40K" />
                                  <MRow label="5-Mile (est.)" value={popRaw ? Math.round(popRaw * 2.4).toLocaleString() : "—"} color="#1D4ED8" pctOf={popRaw ? Math.min(100, (popRaw * 2.4 / 100000) * 100) : 0} bench benchLabel="100K" />
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(34,197,94,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PROJECTED TRAJECTORY (2025-2030)</div>
                                  <MRow label="Current (2025)" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popPct} />
                                  <MRow label="Projected (2030)" value={futurePop ? futurePop.toLocaleString() : "—"} color={gVal > 0 ? "#22C55E" : "#EF4444"} pctOf={futPct} />
                                  <MRow label="Net Change" value={futurePop && popRaw ? (futurePop > popRaw ? "+" : "") + (futurePop - popRaw).toLocaleString() : "—"} color={gVal > 0 ? "#22C55E" : "#EF4444"} pctOf={futurePop && popRaw ? Math.min(100, Math.abs(futurePop - popRaw) / popRaw * 100 * 5) : 0} />
                                  <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 10, color: "#6B7394" }}>5-Year CAGR</span>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: gVal > 0 ? "#22C55E" : gVal === 0 ? "#94A3B8" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{gVal != null ? (gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "%" : "—"}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 4 }}>
                                <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>PS BENCHMARK</div>
                                  <div style={{ fontSize: 16, fontWeight: 900, color: "#4A5080", fontFamily: "'Space Mono', monospace" }}>40,000</div>
                                  <div style={{ fontSize: 9, color: popRaw >= 40000 ? "#22C55E" : "#F59E0B", fontWeight: 700 }}>{popRaw ? (popRaw >= 40000 ? "EXCEEDS" : Math.round(popRaw / 400) + "% of target") : "—"}</div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>MIN THRESHOLD</div>
                                  <div style={{ fontSize: 16, fontWeight: 900, color: "#EF4444", fontFamily: "'Space Mono', monospace" }}>5,000</div>
                                  <div style={{ fontSize: 9, color: popRaw >= 5000 ? "#22C55E" : "#EF4444", fontWeight: 700 }}>{popRaw >= 5000 ? "CLEAR" : "BELOW MIN"}</div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>DENSITY SIGNAL</div>
                                  <div style={{ fontSize: 14, fontWeight: 900, color: sigColor, fontFamily: "'Space Mono', monospace" }}>{signal}</div>
                                  <div style={{ fontSize: 9, color: "#6B7394", fontWeight: 600 }}>Score: {dim.score}/10</div>
                                </div>
                              </div>
                              <StorvexAnalysis signal={signal} signalColor={sigColor} text={popRaw >= 40000 ? `Dense population base of ${popRaw.toLocaleString()} within 3 miles indicates strong latent storage demand. This market exceeds Public Storage's 40K benchmark, placing it in the top tier for household-driven self-storage absorption. ${gVal > 1 ? "Combined with above-average growth, this submarket has compounding demand tailwinds." : "Population density alone supports facility viability."}` : popRaw >= 15000 ? `Population of ${popRaw.toLocaleString()} within 3 miles falls in the mid-range for storage feasibility. While below the 40K premium benchmark, this density is sufficient to support a climate-controlled facility if competition is limited. ${gVal > 1.5 ? "Strong growth trajectory could push this into premium territory within 3-5 years." : "Growth and income quality become critical tiebreakers at this population level."}` : `Population of ${popRaw ? popRaw.toLocaleString() : "N/A"} within 3 miles signals a thinner demand base. Storage facilities in sub-15K markets require either very low competition, premium income demographics, or exceptional growth to justify development. Recommend careful validation of demand drivers.`} />
                            </div>);
                          }
                          if (dK === "growth") {
                            const gC = gVal > 1.5 ? "#22C55E" : gVal > 0.5 ? "#4ADE80" : gVal > 0 ? "#FBBF24" : gVal > -0.5 ? "#94A3B8" : "#EF4444";
                            const outlook = gVal > 2.0 ? "RAPID EXPANSION" : gVal > 1.5 ? "HIGH GROWTH" : gVal > 1.0 ? "ABOVE AVERAGE" : gVal > 0.5 ? "STEADY GROWTH" : gVal > 0 ? "STABLE" : gVal > -0.5 ? "FLAT" : "DECLINING";
                            const natAvg = 0.5; const futurePop = popRaw && gVal != null ? Math.round(popRaw * Math.pow(1 + gVal / 100, 5)) : null;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: `1px solid ${gC}15`, textAlign: "center" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>5-YEAR COMPOUND ANNUAL GROWTH RATE</div>
                                  <div style={{ fontSize: 48, fontWeight: 900, color: gC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{gVal != null ? (gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "%" : "—"}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: gC, marginTop: 8, letterSpacing: "0.05em" }}>{outlook}</div>
                                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginTop: 14 }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(5, ((gVal || 0) / 3) * 100))}%`, borderRadius: 4, background: `linear-gradient(90deg, ${gC}99, ${gC})` }} />
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ fontSize: 8, color: "#4A5080" }}>0%</span><span style={{ fontSize: 8, color: "#4A5080" }}>3%+ (rapid)</span></div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>GROWTH CONTEXT</div>
                                  <MRow label="This Market" value={gVal != null ? gVal.toFixed(2) + "%" : "—"} color={gC} pctOf={gVal ? Math.min(100, (gVal / 3) * 100) : 0} />
                                  <MRow label="National Average" value={natAvg.toFixed(2) + "%"} color="#4A5080" pctOf={(natAvg / 3) * 100} />
                                  <MRow label="Spread vs National" value={gVal != null ? (gVal - natAvg >= 0 ? "+" : "") + (gVal - natAvg).toFixed(2) + "%" : "—"} color={gVal > natAvg ? "#22C55E" : "#EF4444"} pctOf={gVal ? Math.min(100, Math.abs(gVal - natAvg) / 3 * 100) : 0} />
                                  {futurePop && popRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}>
                                    <div style={{ fontSize: 9, color: "#6B7394", marginBottom: 4 }}>5-YEAR NET POPULATION CHANGE</div>
                                    <div style={{ fontSize: 18, fontWeight: 900, color: futurePop > popRaw ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{futurePop > popRaw ? "+" : ""}{(futurePop - popRaw).toLocaleString()} people</div>
                                    <div style={{ fontSize: 10, color: "#94A3B8" }}>{popRaw.toLocaleString()} (2025) → {futurePop.toLocaleString()} (2030)</div>
                                  </div>}
                                </div>
                              </div>
                              <StorvexAnalysis signal={outlook} signalColor={gC} text={gVal > 1.5 ? `This submarket is growing at ${gVal.toFixed(2)}% annually, ${(gVal / natAvg).toFixed(1)}x the national average. Rapid population growth is the strongest predictor of new storage demand, as incoming households typically need storage during relocation transitions. This growth rate projects ${futurePop ? "+" + (futurePop - (popRaw || 0)).toLocaleString() + " new residents" : "significant expansion"} by 2030, creating a compounding demand tailwind.` : gVal > 0.5 ? `Growth rate of ${gVal.toFixed(2)}% tracks above the national average of ${natAvg}%. Steady population expansion supports organic storage demand growth. New household formation in this corridor will drive incremental absorption, though the pace suggests a 3-5 year lease-up horizon for new development.` : gVal > 0 ? `Modest growth at ${gVal.toFixed(2)}% is near the national baseline. Storage demand will be primarily driven by existing household turnover and life events (moves, downsizing, renovations) rather than net new population. Competition quality becomes the critical differentiator in stable markets.` : `Population contraction at ${gVal ? gVal.toFixed(2) : "N/A"}% annually presents a demand headwind. Storage facilities in declining markets can still perform if positioned to capture market share from weaker operators, but organic demand growth is limited. Recommend focus on existing facility occupancy data and competitor health.`} />
                            </div>);
                          }
                          if (dK === "income") {
                            const hhiBench = 90000; const midBench = 65000; const minBench = 55000;
                            const pctTop = hhiRaw ? Math.min(100, (hhiRaw / hhiBench) * 100) : 0;
                            const tier = hhiRaw >= 90000 ? "PREMIUM" : hhiRaw >= 75000 ? "AFFLUENT" : hhiRaw >= 65000 ? "STRONG" : hhiRaw >= 55000 ? "ADEQUATE" : "BELOW THRESHOLD";
                            const tierC = hhiRaw >= 90000 ? "#C9A84C" : hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 65000 ? "#3B82F6" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tierC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOUSEHOLD INCOME</div>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1, marginBottom: 8 }}>{hhiRaw ? "$" + hhiRaw.toLocaleString() : "—"}</div>
                                  <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 6, background: tierC + "18", border: `1px solid ${tierC}30` }}>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: tierC }}>{tier}</span>
                                  </div>
                                  <div style={{ marginTop: 14 }}>
                                    <MRow label="This Market" value={"$" + (hhiRaw || 0).toLocaleString()} color={tierC} pctOf={pctTop} />
                                    <MRow label="Premium ($90K)" value="$90,000" color="#C9A84C" pctOf={100} />
                                    <MRow label="Strong ($65K)" value="$65,000" color="#3B82F6" pctOf={(65000 / hhiBench) * 100} />
                                    <MRow label="Minimum ($55K)" value="$55,000" color="#EF4444" pctOf={(55000 / hhiBench) * 100} />
                                  </div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>INCOME IMPLICATIONS FOR STORAGE</div>
                                  {[
                                    { label: "Willingness to Pay", val: hhiRaw >= 75000 ? "High" : hhiRaw >= 55000 ? "Moderate" : "Limited", color: hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444", desc: "Higher income = premium unit absorption" },
                                    { label: "Climate-Controlled Demand", val: hhiRaw >= 65000 ? "Strong" : "Moderate", color: hhiRaw >= 65000 ? "#22C55E" : "#F59E0B", desc: "Affluent households store higher-value items" },
                                    { label: "Price Sensitivity", val: hhiRaw >= 90000 ? "Low" : hhiRaw >= 65000 ? "Moderate" : "High", color: hhiRaw >= 90000 ? "#22C55E" : hhiRaw >= 65000 ? "#F59E0B" : "#EF4444", desc: "Impacts rate growth potential" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ padding: "10px 0", borderBottom: j < 2 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{r.label}</span>
                                        <span style={{ fontSize: 12, fontWeight: 800, color: r.color, fontFamily: "'Space Mono', monospace" }}>{r.val}</span>
                                      </div>
                                      <div style={{ fontSize: 9, color: "#6B7394", marginTop: 2 }}>{r.desc}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={tier} signalColor={tierC} text={hhiRaw >= 90000 ? `Premium income market at $${hhiRaw.toLocaleString()} median HHI. Households at this income level are the core self-storage demographic: homeowners with accumulated possessions, disposable income for monthly storage rents, and preference for climate-controlled units. This income tier supports premium pricing strategies and strong RevPAF.` : hhiRaw >= 65000 ? `Solid income base at $${hhiRaw.toLocaleString()} median HHI. This level supports standard self-storage pricing and moderate climate-controlled unit demand. Households can absorb typical rate increases without significant churn. Income alone is not a differentiator but removes downside risk.` : `Income at $${(hhiRaw || 0).toLocaleString()} approaches the $55K minimum threshold. Lower-income markets typically see higher price sensitivity, lower climate-controlled uptake, and greater churn. Storage demand exists but skews toward smaller, drive-up units. Premium pricing will be constrained.`} />
                            </div>);
                          }
                          if (dK === "households") {
                            const hhBench = 25000;
                            const hhPct = hhRaw ? Math.min(100, (hhRaw / hhBench) * 100) : 0;
                            const signal = hhRaw >= 25000 ? "DEEP DEMAND POOL" : hhRaw >= 18000 ? "STRONG BASE" : hhRaw >= 12000 ? "ADEQUATE" : hhRaw >= 6000 ? "MODERATE" : "LIMITED";
                            const sigC = hhRaw >= 25000 ? "#22C55E" : hhRaw >= 12000 ? "#3B82F6" : hhRaw >= 6000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sigC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>3-MILE HOUSEHOLD COUNT</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hhRaw ? hhRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: sigC + "18", border: `1px solid ${sigC}30` }}>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: sigC }}>{signal}</span>
                                  </div>
                                </div>
                                <MRow label="This Market" value={(hhRaw || 0).toLocaleString()} color={sigC} pctOf={hhPct} bench benchLabel="25K" />
                                <MRow label="Top Tier (25K)" value="25,000" color="#22C55E" pctOf={100} />
                                <MRow label="Solid Base (12K)" value="12,000" color="#3B82F6" pctOf={48} />
                                <MRow label="Minimum (6K)" value="6,000" color="#F59E0B" pctOf={24} />
                                {popRaw && hhRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 10, color: "#6B7394" }}>Avg Household Size</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{(popRaw / hhRaw).toFixed(1)} people/hh</span>
                                </div>}
                              </div>
                              <StorvexAnalysis signal={signal} signalColor={sigC} text={hhRaw >= 25000 ? `${hhRaw.toLocaleString()} households within 3 miles represents a deep demand pool. Industry data indicates approximately 10% of US households rent storage at any given time, projecting ~${Math.round(hhRaw * 0.10).toLocaleString()} potential storage renters in this trade area. This base can support multiple facilities without saturation.` : hhRaw >= 12000 ? `${hhRaw.toLocaleString()} households provide a solid demand base. With typical 10% storage penetration, this projects ~${Math.round((hhRaw || 0) * 0.10).toLocaleString()} potential renters. Sufficient to support a single well-positioned facility, though competition share becomes a critical variable.` : `Household count of ${(hhRaw || 0).toLocaleString()} indicates a thinner customer base. Each competitor in the trade area consumes a larger share of available demand. Success depends on capturing a dominant market position and/or below-average competition.`} />
                            </div>);
                          }
                          if (dK === "homeValue") {
                            const hvBench = 500000;
                            const hvPct = hvRaw ? Math.min(100, (hvRaw / hvBench) * 100) : 0;
                            const tier = hvRaw >= 500000 ? "PREMIUM" : hvRaw >= 350000 ? "UPPER-MIDDLE" : hvRaw >= 250000 ? "MIDDLE MARKET" : hvRaw >= 180000 ? "MODERATE" : "VALUE";
                            const tierC = hvRaw >= 500000 ? "#C9A84C" : hvRaw >= 350000 ? "#22C55E" : hvRaw >= 250000 ? "#3B82F6" : hvRaw >= 180000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tierC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOME VALUE (3-MI)</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hvRaw ? "$" + hvRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: tierC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: tierC }}>{tier}</span></div>
                                </div>
                                <MRow label="This Market" value={"$" + (hvRaw || 0).toLocaleString()} color={tierC} pctOf={hvPct} bench benchLabel="$500K" />
                                <MRow label="Premium ($500K)" value="$500,000" color="#C9A84C" pctOf={100} />
                                <MRow label="Affluent ($350K)" value="$350,000" color="#22C55E" pctOf={70} />
                                <MRow label="Middle ($250K)" value="$250,000" color="#3B82F6" pctOf={50} />
                              </div>
                              <StorvexAnalysis signal={tier} signalColor={tierC} text={hvRaw >= 350000 ? `Home values averaging $${(hvRaw || 0).toLocaleString()} signal an affluent submarket. Higher home values strongly correlate with storage demand: homeowners accumulate more possessions, invest in climate-sensitive items (furniture, electronics, wine), and are willing to pay premium storage rates. This is a wealth indicator that supports aggressive RevPAF targets.` : hvRaw >= 180000 ? `Middle-market home values at $${(hvRaw || 0).toLocaleString()} indicate a stable residential base. Storage demand will be driven by standard household storage needs (seasonal items, life transitions) rather than premium asset storage. Pricing should target competitive market rates.` : `Home values below $180K suggest a value-oriented market. Storage demand exists but skews toward basic, cost-sensitive solutions. Climate-controlled premium units may see slower absorption. Drive-up and smaller unit mixes perform better in this tier.`} />
                            </div>);
                          }
                          if (dK === "zoning") {
                            const zClass = site.zoningClassification || "unknown";
                            const zColor = zClass === "by-right" ? "#22C55E" : zClass === "conditional" ? "#F59E0B" : zClass === "rezone-required" ? "#EF4444" : "#6B7394";
                            const zLabel = zClass === "by-right" ? "BY-RIGHT" : zClass === "conditional" ? "CONDITIONAL (SUP/CUP)" : zClass === "rezone-required" ? "REZONE REQUIRED" : "UNKNOWN";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${zColor}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>ZONING CLASSIFICATION</div>
                                  <div style={{ fontSize: 22, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", marginBottom: 6 }}>{site.zoning || "TBD"}</div>
                                  <div style={{ display: "inline-block", padding: "5px 14px", borderRadius: 6, background: zColor + "18", border: `1px solid ${zColor}30`, marginBottom: 14 }}>
                                    <span style={{ fontSize: 12, fontWeight: 800, color: zColor }}>{zLabel}</span>
                                  </div>
                                  {site.zoningUseTerm && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>USE CATEGORY: </span><span style={{ fontSize: 11, color: "#E2E8F0" }}>{site.zoningUseTerm}</span></div>}
                                  {site.zoningOrdinanceSection && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>ORDINANCE: </span><span style={{ fontSize: 11, color: "#E2E8F0" }}>{site.zoningOrdinanceSection}</span></div>}
                                  {site.overlayDistrict && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>OVERLAY: </span><span style={{ fontSize: 11, color: "#E2E8F0" }}>{site.overlayDistrict}</span></div>}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>ENTITLEMENT REQUIREMENTS</div>
                                  {[
                                    { label: "Permitting Path", val: zLabel, color: zColor },
                                    { label: "Est. Timeline", val: site.supTimeline || (zClass === "by-right" ? "30-60 days" : zClass === "conditional" ? "3-6 months" : "6-12+ months"), color: zClass === "by-right" ? "#22C55E" : zClass === "conditional" ? "#F59E0B" : "#EF4444" },
                                    { label: "Est. Cost", val: site.supCost || (zClass === "by-right" ? "$5K-$15K" : zClass === "conditional" ? "$25K-$50K" : "$50K-$100K+") },
                                    { label: "Political Risk", val: site.politicalRisk || "Not assessed" },
                                    { label: "Planning Contact", val: site.planningContact || "Not recorded" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: j < 4 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <span style={{ fontSize: 11, color: "#94A3B8" }}>{r.label}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: r.color || "#E2E8F0", textAlign: "right", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={zLabel} signalColor={zColor} text={zClass === "by-right" ? `Storage is permitted by-right under ${site.zoning || "current zoning"}, eliminating the largest entitlement risk factor. By-right approval typically takes 30-60 days through standard site plan review. This is the optimal zoning scenario and significantly de-risks the development timeline.${site.facadeReqs ? " Note: architectural/facade requirements may apply." : ""}` : zClass === "conditional" ? `Storage requires a conditional use permit (SUP/CUP) under ${site.zoning || "current zoning"}. This introduces 3-6 months of entitlement timeline and $25K-$50K in application/legal costs. Success depends on political environment, neighbor opposition risk, and recent approval history. ${site.politicalRisk === "Low" ? "Low political risk noted." : "Recommend checking recent storage approvals in this jurisdiction."}` : zClass === "rezone-required" ? `Rezoning is required, representing the highest entitlement risk. Timeline extends to 6-12+ months with $50K-$100K+ in costs and no guarantee of approval. This adds significant risk premium to the deal and should be reflected in pricing negotiations.` : `Zoning classification not yet confirmed for ${site.zoning || "this parcel"}. Immediate verification of the permitted use table is required before advancing. Contact local planning department to confirm self-storage permissibility under the current district.`} />
                            </div>);
                          }
                          if (dK === "psProximity") {
                            const psD = iq.nearestPS; const psDist = typeof psD === "number" ? psD : parseFloat(psD);
                            const proxSignal = psDist <= 5 ? "VALIDATED SUBMARKET" : psDist <= 10 ? "PS ADJACENT" : psDist <= 15 ? "MODERATE DISTANCE" : psDist <= 25 ? "EDGE OF FOOTPRINT" : "REMOTE";
                            const proxC = psDist <= 5 ? "#22C55E" : psDist <= 10 ? "#3B82F6" : psDist <= 15 ? "#F59E0B" : "#E87A2E";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${proxC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PS NEAREST FACILITY PROXIMITY</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 42, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{psDist ? psDist.toFixed(1) : "—"}<span style={{ fontSize: 16, color: "#6B7394" }}> mi</span></div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: proxC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: proxC }}>{proxSignal}</span></div>
                                </div>
                                <div style={{ marginTop: 8 }}>
                                  {[
                                    { label: "0-5 mi: Validated Submarket", color: "#22C55E", active: psDist <= 5, score: "10/10" },
                                    { label: "5-10 mi: PS Adjacent", color: "#3B82F6", active: psDist > 5 && psDist <= 10, score: "9/10" },
                                    { label: "10-15 mi: Moderate", color: "#F59E0B", active: psDist > 10 && psDist <= 15, score: "7/10" },
                                    { label: "15-25 mi: Edge", color: "#E87A2E", active: psDist > 15 && psDist <= 25, score: "5/10" },
                                    { label: "25-35 mi: Remote", color: "#EF4444", active: psDist > 25, score: "3/10" },
                                  ].map((t, j) => (
                                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, marginBottom: 4, background: t.active ? t.color + "12" : "transparent", border: t.active ? `1px solid ${t.color}30` : "1px solid transparent" }}>
                                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.active ? t.color : "#4A5080" }} />
                                      <span style={{ fontSize: 11, color: t.active ? "#E2E8F0" : "#6B7394", fontWeight: t.active ? 700 : 500, flex: 1 }}>{t.label}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: t.active ? t.color : "#4A5080", fontFamily: "'Space Mono', monospace" }}>{t.score}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={proxSignal} signalColor={proxC} text={psDist <= 5 ? `Nearest PS facility is just ${psDist.toFixed(1)} miles away, confirming this as a validated PS submarket. Proximity to existing PS locations indicates the market has been previously vetted and approved by PS development. Closer proximity = stronger market validation signal, not cannibalization risk. New facilities in proven PS markets typically achieve faster lease-up.` : psDist <= 15 ? `At ${psDist.toFixed(1)} miles from the nearest PS location, this site sits within PS's established operating footprint. The distance suggests an adjacent trade area that PS has not yet saturated, presenting an infill opportunity. This proximity supports operational efficiency for PS's regional management structure.` : `${psDist ? psDist.toFixed(1) : "N/A"} miles from the nearest PS facility places this at the edge of PS's current footprint. While not a disqualifier, sites beyond 25 miles require stronger standalone fundamentals (demographics, growth, limited competition) to justify expansion into a new submarket. Above 35 miles is an automatic exclusion per PS criteria.`} />
                            </div>);
                          }
                          if (dK === "access") {
                            const acreage = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
                            const sizeSignal = acreage >= 3.5 && acreage <= 5 ? "IDEAL SIZE" : acreage >= 2.5 ? "VIABLE" : acreage >= 5 && acreage <= 7 ? "LARGE" : "REVIEW";
                            const sizeC = acreage >= 3.5 && acreage <= 5 ? "#22C55E" : acreage >= 2.5 ? "#3B82F6" : "#F59E0B";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sizeC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>SITE SIZE & CONFIGURATION</div>
                                  <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
                                    <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{acreage ? acreage.toFixed(2) : "—"}<span style={{ fontSize: 14, color: "#6B7394" }}> ac</span></div>
                                    <div style={{ padding: "4px 12px", borderRadius: 6, background: sizeC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: sizeC }}>{sizeSignal}</span></div>
                                  </div>
                                  {[
                                    { label: "Primary (3.5-5 ac)", desc: "One-story indoor CC", range: [3.5, 5], color: "#22C55E" },
                                    { label: "Secondary (2.5-3.5 ac)", desc: "Multi-story option", range: [2.5, 3.5], color: "#3B82F6" },
                                    { label: "Large (5-7 ac)", desc: "Subdivisible", range: [5, 7], color: "#F59E0B" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 5, marginBottom: 3, background: acreage >= r.range[0] && acreage <= r.range[1] ? r.color + "12" : "transparent" }}>
                                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: acreage >= r.range[0] && acreage <= r.range[1] ? r.color : "#4A5080" }} />
                                      <span style={{ fontSize: 10, color: acreage >= r.range[0] && acreage <= r.range[1] ? "#E2E8F0" : "#6B7394", fontWeight: acreage >= r.range[0] && acreage <= r.range[1] ? 700 : 500 }}>{r.label}</span>
                                      <span style={{ fontSize: 9, color: "#4A5080", marginLeft: "auto" }}>{r.desc}</span>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>ACCESS & ENVIRONMENTAL</div>
                                  {[
                                    { label: "Road Frontage", val: site.roadFrontage || "Not confirmed" },
                                    { label: "Traffic (VPD)", val: site.trafficData || "—" },
                                    { label: "Flood Zone", val: site.floodZone || "Not checked", color: site.floodZone && site.floodZone.toLowerCase().includes("zone x") ? "#22C55E" : "#F59E0B" },
                                    { label: "Terrain", val: site.terrain || "—" },
                                    { label: "Visibility", val: site.visibility || "—" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: j < 4 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <span style={{ fontSize: 11, color: "#94A3B8" }}>{r.label}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: r.color || "#E2E8F0", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={sizeSignal} signalColor={sizeC} text={`${acreage ? acreage.toFixed(2) + " acres" : "Acreage TBD"} — ${acreage >= 3.5 && acreage <= 5 ? "ideal footprint for PS's preferred one-story, indoor climate-controlled product. This size accommodates 80,000-110,000 net rentable SF with adequate parking, landscaping, and stormwater management." : acreage >= 2.5 && acreage < 3.5 ? "suitable for a multi-story (3-4 story) climate-controlled facility. Tighter footprint requires vertical construction but can still achieve 70,000-100,000 net rentable SF." : acreage > 5 ? "large parcel offers flexibility. Could accommodate PS's standard product with excess land for future expansion, pad site sale, or outparcel development to offset land basis." : "may be undersized for PS's standard product. Evaluate whether a compact multi-story design is feasible for this footprint."} ${site.floodZone && !site.floodZone.toLowerCase().includes("zone x") ? " Flood zone designation requires additional investigation." : ""}`} />
                            </div>);
                          }
                          if (dK === "competition") {
                            const compCount = iq.competitorCount || 0;
                            const compNames = iq.competitorNames;
                            const nearComp = iq.nearestCompetitor;
                            const signal = compCount <= 1 ? "UNDERSERVED" : compCount <= 3 ? "LOW COMPETITION" : compCount <= 6 ? "MODERATE" : "COMPETITIVE";
                            const sigC = compCount <= 1 ? "#22C55E" : compCount <= 3 ? "#3B82F6" : compCount <= 6 ? "#F59E0B" : "#EF4444";
                            const operators = compNames ? String(compNames).split(",").map(n => n.trim()).filter(Boolean) : [];
                            const reitCount = operators.filter(n => n.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i)).length;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sigC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>COMPETITIVE DENSITY (3-MI RADIUS)</div>
                                  <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                    <div style={{ fontSize: 48, fontWeight: 900, color: sigC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{compCount}</div>
                                    <div>
                                      <div style={{ padding: "4px 12px", borderRadius: 6, background: sigC + "18", marginBottom: 4 }}><span style={{ fontSize: 11, fontWeight: 800, color: sigC }}>{signal}</span></div>
                                      {reitCount > 0 && <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 700 }}>{reitCount} REIT operator{reitCount > 1 ? "s" : ""}</div>}
                                    </div>
                                  </div>
                                  {nearComp && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>NEAREST: </span><span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{nearComp}</span></div>}
                                  {(site.demandSupplySignal || site.competingSF) && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>MARKET: </span><span style={{ fontSize: 11, color: "#C9A84C", fontWeight: 600 }}>{site.demandSupplySignal || site.competingSF}</span></div>}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 10 }}>OPERATOR LANDSCAPE</div>
                                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                    {operators.length > 0 ? operators.map((name, j) => (
                                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: j < operators.length - 1 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/i) ? "#EF4444" : name.match(/StorageMart|U-Haul|SecurCare/i) ? "#F59E0B" : "#3B82F6", flexShrink: 0 }} />
                                        <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600, flex: 1 }}>{name}</span>
                                        {name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i) && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 3 }}>REIT</span>}
                                      </div>
                                    )) : <div style={{ fontSize: 11, color: "#6B7394", fontStyle: "italic" }}>No operator data available</div>}
                                  </div>
                                </div>
                              </div>
                              <StorvexAnalysis signal={signal} signalColor={sigC} text={compCount <= 1 ? `Only ${compCount} competing facilit${compCount === 1 ? "y" : "ies"} within 3 miles signals an underserved market with significant unmet demand. Low competition environments allow for premium pricing, faster lease-up, and dominant market positioning. This is the ideal competitive landscape for a new PS development.` : compCount <= 3 ? `${compCount} competitors within 3 miles represents manageable competition. Market is not saturated, and a well-positioned PS facility can capture meaningful share. ${reitCount > 0 ? `${reitCount} REIT operator(s) present validates institutional-grade demand.` : "Predominantly local operators suggest opportunity for a REIT-quality facility to capture market share."} Focus on differentiation through climate-controlled product and PS brand strength.` : compCount <= 6 ? `${compCount} facilities within 3 miles indicates moderate competition. Market is established with proven demand, but share capture requires competitive positioning. ${reitCount >= 2 ? "Multiple REIT operators confirm a mature, validated market." : ""} Key success factors: unit mix optimization, competitive rate strategy, and superior site visibility/access.` : `${compCount} facilities within 3 miles signals high competitive density. New entrant faces lease-up headwinds in a market with existing supply. Recommend careful analysis of occupancy rates, rate trends, and whether recent new supply has been absorbed. Success requires a differentiated value proposition or displacement of weaker operators.`} />
                            </div>);
                          }
                          if (dK === "marketTier") {
                            const mt = iq.marketTier;
                            const tierLabel = mt === 1 ? "TIER 1 — PRIMARY" : mt === 2 ? "TIER 2 — STRATEGIC" : mt === 3 ? "TIER 3 — GROWTH" : mt === 4 ? "TIER 4 — EMERGING" : "UNCLASSIFIED";
                            const tierC = mt === 1 ? "#C9A84C" : mt === 2 ? "#22C55E" : mt === 3 ? "#3B82F6" : mt === 4 ? "#8B5CF6" : "#6B7394";
                            const tierMarkets = { 1: "Cincinnati / N. KY, Indianapolis", 2: "Independence KY, S. Dayton OH, Springboro OH", 3: "Middle TN corridor", 4: "DFW, Austin, Houston, Central TX" };
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tierC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>TARGET MARKET CLASSIFICATION</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 16 }}>
                                  <div style={{ fontSize: 28, fontWeight: 900, color: tierC, letterSpacing: "0.02em" }}>{tierLabel}</div>
                                </div>
                                {[1, 2, 3, 4].map(t => (
                                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 6, marginBottom: 4, background: mt === t ? (t === 1 ? "#C9A84C" : t === 2 ? "#22C55E" : t === 3 ? "#3B82F6" : "#8B5CF6") + "12" : "transparent", border: mt === t ? `1px solid ${t === 1 ? "#C9A84C" : t === 2 ? "#22C55E" : t === 3 ? "#3B82F6" : "#8B5CF6"}30` : "1px solid transparent" }}>
                                    <div style={{ width: 24, height: 24, borderRadius: 6, background: (t === 1 ? "#C9A84C" : t === 2 ? "#22C55E" : t === 3 ? "#3B82F6" : "#8B5CF6") + (mt === t ? "30" : "10"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: mt === t ? "#E2E8F0" : "#4A5080" }}>{t}</div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 11, fontWeight: mt === t ? 700 : 500, color: mt === t ? "#E2E8F0" : "#6B7394" }}>Tier {t}: {t === 1 ? "Primary" : t === 2 ? "Strategic" : t === 3 ? "Growth" : "Emerging"}</div>
                                      <div style={{ fontSize: 9, color: "#4A5080" }}>{tierMarkets[t]}</div>
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: mt === t ? tierC : "#4A5080", fontFamily: "'Space Mono', monospace" }}>{t === 1 ? "10/10" : t === 2 ? "8/10" : t === 3 ? "6/10" : "4/10"}</span>
                                  </div>
                                ))}
                              </div>
                              <StorvexAnalysis signal={tierLabel} signalColor={tierC} text={mt === 1 ? `${site.market || "This market"} is a Tier 1 primary target — PS's highest-priority expansion corridor. MT and DW have confirmed active deal flow here. Sites in Tier 1 markets receive a scoring boost reflecting PS's strategic focus and established operational infrastructure in the region.` : mt === 2 ? `Tier 2 strategic market — identified as a coverage gap in PS's footprint. These markets have zero or minimal PS presence despite strong fundamentals, representing greenfield expansion opportunities.` : mt === 3 ? `Tier 3 growth market — Middle TN corridor. Growing market with PS interest but lower strategic priority than Tier 1-2. Sites here compete primarily on fundamentals (demographics, zoning, pricing) rather than market alignment.` : mt === 4 ? `Tier 4 emerging market. PS has broader interest in this region but no confirmed target list placement. Sites score on their standalone merits. Strong fundamentals can still drive advancement.` : `Market not classified in PS's target tier system. This site will be evaluated purely on demographic and competitive fundamentals without a market alignment bonus.`} />
                            </div>);
                          }
                          return <div style={{ padding: 16, fontSize: 11, color: "#6B7394", fontStyle: "italic" }}>Detailed analysis not yet available for this dimension.</div>;
                        };
                        return (
                          <div key={dim.key}>
                            <div onClick={() => setScoreDimExpanded(isExpanded ? null : dim.key)} style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px 60px 70px", alignItems: "center", padding: "10px 24px", borderBottom: (i < bd.length - 1 && !isExpanded) ? "1px solid rgba(201,168,76,0.04)" : "none", transition: "background 0.15s", cursor: "pointer", background: isExpanded ? "rgba(201,168,76,0.06)" : "transparent" }} onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "rgba(201,168,76,0.03)"; }} onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14 }}>{dimIcons[i] || "📊"}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: isExpanded ? "#C9A84C" : "#E2E8F0" }}>{dim.label}</span>
                                <span style={{ fontSize: 9, color: isExpanded ? "#C9A84C" : "#4A5080", transition: "transform 0.2s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                              </div>
                              <div style={{ position: "relative", height: 20, borderRadius: 10, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 10, background: `linear-gradient(90deg, ${barC}CC, ${barC})`, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)", boxShadow: dim.score >= 8 ? `0 0 12px ${barC}40` : "none" }} />
                                <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 10, fontWeight: 800, color: dim.score >= 5 ? "#fff" : barC, zIndex: 1 }}>{dim.score}/10</div>
                              </div>
                              <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#94A3B8", fontFamily: "'Space Mono', monospace" }}>{wPct}%</div>
                              <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: barC, fontFamily: "'Space Mono', monospace" }}>{dim.score}</div>
                              <div style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>+{contrib}</div>
                            </div>
                            {/* EXPANDED DIMENSION DEEP DIVE */}
                            {isExpanded && (
                              <div style={{ padding: "16px 24px 20px", background: "rgba(10,10,14,0.8)", borderBottom: "2px solid rgba(201,168,76,0.1)", animation: "fadeIn 0.2s ease-out" }}>
                                {renderDimExpansion()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Column headers */}
                    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px 60px 70px", padding: "0 24px 8px", borderTop: "1px solid rgba(201,168,76,0.08)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", paddingTop: 8 }}>DIMENSION — CLICK TO EXPAND</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", paddingTop: 8 }}>SCORE BAR</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", textAlign: "center", paddingTop: 8 }}>WEIGHT</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", textAlign: "center", paddingTop: 8 }}>RAW</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", textAlign: "right", paddingTop: 8 }}>CONTRIB</div>
                    </div>
                    {/* Flags */}
                    {iqR.flags && iqR.flags.length > 0 && (
                      <div style={{ padding: "12px 24px 16px", borderTop: "1px solid rgba(201,168,76,0.08)" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>FLAGS & ADJUSTMENTS</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {iqR.flags.map((f, i) => (
                            <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 6, background: f.includes("FAIL") ? "rgba(239,68,68,0.12)" : f.includes("Growth corridor") ? "rgba(34,197,94,0.12)" : "rgba(201,168,76,0.08)", color: f.includes("FAIL") ? "#EF4444" : f.includes("Growth corridor") ? "#22C55E" : "#C9A84C", border: `1px solid ${f.includes("FAIL") ? "rgba(239,68,68,0.2)" : f.includes("Growth corridor") ? "rgba(34,197,94,0.2)" : "rgba(201,168,76,0.15)"}` }}>{f}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* KEY METRICS STRIP — with hover tooltips */}
              {(() => {
                const parsePrice = (v) => { if (!v) return NaN; const s = String(v).replace(/,/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s.replace(/[^0-9.]/g, "")); };
                const askRaw = parsePrice(site.askingPrice);
                const intRaw = parsePrice(site.internalPrice);
                const acRaw = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
                const popRaw = parseInt(String(site.pop3mi || "").replace(/[^0-9]/g, ""), 10);
                const incRaw = parseInt(String(site.income3mi || "").replace(/[^0-9]/g, ""), 10);
                const hhRaw = parseInt(String(site.households3mi || "").replace(/[^0-9]/g, ""), 10);
                const hvRaw = parseInt(String(site.homeValue3mi || "").replace(/[^0-9]/g, ""), 10);
                const growthRaw = site.popGrowth3mi || site.growthRate;
                const growthPct = growthRaw ? parseFloat(String(growthRaw).replace(/[^0-9.\-]/g, "")) : null;
                const ppaVal = (!isNaN(askRaw) && askRaw > 0 && !isNaN(acRaw) && acRaw > 0) ? Math.round(askRaw / acRaw) : null;
                const dom = site.daysOnMarket || site.dom;
                const phase = site.phase || "Prospect";

                const buildTooltip = (key) => {
                  if (key === "asking") {
                    const domStr = dom ? `${dom} days on market` : null;
                    const ppaStr = ppaVal ? `$${ppaVal.toLocaleString()}/acre` : null;
                    const lines = [];
                    lines.push(!isNaN(askRaw) && askRaw > 0 ? `Listed at $${askRaw.toLocaleString()}` : "No asking price listed");
                    if (ppaStr) lines.push(`Equates to ${ppaStr} across ${acRaw} acres`);
                    if (domStr) lines.push(domStr);
                    if (!isNaN(intRaw) && intRaw > 0) { const disc = (((askRaw - intRaw) / askRaw) * 100).toFixed(1); lines.push(`Internal target: $${intRaw.toLocaleString()} (${disc}% below ask)`); }
                    if (ppaVal) { const tier = ppaVal <= 150000 ? "Excellent - well below $150K/ac target" : ppaVal <= 250000 ? "Good - within $250K/ac acquisition range" : ppaVal <= 400000 ? "Moderate - above preferred range" : "Premium pricing - above $400K/ac"; lines.push(tier); }
                    return lines;
                  }
                  if (key === "internal") {
                    const lines = [];
                    if (!isNaN(intRaw) && intRaw > 0) {
                      if (phase === "Under Contract") lines.push(`Under contract at $${intRaw.toLocaleString()}`);
                      else if (phase === "LOI") lines.push(`LOI submitted at $${intRaw.toLocaleString()}`);
                      else if (phase === "PSA Sent") lines.push(`PSA sent at $${intRaw.toLocaleString()}`);
                      else lines.push(`Internal price target: $${intRaw.toLocaleString()}`);
                      if (!isNaN(askRaw) && askRaw > 0) { const disc = (((askRaw - intRaw) / askRaw) * 100).toFixed(1); lines.push(`${disc}% discount to asking ($${askRaw.toLocaleString()})`); }
                      if (site.summary) { const s = site.summary; if (s.toLowerCase().includes("counter")) lines.push("Negotiation history in recent summary"); }
                    } else { lines.push("No internal pricing established yet"); lines.push("Awaiting broker response or initial valuation"); }
                    return lines;
                  }
                  if (key === "acreage") {
                    const lines = [];
                    if (!isNaN(acRaw) && acRaw > 0) {
                      lines.push(`${acRaw.toFixed(2)} acres total`);
                      if (acRaw >= 3.5 && acRaw <= 5) lines.push("Ideal size for one-story indoor climate-controlled storage");
                      else if (acRaw >= 2.5 && acRaw < 3.5) lines.push("Fits 3-4 story multi-story storage product");
                      else if (acRaw > 5 && acRaw <= 7) lines.push("Larger site - potential for phased development or pad split");
                      else if (acRaw > 7) lines.push("Oversized - would need subdivision or excess land disposition");
                      else if (acRaw < 2.5) lines.push("Below minimum 2.5ac threshold - tight fit");
                      if (acRaw > 7) lines.push("Evaluate partial acquisition or subdivide strategy");
                      if (ppaVal) lines.push(`Current basis: $${ppaVal.toLocaleString()}/acre`);
                    } else { lines.push("Acreage not specified"); }
                    return lines;
                  }
                  if (key === "zoning") {
                    const lines = [];
                    const zc = site.zoningClassification || "unknown";
                    const zu = site.zoningUseTerm;
                    lines.push(`District: ${site.zoning || "Not specified"}`);
                    if (zc === "by-right") lines.push("Self-storage is PERMITTED BY RIGHT - no hearing required");
                    else if (zc === "conditional") lines.push("Conditional use / SUP required - public hearing needed");
                    else if (zc === "rezone-required") lines.push("Rezone required - higher cost and timeline risk");
                    else if (zc === "prohibited") lines.push("Storage use PROHIBITED in current district");
                    else lines.push("Zoning viability not yet confirmed");
                    if (zu) lines.push(`Use category: "${zu}"`);
                    if (site.zoningOrdinanceSection) lines.push(`Source: ${site.zoningOrdinanceSection}`);
                    if (site.jurisdictionType) lines.push(`Jurisdiction: ${site.jurisdictionType}`);
                    if (site.supCost) lines.push(`Est. entitlement cost: ${site.supCost}`);
                    return lines;
                  }
                  if (key === "pop") {
                    const lines = [];
                    if (!isNaN(popRaw) && popRaw > 0) {
                      lines.push(`${popRaw.toLocaleString()} residents within 3-mile radius`);
                      const tier = popRaw >= 40000 ? "Dense suburban market - strong demand pool" : popRaw >= 25000 ? "Solid suburban density" : popRaw >= 15000 ? "Moderate density - viable with growth" : popRaw >= 10000 ? "Lower density - growth trajectory critical" : "Thin population base";
                      lines.push(tier);
                      if (growthPct !== null) {
                        const gStr = growthPct >= 2.0 ? `${growthPct.toFixed(1)}% CAGR - explosive growth corridor` : growthPct >= 1.5 ? `${growthPct.toFixed(1)}% CAGR - strong growth` : growthPct >= 1.0 ? `${growthPct.toFixed(1)}% CAGR - healthy growth` : growthPct >= 0 ? `${growthPct.toFixed(1)}% CAGR - stable` : `${growthPct.toFixed(1)}% CAGR - declining`;
                        lines.push(`5-yr growth outlook: ${gStr}`);
                        if (growthPct > 0) { const proj = Math.round(popRaw * Math.pow(1 + growthPct / 100, 5)); lines.push(`Projected 2030 population: ~${proj.toLocaleString()}`); }
                      }
                      if (!isNaN(hhRaw) && hhRaw > 0) lines.push(`${hhRaw.toLocaleString()} households (${(popRaw / hhRaw).toFixed(1)} persons/hh)`);
                    } else { lines.push("Population data not available"); }
                    if (site.demandDrivers) lines.push(`Drivers: ${site.demandDrivers.substring(0, 120)}${site.demandDrivers.length > 120 ? "..." : ""}`);
                    return lines;
                  }
                  if (key === "income") {
                    const lines = [];
                    if (!isNaN(incRaw) && incRaw > 0) {
                      lines.push(`$${incRaw.toLocaleString()} median household income (3-mi)`);
                      const tier = incRaw >= 90000 ? "Premium affluent market - strong pricing power" : incRaw >= 75000 ? "Upper-middle income - favorable for climate-controlled" : incRaw >= 65000 ? "Solid middle income - core storage demographic" : incRaw >= 55000 ? "Moderate income - viable but price-sensitive" : "Below target threshold ($55K minimum)";
                      lines.push(tier);
                      if (!isNaN(hvRaw) && hvRaw > 0) lines.push(`Median home value: $${hvRaw.toLocaleString()}`);
                      if (growthPct !== null) {
                        const incomeGrowth = growthPct >= 1.5 ? "Rising incomes likely - high-growth market" : growthPct >= 0.5 ? "Stable income trajectory with population growth" : "Flat or declining growth - monitor pricing power";
                        lines.push(`5-yr outlook: ${incomeGrowth}`);
                      }
                      if (site.renterPct3mi) lines.push(`Renter percentage: ${site.renterPct3mi} (renters = higher storage demand)`);
                    } else { lines.push("Income data not available"); }
                    return lines;
                  }
                  return [];
                };

                const metricItems = [
                  { key: "asking", label: "ASKING", val: fmtPrice(site.askingPrice), color: "#E2E8F0" },
                  { key: "internal", label: "INTERNAL", val: site.internalPrice ? fmtPrice(site.internalPrice) : "---", color: "#E87A2E" },
                  { key: "acreage", label: "ACREAGE", val: site.acreage ? `${site.acreage} ac` : "---", color: "#E2E8F0" },
                  { key: "zoning", label: "ZONING", val: site.zoning || "---", color: "#C9A84C" },
                  { key: "pop", label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "---", color: "#E2E8F0" },
                  { key: "income", label: "3MI MED INC", val: site.income3mi ? "$" + fmtN(site.income3mi) : "---", color: "#E2E8F0" },
                ];

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
                    {metricItems.map((m) => {
                      const isHov = hoveredMetric === m.key;
                      const ttLines = isHov ? buildTooltip(m.key) : [];
                      return (
                        <div key={m.key} style={{ position: "relative" }}
                          onMouseEnter={() => setHoveredMetric(m.key)} onMouseLeave={() => setHoveredMetric(null)}>
                          <div style={{ background: isHov ? "rgba(30,39,97,0.85)" : "rgba(15,21,56,0.5)", borderRadius: 12, padding: "14px 16px", border: isHov ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(201,168,76,0.08)", cursor: "pointer", transition: "all 0.2s ease", transform: isHov ? "translateY(-2px)" : "none", boxShadow: isHov ? "0 8px 32px rgba(201,168,76,0.15)" : "none" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: isHov ? "#C9A84C" : "#6B7394", letterSpacing: "0.1em", marginBottom: 4, transition: "color 0.2s" }}>{m.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: m.color, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                          </div>
                          {isHov && ttLines.length > 0 && (
                            <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", minWidth: 320, maxWidth: 420, zIndex: 9999, borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.2), 0 0 40px rgba(30,39,97,0.4)", paddingTop: 4, pointerEvents: "none" }}>
                              <div style={{ background: "linear-gradient(135deg, #1E2761, #2C3E6B)", padding: "10px 14px", borderBottom: "2px solid #C9A84C", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12 }}>{m.key === "asking" ? "💰" : m.key === "internal" ? "🎯" : m.key === "acreage" ? "📐" : m.key === "zoning" ? "📋" : m.key === "pop" ? "👥" : "💵"}</span>
                                <span style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", letterSpacing: "0.08em", textTransform: "uppercase" }}>SiteScore Intelligence</span>
                              </div>
                              <div style={{ background: "linear-gradient(180deg, #0F1538, #131B45)", padding: "14px 16px" }}>
                                {ttLines.map((line, li) => (
                                  <div key={li} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderBottom: li < ttLines.length - 1 ? "1px solid rgba(201,168,76,0.06)" : "none" }}>
                                    <span style={{ color: "#C9A84C", fontSize: 8, marginTop: 5, flexShrink: 0 }}>&#9670;</span>
                                    <span style={{ fontSize: 12, color: li === 0 ? "#F4F6FA" : "#CBD5E1", fontWeight: li === 0 ? 700 : 500, lineHeight: 1.5 }}>{line}</span>
                                  </div>
                                ))}
                              </div>
                              <div style={{ background: "rgba(201,168,76,0.04)", padding: "6px 14px", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
                                <span style={{ fontSize: 9, color: "#6B7394", fontWeight: 600, letterSpacing: "0.05em" }}>SiteScore&#8482; Analysis</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ACTION BUTTONS */}
              <div style={{ marginBottom: 24, padding: "16px 0", borderTop: "1px solid rgba(201,168,76,0.08)", borderBottom: "1px solid rgba(201,168,76,0.08)" }}>
                {/* Top Row — Big Report Buttons */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
                  <button onClick={() => {
                    try { const rpt = generateDemographicsReport(site); if (!rpt) { notify("No demographic data — pull ESRI demographics first."); return; } const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("Demographics report failed."); console.error(err); }
                  }} style={{ padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, #1565C0, #0D47A1)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(21,101,192,0.4), 0 0 0 1px rgba(21,101,192,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}>📊 Demos</button>
                  <button onClick={() => {
                    try { const iqGen = computeSiteScore(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqGen); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); autoGenerateVettingReport(dv.regionKey, site.id, site); } catch (err) { notify("Report generation failed — some site data may be missing."); console.error("Vet report error:", err); }
                  }} style={{ padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(232,122,46,0.4), 0 0 0 1px rgba(232,122,46,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}>🔬 Vet Report</button>
                  <button onClick={() => {
                    try { const iqR = computeSiteScore(site); const rpt = generatePricingReport(site, iqR, [...sw, ...east]); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("Pricing report failed — some site data may be missing."); console.error("Pricing report error:", err); }
                  }} style={{ padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, #2E7D32, #43A047)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(46,125,50,0.4), 0 0 0 1px rgba(46,125,50,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}>💰 Pricing</button>
                  <button onClick={() => {
                    try { const iqR = computeSiteScore(site); const rpt = generateRECPackage(site, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); } catch (err) { notify("REC Package failed — some site data may be missing."); console.error("REC package error:", err); }
                  }} style={{ padding: "12px 16px", borderRadius: 12, background: "linear-gradient(135deg, #1E2761, #C9A84C)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(30,39,97,0.4), 0 0 0 1px rgba(201,168,76,0.3)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.15s" }}>📋 REC Package</button>
                </div>
              </div>

              {/* SUMMARY */}
              <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 12, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Summary / Deal Notes</div>
                <div style={{ fontSize: 13, color: "#E2E8F0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{site.summary || "No notes yet."}</div>
              </div>

              {/* DEMOGRAPHICS — Clickable + Expandable */}
              {(site.pop3mi || site.income3mi) && (() => {
                const pN2 = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                const fP2 = (v, pre) => { const n = pN2(v); return n != null ? (pre || "") + n.toLocaleString() : null; };
                const gVal2 = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : null;
                const gColor2 = gVal2 != null ? (gVal2 > 0 ? "#22C55E" : gVal2 < 0 ? "#EF4444" : "#94A3B8") : "#6B7394";
                const gLabel2 = gVal2 != null ? ((gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "% /yr") : null;
                const gOutlook2 = gVal2 != null ? (gVal2 > 1.5 ? "High Growth" : gVal2 > 0.5 ? "Growing" : gVal2 > 0 ? "Stable Growth" : gVal2 > -0.5 ? "Flat" : "Declining") : null;
                const popRaw = pN2(site.pop3mi);
                const hhiRaw = pN2(site.income3mi);
                const hhRaw = pN2(site.households3mi);
                const hvRaw = pN2(site.homeValue3mi);
                const pop1Raw = pN2(site.pop1mi);
                const acreageVal = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
                const pricePerAcVal = (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(acreageVal) && acreageVal > 0) ? Math.round(p / acreageVal) : null; })();
                const psDist2 = site.siteiqData?.nearestPS ? (typeof site.siteiqData.nearestPS === "number" ? site.siteiqData.nearestPS : parseFloat(site.siteiqData.nearestPS)) : null;
                const demoRows = [
                  { key: "population", label: "Population (3-mi)", val: fP2(site.pop3mi), icon: "👥" },
                  { key: "income", label: "Median HHI (3-mi)", val: fP2(site.income3mi, "$"), icon: "💰" },
                  { key: "growth", label: "Pop Growth (ESRI 2025→2030)", val: gLabel2, icon: "📈", color: gColor2 },
                  { key: "growthOutlook", label: "Growth Outlook", val: gOutlook2, icon: "🔮", color: gVal2 != null ? (gVal2 > 1.5 ? "#22C55E" : gVal2 > 0.5 ? "#4ADE80" : "#FBBF24") : "#6B7394" },
                  { key: "households", label: "Households (3-mi)", val: fP2(site.households3mi), icon: "🏠" },
                  { key: "homeValue", label: "Median Home Value (3-mi)", val: fP2(site.homeValue3mi, "$"), icon: "🏡" },
                  { key: "acreage", label: "Acreage", val: acreageVal ? acreageVal.toFixed(2) + " ac" : null, icon: "📐" },
                  { key: "pricing", label: "Price / Acre", val: pricePerAcVal ? "$" + pricePerAcVal.toLocaleString() + "/ac" : null, icon: "🏷️" },
                  { key: "psProximity", label: "Nearest Facility", val: psDist2 ? psDist2.toFixed(1) + " mi" : null, icon: "📍" },
                  { key: "competition", label: "Competitors (3-mi)", val: site.siteiqData?.competitorCount != null ? String(site.siteiqData.competitorCount) : null, icon: "🏪" },
                ].filter(r => r.val != null);
                // Benchmarks for bar charts
                const popBench = 40000; const hhiBench = 90000; const hhBench = 25000; const hvBench = 500000;
                const compCount = site.siteiqData?.competitorCount;
                const compNames = site.siteiqData?.competitorNames;
                const nearComp = site.siteiqData?.nearestCompetitor;
                const demandSig = site.siteiqData?.demandSupplySignal || site.demandSupplySignal;
                return demoRows.length > 0 ? (
                  <div style={{ borderRadius: 14, marginBottom: 20, overflow: "hidden", border: `1px solid ${demoExpanded ? "rgba(201,168,76,0.2)" : "rgba(201,168,76,0.1)"}`, transition: "all 0.3s" }}>
                    <div onClick={() => setDemoExpanded(!demoExpanded)} style={{ background: "linear-gradient(135deg,#0F172A,#1E293B,#1565C0)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.background = "linear-gradient(135deg,#0F172A,#1E293B,#1976D2)"} onMouseLeave={(e) => e.currentTarget.style.background = "linear-gradient(135deg,#0F172A,#1E293B,#1565C0)"}>
                      <span style={{ fontSize: 14 }}>📊</span>
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}>SITE DEMOGRAPHICS</span>
                      <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 5 }}>ESRI 2025</span>
                      <span style={{ marginLeft: "auto", color: "#C9A84C", fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{demoExpanded ? "▲ Collapse" : "▼ Expand Deep Dive"}</span>
                    </div>
                    {/* Compact view — each row clickable with expansion */}
                    <div style={{ background: "rgba(15,21,56,0.3)" }}>
                      {demoRows.map((row, i) => {
                        const isRowExp = demoRowExpanded === row.key;
                        // Expansion renderer per row key
                        const renderRowExpansion = () => {
                          const MR = ({ label, value, color, pctOf, bench, benchLabel }) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(201,168,76,0.04)" }}>
                              <div style={{ width: 130, fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>{label}</div>
                              <div style={{ flex: 1, position: "relative", height: 9, borderRadius: 5, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, pctOf || 0)}%`, borderRadius: 5, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                              </div>
                              <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{value || "—"}</div>
                              {bench && <div style={{ width: 90, textAlign: "right", fontSize: 9, color: "#6B7394" }}>vs {benchLabel}</div>}
                            </div>
                          );
                          const SvxBox = ({ text, signal, sigColor }) => (
                            <div style={{ marginTop: 16, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(201,168,76,0.12)" }}>
                              <div style={{ background: "linear-gradient(135deg, #1E2761, #0F172A)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12 }}>🔬</span>
                                <span style={{ fontSize: 10, fontWeight: 900, color: "#C9A84C", letterSpacing: "0.1em" }}>STORVEX SUMMARY ANALYSIS</span>
                                {signal && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, padding: "2px 10px", borderRadius: 5, background: (sigColor || "#C9A84C") + "18", color: sigColor || "#C9A84C" }}>{signal}</span>}
                              </div>
                              <div style={{ padding: "12px 16px", background: "rgba(10,10,14,0.6)", fontSize: 11, color: "#CBD5E1", lineHeight: 1.7 }}>{text}</div>
                            </div>
                          );
                          const k = row.key;
                          if (k === "population") {
                            const futurePop = popRaw && gVal2 != null ? Math.round(popRaw * Math.pow(1 + gVal2 / 100, 5)) : null;
                            const signal = popRaw >= 40000 ? "DENSE MARKET" : popRaw >= 25000 ? "SOLID DEMAND" : popRaw >= 10000 ? "EMERGING" : "THIN";
                            const sigC = popRaw >= 40000 ? "#22C55E" : popRaw >= 25000 ? "#3B82F6" : popRaw >= 10000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>RADIUS POPULATION BREAKDOWN</div>
                                  <MR label="1-Mile Radius" value={pop1Raw ? pop1Raw.toLocaleString() : "—"} color="#8B5CF6" pctOf={pop1Raw ? Math.min(100, (pop1Raw / 10000) * 100) : 0} bench benchLabel="10K" />
                                  <MR label="3-Mile Radius" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popRaw ? Math.min(100, (popRaw / popBench) * 100) : 0} bench benchLabel="40K" />
                                  <MR label="5-Mile (est.)" value={popRaw ? Math.round(popRaw * 2.4).toLocaleString() : "—"} color="#1D4ED8" pctOf={popRaw ? Math.min(100, (popRaw * 2.4 / 100000) * 100) : 0} bench benchLabel="100K" />
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(34,197,94,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PROJECTED TRAJECTORY (2025-2030)</div>
                                  <MR label="Current (2025)" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popRaw ? Math.min(100, (popRaw / popBench) * 100) : 0} />
                                  <MR label="Projected (2030)" value={futurePop ? futurePop.toLocaleString() : "—"} color={gVal2 > 0 ? "#22C55E" : "#EF4444"} pctOf={futurePop ? Math.min(100, (futurePop / popBench) * 100) : 0} />
                                  <MR label="Net Change" value={futurePop && popRaw ? (futurePop > popRaw ? "+" : "") + (futurePop - popRaw).toLocaleString() : "—"} color={gVal2 > 0 ? "#22C55E" : "#EF4444"} pctOf={futurePop && popRaw ? Math.min(100, Math.abs(futurePop - popRaw) / popRaw * 500) : 0} />
                                  <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 10, color: "#6B7394" }}>5-Year CAGR</span>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: gVal2 > 0 ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{gVal2 != null ? (gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "%" : "—"}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 4 }}>
                                {[{ l: "PS BENCHMARK", v: "40,000", s: popRaw >= 40000 ? "EXCEEDS" : Math.round((popRaw||0) / 400) + "% of target", c: popRaw >= 40000 ? "#22C55E" : "#F59E0B" },
                                  { l: "MIN THRESHOLD", v: "5,000", s: popRaw >= 5000 ? "CLEAR" : "BELOW MIN", c: popRaw >= 5000 ? "#22C55E" : "#EF4444" },
                                  { l: "DENSITY SIGNAL", v: signal, s: "Score", c: sigC }
                                ].map((b, j) => (
                                  <div key={j} style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                    <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>{b.l}</div>
                                    <div style={{ fontSize: 16, fontWeight: 900, color: j < 2 ? "#4A5080" : b.c, fontFamily: "'Space Mono', monospace" }}>{b.v}</div>
                                    <div style={{ fontSize: 9, color: b.c, fontWeight: 700 }}>{b.s}</div>
                                  </div>
                                ))}
                              </div>
                              <SvxBox signal={signal} sigColor={sigC} text={popRaw >= 40000 ? `Dense population base of ${popRaw.toLocaleString()} within 3 miles exceeds PS's 40K benchmark — top tier for household-driven self-storage absorption. ${gVal2 > 1 ? "Combined with above-average growth, compounding demand tailwinds." : "Population density alone supports facility viability."}` : popRaw >= 15000 ? `Population of ${popRaw.toLocaleString()} within 3 miles — mid-range for storage feasibility. Sufficient for climate-controlled facility if competition is limited. ${gVal2 > 1.5 ? "Strong growth could push this into premium territory within 3-5 years." : "Growth and income quality become critical tiebreakers."}` : `Population of ${popRaw ? popRaw.toLocaleString() : "N/A"} within 3 miles — thinner demand base. Requires low competition, premium income, or exceptional growth to justify development.`} />
                            </div>);
                          }
                          if (k === "income") {
                            const tier = hhiRaw >= 90000 ? "PREMIUM" : hhiRaw >= 75000 ? "AFFLUENT" : hhiRaw >= 65000 ? "STRONG" : hhiRaw >= 55000 ? "ADEQUATE" : "BELOW THRESHOLD";
                            const tC = hhiRaw >= 90000 ? "#C9A84C" : hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 65000 ? "#3B82F6" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOUSEHOLD INCOME</div>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1, marginBottom: 8 }}>{hhiRaw ? "$" + hhiRaw.toLocaleString() : "—"}</div>
                                  <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 6, background: tC + "18", border: `1px solid ${tC}30` }}><span style={{ fontSize: 11, fontWeight: 800, color: tC }}>{tier}</span></div>
                                  <div style={{ marginTop: 14 }}>
                                    <MR label="This Market" value={"$" + (hhiRaw || 0).toLocaleString()} color={tC} pctOf={hhiRaw ? Math.min(100, (hhiRaw / hhiBench) * 100) : 0} />
                                    <MR label="Premium ($90K)" value="$90,000" color="#C9A84C" pctOf={100} />
                                    <MR label="Strong ($65K)" value="$65,000" color="#3B82F6" pctOf={72} />
                                    <MR label="Minimum ($55K)" value="$55,000" color="#EF4444" pctOf={61} />
                                  </div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>INCOME IMPLICATIONS FOR STORAGE</div>
                                  {[
                                    { label: "Willingness to Pay", val: hhiRaw >= 75000 ? "High" : hhiRaw >= 55000 ? "Moderate" : "Limited", c: hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444", desc: "Higher income = premium unit absorption" },
                                    { label: "Climate-Controlled Demand", val: hhiRaw >= 65000 ? "Strong" : "Moderate", c: hhiRaw >= 65000 ? "#22C55E" : "#F59E0B", desc: "Affluent households store higher-value items" },
                                    { label: "Price Sensitivity", val: hhiRaw >= 90000 ? "Low" : hhiRaw >= 65000 ? "Moderate" : "High", c: hhiRaw >= 90000 ? "#22C55E" : hhiRaw >= 65000 ? "#F59E0B" : "#EF4444", desc: "Impacts rate growth potential" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ padding: "10px 0", borderBottom: j < 2 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{r.label}</span><span style={{ fontSize: 12, fontWeight: 800, color: r.c, fontFamily: "'Space Mono', monospace" }}>{r.val}</span></div>
                                      <div style={{ fontSize: 9, color: "#6B7394", marginTop: 2 }}>{r.desc}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <SvxBox signal={tier} sigColor={tC} text={hhiRaw >= 90000 ? `Premium income market at $${hhiRaw.toLocaleString()} median HHI. Core self-storage demographic: homeowners with accumulated possessions, disposable income for storage rents, and preference for climate-controlled units. Supports premium pricing and strong RevPAF.` : hhiRaw >= 65000 ? `Solid income base at $${hhiRaw.toLocaleString()} median HHI. Supports standard pricing and moderate CC demand. Income alone is not a differentiator but removes downside risk.` : `Income at $${(hhiRaw || 0).toLocaleString()} approaches the $55K threshold. Lower-income markets see higher price sensitivity and lower CC uptake. Demand skews toward smaller drive-up units.`} />
                            </div>);
                          }
                          if (k === "growth" || k === "growthOutlook") {
                            const gC = gVal2 > 1.5 ? "#22C55E" : gVal2 > 0.5 ? "#4ADE80" : gVal2 > 0 ? "#FBBF24" : "#94A3B8";
                            const outlook = gVal2 > 2.0 ? "RAPID EXPANSION" : gVal2 > 1.5 ? "HIGH GROWTH" : gVal2 > 1.0 ? "ABOVE AVERAGE" : gVal2 > 0.5 ? "STEADY GROWTH" : gVal2 > 0 ? "STABLE" : "FLAT/DECLINING";
                            const natAvg = 0.5; const futurePop = popRaw && gVal2 != null ? Math.round(popRaw * Math.pow(1 + gVal2 / 100, 5)) : null;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: `1px solid ${gC}15`, textAlign: "center" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>5-YEAR COMPOUND ANNUAL GROWTH RATE</div>
                                  <div style={{ fontSize: 48, fontWeight: 900, color: gC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{gVal2 != null ? (gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "%" : "—"}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: gC, marginTop: 8 }}>{outlook}</div>
                                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginTop: 14 }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(5, ((gVal2 || 0) / 3) * 100))}%`, borderRadius: 4, background: `linear-gradient(90deg, ${gC}99, ${gC})` }} />
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ fontSize: 8, color: "#4A5080" }}>0%</span><span style={{ fontSize: 8, color: "#4A5080" }}>3%+ (rapid)</span></div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>GROWTH CONTEXT</div>
                                  <MR label="This Market" value={gVal2 != null ? gVal2.toFixed(2) + "%" : "—"} color={gC} pctOf={gVal2 ? Math.min(100, (gVal2 / 3) * 100) : 0} />
                                  <MR label="National Average" value={natAvg.toFixed(2) + "%"} color="#4A5080" pctOf={(natAvg / 3) * 100} />
                                  <MR label="Spread vs National" value={gVal2 != null ? (gVal2 - natAvg >= 0 ? "+" : "") + (gVal2 - natAvg).toFixed(2) + "%" : "—"} color={gVal2 > natAvg ? "#22C55E" : "#EF4444"} pctOf={gVal2 ? Math.min(100, Math.abs(gVal2 - natAvg) / 3 * 100) : 0} />
                                  {futurePop && popRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}>
                                    <div style={{ fontSize: 9, color: "#6B7394", marginBottom: 4 }}>5-YEAR NET POPULATION CHANGE</div>
                                    <div style={{ fontSize: 18, fontWeight: 900, color: futurePop > popRaw ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{futurePop > popRaw ? "+" : ""}{(futurePop - popRaw).toLocaleString()} people</div>
                                    <div style={{ fontSize: 10, color: "#94A3B8" }}>{popRaw.toLocaleString()} (2025) → {futurePop.toLocaleString()} (2030)</div>
                                  </div>}
                                </div>
                              </div>
                              <SvxBox signal={outlook} sigColor={gC} text={gVal2 > 1.5 ? `Growing at ${gVal2.toFixed(2)}% annually, ${(gVal2 / natAvg).toFixed(1)}x the national average. Rapid growth is the strongest predictor of new storage demand. Projects ${futurePop ? "+" + (futurePop - (popRaw || 0)).toLocaleString() + " new residents" : "significant expansion"} by 2030.` : gVal2 > 0.5 ? `Growth of ${gVal2.toFixed(2)}% tracks above national average. Steady expansion supports organic storage demand growth with a 3-5 year lease-up horizon.` : `Modest growth at ${gVal2 != null ? gVal2.toFixed(2) : "N/A"}%. Demand driven by household turnover rather than net new population. Competition quality becomes the differentiator.`} />
                            </div>);
                          }
                          if (k === "households") {
                            const signal = hhRaw >= 25000 ? "DEEP DEMAND POOL" : hhRaw >= 18000 ? "STRONG BASE" : hhRaw >= 12000 ? "ADEQUATE" : hhRaw >= 6000 ? "MODERATE" : "LIMITED";
                            const sC = hhRaw >= 25000 ? "#22C55E" : hhRaw >= 12000 ? "#3B82F6" : hhRaw >= 6000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>3-MILE HOUSEHOLD COUNT</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hhRaw ? hhRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: sC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: sC }}>{signal}</span></div>
                                </div>
                                <MR label="This Market" value={(hhRaw || 0).toLocaleString()} color={sC} pctOf={hhRaw ? Math.min(100, (hhRaw / hhBench) * 100) : 0} bench benchLabel="25K" />
                                <MR label="Top Tier (25K)" value="25,000" color="#22C55E" pctOf={100} />
                                <MR label="Solid Base (12K)" value="12,000" color="#3B82F6" pctOf={48} />
                                {popRaw && hhRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 10, color: "#6B7394" }}>Avg Household Size</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{(popRaw / hhRaw).toFixed(1)} ppl/hh</span>
                                </div>}
                                <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 10, color: "#6B7394" }}>10% Penetration Projection</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>~{Math.round((hhRaw || 0) * 0.10).toLocaleString()} renters</span>
                                </div>
                              </div>
                              <SvxBox signal={signal} sigColor={sC} text={hhRaw >= 25000 ? `${hhRaw.toLocaleString()} households represents a deep demand pool. ~${Math.round(hhRaw * 0.10).toLocaleString()} potential storage renters at 10% penetration. Can support multiple facilities.` : hhRaw >= 12000 ? `${hhRaw.toLocaleString()} households provide a solid demand base. ~${Math.round((hhRaw || 0) * 0.10).toLocaleString()} potential renters. Sufficient for a well-positioned facility.` : `Household count of ${(hhRaw || 0).toLocaleString()} indicates a thinner customer base. Each competitor consumes a larger demand share.`} />
                            </div>);
                          }
                          if (k === "homeValue") {
                            const hvTier = hvRaw >= 500000 ? "PREMIUM" : hvRaw >= 350000 ? "UPPER-MIDDLE" : hvRaw >= 250000 ? "MIDDLE MARKET" : hvRaw >= 180000 ? "MODERATE" : "VALUE";
                            const hvC = hvRaw >= 500000 ? "#C9A84C" : hvRaw >= 350000 ? "#22C55E" : hvRaw >= 250000 ? "#3B82F6" : hvRaw >= 180000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${hvC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOME VALUE (3-MI)</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hvRaw ? "$" + hvRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: hvC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: hvC }}>{hvTier}</span></div>
                                </div>
                                <MR label="This Market" value={"$" + (hvRaw || 0).toLocaleString()} color={hvC} pctOf={hvRaw ? Math.min(100, (hvRaw / hvBench) * 100) : 0} bench benchLabel="$500K" />
                                <MR label="Premium ($500K)" value="$500,000" color="#C9A84C" pctOf={100} />
                                <MR label="Affluent ($350K)" value="$350,000" color="#22C55E" pctOf={70} />
                                <MR label="Middle ($250K)" value="$250,000" color="#3B82F6" pctOf={50} />
                              </div>
                              <SvxBox signal={hvTier} sigColor={hvC} text={hvRaw >= 350000 ? `Home values at $${hvRaw.toLocaleString()} signal an affluent submarket. Higher home values correlate with larger homes, more possessions, and greater willingness to pay for premium climate-controlled storage.` : hvRaw >= 180000 ? `Middle-market home values at $${hvRaw.toLocaleString()}. Standard storage demand profile — supports a mix of unit sizes and moderate pricing.` : `Home values at $${(hvRaw || 0).toLocaleString()} indicate a value market. Storage demand exists but skews toward drive-up and smaller units.`} />
                            </div>);
                          }
                          if (k === "acreage") {
                            const sizeSignal = acreageVal >= 3.5 && acreageVal <= 5 ? "IDEAL SIZE" : acreageVal >= 2.5 && acreageVal < 3.5 ? "MULTI-STORY" : acreageVal > 5 && acreageVal <= 7 ? "LARGE" : acreageVal > 7 ? "SUBDIVISIBLE" : "REVIEW";
                            const sizeC = acreageVal >= 3.5 && acreageVal <= 5 ? "#22C55E" : acreageVal >= 2.5 ? "#3B82F6" : "#F59E0B";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sizeC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>SITE SIZE & CONFIGURATION</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{acreageVal.toFixed(2)}<span style={{ fontSize: 14, color: "#6B7394" }}> ac</span></div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: sizeC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: sizeC }}>{sizeSignal}</span></div>
                                </div>
                                {[{ l: "Primary (3.5-5 ac)", d: "One-story indoor CC", r: [3.5, 5], c: "#22C55E" },
                                  { l: "Secondary (2.5-3.5 ac)", d: "Multi-story option", r: [2.5, 3.5], c: "#3B82F6" },
                                  { l: "Large (5-7 ac)", d: "Subdivisible", r: [5, 7], c: "#F59E0B" },
                                  { l: "XL (7+ ac)", d: "Pad-split potential", r: [7, 999], c: "#8B5CF6" },
                                ].map((r, j) => (
                                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 5, marginBottom: 3, background: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? r.c + "12" : "transparent" }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? r.c : "#4A5080" }} />
                                    <span style={{ fontSize: 10, color: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? "#E2E8F0" : "#6B7394", fontWeight: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? 700 : 500 }}>{r.l}</span>
                                    <span style={{ fontSize: 9, color: "#4A5080", marginLeft: "auto" }}>{r.d}</span>
                                  </div>
                                ))}
                              </div>
                              <SvxBox signal={sizeSignal} sigColor={sizeC} text={acreageVal >= 3.5 && acreageVal <= 5 ? `${acreageVal.toFixed(2)} acres — ideal for PS's preferred one-story, indoor climate-controlled product. Accommodates 80,000-110,000 net rentable SF with parking, landscaping, and stormwater.` : acreageVal > 5 ? `${acreageVal.toFixed(2)} acres — large parcel offers flexibility. Could accommodate PS's standard product with excess land for expansion or outparcel development to offset land basis.` : `${acreageVal.toFixed(2)} acres — suitable for multi-story (3-4 story) climate-controlled facility. Can achieve 70,000-100,000 net rentable SF with vertical construction.`} />
                            </div>);
                          }
                          if (k === "psProximity") {
                            const proxSig = psDist2 <= 5 ? "VALIDATED SUBMARKET" : psDist2 <= 10 ? "PS ADJACENT" : psDist2 <= 15 ? "MODERATE" : psDist2 <= 25 ? "EDGE" : "REMOTE";
                            const pC = psDist2 <= 5 ? "#22C55E" : psDist2 <= 10 ? "#3B82F6" : psDist2 <= 15 ? "#F59E0B" : "#E87A2E";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${pC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PS NEAREST FACILITY PROXIMITY</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 42, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{psDist2 ? psDist2.toFixed(1) : "—"}<span style={{ fontSize: 16, color: "#6B7394" }}> mi</span></div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: pC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: pC }}>{proxSig}</span></div>
                                </div>
                                {[{ l: "0-5 mi: Validated Submarket", c: "#22C55E", a: psDist2 <= 5, s: "10/10" },
                                  { l: "5-10 mi: PS Adjacent", c: "#3B82F6", a: psDist2 > 5 && psDist2 <= 10, s: "9/10" },
                                  { l: "10-15 mi: Moderate", c: "#F59E0B", a: psDist2 > 10 && psDist2 <= 15, s: "7/10" },
                                  { l: "15-25 mi: Edge", c: "#E87A2E", a: psDist2 > 15 && psDist2 <= 25, s: "5/10" },
                                  { l: "25-35 mi: Remote", c: "#EF4444", a: psDist2 > 25, s: "3/10" },
                                ].map((t, j) => (
                                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, marginBottom: 4, background: t.a ? t.c + "12" : "transparent", border: t.a ? `1px solid ${t.c}30` : "1px solid transparent" }}>
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.a ? t.c : "#4A5080" }} />
                                    <span style={{ fontSize: 11, color: t.a ? "#E2E8F0" : "#6B7394", fontWeight: t.a ? 700 : 500, flex: 1 }}>{t.l}</span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: t.a ? t.c : "#4A5080", fontFamily: "'Space Mono', monospace" }}>{t.s}</span>
                                  </div>
                                ))}
                              </div>
                              <SvxBox signal={proxSig} sigColor={pC} text={psDist2 <= 5 ? `Nearest PS is ${psDist2.toFixed(1)} miles away — validated PS submarket. Proximity confirms market has been previously vetted. Closer = stronger validation, not cannibalization.` : psDist2 <= 15 ? `At ${psDist2.toFixed(1)} miles, within PS's established footprint. Adjacent trade area PS hasn't yet saturated — infill opportunity.` : `${psDist2 ? psDist2.toFixed(1) : "N/A"} miles from nearest PS. Requires stronger standalone fundamentals to justify expansion into a new submarket.`} />
                            </div>);
                          }
                          if (k === "competition") {
                            const cc = compCount || 0;
                            const signal = cc <= 1 ? "UNDERSERVED" : cc <= 3 ? "LOW COMPETITION" : cc <= 6 ? "MODERATE" : "COMPETITIVE";
                            const sC = cc <= 1 ? "#22C55E" : cc <= 3 ? "#3B82F6" : cc <= 6 ? "#F59E0B" : "#EF4444";
                            const operators = compNames ? String(compNames).split(",").map(n => n.trim()).filter(Boolean) : [];
                            const reitCt = operators.filter(n => n.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i)).length;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>COMPETITIVE DENSITY (3-MI RADIUS)</div>
                                  <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                    <div style={{ fontSize: 48, fontWeight: 900, color: sC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{cc}</div>
                                    <div><div style={{ padding: "4px 12px", borderRadius: 6, background: sC + "18", marginBottom: 4 }}><span style={{ fontSize: 11, fontWeight: 800, color: sC }}>{signal}</span></div>
                                    {reitCt > 0 && <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 700 }}>{reitCt} REIT{reitCt > 1 ? "s" : ""}</div>}</div>
                                  </div>
                                  {nearComp && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>NEAREST: </span><span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{nearComp}</span></div>}
                                  {demandSig && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>MARKET: </span><span style={{ fontSize: 11, color: "#C9A84C", fontWeight: 600 }}>{demandSig}</span></div>}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 10 }}>OPERATOR LANDSCAPE</div>
                                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                    {operators.length > 0 ? operators.map((name, j) => (
                                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: j < operators.length - 1 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/i) ? "#EF4444" : name.match(/StorageMart|U-Haul|SecurCare/i) ? "#F59E0B" : "#3B82F6", flexShrink: 0 }} />
                                        <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600, flex: 1 }}>{name}</span>
                                        {name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i) && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 3 }}>REIT</span>}
                                      </div>
                                    )) : <div style={{ fontSize: 11, color: "#6B7394", fontStyle: "italic" }}>No operator data available</div>}
                                  </div>
                                </div>
                              </div>
                              <SvxBox signal={signal} sigColor={sC} text={cc <= 1 ? `Only ${cc} competitor within 3 miles — underserved market with significant unmet demand. Ideal for new PS development.` : cc <= 3 ? `${cc} competitors — manageable competition. ${reitCt > 0 ? reitCt + " REIT(s) validates institutional demand." : "Predominantly local operators — opportunity for REIT-quality facility."}` : `${cc} facilities within 3 miles — ${cc <= 6 ? "moderate" : "high"} competition. ${reitCt >= 2 ? "Multiple REITs confirm mature market." : ""} Success requires competitive positioning and rate strategy.`} />
                            </div>);
                          }
                          return null;
                        };
                        return (
                          <div key={i}>
                            <div onClick={() => { if (row.key !== "growthOutlook") setDemoRowExpanded(isRowExp ? null : row.key); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 18px", borderBottom: "1px solid rgba(201,168,76,0.06)", cursor: row.key !== "growthOutlook" ? "pointer" : "default", background: isRowExp ? "rgba(201,168,76,0.06)" : "transparent", transition: "background 0.15s" }} onMouseEnter={(e) => { if (row.key !== "growthOutlook" && !isRowExp) e.currentTarget.style.background = "rgba(201,168,76,0.03)"; }} onMouseLeave={(e) => { if (!isRowExp) e.currentTarget.style.background = "transparent"; }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13 }}>{row.icon}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: isRowExp ? "#C9A84C" : "#94A3B8" }}>{row.label}</span>
                                {row.key !== "growthOutlook" && <span style={{ fontSize: 9, color: isRowExp ? "#C9A84C" : "#4A5080", transition: "transform 0.2s", display: "inline-block", transform: isRowExp ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 800, color: row.color || "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{row.val}</span>
                            </div>
                            {isRowExp && renderRowExpansion() && (
                              <div style={{ padding: "16px 20px 20px", background: "rgba(10,10,14,0.8)", borderBottom: "2px solid rgba(201,168,76,0.1)", animation: "fadeIn 0.2s ease-out" }}>
                                {renderRowExpansion()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* EXPANDED DEEP DIVE */}
                    {demoExpanded && (
                      <div style={{ background: "rgba(10,10,14,0.95)", borderTop: "2px solid rgba(201,168,76,0.15)" }}>
                        {/* POPULATION ANALYSIS */}
                        <div style={{ padding: "20px 24px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                            <div style={{ width: 3, height: 18, borderRadius: 2, background: "#3B82F6" }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#3B82F6", letterSpacing: "0.1em" }}>POPULATION ANALYSIS</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                            {/* Pop bar chart */}
                            <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(59,130,246,0.1)" }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", marginBottom: 12, letterSpacing: "0.08em" }}>3-MILE POPULATION vs BENCHMARK</div>
                              {[
                                { label: "This Site", val: popRaw, color: "#3B82F6" },
                                { label: "PS Benchmark (40K)", val: popBench, color: "#4A5080" },
                                { label: "Min Threshold (5K)", val: 5000, color: "#EF4444" },
                              ].map((b, i) => (
                                <div key={i} style={{ marginBottom: 10 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: "#94A3B8" }}>{b.label}</span>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: b.color, fontFamily: "'Space Mono', monospace" }}>{b.val ? b.val.toLocaleString() : "—"}</span>
                                  </div>
                                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, ((b.val || 0) / popBench) * 100)}%`, borderRadius: 4, background: `linear-gradient(90deg, ${b.color}99, ${b.color})`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {/* Growth trajectory */}
                            <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(34,197,94,0.1)" }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", marginBottom: 12, letterSpacing: "0.08em" }}>GROWTH TRAJECTORY</div>
                              <div style={{ textAlign: "center", padding: "12px 0" }}>
                                <div style={{ fontSize: 36, fontWeight: 900, color: gColor2, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{gLabel2 || "—"}</div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: gVal2 != null ? (gVal2 > 1.5 ? "#22C55E" : "#FBBF24") : "#6B7394", marginTop: 6, fontStyle: "italic" }}>{gOutlook2 || "No data"}</div>
                              </div>
                              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.1)" }}>
                                <div style={{ fontSize: 10, color: "#94A3B8", lineHeight: 1.6 }}>
                                  {gVal2 != null && gVal2 > 1.5 ? "High-growth corridor — population expanding rapidly. Strong demand signal for storage as new households form." : gVal2 != null && gVal2 > 0.5 ? "Steady growth market. Population is expanding at a sustainable pace, driving incremental storage demand." : gVal2 != null && gVal2 > 0 ? "Stable market with modest growth. Existing facilities may absorb most new demand." : "Flat or declining population. Storage demand may be static — focus on existing household turnover."}
                                </div>
                              </div>
                              {pop1Raw && <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 10, color: "#6B7394" }}>1-Mile Pop</span><span style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{pop1Raw.toLocaleString()}</span></div>}
                            </div>
                          </div>
                        </div>
                        {/* INCOME & WEALTH */}
                        <div style={{ padding: "4px 24px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                            <div style={{ width: 3, height: 18, borderRadius: 2, background: "#C9A84C" }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", letterSpacing: "0.1em" }}>INCOME & WEALTH INDICATORS</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                            {[
                              { label: "MEDIAN HHI", val: hhiRaw, fmt: "$" + (hhiRaw || 0).toLocaleString(), bench: hhiBench, benchLabel: "$90K (top tier)", color: "#C9A84C", signal: hhiRaw >= 90000 ? "Premium" : hhiRaw >= 65000 ? "Strong" : hhiRaw >= 55000 ? "Adequate" : "Below threshold" },
                              { label: "HOUSEHOLDS", val: hhRaw, fmt: (hhRaw || 0).toLocaleString(), bench: hhBench, benchLabel: "25K (top tier)", color: "#8B5CF6", signal: hhRaw >= 25000 ? "Deep demand pool" : hhRaw >= 12000 ? "Solid base" : "Limited pool" },
                              { label: "HOME VALUE", val: hvRaw, fmt: "$" + (hvRaw || 0).toLocaleString(), bench: hvBench, benchLabel: "$500K (top tier)", color: "#F37C33", signal: hvRaw >= 500000 ? "Premium market" : hvRaw >= 250000 ? "Affluent" : hvRaw >= 180000 ? "Middle market" : "Value market" },
                            ].map((m, i) => (
                              <div key={i} style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: `1px solid ${m.color}15` }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>{m.label}</div>
                                <div style={{ fontSize: 22, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", marginBottom: 4 }}>{m.val ? m.fmt : "—"}</div>
                                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginBottom: 8 }}>
                                  <div style={{ height: "100%", width: `${Math.min(100, ((m.val || 0) / m.bench) * 100)}%`, borderRadius: 3, background: `linear-gradient(90deg, ${m.color}99, ${m.color})` }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 9, color: "#6B7394" }}>vs {m.benchLabel}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: m.color }}>{m.signal}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* COMPETITION LANDSCAPE */}
                        {(compCount != null || compNames) && (
                          <div style={{ padding: "4px 24px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                              <div style={{ width: 3, height: 18, borderRadius: 2, background: "#E87A2E" }} />
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#E87A2E", letterSpacing: "0.1em" }}>COMPETITION LANDSCAPE</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                  <div>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 4 }}>FACILITIES WITHIN 3 MI</div>
                                    <div style={{ fontSize: 36, fontWeight: 900, color: compCount <= 3 ? "#22C55E" : compCount <= 6 ? "#F59E0B" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{compCount}</div>
                                  </div>
                                  <div style={{ padding: "6px 12px", borderRadius: 8, background: compCount <= 3 ? "rgba(34,197,94,0.12)" : compCount <= 6 ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)", border: `1px solid ${compCount <= 3 ? "rgba(34,197,94,0.2)" : compCount <= 6 ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: compCount <= 3 ? "#22C55E" : compCount <= 6 ? "#F59E0B" : "#EF4444" }}>{compCount <= 3 ? "UNDERSERVED" : compCount <= 6 ? "MODERATE" : "COMPETITIVE"}</div>
                                  </div>
                                </div>
                                {nearComp && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>NEAREST: </span><span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{nearComp}</span></div>}
                                {demandSig && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>SIGNAL: </span><span style={{ fontSize: 11, color: "#C9A84C", fontWeight: 600 }}>{demandSig}</span></div>}
                              </div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 10 }}>COMPETING OPERATORS</div>
                                {compNames ? String(compNames).split(",").map((name, i) => (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(201,168,76,0.04)" }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: name.trim().match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/) ? "#EF4444" : name.trim().match(/StorageMart|U-Haul|SecurCare/) ? "#F59E0B" : "#3B82F6", flexShrink: 0 }} />
                                    <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{name.trim()}</span>
                                    {name.trim().match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/) && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 3 }}>REIT</span>}
                                  </div>
                                )) : <div style={{ fontSize: 11, color: "#6B7394" }}>No competitor data</div>}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null;
              })()}

              {/* ZONING & UTILITIES SNAPSHOT */}
              {(site.zoningNotes || site.utilityNotes || site.waterProvider) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {/* Zoning Card */}
                  <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, border: "1px solid rgba(201,168,76,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>🏛</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.06em" }}>Zoning</span>
                      {site.zoningClassification && site.zoningClassification !== "unknown" && (
                        <span style={{ padding: "2px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: site.zoningClassification === "by-right" ? "rgba(22,163,74,0.15)" : site.zoningClassification === "conditional" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)", color: site.zoningClassification === "by-right" ? "#22C55E" : site.zoningClassification === "conditional" ? "#F59E0B" : "#EF4444" }}>{site.zoningClassification === "by-right" ? "BY-RIGHT" : site.zoningClassification === "conditional" ? "CONDITIONAL" : site.zoningClassification.toUpperCase()}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>{site.zoning || "Not confirmed"}</div>
                    {site.zoningSource && <div style={{ fontSize: 10, color: "#6B7394", lineHeight: 1.5, marginBottom: 8, maxHeight: 60, overflow: "hidden" }}>{site.zoningSource.substring(0, 200)}...</div>}
                    {site.planningContact && <div style={{ fontSize: 10, color: "#94A3B8" }}>📞 {site.planningContact.substring(0, 100)}</div>}
                  </div>
                  {/* Utilities Card */}
                  <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, border: "1px solid rgba(201,168,76,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>💧</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.06em" }}>Utilities</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {[
                        { label: "Water", val: site.waterAvailable === true ? "✓" : site.waterAvailable === false ? "✗" : "?", color: site.waterAvailable === true ? "#22C55E" : site.waterAvailable === false ? "#EF4444" : "#6B7394", detail: site.waterProvider },
                        { label: "Sewer", val: site.sewerAvailable === true ? "✓" : site.sewerAvailable === false ? "✗" : "?", color: site.sewerAvailable === true ? "#22C55E" : site.sewerAvailable === false ? "#EF4444" : "#6B7394", detail: site.sewerProvider },
                        { label: "Electric", val: site.threePhase === true ? "3Φ ✓" : site.electricProvider ? "✓" : "?", color: site.threePhase === true ? "#22C55E" : site.electricProvider ? "#22C55E" : "#6B7394", detail: site.electricProvider },
                        { label: "Flood", val: site.floodZone ? (site.floodZone.toLowerCase().includes("zone x") ? "Clear" : "Check") : "?", color: site.floodZone && site.floodZone.toLowerCase().includes("zone x") ? "#22C55E" : "#F59E0B" },
                      ].map((u, i) => (
                        <div key={i} style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8" }}>{u.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: u.color }}>{u.val}</span>
                          </div>
                          {u.detail && <div style={{ fontSize: 8, color: "#6B7394", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.detail.substring(0, 40)}</div>}
                        </div>
                      ))}
                    </div>
                    {site.tapFees && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 8 }}>💲 {site.tapFees.substring(0, 80)}...</div>}
                  </div>
                </div>
              )}

              {/* TOPO & ACCESS SNAPSHOT */}
              {(site.terrain || site.floodZone || site.gradingRisk) && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14 }}>🌍</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#E87A2E", textTransform: "uppercase", letterSpacing: "0.06em" }}>Topography & Access</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[
                      { label: "FEMA Flood", val: site.floodZone || "Not checked", icon: "🌊" },
                      { label: "Terrain", val: site.terrain || "Not assessed", icon: "⛰️" },
                      { label: "Grading Risk", val: site.gradingRisk || "Not assessed", icon: "📐" },
                    ].map((t, i) => (
                      <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(15,21,56,0.3)" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", marginBottom: 4 }}>{t.icon} {t.label}</div>
                        <div style={{ fontSize: 11, color: "#E2E8F0", lineHeight: 1.4, maxHeight: 44, overflow: "hidden" }}>{typeof t.val === "string" ? t.val.substring(0, 80) : t.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ZONING RESEARCH NOTES (full) */}
              {site.zoningNotes && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>🏛 Zoning Research Notes</div>
                  <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{site.zoningNotes}</div>
                </div>
              )}

              {/* UTILITY RESEARCH NOTES (full) */}
              {site.utilityNotes && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>💧 Utility Research Notes</div>
                  <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{site.utilityNotes}</div>
                </div>
              )}

              {/* DOCUMENTS */}
              {docs.length > 0 && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>📁 Documents ({docs.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {docs.map(([dk, doc]) => (
                      <a key={dk} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(232,122,46,0.08)", border: "1px solid rgba(232,122,46,0.15)", color: "#E87A2E", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{doc.type}: {doc.name?.length > 25 ? doc.name.slice(0, 25) + "…" : doc.name} ↗</a>
                    ))}
                  </div>
                </div>
              )}

              {/* SITESCORE DETAILED SCORECARD */}
              {iqR && iqR.scores && (() => {
                const dims2 = [
                  { key: "population", label: "Population", icon: "👥", weight: getIQWeight("population") },
                  { key: "growth", label: "Growth", icon: "📈", weight: getIQWeight("growth") },
                  { key: "income", label: "Income", icon: "💰", weight: getIQWeight("income") },
                  { key: "households", label: "Households", icon: "🏠", weight: getIQWeight("households") },
                  { key: "homeValue", label: "Home Value", icon: "🏡", weight: getIQWeight("homeValue") },
                  { key: "zoning", label: "Zoning", icon: "🏛️", weight: getIQWeight("zoning") },
                  { key: "psProximity", label: "PS Proximity", icon: "📦", weight: getIQWeight("psProximity") },
                  { key: "access", label: "Site Access", icon: "🛣️", weight: getIQWeight("access") },
                  { key: "competition", label: "Competition", icon: "🏪", weight: getIQWeight("competition") },
                  { key: "marketTier", label: "Market Tier", icon: "🎯", weight: getIQWeight("marketTier") },
                ];
                const sc2 = (v) => v >= 8 ? "#22C55E" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
                return (
                  <div style={{ borderRadius: 14, marginBottom: 20, overflow: "hidden", border: "1px solid rgba(232,122,46,0.15)" }}>
                    <div style={{ background: "linear-gradient(135deg,#1a0a00,#2a1505)", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14 }}>🔬</span>
                        <span style={{ color: "#FFB347", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}>SiteScore™ SCORECARD</span>
                        <span style={{ color: sc2(iqR.score), fontSize: 14, fontWeight: 900, fontFamily: "'Space Mono'" }}>{iqR.score.toFixed(2)}</span>
                      </div>
                      {iqR.flags && iqR.flags.length > 0 && <div style={{ display: "flex", gap: 4 }}>{iqR.flags.map((f, i) => <span key={i} style={{ fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "2px 6px", borderRadius: 4 }}>{f}</span>)}</div>}
                    </div>
                    <div style={{ background: "linear-gradient(180deg,#0F0A05,#0a0a0e)", padding: "8px 14px" }}>
                      {dims2.map((d, i) => {
                        const v2 = iqR.scores[d.key] || 0;
                        const pct2 = (v2 / 10) * 100;
                        return (
                          <div key={d.key} style={{ display: "grid", gridTemplateColumns: "28px 1fr 50px 90px 60px", alignItems: "center", gap: 6, padding: "7px 4px", borderBottom: i < dims2.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }}>
                            <span style={{ fontSize: 13, textAlign: "center" }}>{d.icon}</span>
                            <div><div style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{d.label}</div><div style={{ fontSize: 8, color: "#6B7394" }}>{(d.weight * 100).toFixed(0)}% weight</div></div>
                            <div style={{ textAlign: "right", fontSize: 15, fontWeight: 900, color: sc2(v2), fontFamily: "'Space Mono'" }}>{v2}</div>
                            <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 4, height: 10, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct2}%`, background: `linear-gradient(90deg, ${sc2(v2)}88, ${sc2(v2)})`, borderRadius: 4 }} /></div>
                            <div style={{ textAlign: "right", fontSize: 11, fontWeight: 800, color: "#C9A84C", fontFamily: "'Space Mono'" }}>{(v2 * d.weight).toFixed(2)}</div>
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 4px 4px", borderTop: "2px solid rgba(243,124,51,.2)", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#94A3B8" }}>COMPOSITE: <span style={{ color: "#C9A84C", fontWeight: 900, fontSize: 14, fontFamily: "'Space Mono'" }}>{iqR.score.toFixed(2)}</span> / 10</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* BOTTOM NAV */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
                <button disabled={!prevSite} onClick={() => { if (prevSite) { goToDetail({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); } }} style={{ ...navBtnSt(!prevSite), padding: "12px 24px" }}>← {prevSite ? prevSite.name : "Start"}</button>
                <button onClick={() => { setDetailView(null); navigateTo(dv.regionKey); }} style={{ padding: "12px 24px", borderRadius: 10, background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↩ Back to Tracker</button>
                <button disabled={!nextSite} onClick={() => { if (nextSite) { goToDetail({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); } }} style={{ ...navBtnSt(!nextSite), padding: "12px 24px" }}>{nextSite ? nextSite.name : "End"} →</button>
              </div>
            </div>
          );
        })()}

        {/* ═══ VALUATION INPUTS ═══ */}
        {tab === "inputs" && (() => {
          // Pass all pipeline sites so the component can render a property dropdown
          const allPipelineSites = [...sw.map(s => ({ ...s, _region: "southwest" })), ...east.map(s => ({ ...s, _region: "east" }))];
          // If a detail view is active, pre-select that site
          const preselectedSite = detailView ? allPipelineSites.find(s => s.id === detailView.siteId) || null : null;
          return <ValuationInputs
            overrides={valuationOverrides}
            onSave={(newOverrides) => { setValuationOverrides(newOverrides); VALUATION_OVERRIDES = newOverrides; }}
            fbSet={fbSet}
            activeSite={preselectedSite}
            activeRegion={preselectedSite?._region || detailView?.regionKey || null}
            allSites={allPipelineSites}
          />;
        })()}

        {/* ═══ TRACKERS ═══ */}
        {(tab === "southwest" || tab === "east") && !detailView && <TrackerCards regionKey={tab} />}
      </div>

            {/* ═══ COPYRIGHT FOOTER ═══ */}
                  <div style={{ textAlign: "center", padding: "18px 0 14px", borderTop: "1px solid rgba(201,168,76,0.1)", marginTop: 24, color: "#94A3B8", fontSize: 11, letterSpacing: 0.3 }}>
                          © {new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. Patent Pending (App. No. 64/009,393). Proprietary software — unauthorized reproduction prohibited.
                                </div>
    </div>
  );
}

// Intel tooltip wrapper — isolates hover state per card (no parent re-renders)
// Uses a ref-based delay to prevent flicker on rapid mouse movement
function IntelCardHeader({ site, onClick, children }) {
  const [show, setShow] = useState(false);
  const timerRef = useRef(null);
  const enter = () => { if (!site.latestNote) return; clearTimeout(timerRef.current); timerRef.current = setTimeout(() => setShow(true), 120); };
  const leave = () => { clearTimeout(timerRef.current); setShow(false); };
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const lines = show && site.latestNote ? site.latestNote.split("\n").filter(l => l.trim()) : [];
  return (
    <div onMouseEnter={enter} onMouseLeave={leave} onClick={onClick} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, position: "relative", zIndex: show ? 100 : 1 }}>
      {show && lines.length > 0 && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 9999, pointerEvents: "none", animation: "tooltipSlideIn 0.15s ease-out", padding: "8px 18px 0" }}>
          <div style={{ borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 2px rgba(201,168,76,0.2), 0 0 80px rgba(232,122,46,0.1)", border: "2px solid rgba(201,168,76,0.25)" }}>
            <div style={{ background: "linear-gradient(135deg, #0A0E24 0%, #1E2761 50%, #0A0E24 100%)", padding: "10px 18px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(201,168,76,0.2)" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, boxShadow: "0 4px 12px rgba(232,122,46,0.4)" }}>&#x1F525;</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", letterSpacing: "0.08em", textTransform: "uppercase" }}>Latest Intel</div>
                <div style={{ fontSize: 9, color: "#6B7394", fontWeight: 600 }}>Storvex Pipeline Intelligence</div>
              </div>
              {site.latestNoteDate && <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, background: "rgba(201,168,76,0.1)", padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.15)", whiteSpace: "nowrap" }}>{site.latestNoteDate}</span>}
            </div>
            <div style={{ background: "#080B1A", padding: "14px 20px" }}>
              {lines.map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0", borderBottom: i < lines.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <span style={{ color: "#C9A84C", fontSize: 10, marginTop: 3, flexShrink: 0 }}>&#x25C6;</span>
                  <span style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.7, fontWeight: 500 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ width: 14, height: 14, background: "#0A0E24", transform: "rotate(45deg)", position: "absolute", top: 2, left: 60, border: "2px solid rgba(201,168,76,0.25)", borderBottom: "none", borderRight: "none" }} />
        </div>
      )}
      {children}
    </div>
  );
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>;
}
