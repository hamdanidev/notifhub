import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Col, Row, Spinner } from 'react-bootstrap';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { templatesClient } from '../lib/adminClient';
import { describeError } from '../lib/format';
import type { TemplateDiffField, TemplateDiffHunk } from '@notifhub/js';

/** Side-by-side review of two template versions: field hunks, visual blocks, rendered HTML. */
export function TemplateComparePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const fromVersion = parseVersion(search.get('fromVersion'));
  const toVersion = parseVersion(search.get('toVersion'));

  const diff = useQuery({
    queryKey: ['template-diff', id, fromVersion, toVersion],
    queryFn: () => templatesClient.diffTemplate(id ?? '', fromVersion, toVersion),
    enabled: id !== undefined,
  });

  if (diff.isLoading) {
    return <Spinner animation="border" role="status" />;
  }

  if (diff.isError || diff.data === undefined) {
    return <Alert variant="danger">{describeError(diff.error ?? new Error('Diff gagal'))}</Alert>;
  }

  const data = diff.data;

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div>
          <h1 className="h4 mb-1">Bandingkan versi</h1>
          <p className="text-muted small mb-0">
            <code>{data.key}</code> · {data.channel} · {data.locale} · v{data.from.version} → v
            {data.to.version}
          </p>
        </div>
        <div className="d-flex gap-2">
          <Badge bg="light" text="dark" className="fw-normal">
            {data.fields.filter((field) => field.changed).length} field berubah
          </Badge>
          <Badge bg="light" text="dark" className="fw-normal">
            +{data.blocks.added} / -{data.blocks.removed} block
          </Badge>
          <Link
            className="btn btn-sm btn-outline-secondary"
            to={`/templates/${data.templateId}/history`}
          >
            Riwayat
          </Link>
        </div>
      </div>

      {data.truncated ? (
        <Alert variant="warning" className="py-2">
          Diff dipotong karena melebihi batas ukuran; periksa template secara utuh di editor.
        </Alert>
      ) : null}

      <Row className="g-3">
        <Col xl={7}>
          <Card className="mb-3">
            <Card.Header className="fw-semibold">Perubahan field</Card.Header>
            <Card.Body>
              {data.fields.map((field) =>
                field.changed ? (
                  <div key={field.field} className="mb-3">
                    <div className="fw-semibold text-uppercase small mb-1">{field.field}</div>
                    <FieldDiff field={field} />
                  </div>
                ) : (
                  <div key={field.field} className="small text-muted mb-2">
                    {field.field}: tidak berubah
                  </div>
                ),
              )}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header className="fw-semibold">Perubahan block Visual</Card.Header>
            <Card.Body>
              {!data.blocks.available ? (
                <p className="small text-muted mb-0">
                  Salah satu versi dibuat di mode HTML sehingga tidak punya data block.
                </p>
              ) : data.blocks.changed.length === 0 && data.blocks.added === 0 && data.blocks.removed === 0 ? (
                <p className="small text-muted mb-0">Struktur block tidak berubah.</p>
              ) : (
                <ul className="small mb-0">
                  {data.blocks.changed.map((change) => (
                    <li key={`${change.index}-${change.type}`}>
                      Block #{change.index + 1} ({change.type}): {change.fields.join(', ')} berubah
                    </li>
                  ))}
                  {data.blocks.added > 0 ? <li>{data.blocks.added} block ditambahkan</li> : null}
                  {data.blocks.removed > 0 ? <li>{data.blocks.removed} block dihapus</li> : null}
                </ul>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col xl={5}>
          <Card>
            <Card.Header className="fw-semibold">Render berdampingan</Card.Header>
            <Card.Body>
              <div className="d-flex gap-2 mb-2 small text-muted">
                <span>v{data.from.version} (lama)</span>
                <span>v{data.to.version} (baru)</span>
              </div>
              <Row className="g-2">
                <Col xs={6}>
                  <RenderPane
                    html={data.rendered.from.html}
                    error={data.rendered.from.error}
                    title={`Render v${data.from.version}`}
                  />
                </Col>
                <Col xs={6}>
                  <RenderPane
                    html={data.rendered.to.html}
                    error={data.rendered.to.error}
                    title={`Render v${data.to.version}`}
                  />
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function FieldDiff({ field }: { field: TemplateDiffField }): JSX.Element {
  return (
    <pre className="small mb-0 p-2 bg-light border rounded" style={{ whiteSpace: 'pre-wrap' }}>
      {field.hunks.map((hunk, index) => (
        <Hunk key={`${field.field}-${index}`} hunk={hunk} />
      ))}
    </pre>
  );
}

function Hunk({ hunk }: { hunk: TemplateDiffHunk }): JSX.Element {
  const prefix = hunk.type === 'added' ? '+ ' : hunk.type === 'removed' ? '- ' : '  ';

  return (
    <div className={hunk.type === 'added' ? 'text-success' : hunk.type === 'removed' ? 'text-danger' : undefined}>
      {prefix}
      {hunk.value}
    </div>
  );
}

function RenderPane({
  html,
  error,
  title,
}: {
  html: string | null;
  error: string | null;
  title: string;
}): JSX.Element {
  if (html === null) {
    return <Alert variant="secondary" className="small p-2">{error ?? 'Render tidak tersedia.'}</Alert>;
  }

  return (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
      style={{ width: '100%', height: '22rem', border: '1px solid #dee2e6', background: '#fff' }}
    />
  );
}

function parseVersion(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
