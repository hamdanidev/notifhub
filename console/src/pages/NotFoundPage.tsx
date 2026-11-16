import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="text-center py-5">
      <h1 className="h3">404</h1>
      <p className="text-muted">Halaman tidak ditemukan.</p>
      <Link to="/" className="btn btn-primary btn-sm">
        Kembali ke dashboard
      </Link>
    </div>
  );
}
