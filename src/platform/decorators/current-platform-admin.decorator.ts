import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  PlatformAdminPrincipal,
  RequestWithPlatformAdmin,
} from '../../auth/admin/admin.types';

/** Injects the authenticated platform admin (set by PlatformAdminGuard). */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformAdminPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithPlatformAdmin>();

    if (request.platformAdmin === undefined) {
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    return request.platformAdmin;
  },
);
