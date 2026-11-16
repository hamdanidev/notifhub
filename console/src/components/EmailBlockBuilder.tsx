import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap';
import {
  BLOCK_TYPES,
  blockLabel,
  createBlock,
  moveBlock,
  type EmailBlock,
  type EmailBlockDocument,
  type EmailBlockType,
} from '../lib/emailBlocks';

const MAX_HISTORY = 50;
const COALESCE_WINDOW_MS = 500;

interface BuilderHistory {
  past: EmailBlockDocument[];
  future: EmailBlockDocument[];
}

export interface EmailBlockBuilderProps {
  document: EmailBlockDocument;
  onChange: (document: EmailBlockDocument) => void;
  variableKeys: string[];
  readOnly?: boolean;
  /** Changes when the parent loads/saves a template; resets local undo history. */
  historyKey?: string;
}

export function EmailBlockBuilder({
  document,
  onChange,
  variableKeys,
  readOnly = false,
  historyKey,
}: EmailBlockBuilderProps): JSX.Element {
  const blocks = document.blocks;
  const [history, setHistory] = useState<BuilderHistory>({ past: [], future: [] });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const lastPushRef = useRef<{ key: string; at: number } | null>(null);
  const lastHistoryKeyRef = useRef<string | undefined>(historyKey);

  useEffect(() => {
    if (historyKey === lastHistoryKeyRef.current) {
      return;
    }

    lastHistoryKeyRef.current = historyKey;
    lastPushRef.current = null;
    setHistory({ past: [], future: [] });
  }, [historyKey]);

  const commit = useCallback(
    (next: EmailBlockDocument, coalesceKey?: string): void => {
      const now = Date.now();
      const last = lastPushRef.current;
      const coalesce =
        coalesceKey !== undefined &&
        last !== null &&
        last.key === coalesceKey &&
        now - last.at < COALESCE_WINDOW_MS;

      if (!coalesce) {
        setHistory((current) => ({
          past: [...current.past.slice(-(MAX_HISTORY - 1)), document],
          future: [],
        }));
      }

      lastPushRef.current =
        coalesceKey === undefined ? null : { key: coalesceKey, at: now };
      onChange(next);
    },
    [document, onChange],
  );

  const replace = useCallback(
    (next: EmailBlock[], coalesceKey?: string): void => {
      commit({ ...document, blocks: next }, coalesceKey);
    },
    [commit, document],
  );

  const undo = useCallback((): void => {
    const previous = history.past[history.past.length - 1];

    if (previous === undefined) {
      return;
    }

    setHistory({
      past: history.past.slice(0, -1),
      future: [document, ...history.future].slice(0, MAX_HISTORY),
    });
    lastPushRef.current = null;
    setAnnouncement('Perubahan terakhir dibatalkan.');
    onChange(previous);
  }, [document, history, onChange]);

  const redo = useCallback((): void => {
    const next = history.future[0];

    if (next === undefined) {
      return;
    }

    setHistory({
      past: [...history.past.slice(-(MAX_HISTORY - 1)), document],
      future: history.future.slice(1),
    });
    lastPushRef.current = null;
    setAnnouncement('Perubahan diterapkan kembali.');
    onChange(next);
  }, [document, history, onChange]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (readOnly || !(event.ctrlKey || event.metaKey)) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target !== null &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handler);

    return () => window.removeEventListener('keydown', handler);
  }, [readOnly, redo, undo]);

  const update = (id: string, patch: Record<string, unknown>): void => {
    const coalesceKey = `update:${id}:${Object.keys(patch).join(',')}`;

    replace(
      blocks.map((block) =>
        block.id === id ? ({ ...block, ...patch } as EmailBlock) : block,
      ),
      coalesceKey,
    );
  };

  const moveTo = (from: number, to: number): void => {
    if (from === to) {
      return;
    }

    const moved = blocks[from];

    if (moved === undefined) {
      return;
    }

    const next = moveBlock(blocks, from, to);

    if (next === blocks) {
      return;
    }

    replace(next);
    setAnnouncement(
      `${blockLabel(moved.type)} dipindah ke posisi ${to + 1} dari ${blocks.length}.`,
    );
  };

  const move = (index: number, delta: number): void => {
    moveTo(index, index + delta);
  };

  const duplicate = (block: EmailBlock): void => {
    const index = blocks.findIndex((item) => item.id === block.id);
    const copy = { ...block, id: createBlock(block.type).id } as EmailBlock;
    const next = [...blocks];
    next.splice(index + 1, 0, copy);
    replace(next);
    setAnnouncement(`${blockLabel(block.type)} diduplikasi.`);
  };

  const remove = (block: EmailBlock): void => {
    replace(blocks.filter((item) => item.id !== block.id));
    setAnnouncement(`${blockLabel(block.type)} dihapus.`);
  };

  const add = (type: EmailBlockType): void => {
    replace([...blocks, createBlock(type)]);
    setAnnouncement(`${blockLabel(type)} ditambahkan.`);
  };

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap">
        <div>
          <div className="small fw-semibold">Block builder</div>
          <div className="small text-muted">
            Susun body dari blok. Tarik handle atau pakai tombol naik/turun. Gunakan mode HTML
            untuk loop/conditional lanjutan.
          </div>
        </div>
        <div className="d-flex align-items-center gap-1">
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={undo}
            disabled={!canUndo || readOnly}
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo perubahan block"
          >
            Undo
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={redo}
            disabled={!canRedo || readOnly}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo perubahan block"
          >
            Redo
          </Button>
          <Badge bg="light" text="dark" className="fw-normal">
            {blocks.length} blok
          </Badge>
        </div>
      </div>

      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>

      <div className="d-flex flex-wrap gap-1 mb-3">
        {BLOCK_TYPES.map((item) => (
          <Button
            key={item.type}
            size="sm"
            variant="outline-secondary"
            onClick={() => add(item.type)}
            disabled={readOnly}
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
            <Card
              key={block.id}
              className={[
                'block-card',
                dragIndex === index ? 'block-card--dragging' : '',
                dragIndex !== null && dropIndex === index && dragIndex !== index
                  ? 'block-card--drop-target'
                  : '',
              ]
                .filter((value) => value.length > 0)
                .join(' ')}
              onDragOver={(event) => {
                if (readOnly || dragIndex === null) {
                  return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropIndex(index);
              }}
              onDragLeave={() => {
                setDropIndex((current) => (current === index ? null : current));
              }}
              onDrop={(event) => {
                if (readOnly) {
                  return;
                }

                event.preventDefault();
                const raw = event.dataTransfer.getData('text/plain');
                const parsed = raw.length > 0 ? Number(raw) : NaN;
                const from = Number.isInteger(parsed) ? parsed : dragIndex;

                if (from !== null && from >= 0 && from < blocks.length) {
                  moveTo(from, index);
                }

                setDragIndex(null);
                setDropIndex(null);
              }}
            >
              <Card.Header className="d-flex align-items-center justify-content-between gap-2 py-2">
                <span className="d-flex align-items-center gap-2">
                  <span
                    className="block-drag-handle"
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(index));
                      setDragIndex(index);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    title="Tarik untuk memindahkan block"
                    aria-hidden="true"
                  >
                    ⋮⋮
                  </span>
                  <span className="small fw-semibold">
                    {index + 1}. {blockLabel(block.type)}
                  </span>
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
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => remove(block)}
                  >
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
