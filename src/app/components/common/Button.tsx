import type { ButtonHTMLAttributes, ReactElement } from 'react';
import './common.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = brand blue, secondary = grey, danger = red, link = text only. Default 'primary'. */
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  size?: 'md' | 'sm';
}

/** Discord-style text button. `type` defaults to "button" so it never submits a surrounding form by accident. */
export function Button({ variant = 'primary', size = 'md', type = 'button', className, ...rest }: ButtonProps): ReactElement {
  const classes = `dce-button dce-button--${variant} dce-button--${size}`;
  return <button type={type} className={className === undefined ? classes : `${classes} ${className}`} {...rest} />;
}
