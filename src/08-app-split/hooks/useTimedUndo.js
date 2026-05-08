import { useRef, useState } from 'react';

export function useTimedUndo(duration = 6000) {
  const [undo, setUndo] = useState(null);
  const timer = useRef(null);

  const showUndo = (value) => {
    clearTimeout(timer.current);
    setUndo(value);
    timer.current = setTimeout(() => setUndo(null), duration);
  };

  const clearUndo = () => {
    clearTimeout(timer.current);
    setUndo(null);
  };

  return { clearUndo, showUndo, undo };
}
