import React from 'react';
import PhotoLabels from './PhotoLabels';

export default function DraggableLabelOverlay({ photo, role }) {
  return <PhotoLabels photo={photo} role={role} />;
}
