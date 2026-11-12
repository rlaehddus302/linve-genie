ALTER TABLE "print_queues" ADD COLUMN IF NOT EXISTS "hide_nickname_suffix" boolean NOT NULL DEFAULT false;
