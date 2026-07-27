ALTER TABLE psychotherapy_appointments DROP COLUMN meet_space_name;
DROP INDEX idx_transcription_jobs_status_next;
DROP INDEX uq_transcription_job_active;
DROP TABLE transcription_jobs;
DROP TABLE transcription_integrations;
