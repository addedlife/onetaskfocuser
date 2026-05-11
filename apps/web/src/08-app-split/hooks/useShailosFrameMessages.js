import { useEffect } from 'react';

export function useShailosFrameMessages({ setConvCallMode, setShailosAction, setShowConvCapture, setShowShailos }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data === 'shailos:close') {
        setShowShailos(false);
        setShailosAction(null);
      }
      if (e.data === 'shailos:open-conv-capture') {
        setShowShailos(false);
        setShailosAction(null);
        setConvCallMode(true);
        setShowConvCapture(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setConvCallMode, setShailosAction, setShowConvCapture, setShowShailos]);
}
