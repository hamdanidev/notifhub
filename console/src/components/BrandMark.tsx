export type BrandMarkVariant = 'tenant' | 'platform';

export interface BrandMarkProps {
  variant?: BrandMarkVariant;
  className?: string;
}

/**
 * NotifHub "Hub" mark: one centre point branching to three channels.
 *
 * Rendered as an inline SVG so the sidebar, login page, and platform console share one shape and
 * can inherit the lane accent through the `brand-mark--*` class.
 */
export function BrandMark({ variant = 'tenant', className }: BrandMarkProps): JSX.Element {
  const classes = ['brand-mark', `brand-mark--${variant}`, className]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(' ');

  return (
    <svg className={classes} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect className="brand-mark__bg" width="24" height="24" rx="6" />
      <path
        className="brand-mark__spoke"
        d="M12 12 L12 5.5 M12 12 L6 17.5 M12 12 L18 17.5"
      />
      <circle className="brand-mark__dot" cx="12" cy="12" r="2.1" />
      <circle className="brand-mark__node" cx="12" cy="5.5" r="1.2" />
      <circle className="brand-mark__node" cx="6" cy="17.5" r="1.2" />
      <circle className="brand-mark__node" cx="18" cy="17.5" r="1.2" />
    </svg>
  );
}
