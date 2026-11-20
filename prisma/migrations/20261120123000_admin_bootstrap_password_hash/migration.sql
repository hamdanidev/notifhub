-- Lacak hash env terakhir agar rotasi env tetap bekerja tanpa menimpa password yang diubah dari UI.
ALTER TABLE "AdminUser" ADD COLUMN "bootstrapPasswordHash" TEXT;
