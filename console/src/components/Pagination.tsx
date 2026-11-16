import { Button, ButtonGroup } from 'react-bootstrap';

export interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}

export function Pagination({ total, limit, offset, onChange }: PaginationProps): JSX.Element {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="pagination-bar">
      <span className="pagination-info">
        {from}–{to} dari {total} · halaman {page}/{pages}
      </span>
      <ButtonGroup size="sm">
        <Button
          variant="outline-secondary"
          disabled={offset <= 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Sebelumnya
        </Button>
        <Button
          variant="outline-secondary"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          Berikutnya
        </Button>
      </ButtonGroup>
    </div>
  );
}
