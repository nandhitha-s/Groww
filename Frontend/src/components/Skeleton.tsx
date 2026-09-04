import type { CSSProperties } from 'react';

export function Skeleton({
  width,
  height,
  radius,
  style,
}: {
  width: number | string;
  height: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}
