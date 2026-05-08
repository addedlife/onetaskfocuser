import { useRef, useState } from 'react';

export function useQueueToast() {
  const [queueToast, setQueueToast] = useState(null);
  const [queueToastKey, setQueueToastKey] = useState(0);
  const queueToastTimer = useRef(null);

  const showQueueToast = (color) => {
    clearTimeout(queueToastTimer.current);
    setQueueToast(color);
    setQueueToastKey(k => k + 1);
    queueToastTimer.current = setTimeout(() => setQueueToast(null), 5000);
  };

  return { queueToast, queueToastKey, showQueueToast };
}
