import { describe, expect, it } from 'vitest';
import {
  exportFileName,
  notificationsToCsv,
  type ExportNotificationRow,
} from './adminExport';

const base: ExportNotificationRow = {
  id: '11111111-1111-1111-1111-111111111111',
  createdAt: '2026-11-20T12:00:00.000Z',
  templateKey: 'order.shipped',
  overallStatus: 'sent',
  targetType: 'recipients',
  priority: 3,
  recipientCount: 2,
  sentCount: 1,
  failedCount: 1,
  pendingCount: 0,
  skippedCount: 0,
};

describe('notificationsToCsv', () => {
  it('writes the header and one quoted row per notification', () => {
    const csv = notificationsToCsv([base]);

    expect(csv.startsWith('"id","created_at","template_key"')).toBe(true);
    expect(csv).toContain('"order.shipped"');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('neutralises spreadsheet formulas and escapes quotes', () => {
    const csv = notificationsToCsv([
      {
        ...base,
        id: '=SUM(A1)',
        templateKey: 'a"b',
        targetType: '+cmd',
      },
    ]);

    expect(csv).toContain(`"'=SUM(A1)"`);
    expect(csv).toContain(`"a""b"`);
    expect(csv).toContain(`"'+cmd"`);
  });

  it('keeps commas/newlines inside quoted cells', () => {
    const csv = notificationsToCsv([{ ...base, targetType: 'x,y\nz' }]);

    expect(csv).toContain(`"x,y\nz"`);
  });

  it('emits only the header when there are no rows', () => {
    const csv = notificationsToCsv([]);

    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).not.toContain('11111111');
  });
});

describe('exportFileName', () => {
  it('uses the UTC timestamp', () => {
    expect(exportFileName(new Date('2026-11-20T12:34:00Z'))).toBe(
      'notifhub-notifications-20261120-1234.csv',
    );
  });
});
