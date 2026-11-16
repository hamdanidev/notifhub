import { isNotifHubError, type NotifHubError } from '@notifhub/js';
import { DevApiError } from './dev-api';

export interface ErrorInfo {
  title: string;
  message: string;
  status?: number;
  requestId?: string | null;
  unauthorized: boolean;
}

function notifHubErrorInfo(error: NotifHubError): ErrorInfo {
  const retryHint =
    error.retryAfterMs === undefined
      ? ''
      : ` Coba lagi dalam sekitar ${Math.max(1, Math.ceil(error.retryAfterMs / 1000))} detik.`;

  switch (error.code) {
    case 'unauthorized':
      return {
        title: 'Sesi tidak valid atau kedaluwarsa (401)',
        message:
          'Server menolak subscriber token. Perbarui token lewat middleware dev, lalu sambungkan ulang.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: true,
      };
    case 'rate_limited':
      return {
        title: 'Terlalu banyak permintaan (429)',
        message: `Batas 60 request per menit tercapai.${retryHint}`,
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'network_error':
      return {
        title: 'Koneksi ke NotifHub gagal',
        message:
          'Tidak dapat menghubungi backend. Pastikan backend berjalan dan proxy Vite aktif, lalu coba lagi.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'server_error':
      return {
        title: 'Backend mengalami gangguan (5xx)',
        message: 'Coba lagi setelah backend dan Redis siap.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'forbidden':
      return {
        title: 'Akses ditolak (403)',
        message: 'Subscriber token tidak diizinkan untuk operasi ini.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'not_found':
      return {
        title: 'Data tidak ditemukan (404)',
        message: 'Notifikasi mungkin milik subscriber lain atau sudah tidak tersedia.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'bad_request':
      return {
        title: 'Permintaan tidak valid (400)',
        message: error.message,
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'aborted':
      return {
        title: 'Permintaan dibatalkan',
        message: 'Operasi dihentikan sebelum selesai.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
    case 'invalid_response':
      return {
        title: 'Respons server tidak dikenali',
        message: 'Kontrak respons berbeda dari yang diharapkan SDK.',
        status: error.status,
        requestId: error.requestId,
        unauthorized: false,
      };
  }
}

function devApiErrorInfo(error: DevApiError): ErrorInfo {
  if (error.kind === 'network') {
    return {
      title: 'Dev server tidak dapat dijangkau',
      message: 'Pastikan Vite dev server sample masih berjalan, lalu coba lagi.',
      unauthorized: false,
    };
  }

  if (error.kind === 'invalid_response') {
    return {
      title: 'Respons middleware dev tidak dikenali',
      message: error.message,
      status: error.status,
      requestId: error.requestId,
      unauthorized: false,
    };
  }

  if (error.status === 401) {
    return {
      title: 'Sesi ditolak (401)',
      message: error.message,
      status: error.status,
      requestId: error.requestId,
      unauthorized: true,
    };
  }

  if (error.status === 429) {
    return {
      title: 'Terlalu banyak permintaan (429)',
      message: error.message,
      status: error.status,
      requestId: error.requestId,
      unauthorized: false,
    };
  }

  if (error.status === 502 || error.status === 503) {
    return {
      title: `Layanan pendukung belum siap (${error.status})`,
      message: error.message,
      status: error.status,
      requestId: error.requestId,
      unauthorized: false,
    };
  }

  return {
    title: error.status === undefined ? 'Permintaan gagal' : `Permintaan gagal (${error.status})`,
    message: error.message,
    status: error.status,
    requestId: error.requestId,
    unauthorized: false,
  };
}

export function describeError(error: unknown): ErrorInfo {
  if (isNotifHubError(error)) {
    return notifHubErrorInfo(error);
  }

  if (error instanceof DevApiError) {
    return devApiErrorInfo(error);
  }

  if (error instanceof Error) {
    return {
      title: 'Terjadi kesalahan',
      message: error.message,
      unauthorized: false,
    };
  }

  return {
    title: 'Terjadi kesalahan',
    message: 'Penyebab error tidak dikenali. Periksa console dev server dan log backend.',
    unauthorized: false,
  };
}
