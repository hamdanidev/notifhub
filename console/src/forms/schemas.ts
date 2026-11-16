import { z } from 'zod';

export const CHANNELS = ['inapp', 'email', 'whatsapp', 'sms'] as const;
export const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export const QUIET_HOURS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const loginSchema = z.object({
  email: z.string().trim().email('Email tidak valid'),
  password: z.string().min(8, 'Minimal 8 karakter'),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const templateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key wajib diisi')
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/, 'Format key tidak valid'),
  channel: z.enum(CHANNELS),
  locale: z.string().trim().min(1, 'Locale wajib diisi').max(16),
  subject: z.string().trim().max(255).optional(),
  body: z.string().min(1, 'Body wajib diisi'),
  version: z.string().trim().optional(),
  fallbackChannel: z.union([z.enum(CHANNELS), z.literal('')]).optional(),
  fallbackProvider: z.string().trim().max(64).optional(),
});

export type TemplateValues = z.infer<typeof templateSchema>;

export const apiKeySchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(80),
  allowedOrigins: z.string().trim().optional(),
});

export type ApiKeyValues = z.infer<typeof apiKeySchema>;

export function isValidQuietHoursPair(start: string, end: string): boolean {
  if (start.length === 0 && end.length === 0) {
    return true;
  }

  return QUIET_HOURS_PATTERN.test(start) && QUIET_HOURS_PATTERN.test(end);
}
