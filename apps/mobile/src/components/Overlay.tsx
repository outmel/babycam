import type { Point, TrackSnapshot, Zone } from '@lulu/core';
import Svg, { Circle, G, Polygon, Rect, Text as SvgText } from 'react-native-svg';

/** Draws safe zones and tracked people over the camera preview (normalized coordinates). */
export function Overlay({
  width,
  height,
  zones,
  tracks = [],
  draft,
}: {
  width: number;
  height: number;
  zones: Zone[];
  tracks?: TrackSnapshot[];
  draft?: Point[];
}) {
  const pts = (p: Point[]) => p.map((q) => `${q.x * width},${q.y * height}`).join(' ');
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      {zones.map((z) => (
        <G key={z.id}>
          <Polygon points={pts(z.points)} fill="rgba(134,179,142,0.18)" stroke="#86B38E" strokeWidth={2} strokeDasharray="8 6" />
          <SvgText x={z.points[0].x * width + 6} y={z.points[0].y * height + 18} fill="#DDEFE0" fontSize={13} fontWeight="600">
            {z.name}
          </SvgText>
        </G>
      ))}
      {draft && draft.length > 0 && (
        <G>
          {draft.length > 1 && <Polygon points={pts(draft)} fill="rgba(224,122,95,0.18)" stroke="#E07A5F" strokeWidth={2} />}
          {draft.map((p, i) => (
            <Circle key={i} cx={p.x * width} cy={p.y * height} r={8} fill="#E07A5F" stroke="#fff" strokeWidth={2} />
          ))}
        </G>
      )}
      {tracks.map((tr) => {
        const color = tr.isChild ? '#F2C14E' : '#9DB4C8';
        return (
          <G key={tr.id}>
            <Rect x={tr.box.x * width} y={tr.box.y * height} width={tr.box.w * width} height={tr.box.h * height} stroke={color} strokeWidth={2} fill="none" rx={6} />
            <SvgText x={tr.box.x * width + 4} y={tr.box.y * height - 6} fill={color} fontSize={13} fontWeight="700">
              {tr.isChild ? `Child ${tr.label}` : `Person ${tr.label}`}
              {tr.posture && tr.posture !== 'unknown' ? ` · ${tr.posture.replace('_', ' ')}` : ''}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
