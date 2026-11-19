import { useEffect } from 'react';

/**
 * Redirects the browser to another origin and shows a small placeholder until it happens.
 * Used when the tenant console is asked for a platform route while the platform console lives
 * on its own host.
 */
export function ExternalRedirect({ to }: { to: string }): JSX.Element {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);

  return <div className="empty-state">Mengalihkan ke console platform...</div>;
}
