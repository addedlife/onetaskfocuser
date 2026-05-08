import { useMemo } from 'react';
import { SCHEMES } from '../../01-core.js';
import { buildDeskPhoneThemeQuery } from '../ui-tokens.jsx';

export function useAppTheme(AS) {
  const sc = SCHEMES[AS?.colorScheme] || AS?.customSchemes?.[AS?.colorScheme] || SCHEMES.claude;
  const isDark = (() => {
    const h = sc.bg || "#EDE5D8";
    const r = parseInt(h.slice(1,3),16);
    const g = parseInt(h.slice(3,5),16);
    const b = parseInt(h.slice(5,7),16);
    return (r*299+g*587+b*114)/1000 < 128;
  })();
  const T = {
    ...sc,
    isDark,
    glow: !!sc.glow,
    shadow: isDark ? "0 2px 12px rgba(0,0,0,0.3)" : "0 2px 12px rgba(0,0,0,0.06)",
    shadowLg: isDark ? "0 6px 24px rgba(0,0,0,0.4)" : "0 6px 24px rgba(0,0,0,0.09)",
  };
  const deskPhoneThemePalette = AS?.colorScheme === "material"
    ? "material"
    : isDark
      ? "navyGold"
      : "claude";
  const deskPhoneThemeSyncEnabled = AS?.deskPhoneThemeSync !== false;
  const deskPhoneThemeQuery = useMemo(() => buildDeskPhoneThemeQuery(deskPhoneThemePalette, T), [deskPhoneThemePalette, T]);
  const softBorderC = isDark ? "#7A78A8" : "#B8A88E";

  return {
    deskPhoneThemeQuery,
    deskPhoneThemeSyncEnabled,
    isDark,
    sc,
    softBorderC,
    T,
  };
}
