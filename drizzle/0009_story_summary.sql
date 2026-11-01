-- Use one story-summary field; historical text moves without pretending it has been reverified.
ALTER TABLE stories RENAME COLUMN hook TO summary;

UPDATE reader_sessions
SET document=json_remove(json_set(document,'$.plan.summary',
 CASE WHEN json_type(document,'$.plan.summary')='text' AND length(trim(json_extract(document,'$.plan.summary')))>0 THEN json_extract(document,'$.plan.summary') ELSE json_extract(document,'$.plan.hook') END),'$.plan.hook')
WHERE CASE WHEN json_valid(document) THEN json_type(document,'$.plan.hook') IS NOT NULL ELSE 0 END;

UPDATE reader_sessions
SET document=json_remove(json_set(document,'$.draft.summary',
 CASE WHEN json_type(document,'$.draft.summary')='text' AND length(trim(json_extract(document,'$.draft.summary')))>0 THEN json_extract(document,'$.draft.summary') ELSE json_extract(document,'$.draft.hook') END),'$.draft.hook')
WHERE CASE WHEN json_valid(document) THEN json_type(document,'$.draft.hook') IS NOT NULL ELSE 0 END;

UPDATE reader_sessions
SET document=json_remove(json_set(document,'$.storyboard.outline.summary',
 CASE WHEN json_type(document,'$.storyboard.outline.summary')='text' AND length(trim(json_extract(document,'$.storyboard.outline.summary')))>0 THEN json_extract(document,'$.storyboard.outline.summary') ELSE json_extract(document,'$.storyboard.outline.hook') END),'$.storyboard.outline.hook')
WHERE CASE WHEN json_valid(document) THEN json_type(document,'$.storyboard.outline.hook') IS NOT NULL ELSE 0 END;

UPDATE reader_sessions
SET document=json_remove(json_set(document,'$.revision.base.plan.summary',
 CASE WHEN json_type(document,'$.revision.base.plan.summary')='text' AND length(trim(json_extract(document,'$.revision.base.plan.summary')))>0 THEN json_extract(document,'$.revision.base.plan.summary') ELSE json_extract(document,'$.revision.base.plan.hook') END),'$.revision.base.plan.hook')
WHERE CASE WHEN json_valid(document) THEN json_type(document,'$.revision.base.plan.hook') IS NOT NULL ELSE 0 END;
