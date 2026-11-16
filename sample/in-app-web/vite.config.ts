import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const sampleRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sampleRoot, '..', '..');
const tokenHelperPath = path.join(repoRoot, 'scripts', 'dev-subscriber-token.mjs');
const SESSION_PATH = '/dev/session';
const NOTIFY_PATH = '/dev/notify';
const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_TIMEOUT_MS = 15_000;
const BACKEND_TIMEOUT_MS = 10_000;
const DEFAULT_BACKEND_PORT = 3000;
const TEST_CHANNELS = ['inapp', 'email', 'whatsapp'] as const;

type RootEnv = Record<string, string | undefined>;
type TestChannel = (typeof TEST_CHANNELS)[number];

class DevEndpointError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = 'DevEndpointError';
  }
}

interface SessionResult {
  token: string;
  tokenType: 'Bearer';
  recipientId: string;
  tenant: string;
  expiresAt: string;
}

interface NotifyResult {
  notification_id: string;
  status: 'accepted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTestChannel(value: string): value is TestChannel {
  return (TEST_CHANNELS as readonly string[]).includes(value);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(payload));
}

function readString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  label: string,
  required: true,
): string;
function readString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  label: string,
  required: false,
): string | undefined;
function readString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  label: string,
  required: boolean,
): string | undefined {
  const raw = source[key];

  if (raw === undefined || raw === null) {
    if (required) {
      throw new DevEndpointError(400, `${label} wajib diisi.`);
    }

    return undefined;
  }

  if (typeof raw !== 'string') {
    throw new DevEndpointError(400, `${label} harus berupa string.`);
  }

  const value = raw.trim();

  if (value.length === 0) {
    if (required) {
      throw new DevEndpointError(400, `${label} wajib diisi.`);
    }

    return undefined;
  }

  if (value.length > maxLength) {
    throw new DevEndpointError(400, `${label} maksimal ${maxLength} karakter.`);
  }

  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new DevEndpointError(400, `${label} mengandung karakter yang tidak valid.`);
  }

  return value;
}

function readQuery(url: URL): Record<string, unknown> {
  return {
    recipientId: url.searchParams.get('recipientId') ?? undefined,
    tenant: url.searchParams.get('tenant') ?? undefined,
  };
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let tooLarge = false;

    request.on('data', (chunk: Buffer) => {
      if (tooLarge) {
        return;
      }

      totalBytes += chunk.length;

      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      if (tooLarge) {
        reject(new DevEndpointError(413, 'Request body terlalu besar.'));
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');

      if (raw.trim().length === 0) {
        reject(new DevEndpointError(400, 'Request body JSON wajib diisi.'));
        return;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new DevEndpointError(400, 'Request body bukan JSON yang valid.'));
        return;
      }

      if (!isRecord(parsed)) {
        reject(new DevEndpointError(400, 'Request body harus berupa objek JSON.'));
        return;
      }

      resolve(parsed);
    });

    request.on('error', () => {
      reject(new DevEndpointError(400, 'Gagal membaca request body.'));
    });
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') {
    throw new DevEndpointError(405, 'Method tidak didukung. Gunakan POST.');
  }

  const contentType = request.headers['content-type'] ?? '';

  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new DevEndpointError(415, 'Content-Type harus application/json.');
  }

  return readBody(request);
}

function runTokenHelper(recipientId: string, tenant: string, rootEnv: RootEnv): Promise<string> {
  if (!existsSync(tokenHelperPath)) {
    return Promise.reject(
      new DevEndpointError(
        500,
        'Helper token dev tidak ditemukan. Jalankan sample dari dalam repository NotifHub.',
      ),
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [tokenHelperPath, recipientId, tenant],
      {
        cwd: repoRoot,
        env: { ...process.env, ...rootEnv },
        timeout: TOKEN_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(
            new DevEndpointError(
              502,
              'Gagal menerbitkan token. Pastikan PostgreSQL berjalan, migrasi/seed sudah dijalankan, dan .env root tersedia.',
            ),
          );
          return;
        }

        resolve(stdout);
      },
    );
  });
}

function readJwtExpiry(token: string): string {
  const parts = token.split('.');

  if (parts.length !== 3 || parts[1] === undefined) {
    throw new DevEndpointError(502, 'Helper token mengembalikan token yang tidak valid.');
  }

  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new DevEndpointError(502, 'Helper token mengembalikan token yang tidak valid.');
  }

  if (!isRecord(payload) || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new DevEndpointError(502, 'Token dev tidak memiliki klaim exp yang valid.');
  }

  return new Date(payload.exp * 1000).toISOString();
}

async function mintSession(
  recipientId: string,
  tenant: string,
  rootEnv: RootEnv,
): Promise<SessionResult> {
  const stdout = await runTokenHelper(recipientId, tenant, rootEnv);
  const token = stdout.trim();

  if (token.length === 0) {
    throw new DevEndpointError(502, 'Helper token tidak mengembalikan token.');
  }

  return {
    token,
    tokenType: 'Bearer',
    recipientId,
    tenant,
    expiresAt: readJwtExpiry(token),
  };
}

function parseUpstreamJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const raw = payload.message;

  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.slice(0, 500);
  }

  if (Array.isArray(raw)) {
    const parts = raw.filter((part): part is string => typeof part === 'string');

    if (parts.length > 0) {
      return parts.join('; ').slice(0, 500);
    }
  }

  return undefined;
}

function extractRequestId(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.requestId !== 'string') {
    return null;
  }

  return payload.requestId;
}

function isNotifyResult(payload: unknown): payload is NotifyResult {
  return (
    isRecord(payload) &&
    typeof payload.notification_id === 'string' &&
    payload.notification_id.length > 0 &&
    payload.status === 'accepted'
  );
}

async function handleSession(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  rootEnv: RootEnv,
): Promise<void> {
  let source: Record<string, unknown>;

  if (request.method === 'GET') {
    source = readQuery(url);
  } else if (request.method === 'POST') {
    source = await readJsonBody(request);
  } else {
    response.setHeader('Allow', 'GET, POST');
    throw new DevEndpointError(405, 'Method tidak didukung. Gunakan GET atau POST.');
  }

  const recipientId = readString(source, 'recipientId', 128, 'recipientId', true);
  const tenant = readString(source, 'tenant', 64, 'tenant', false) ?? rootEnv.DEFAULT_TENANT_ID?.trim() ?? 'default';

  if (tenant.length === 0) {
    throw new DevEndpointError(400, 'tenant tidak boleh kosong.');
  }

  const result = await mintSession(recipientId, tenant, rootEnv);
  sendJson(response, 200, result);
}

async function handleNotify(
  request: IncomingMessage,
  response: ServerResponse,
  rootEnv: RootEnv,
  backendUrl: string,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    throw new DevEndpointError(405, 'Method tidak didukung. Gunakan POST.');
  }

  const body = await readJsonBody(request);
  const recipientId = readString(body, 'recipientId', 128, 'recipientId', true);
  const channelRaw = readString(body, 'channel', 16, 'channel', true).toLowerCase();

  if (!isTestChannel(channelRaw)) {
    throw new DevEndpointError(400, 'channel harus salah satu dari inapp, email, atau whatsapp.');
  }

  const channel: TestChannel = channelRaw;
  const name = readString(body, 'name', 80, 'name', false) ?? 'Pengguna Sample';
  const apiKey = rootEnv.SERVICE_API_KEY?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    throw new DevEndpointError(
      503,
      'SERVICE_API_KEY belum diisi di .env root. Sample tidak dapat mengirim notifikasi.',
    );
  }

  const payload = {
    idempotency_key: `sample-${Date.now()}-${randomUUID()}`,
    template_key: 'test.notification',
    recipients: [recipientId],
    channels: [channel],
    data: { nama: name },
    priority: 'normal',
  };

  let upstream: Response;

  try {
    upstream = await fetch(`${backendUrl}/api/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
  } catch {
    throw new DevEndpointError(
      502,
      `Tidak dapat menghubungi backend di ${backendUrl}. Pastikan npm run start:dev berjalan.`,
    );
  }

  const text = await upstream.text();
  const parsed = parseUpstreamJson(text);

  if (!upstream.ok) {
    throw new DevEndpointError(
      upstream.status,
      extractMessage(parsed) ?? `Backend menolak request dengan status ${upstream.status}.`,
      extractRequestId(parsed),
    );
  }

  if (upstream.status !== 202 || !isNotifyResult(parsed)) {
    throw new DevEndpointError(502, 'Backend mengembalikan respons notify yang tidak dikenali.');
  }

  sendJson(response, 202, { notification_id: parsed.notification_id, status: parsed.status });
}

async function routeDevRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  rootEnv: RootEnv,
  backendUrl: string,
): Promise<void> {
  if (url.pathname === SESSION_PATH) {
    await handleSession(request, response, url, rootEnv);
    return;
  }

  if (url.pathname === NOTIFY_PATH) {
    await handleNotify(request, response, rootEnv, backendUrl);
    return;
  }

  throw new DevEndpointError(404, 'Endpoint dev tidak ditemukan.');
}

function normalizeDevError(error: unknown): DevEndpointError {
  if (error instanceof DevEndpointError) {
    return error;
  }

  return new DevEndpointError(500, 'Terjadi kesalahan internal pada middleware sample.');
}

function createDevEndpointPlugin(rootEnv: RootEnv, backendUrl: string): Plugin {
  return {
    name: 'notifhub-sample-dev-endpoints',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let url: URL;

        try {
          url = new URL(request.url ?? '/', 'http://127.0.0.1');
        } catch {
          next();
          return;
        }

        if (url.pathname !== SESSION_PATH && url.pathname !== NOTIFY_PATH) {
          next();
          return;
        }

        void routeDevRequest(request, response, url, rootEnv, backendUrl).catch((error: unknown) => {
          const normalized = normalizeDevError(error);

          if (normalized.status >= 500) {
            server.config.logger.error(`[sample dev] ${normalized.message}`);
          }

          if (!response.headersSent) {
            sendJson(response, normalized.status, {
              error: {
                status: normalized.status,
                message: normalized.message,
                requestId: normalized.requestId,
              },
            });
            return;
          }

          response.end();
        });
      });
    },
  };
}

function resolveBackendUrl(rootEnv: RootEnv): string {
  const configured = rootEnv.NOTIFHUB_SAMPLE_API_URL?.trim();
  const fallbackPort = rootEnv.PORT?.trim() ?? String(DEFAULT_BACKEND_PORT);
  const raw = configured !== undefined && configured.length > 0
    ? configured
    : `http://127.0.0.1:${fallbackPort}`;

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`NOTIFHUB_SAMPLE_API_URL bukan URL yang valid: ${raw}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('NOTIFHUB_SAMPLE_API_URL harus memakai http atau https.');
  }

  return parsed.origin;
}

export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, repoRoot, '');
  const rootEnv: RootEnv = { ...process.env, ...loaded };
  const backendUrl = resolveBackendUrl(rootEnv);

  return {
    envDir: repoRoot,
    plugins: [react(), createDevEndpointPlugin(rootEnv, backendUrl)],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4174,
      strictPort: true,
    },
    build: {
      sourcemap: false,
    },
  };
});
