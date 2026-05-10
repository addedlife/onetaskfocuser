import { useEffect, useState } from 'react';

export function useAppConfig() {
  const [serverKeyAvailable, setServerKeyAvailable] = useState(false);
  const [aiConfig, setAiConfig] = useState(null);
  const [serverGoogleClientId, setServerGoogleClientId] = useState("");

  useEffect(() => {
    fetch("/.netlify/functions/app-config")
      .then(r => r.json())
      .then(d => {
        const cfg = d.ai || null;
        const googleId = d?.integrations?.googleClientId || d?.googleClientId || "";
        setAiConfig(cfg);
        setServerKeyAvailable(!!(cfg?.available?.gemini || d.geminiKey));
        setServerGoogleClientId(typeof googleId === "string" ? googleId.trim() : "");
      })
      .catch(() => {});
  }, []);

  return {
    aiConfig,
    serverGoogleClientId,
    serverKeyAvailable,
  };
}
