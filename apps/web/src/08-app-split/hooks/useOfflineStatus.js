import { useEffect, useState } from 'react';
import { isOfflineShellReady } from '../../offline-support.js';

export function useOfflineStatus() {
  const [networkOffline, setNetworkOffline] = useState(() => typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [offlineShellReady, setOfflineShellReady] = useState(isOfflineShellReady);
  const [offlineNoticeDismissed, setOfflineNoticeDismissed] = useState(false);
  const [fbOffline, setFbOffline] = useState(false);

  useEffect(() => {
    const updateNetworkState = () => {
      setNetworkOffline(!navigator.onLine);
      if (navigator.onLine) setOfflineNoticeDismissed(false);
    };
    const markOfflineReady = () => setOfflineShellReady(true);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    window.addEventListener("onetask-offline-ready", markOfflineReady);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
      window.removeEventListener("onetask-offline-ready", markOfflineReady);
    };
  }, []);

  return {
    fbOffline,
    networkOffline,
    offlineNoticeDismissed,
    offlineShellReady,
    setFbOffline,
    setOfflineNoticeDismissed,
  };
}
