import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AdminPrincipal, RequestWithAdmin } from '../../auth/admin/admin.types';

/** Injects the authenticated tenant admin (set by AdminJwtGuard). */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();

    if (request.admin === undefined) {
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    return request.admin;
  },
);
