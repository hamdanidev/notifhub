-- Allow the tenant approver role on the tenant lane (still requires a tenant).
ALTER TABLE "AdminUser" DROP CONSTRAINT "AdminUser_role_tenant_check";

ALTER TABLE "AdminUser"
  ADD CONSTRAINT "AdminUser_role_tenant_check"
  CHECK (
    ("role" = 'platform_admin' AND "tenantId" IS NULL) OR
    ("role" IN ('tenant_admin', 'tenant_approver') AND "tenantId" IS NOT NULL)
  );