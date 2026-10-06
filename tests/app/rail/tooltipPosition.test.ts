import { describe, expect, it } from 'vitest';
import { TOOLTIP_VIEWPORT_MARGIN, tooltipShift } from '@/app/components/rail/tooltipPosition';

describe('tooltipShift', () => {
  const margin = TOOLTIP_VIEWPORT_MARGIN;

  it('leaves a tooltip that fits where it is', () => {
    expect(tooltipShift(400, 34, 800)).toBe(0);
    expect(tooltipShift(margin + 17, 34, 800)).toBe(0); // exactly on the margin
    expect(tooltipShift(800 - margin - 17, 34, 800)).toBe(0);
  });

  it('moves a box that would start above the window down to the margin (the long name at the top row of a scrolled rail)', () => {
    // icon centre 24, four lines (88px): the box would run from -20 to 68
    expect(tooltipShift(24, 88, 800)).toBe(28);
    expect(24 - 88 / 2 + tooltipShift(24, 88, 800)).toBe(margin);
  });

  it('moves a box that would end below the window up to the margin (a 300px high window)', () => {
    // icon centre 270: the box would run from 226 to 314
    expect(tooltipShift(270, 88, 300)).toBe(-22);
    expect(270 + 44 + tooltipShift(270, 88, 300)).toBe(300 - margin);
  });

  it('shows the start of a box that is taller than the window', () => {
    expect(tooltipShift(120, 400, 300)).toBe(margin - (120 - 200));
    expect(120 - 200 + tooltipShift(120, 400, 300)).toBe(margin);
    // ... also when it sits far below the window: it comes up to the margin and no further
    expect(500 - 200 + tooltipShift(500, 400, 300)).toBe(margin);
  });

  it('never pushes the top of the box above the margin when moving it up', () => {
    // a 280px box in a 300px window with the icon near the bottom: moving up by the overflow alone would clip the top
    const shift = tooltipShift(290, 280, 300);
    expect(290 - 140 + shift).toBeGreaterThanOrEqual(margin);
  });

  it('does nothing before anything has a size (a DOM without layout)', () => {
    expect(tooltipShift(0, 0, 800)).toBe(0);
    expect(tooltipShift(24, 88, 0)).toBe(0);
  });

  it('keeps a custom margin', () => {
    expect(tooltipShift(10, 40, 800, 20)).toBe(30);
  });
});
