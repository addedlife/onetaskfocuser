import { useCallback, useMemo, useState } from 'react';
import { getInitialSuiteView } from '../ui-tokens.jsx';

export function useSuiteNavigation({ curTask, syncDeskPhoneTheme, zen }) {
  const [suiteView, setSuiteView] = useState(getInitialSuiteView);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarAutoCollapse, setSidebarAutoCollapse] = useState(() => {
    try { return localStorage.getItem('ot_sidebar_autocollapse') !== 'false'; } catch { return true; }
  });
  const [legacyPrompt, setLegacyPrompt] = useState(null);
  const [showShailos, setShowShailos] = useState(false);
  const [shailosAction, setShailosAction] = useState(null);

  const shellHidden = !!(zen && curTask);
  const sidebarW = shellHidden ? 0 : (sidebarOpen ? 168 : 46);

  const openCommandView = useCallback((view) => {
    if (view === "deskphone") {
      setSuiteView("deskphone");
      setShailosAction(null);
      setShowShailos(false);
      syncDeskPhoneTheme(true);
      return;
    }
    setSuiteView(view);
    if (view !== "shailos") setShailosAction(null);
    if (view === "focus") setShowShailos(false);
  }, [syncDeskPhoneTheme]);

  const askLegacyOpen = useCallback((target) => setLegacyPrompt(target), []);

  const openLegacyTarget = useCallback(() => {
    const target = legacyPrompt;
    setLegacyPrompt(null);
    if (!target) return;
    if (target.id === "shailos") {
      setShailosAction(target.action || null);
      setShowShailos(true);
    } else if (target.id === "tasks") {
      openCommandView("focus");
    } else if (target.id === "deskphone") {
      openCommandView("deskphone");
    }
  }, [legacyPrompt, openCommandView]);

  const openLegacyInCommandCenter = useCallback(() => {
    const target = legacyPrompt;
    setLegacyPrompt(null);
    if (!target) return;
    if (target.id === "shailos") {
      setShailosAction(target.action || null);
      openCommandView("shailos");
    } else if (target.id === "tasks") {
      openCommandView("nervecenter");
    } else if (target.id === "deskphone") {
      openCommandView("deskphone");
    }
  }, [legacyPrompt, openCommandView]);

  const toggleSidebarAutoCollapse = useCallback(() => {
    setSidebarAutoCollapse(v => {
      const next = !v;
      try { localStorage.setItem('ot_sidebar_autocollapse', String(next)); } catch {}
      return next;
    });
  }, []);

  return useMemo(() => ({
    askLegacyOpen,
    legacyPrompt,
    openCommandView,
    openLegacyInCommandCenter,
    openLegacyTarget,
    setShailosAction,
    setShowShailos,
    setSidebarOpen,
    setSuiteView,
    shailosAction,
    shellHidden,
    showShailos,
    sidebarAutoCollapse,
    sidebarOpen,
    sidebarW,
    suiteView,
    toggleSidebarAutoCollapse,
  }), [
    askLegacyOpen,
    legacyPrompt,
    openCommandView,
    openLegacyInCommandCenter,
    openLegacyTarget,
    shailosAction,
    shellHidden,
    showShailos,
    sidebarAutoCollapse,
    sidebarOpen,
    sidebarW,
    suiteView,
    toggleSidebarAutoCollapse,
  ]);
}
