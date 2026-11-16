import { useMemo } from 'react';
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap';
import {
  BLOCK_TYPES,
  blockLabel,
  createBlock,
  type EmailBlock,
  type EmailBlockDocument,
  type EmailBlockType,
} from '../lib/emailBlocks';

export interface EmailBlockBuilderProps {
  document: EmailBlockDocument;
  onChange: (document: EmailBlockDocument) => void;
  variableKeys: string[];
}

export function EmailBlockBuilder({
  document,
  onChange,
  variableKeys,
}: EmailBlockBuilderProps): JSX.Element {
  const blocks = document.blocks;

  const replace = (next: EmailBlock[]): void => {
    onChange({ ...document, blocks: next });
  };

  const update = (id: string, patch: Record<string, unknown>): void => {
    replace(
      blocks.map((block) =>
        block.id === id ? ({ ...block, ...patch } as EmailBlock) : block,
      ),
    );
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;

    if (target < 0 || target >= blocks.length) {
      return;
    }

    const next = [...blocks];
    const [current] = next.splice(index, 1);

    if (current === undefined) {
      return;
    }

    next.splice(target, 0, current);
    replace(next);
  };

  const duplicate = (block: EmailBlock): void => {
    const index = blocks.findIndex((item) => item.id === block.id);
    const copy = { ...block, id: createBlock(block.type).id } as EmailBlock;
    const next = [...blocks];
    next.splice(index + 1, 0, copy);
    replace(next);
  };

  const remove = (id: string): void => {
    replace(blocks.filter((block) => block.id !== id));
  };

  const add = (type: EmailBlockType): void => {
    replace([...blocks, createBlock(type)]);
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <div>
          <div className="small fw-semibold">Block builder</div>
          <div className="small text-muted">
            Susun body dari blok. Gunakan mode HTML untuk loop/conditional lanjutan.
          </div>
        </div>
        <Badge bg="light" text="dark" className="fw-normal">
          {blocks.length} blok
        </Badge>
      </div>

      <div className="d-flex flex-wrap gap-1 mb-3">
        {BLOCK_TYPES.map((item) => (
          <Button
            key={item.type}
            size="sm"
            variant="outline-secondary"
            onClick={() => add(item.type)}
          >
            + {item.label}
          </Button>
        ))}
      </div>

      {blocks.length === 0 ? (
        <div className="border rounded p-3 text-center text-muted small">
          Belum ada block. Tambahkan heading atau teks untuk mulai.
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {blocks.map((block, index) => (
            <Card key={block.id} className="block-card">
              <Card.Header className="d-flex align-items-center justify-content-between gap-2 py-2">
                <span className="small fw-semibold">
                  {index + 1}. {blockLabel(block.type)}
                </span>
                <div className="d-flex gap-1">
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Naikkan block"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={index === blocks.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Turunkan block"
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => duplicate(block)}
                  >
                    Duplikat
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => remove(block.id)}>
                    Hapus
                  </Button>
                </div>
              </Card.Header>
              <Card.Body className="py-2">
                {block.type === 'heading' ? (
                  <>
                    <Row className="g-2">
                      <Col xs={12} md={9}>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={block.text}
                          onChange={(event) => update(block.id, { text: event.target.value })}
                        />
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Select
                          value={String(block.level)}
                          onChange={(event) =>
                            update(block.id, { level: Number(event.target.value) })
                          }
                        >
                          <option value="1">Heading 1</option>
                          <option value="2">Heading 2</option>
                          <option value="3">Heading 3</option>
                        </Form.Select>
                      </Col>
                    </Row>
                    <VariableInsert
                      keys={variableKeys}
                      onInsert={(token) => update(block.id, { text: appendToken(block.text, token) })}
                    />
                  </>
                ) : null}

                {block.type === 'text' ? (
                  <>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={block.text}
                      onChange={(event) => update(block.id, { text: event.target.value })}
                    />
                    <VariableInsert
                      keys={variableKeys}
                      onInsert={(token) => update(block.id, { text: appendToken(block.text, token) })}
                    />
                  </>
                ) : null}

                {block.type === 'image' ? (
                  <Row className="g-2">
                    <Col xs={12}>
                      <Form.Control
                        value={block.url}
                        placeholder="https://... atau {{image.url}}"
                        onChange={(event) => update(block.id, { url: event.target.value })}
                      />
                    </Col>
                    <Col xs={12} md={7}>
                      <Form.Control
                        value={block.alt}
                        placeholder="Alt text"
                        onChange={(event) => update(block.id, { alt: event.target.value })}
                      />
                    </Col>
                    <Col xs={6} md={5}>
                      <Form.Control
                        value={block.width}
                        placeholder="Lebar px"
                        onChange={(event) => update(block.id, { width: event.target.value })}
                      />
                    </Col>
                  </Row>
                ) : null}

                {block.type === 'button' ? (
                  <Row className="g-2">
                    <Col xs={12} md={6}>
                      <Form.Control
                        value={block.label}
                        placeholder="Label tombol"
                        onChange={(event) => update(block.id, { label: event.target.value })}
                      />
                    </Col>
                    <Col xs={12} md={4}>
                      <Form.Control
                        value={block.url}
                        placeholder="{{cta.url}} atau https://..."
                        onChange={(event) => update(block.id, { url: event.target.value })}
                      />
                    </Col>
                    <Col xs={6} md={2}>
                      <Form.Select
                        value={block.align}
                        onChange={(event) => update(block.id, { align: event.target.value })}
                      >
                        <option value="left">Kiri</option>
                        <option value="center">Tengah</option>
                        <option value="right">Kanan</option>
                      </Form.Select>
                    </Col>
                    <Col xs={12}>
                      <VariableInsert
                        keys={variableKeys}
                        onInsert={(token) =>
                          update(block.id, { label: appendToken(block.label, token) })
                        }
                      />
                    </Col>
                  </Row>
                ) : null}

                {block.type === 'divider' ? (
                  <p className="small text-muted mb-0">Garis pemisah horizontal.</p>
                ) : null}

                {block.type === 'spacer' ? (
                  <Row className="g-2">
                    <Col xs={6} md={3}>
                      <Form.Control
                        value={block.height}
                        placeholder="Tinggi px"
                        onChange={(event) => update(block.id, { height: event.target.value })}
                      />
                    </Col>
                    <Col xs={12} md={9} className="align-self-center">
                      <span className="small text-muted">Ruang kosong vertikal (4–120 px).</span>
                    </Col>
                  </Row>
                ) : null}

                {block.type === 'columns' ? (
                  <Row className="g-2">
                    <Col xs={12} md={6}>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={block.left}
                        placeholder="Kolom kiri"
                        onChange={(event) => update(block.id, { left: event.target.value })}
                      />
                      <VariableInsert
                        keys={variableKeys}
                        onInsert={(token) =>
                          update(block.id, { left: appendToken(block.left, token) })
                        }
                      />
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={block.right}
                        placeholder="Kolom kanan"
                        onChange={(event) => update(block.id, { right: event.target.value })}
                      />
                      <VariableInsert
                        keys={variableKeys}
                        onInsert={(token) =>
                          update(block.id, { right: appendToken(block.right, token) })
                        }
                      />
                    </Col>
                  </Row>
                ) : null}
              </Card.Body>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function VariableInsert({
  keys,
  onInsert,
}: {
  keys: string[];
  onInsert: (token: string) => void;
}): JSX.Element | null {
  const options = useMemo(
    () =>
      keys.map((key) => ({
        key,
        token: `{{${key}}}`,
      })),
    [keys],
  );

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="d-flex justify-content-end mt-1">
      <Form.Select
        size="sm"
        value=""
        style={{ width: 'auto' }}
        aria-label="Sisipkan variabel"
        onChange={(event) => {
          const token = event.target.value;

          if (token.length > 0) {
            onInsert(token);
          }
        }}
      >
        <option value="">+ variabel</option>
        {options.map((option) => (
          <option key={option.key} value={option.token}>
            {option.key}
          </option>
        ))}
      </Form.Select>
    </div>
  );
}

function appendToken(value: string, token: string): string {
  if (value.length === 0) {
    return token;
  }

  return value.endsWith(' ') ? `${value}${token}` : `${value} ${token}`;
}
