import { useRef } from 'react';
import { PanResponder } from 'react-native';

// Bottom-nav order. Swipe left → next tab, swipe right → previous tab.
// Edges (Home / Settings) stop at the boundary instead of wrapping.
const TAB_ORDER = ['Home', 'Projects', 'Studio', 'Settings'];

const HORIZONTAL_RATIO = 1.5;   // dx must dominate dy this much to claim the gesture
const ACTIVATION_DX = 20;        // px of horizontal motion before we take over
const COMMIT_DX = 60;            // px on release to commit a tab switch

export const useTabSwipe = (currentTab, navigation) => {
  const ref = useRef(
    PanResponder.create({
      // We only intercept clear horizontal swipes — vertical scrolling and
      // ScrollViews inside the screen claim the gesture first.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > ACTIVATION_DX && Math.abs(g.dx) > Math.abs(g.dy) * HORIZONTAL_RATIO,
      onPanResponderRelease: (_, g) => {
        const idx = TAB_ORDER.indexOf(currentTab);
        if (idx < 0) return;
        if (g.dx < -COMMIT_DX && idx < TAB_ORDER.length - 1) {
          navigation.reset({ index: 0, routes: [{ name: TAB_ORDER[idx + 1] }] });
        } else if (g.dx > COMMIT_DX && idx > 0) {
          navigation.reset({ index: 0, routes: [{ name: TAB_ORDER[idx - 1] }] });
        }
      },
    })
  );
  return ref.current.panHandlers;
};
