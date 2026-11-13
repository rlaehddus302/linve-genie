ALTER TABLE "print_attempts" ADD COLUMN IF NOT EXISTS "fail_reason" text;--> statement-breakpoint
ALTER TABLE "print_attempts" ADD COLUMN IF NOT EXISTS "fail_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_attempts" ADD COLUMN IF NOT EXISTS "fail_detail" text;
