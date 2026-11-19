import type { PrismaService } from '../prisma/prisma.service';

/**
 * Ensures the tenant row referenced by `tenantId` exists.
 *
 * Every table with a `tenantId` has a foreign key to `Tenant`, so bootstrap paths (admin user,
 * bootstrap API key) and the seed must create the tenant row before writing tenant-owned rows.
 * The operation is idempotent and safe to call from several bootstrap hooks in any order: the
 * primary-key conflict is the "already exists" signal, so there is no select-then-insert race.
 */
export async function ensureTenant(
  prisma: PrismaService,
  tenantId: string,
): Promise<'created' | 'existing'> {
  try {
    await prisma.tenant.create({
      data: { id: tenantId, name: tenantId },
      select: { id: true },
    });

    return 'created';
  } catch (error) {
    if (isUniqueViolation(error)) {
      return 'existing';
    }

    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
