import type { ExportNotificationRow } from '@notifhub/js';

export type { ExportNotificationRow } from '@notifhub/js';

const CSV_HEADERS = [
  'id',
  'created_at',
  'template_key',
  'status',
  'target_type',
  'priority',
  'recipient_count',
  'sent_count',
  'failed_count',
  'pending_count',
  'skipped_count',
] as const;

/** Quote a CSV cell and neutralise spreadsheet formulas. */
function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function notificationsToCsv(rows: ExportNotificationRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.createdAt,
        row.templateKey,
        row.overallStatus,
        row.targetType,
        row.priority,
        row.recipientCount,
        row.sentCount,
        row.failedCount,
        row.pendingCount,
        row.skippedCount,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

export function exportFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');

  return `notifhub-notifications-${stamp.slice(0, 8)}-${stamp.slice(8)}.csv`;
}

export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
