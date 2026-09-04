import type { ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  variant?: 'default' | 'ghost' | 'danger';
}

export function IconButton({ variant = 'default', className, ...rest }: IconButtonProps) {
  const variantClass = variant === 'default' ? '' : styles[variant];
  return <button className={`${styles.button} ${variantClass} ${className ?? ''}`} {...rest} />;
}
