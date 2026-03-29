// src/hooks/useNavigation.js
// Browser history + tab navigation state extracted from App.js

import { useState, useEffect, useCallback, useRef } from "react";

export function useNavigation({ setExpandedSite, setFilterPhase, setShowNewAlert }) {
  const [tab, setTab] = useState("dashboard");
  const [transitioning, setTransitioning] = useState(false);
  const [detailView, setDetailView] = useState(null); // { regionKey, siteId }
  const [reviewDetailSite, setReviewDetailSite] = useState(null); // site ID for full-page review detail
  const isPopState = useRef(false); // prevents pushState during popstate handling

  // ─── Browser History Integration — back/forward button support ───
  const pushNav = useCallback((navState) => {
    if (!isPopState.current) {
      window.history.pushState(navState, "", window.location.pathname);
    }
  }, []);

  // ─── Deep-link: ?site=SITE_ID opens directly to property detail ───
  // Handled by useDeepLink hook in App.js (needs access to site data)
  // This hook just preserves the URL param on initial load
  useEffect(() => {
    // Set initial history state — preserve ?site= param if present
    const params = new URLSearchParams(window.location.search);
    const siteParam = params.get("site");
    window.history.replaceState(
      { tab: "dashboard", detailView: null, reviewDetailSite: null },
      "",
      siteParam ? window.location.pathname + window.location.search : window.location.pathname
    );
    const onPopState = (e) => {
      const st = e.state;
      if (!st) return;
      isPopState.current = true;
      setTransitioning(true);
      setTimeout(() => {
        setTab(st.tab || "dashboard");
        setDetailView(st.detailView || null);
        setReviewDetailSite(st.reviewDetailSite || null);
        setExpandedSite(null);
        setFilterPhase("all");
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => { setTransitioning(false); isPopState.current = false; }, 350);
      }, 100);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setExpandedSite, setFilterPhase]);

  const navigateTo = useCallback((newTab, opts = {}) => {
    if (opts.reviewSiteId) {
      setReviewDetailSite(opts.reviewSiteId);
      setDetailView({ regionKey: "queue", siteId: opts.reviewSiteId });
      setTab("review");
      pushNav({ tab: "review", detailView: { regionKey: "queue", siteId: opts.reviewSiteId }, reviewDetailSite: opts.reviewSiteId });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (newTab === tab && !opts.force) {
      if (detailView) {
        setDetailView(null);
        const cleanUrl = new URL(window.location);
        cleanUrl.searchParams.delete("site");
        window.history.pushState({ tab, detailView: null, reviewDetailSite: null }, "", cleanUrl.toString());
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (opts.phase) setFilterPhase(opts.phase);
      if (opts.siteId) {
        setExpandedSite(opts.siteId);
        setTimeout(() => {
          const el = document.getElementById(`site-${opts.siteId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
      return;
    }
    // Instant tab switch — all state updates in one synchronous block
    // (React 18 createRoot batches these into a single render)
    setTab(newTab);
    setDetailView(null);
    if (newTab !== "review") setReviewDetailSite(null);
    if (opts.phase) setFilterPhase(opts.phase); else setFilterPhase("all");
    if (opts.siteId) {
      setExpandedSite(opts.siteId);
      setTimeout(() => {
        const el = document.getElementById(`site-${opts.siteId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } else {
      setExpandedSite(null);
    }
    if (newTab === "review") setShowNewAlert(false);
    pushNav({ tab: newTab, detailView: null, reviewDetailSite: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [tab, detailView, pushNav, setExpandedSite, setFilterPhase, setShowNewAlert]);

  const goToDetail = useCallback((dv) => {
    setDetailView(dv);
    if (dv) {
      const url = new URL(window.location);
      url.searchParams.set("site", dv.siteId);
      window.history.pushState({ tab, detailView: dv, reviewDetailSite: null }, "", url.toString());
    }
  }, [tab]);

  return {
    tab, setTab,
    transitioning, setTransitioning,
    detailView, setDetailView,
    reviewDetailSite, setReviewDetailSite,
    pushNav,
    navigateTo,
    goToDetail,
  };
}
