import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { CleanupService } from '../src/cleanup/cleanup.service';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('admin audit cleanup', () => {
  it('retensi 0 tidak membaca atau menghapus event audit', async () => {
    const findMany = jest.fn();
    const deleteMany = jest.fn();
    const prisma = {
      adminAuditEvent: { findMany, deleteMany },
    } as unknown as PrismaService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue(0),
    } as unknown as ConfigService;
    const info = jest.fn();
    const logger = {
      setContext: jest.fn(),
      info,
    } as unknown as PinoLogger;

    const service = new CleanupService(prisma, config, logger);
    const result = await service.runAdminAuditCleanup();

    expect(result).toEqual({ deleted: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'admin.audit.cleanup',
        retention_days: 0,
        cutoff: null,
        deleted: 0,
      }),
      expect.any(String),
    );
  });
});
