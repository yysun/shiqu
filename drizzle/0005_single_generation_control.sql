-- Preserve old reader checkpoints without turning a library upgrade into new paid work.
-- Existing background intent and manual pauses/stops remain authoritative.
UPDATE reader_sessions
SET generation_control=CASE
 WHEN generation_control='active' AND state!='completed' THEN 'paused'
 ELSE generation_control
END,
generation_mode='background'
WHERE generation_mode='reader';
