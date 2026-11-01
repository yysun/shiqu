-- Rename only the direct-selection shelf label, including saved revision metadata.
-- Keep production requirements, story content, progress and generation controls intact.
UPDATE reader_sessions
SET selection=json_set(selection,'$.theme','原典故事')
WHERE CASE WHEN json_valid(selection) THEN json_extract(selection,'$.theme')='忠于原文' ELSE 0 END;

UPDATE reader_sessions
SET document=json_set(document,'$.revision.base.selection.theme','原典故事')
WHERE CASE WHEN json_valid(document) THEN json_extract(document,'$.revision.base.selection.theme')='忠于原文' ELSE 0 END;

UPDATE stories SET theme='原典故事' WHERE theme='忠于原文';
