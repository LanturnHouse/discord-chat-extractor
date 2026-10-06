/** Free space kept between the tooltip and the top / bottom edge of the window. */
export const TOOLTIP_VIEWPORT_MARGIN = 8;

/**
 * How many pixels (positive = down) a tooltip box of `height`, vertically centred on `center`, has to move to lie inside a
 * window of `viewportHeight` with `margin` left free at both ends. A box taller than the window keeps its start in view, which
 * is where the reader begins. Zero while the box or the window has no size yet (nothing is laid out, e.g. in a test DOM).
 */
export function tooltipShift(center: number, height: number, viewportHeight: number, margin: number = TOOLTIP_VIEWPORT_MARGIN): number {
  if (height <= 0 || viewportHeight <= 0) return 0;
  const top = center - height / 2;
  const bottom = center + height / 2;
  if (top < margin) return margin - top;
  if (bottom > viewportHeight - margin) return Math.max(viewportHeight - margin - bottom, margin - top);
  return 0;
}
