import { useEffect } from 'react';

export function useShailosSharedState({ aiOpts, theme }) {
  useEffect(() => {
    try { localStorage.setItem('onetask_theme', JSON.stringify(theme)); } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      if (aiOpts) localStorage.setItem('onetask_ai_config', JSON.stringify(aiOpts));
    } catch {}
  }, [aiOpts]);
}
