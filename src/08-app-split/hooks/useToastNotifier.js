import { useRef, useState } from 'react';

export function useToastNotifier() {
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (msg, dur = 10000, color) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, color });
    toastTimer.current = setTimeout(() => setToast(null), dur);
  };

  const dismissToast = () => {
    clearTimeout(toastTimer.current);
    setToast(null);
  };

  return { dismissToast, showToast, toast };
}
