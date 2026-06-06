// Module-level handoff between ReportStyleScreen and the editor.
//
// We were previously routing the picked layout id through a route
// param (a callback function) — but React Navigation's params can be
// dropped or serialized in ways that strip functions, and the user
// kept seeing the editor revert to the default layout. A plain
// module-level ref is invulnerable to nav-state quirks: the picker
// writes, the editor reads on focus. One value at a time, consume-on-
// read so we don't re-apply on subsequent focus events.

let pendingLayoutSelection = null;

export const setPendingLayoutSelection = (id) => {
  pendingLayoutSelection = id || null;
};

export const consumePendingLayoutSelection = () => {
  const v = pendingLayoutSelection;
  pendingLayoutSelection = null;
  return v;
};
