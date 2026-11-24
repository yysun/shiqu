-- 家族根记录保存书架封面，后续制作修订沿用这一独立设置。
ALTER TABLE stories ADD COLUMN shelf_cover TEXT;
