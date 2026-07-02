// Cross-cutting flag: "an in-screen fullscreen overlay is currently
// showing — please hide the floating PersistentBottomNav until I close
// it." The nav lives at the navigator root, so it can't see per-screen
// state directly. Screens with their own overlays (HomeScreen's
// tappedFullPhoto enlarged photo viewer, the timeline enlarged view,
// etc.) report visibility through this context and the nav reads it.
//
// Two hooks so consumers split cleanly:
//   useUiOverlayVisible() — read-only, used by PersistentBottomNav
//   useUiOverlayReporter() — setter, used by overlay-owning screens
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const UiOverlayContext = createContext({ visible: false, setVisible: () => {} });

export function UiOverlayProvider({ children }) {
  // Reference-counted — if two screens both report an overlay open at
  // the same time, the nav stays hidden until both close. Avoids the
  // "first screen closes, nav reappears under the second screen's
  // still-open overlay" race.
  const countRef = useRef(0);
  const [visible, setVisibleState] = useState(false);

  const setVisible = useCallback((on) => {
    countRef.current = Math.max(0, countRef.current + (on ? 1 : -1));
    setVisibleState(countRef.current > 0);
  }, []);

  const value = useMemo(() => ({ visible, setVisible }), [visible, setVisible]);
  return <UiOverlayContext.Provider value={value}>{children}</UiOverlayContext.Provider>;
}

export const useUiOverlayVisible = () => useContext(UiOverlayContext).visible;
export const useUiOverlayReporter = () => useContext(UiOverlayContext).setVisible;
