// Shared on-photo overlay components — used by both the Studio (Edit)
// screen and the Home preview's "Edited" toggle so the preview shows
// the exact same composition that the Studio renders (and that the
// share/export pipeline ultimately bakes in).
//
// Label rendering lives in <PhotoLabels> (one source of truth, reads
// SettingsContext directly). This file owns the *other* on-photo
// overlays: watermark, brand logo, metadata, markup. Callers compose
// PhotoLabels + StudioEditOverlays however they need.
import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle as SvgCircle, Polygon, Text as SvgText, G } from 'react-native-svg';
import { getLabelPositions } from '../constants/rooms';
import PhotoWatermark from './PhotoWatermark';
import PhotoLabels from './PhotoLabels';
import { useScopedSettings } from '../hooks/useScopedSettings';

export const LOGO_SIZE_PX = { small: 40, medium: 60, large: 84 };
export const META_FONT_PX = { small: 11, medium: 14, large: 18 };

// Same font key → loaded font mapping as PhotoLabel.
export const META_FONT_FAMILY_MAP = {
  alexandria: 'Alexandria_400Regular',
  system: 'Alexandria_400Regular',
  shadow: 'PlayfairDisplay_700Bold',
  shanatel: 'Quicksand_400Regular',
  sf: 'Lato_700Bold',
  share: 'RobotoMono_700Bold',
  montserratBold: 'Montserrat_700Bold',
  playfairBold: 'PlayfairDisplay_700Bold',
  robotoMonoBold: 'RobotoMono_700Bold',
  latoBold: 'Lato_700Bold',
  poppinsSemiBold: 'Poppins_600SemiBold',
  oswaldSemiBold: 'Oswald_600SemiBold',
};

// Build the style block that places an overlay at a freeform offset
// (fractional 0..1 each). Same trick PhotoLabel uses.
export const freeformPositionStyle = (offset) =>
  offset && typeof offset.x === 'number' && typeof offset.y === 'number'
    ? {
        left: `${offset.x * 100}%`,
        top: `${offset.y * 100}%`,
        transform: [
          { translateX: `${-offset.x * 100}%` },
          { translateY: `${-offset.y * 100}%` },
        ],
      }
    : null;

export function BrandLogoOverlay({ uri, position, size, offset }) {
  const positions = getLabelPositions(10, 10);
  const posStyle = positions[position] || positions['right-bottom'];
  const { name, horizontalAlign, verticalAlign, ...coords } = posStyle;
  const px = typeof size === 'number' ? size : (LOGO_SIZE_PX[size] || LOGO_SIZE_PX.medium);
  const ff = freeformPositionStyle(offset);
  return (
    <View pointerEvents="none" style={[styles.brandLogoOverlay, ff || coords]}>
      <Image source={{ uri }} style={{ width: px, height: px }} resizeMode="contain" />
    </View>
  );
}

export function MetadataOverlay({
  photo,
  location,
  showDate,
  showTime,
  showAddress,
  showGps,
  position,
  color,
  opacity,
  fontSize,
  fontFamily,
  offset,
}) {
  const ts = photo?.timestamp
    ? new Date(photo.timestamp)
    : (photo?.createdAt ? new Date(photo.createdAt) : null);
  const parts = [];
  if (showDate && ts) parts.push(ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  if (showTime && ts) parts.push(ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  if (showAddress) {
    const where = (photo?.location || location || '').toString().trim();
    if (where) parts.push(where);
  }
  if (showGps && photo?.gps) parts.push(String(photo.gps));
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  const positions = getLabelPositions(10, 10);
  const posStyle = positions[position] || positions['left-bottom'];
  const { name, horizontalAlign, verticalAlign, ...coords } = posStyle;
  const fontSizePx = typeof fontSize === 'number' ? fontSize : (META_FONT_PX[fontSize] || META_FONT_PX.small);
  const family = META_FONT_FAMILY_MAP[fontFamily] || META_FONT_FAMILY_MAP.alexandria;
  const ff = freeformPositionStyle(offset);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.metadataOverlay,
        ff || coords,
        { opacity: typeof opacity === 'number' ? opacity : 0.85 },
      ]}
    >
      <Text
        style={{
          color: color || '#FFFFFF',
          fontSize: fontSizePx,
          fontWeight: '700',
          fontFamily: family,
          textShadowColor: 'rgba(0,0,0,0.5)',
          textShadowRadius: 4,
        }}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
  );
}

// Single markup shape — supports the full tool set the MarkupEditor
// can produce.
export function MarkupShape({ shape, theme }) {
  const opacity = shape.tool === 'highlight' ? 0.35 : 1;
  if (shape.tool === 'draw' || shape.tool === 'brush' || shape.tool === 'highlight') {
    const pts = shape.points || [];
    if (pts.length === 0) return null;
    if (pts.length === 1) {
      const r = Math.max(shape.stroke / 2, 2);
      return (
        <SvgCircle cx={pts[0].x} cy={pts[0].y} r={r} fill={shape.color} opacity={opacity} />
      );
    }
    const d = pts.reduce(
      (acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`),
      ''
    );
    return (
      <Path
        d={d}
        stroke={shape.color}
        strokeWidth={shape.stroke}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={opacity}
      />
    );
  }
  if (shape.tool === 'arrow') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const headLen = Math.max(stroke * 4, 12);
    const headWidth = Math.max(stroke * 2.5, 8);
    const bx = x2 - ux * headLen;
    const by = y2 - uy * headLen;
    const ax = bx + px * headWidth;
    const ay = by + py * headWidth;
    const cx = bx - px * headWidth;
    const cy = by - py * headWidth;
    return (
      <G opacity={opacity}>
        <Line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        <Polygon points={`${x2},${y2} ${ax},${ay} ${cx},${cy}`} fill={color} />
      </G>
    );
  }
  if (shape.tool === 'circle') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const r = Math.sqrt(dx * dx + dy * dy);
    return (
      <SvgCircle cx={x1} cy={y1} r={r} stroke={color} strokeWidth={stroke} fill="none" />
    );
  }
  if (shape.tool === 'measure') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    return (
      <G>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        <Line x1={x1 - 6} y1={y1} x2={x1 + 6} y2={y1} stroke={color} strokeWidth={stroke} />
        <Line x1={x2 - 6} y1={y2} x2={x2 + 6} y2={y2} stroke={color} strokeWidth={stroke} />
        <SvgText
          x={midX}
          y={midY - 6}
          fill={color}
          fontSize="12"
          fontWeight="700"
          textAnchor="middle"
        >
          {Math.round(len)} px
        </SvgText>
      </G>
    );
  }
  if (shape.tool === 'text') {
    return (
      <SvgText
        x={shape.x}
        y={shape.y}
        fill={shape.color}
        fontSize="16"
        fontWeight="700"
      >
        {shape.text}
      </SvgText>
    );
  }
  return null;
}

// Renders the full markup payload that lives on `photo.markup`. Handles
// both the legacy raw-array format and the new { bounds, shapes } format.
// Returns null when there's nothing to draw so callers can leave it in
// the tree unconditionally.
export function PhotoMarkupOverlay({ photo, theme }) {
  const m = photo?.markup;
  const shapes = Array.isArray(m) ? m : (m && Array.isArray(m.shapes) ? m.shapes : []);
  if (shapes.length === 0) return null;
  const bounds = (m && m.bounds && m.bounds.w > 0 && m.bounds.h > 0) ? m.bounds : null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg
        width="100%"
        height="100%"
        viewBox={bounds ? `0 0 ${bounds.w} ${bounds.h}` : undefined}
        preserveAspectRatio="xMidYMid meet"
      >
        {shapes.map((shape, i) => (
          <MarkupShape key={`s-${i}`} shape={shape} theme={theme} />
        ))}
      </Svg>
    </View>
  );
}

// Composite renderer: stacks ALL studio-style overlays the user might
// have enabled in Settings, in the same z-order the Studio screen uses.
// Reads watermark/brand/metadata state from SettingsContext so callers
// only need to pass `photo` (+ optional `renderLabels` / `combinedLayout`).
//
// Labels delegate to <PhotoLabels> (single source of truth). Pass
// `renderLabels={false}` when the caller is already drawing labels
// outside this composite — e.g. HomeScreen draws PhotoLabels always,
// but gates the rest of the overlays behind the "Edited" toggle.
export function StudioEditOverlays({
  photo,
  theme,
  renderLabels = true,
  renderWatermark = true,
  renderMetadata = true,
  renderBrandLogo = true,
  renderMarkup = true,
  combinedLayout = 'side',
}) {
  const s = useScopedSettings(photo?.id);
  if (!photo) return null;
  return (
    <>
      {renderLabels && <PhotoLabels photo={photo} combinedLayout={combinedLayout} />}
      {renderWatermark && s.showWatermark && <PhotoWatermark photo={photo} />}
      {renderBrandLogo && s.showBrandLogo && s.brandLogoUri && (
        <BrandLogoOverlay
          uri={s.brandLogoUri}
          position={s.brandLogoPosition}
          size={s.brandLogoSize}
          offset={s.brandLogoOffset}
        />
      )}
      {renderMetadata && s.showPreviewMetadata && (
        <MetadataOverlay
          photo={photo}
          location={s.location}
          showDate={s.metaShowDate}
          showTime={s.metaShowTime}
          showAddress={s.metaShowAddress}
          showGps={s.metaShowGps}
          position={s.metaPosition}
          color={s.metaColor}
          opacity={s.metaOpacity}
          fontSize={s.metaFontSize}
          fontFamily={s.metaFontFamily}
          offset={s.metaOffset}
        />
      )}
      {/* `renderMarkup={false}` — MarkupEditor draws its own live shapes
          from local state and doesn't want the persisted shapes
          layer on top of them. */}
      {renderMarkup && <PhotoMarkupOverlay photo={photo} theme={theme} />}
    </>
  );
}

const styles = StyleSheet.create({
  brandLogoOverlay: {
    position: 'absolute',
  },
  metadataOverlay: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '92%',
  },
});
