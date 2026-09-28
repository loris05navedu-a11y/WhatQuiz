import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** QR code rendu en SVG natif (un seul chemin), sans injection de HTML. */
export function QrCode({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const modules = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
    return { path: d, count: modules };
  }, [value]);

  return (
    <svg className="qr" width={size} height={size} viewBox={`-2 -2 ${count + 4} ${count + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={count + 4} height={count + 4} fill="#fff" />
      <path d={path} fill="#17142b" />
    </svg>
  );
}
