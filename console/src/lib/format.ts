import { isNotifHubError } from '@notifhub/js';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '—';
  }

  const date = parseISO(value);

  return Number.isNaN(date.getTime()) ? value : format(date, 'yyyy-MM-dd HH:mm:ss');
}

export function formatRelative(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '—';
  }

  const date = parseISO(value);

  return Number.isNaN(date.getTime())
    ? value
    : formatDistanceToNowStrict(date, { addSuffix: true });
}

export function formatDay(value: string): string {
  const date = parseISO(value);

  return Number.isNaN(date.getTime()) ? value : format(date, 'yyyy-MM-dd');
}

export function describeError(error: unknown): string {
  if (isNotifHubError(error)) {
    switch (error.code) {
      case 'unauthorized':
        return 'Sesi berakhir. Silakan login kembali.';
      case 'forbidden':
        return 'Akses ditolak.';
      case 'not_found':
        return 'Data tidak ditemukan.';
      case 'rate_limited':
        return 'Terlalu banyak percobaan. Coba lagi sebentar.';
      case 'network_error':
        return 'Tidak dapat menghubungi NotifHub.';
      case 'bad_request':
        return error.message;
      default:
        return error.message;
    }
  }

  return error instanceof Error ? error.message : 'Terjadi kesalahan tidak dikenal.';
}

export function asString(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}
