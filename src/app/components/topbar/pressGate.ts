import { createContext, useContext } from 'react';

/**
 * Runs `action` at once, or - while a mouse button or finger that went down inside the popover is still down - when it comes up.
 *
 * A field that is left because of a press reports what it holds (a half-typed date), and that can change the layout of the
 * popover (an error line appears). Done between the press and the release of a click on a control further down, it moves that
 * control away from under the pointer and the browser sends no click at all. Done when the pointer comes up, the click still
 * reaches the control it was aimed at.
 */
export type AfterPress = (action: () => void) => void;

export const PressGateContext = createContext<AfterPress>((action) => action());

export function useAfterPress(): AfterPress {
  return useContext(PressGateContext);
}
