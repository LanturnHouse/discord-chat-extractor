import { useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Check } from '../common/Icons';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface RadioGroupProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: readonly RadioOption<T>[];
  onChange: (value: T) => void;
  /** 'cards' = stacked cards with a description, 'segmented' = a compact row of choices. */
  variant: 'cards' | 'segmented';
}

/**
 * Radio group with a roving tab stop: Tab reaches the checked option, the arrow keys move the choice (and focus) like
 * native radio buttons do, Home / End jump to the ends. Options are real buttons with `role="radio"`.
 */
export function RadioGroup<T extends string>({ label, value, options, onChange, variant }: RadioGroupProps<T>): ReactElement {
  const idPrefix = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const choose = (index: number): void => {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = options.findIndex((option) => option.value === value);
    const last = options.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = current >= last ? 0 : current + 1;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = current <= 0 ? last : current - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    choose(next);
  };

  return (
    <div role="radiogroup" aria-label={label} className={`topbar-radio topbar-radio--${variant}`} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const checked = option.value === value;
        const labelId = `${idPrefix}-${option.value}-label`;
        const descriptionId = option.description === undefined ? undefined : `${idPrefix}-${option.value}`;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // The description sits inside the button, so the name taken from its content would repeat what aria-describedby reads out.
            aria-labelledby={descriptionId === undefined ? undefined : labelId}
            aria-describedby={descriptionId}
            tabIndex={checked ? 0 : -1}
            className="topbar-radio__option"
            onClick={() => choose(index)}
          >
            <span className="topbar-radio__text">
              <span id={labelId} className="topbar-radio__label">
                {option.label}
              </span>
              {option.description === undefined ? null : (
                <span id={descriptionId} className="topbar-radio__description">
                  {option.description}
                </span>
              )}
            </span>
            {variant === 'cards' && checked ? <Check className="topbar-radio__check" /> : null}
          </button>
        );
      })}
    </div>
  );
}
