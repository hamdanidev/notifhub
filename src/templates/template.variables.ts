import { z } from 'zod';
import {
  TemplateRenderError,
  type TemplateValidationIssue,
  type TemplateVariableDefinition,
  type TemplateVariableSchema,
  type TemplateVariableType,
} from './template.types';

export const VARIABLE_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$/;
const MAX_VARIABLES = 100;
const MAX_DESCRIPTION = 200;

const variableDefinitionSchema = z
  .object({
    key: z.string().regex(VARIABLE_KEY_PATTERN, 'variable key is invalid'),
    type: z.enum(['string', 'number', 'boolean', 'date', 'url', 'email', 'array']),
    required: z.boolean().optional(),
    description: z.string().max(MAX_DESCRIPTION).optional(),
    example: z.unknown().optional(),
    default: z.unknown().optional(),
    pii: z.boolean().optional(),
  })
  .strict();

const variableSchema = z
  .object({
    version: z.number().int().positive().optional(),
    variables: z.array(variableDefinitionSchema).max(MAX_VARIABLES),
  })
  .strict();

export interface ParsedVariableSchema {
  schema: TemplateVariableSchema;
  issues: TemplateValidationIssue[];
}

export function parseVariableSchema(value: unknown): ParsedVariableSchema {
  if (value === null || value === undefined) {
    return { schema: { variables: [] }, issues: [] };
  }

  const parsed = variableSchema.safeParse(value);

  if (!parsed.success) {
    return {
      schema: { variables: [] },
      issues: parsed.error.issues.map((issue) => ({
        code: 'invalid_variable_schema',
        path: issue.path.join('.') || 'variables',
        message: issue.message,
        severity: 'error' as const,
      })),
    };
  }

  const seen = new Set<string>();
  const issues: TemplateValidationIssue[] = [];

  for (const variable of parsed.data.variables) {
    if (seen.has(variable.key)) {
      issues.push({
        code: 'duplicate_variable',
        path: variable.key,
        message: `variable key "${variable.key}" dideklarasikan lebih dari sekali`,
        severity: 'error',
      });
    }
    seen.add(variable.key);
  }

  return { schema: parsed.data, issues };
}

export function collectReferencedVariables(sources: string[]): string[] {
  const references = new Set<string>();

  for (const source of sources) {
    const matches = source.matchAll(/\{\{\{?\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}?\}\}/g);

    for (const match of matches) {
      const name = match[1]?.trim();

      if (name === undefined || name.length === 0) {
        continue;
      }

      if (name.startsWith('@') || name === 'this' || name === 'body') {
        continue;
      }

      references.add(name);
    }
  }

  return [...references].sort();
}

export function validateSampleData(
  schema: TemplateVariableSchema,
  sampleData: unknown,
): TemplateValidationIssue[] {
  if (sampleData === null || sampleData === undefined) {
    const required = schema.variables.filter((variable) => variable.required === true);

    return required.map((variable) => ({
      code: 'missing_sample_data',
      path: variable.key,
      message: `sampleData wajib mengisi variabel required "${variable.key}"`,
      severity: 'error' as const,
    }));
  }

  if (!isRecord(sampleData)) {
    return [
      {
        code: 'invalid_sample_data',
        path: 'sampleData',
        message: 'sampleData harus berupa objek JSON',
        severity: 'error',
      },
    ];
  }

  const issues: TemplateValidationIssue[] = [];

  for (const variable of schema.variables) {
    const value = getPath(sampleData, variable.key);

    if (value === undefined || value === null) {
      if (variable.required === true) {
        issues.push({
          code: 'missing_required_variable',
          path: variable.key,
          message: `sampleData wajib mengisi variabel required "${variable.key}"`,
          severity: 'error',
        });
      }
      continue;
    }

    if (!isValidType(variable.type, value)) {
      issues.push({
        code: 'invalid_variable_value',
        path: variable.key,
        message: `nilai sampleData untuk "${variable.key}" bukan ${variable.type}`,
        severity: 'error',
      });
    }
  }

  return issues;
}

export function prepareTemplateData(
  schema: TemplateVariableSchema,
  input: Record<string, unknown>,
  strict: boolean,
): {
  data: Record<string, unknown>;
  missing: string[];
  issues: TemplateValidationIssue[];
} {
  const data = cloneRecord(input);
  const missing: string[] = [];
  const issues: TemplateValidationIssue[] = [];

  for (const variable of schema.variables) {
    const value = getPath(data, variable.key);

    if (value === undefined || value === null) {
      if (variable.required === true) {
        missing.push(variable.key);
        issues.push({
          code: 'missing_required_variable',
          path: variable.key,
          message: `variabel required "${variable.key}" tidak tersedia`,
          severity: strict ? 'error' : 'warning',
        });

        const fallback =
          variable.default !== undefined ? variable.default : variable.type === 'array' ? [] : '';
        setPath(data, variable.key, fallback);
      }
      continue;
    }

    if (!isValidType(variable.type, value)) {
      issues.push({
        code: 'invalid_variable_value',
        path: variable.key,
        message: `nilai variabel "${variable.key}" bukan ${variable.type}`,
        severity: strict ? 'error' : 'warning',
      });

      if (strict) {
        continue;
      }

      if (variable.default !== undefined) {
        setPath(data, variable.key, variable.default);
      }
    }
  }

  if (strict && issues.some((issue) => issue.severity === 'error')) {
    throw new TemplateRenderError(
      'template_variable_missing',
      `template variables are missing or invalid: ${issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.path)
        .join(', ')}`,
      missing,
    );
  }

  return { data, missing, issues };
}

export function variableDefinition(
  schema: TemplateVariableSchema,
  key: string,
): TemplateVariableDefinition | undefined {
  return schema.variables.find((variable) => variable.key === key);
}

export function getPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;

  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];

    if (!isRecord(child)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1];

  if (last !== undefined) {
    current[last] = value;
  }
}

function isValidType(type: TemplateVariableType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'url':
      return isValidUrl(value);
    case 'email':
      return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
}

function isValidUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cloneRecord(input: Record<string, unknown>): Record<string, unknown> {
  const cloned = cloneValue(input);

  return isRecord(cloned) ? cloned : {};
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }

      next[key] = cloneValue(child);
    }

    return next;
  }

  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
