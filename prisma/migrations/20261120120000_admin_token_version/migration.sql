-- Invalidasi sesi admin: token membawa tokenVersion; password berubah/reset menaikkan nilai ini.
ALTER TABLE "AdminUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
