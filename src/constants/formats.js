// Format templates the user picks on the Studio edit screen — the
// selection is persisted as `photo.pairTemplate` on the record so
// every downstream renderer (Studio, EnlargedPhotoViewer, report
// previews, PhotoSetPreview, HomeScreen) can pick the same aspect
// ratio without duplicating the mapping.
export const FORMAT_ASPECTS = {
  square: 1,
  'wide-16-9': 16 / 9,
  'tall-9-16': 9 / 16,
  'wide-2-1': 2,
  'tall-1-2': 0.5,
};

// Returns the aspect ratio for a stored pairTemplate key. Callers
// should fall back to their own default (e.g. bitmap-derived aspect
// or 1 for a square slot) when this returns null.
export const getFormatAspect = (pairTemplate) => {
  if (!pairTemplate) return null;
  return FORMAT_ASPECTS[pairTemplate] ?? null;
};
