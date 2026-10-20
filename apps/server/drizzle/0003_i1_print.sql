-- I1: 서버 출력 기록 (LABEL_RULES L-11, D-I1-01~D-I1-10) — 출력 대기열·라벨 키·작업·시도·라벨 템플릿·출력 요청 번호. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 발송함(outbox) 표는 바꾸지 않는다(Y1 트랙과 겹치지 않게). 모든 표에 판매자 ID가 있다(SYS-02).
CREATE TABLE "print_queues" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"device_id" text,
	"device_name" text,
	"printer_connected" boolean DEFAULT false NOT NULL,
	"releasing" boolean DEFAULT false NOT NULL,
	"paused" text,
	"backlog" boolean DEFAULT false NOT NULL,
	"next_order" bigint DEFAULT 1 NOT NULL,
	"front_order" bigint DEFAULT 0 NOT NULL,
	"rev" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_labels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"date" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"claim" text,
	"version" integer,
	"broadcast" text,
	"no" integer,
	"buyer_id" text,
	"buyer" text NOT NULL,
	"effect_id" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "print_labels_key_uq" UNIQUE("seller_id","scope_id","key")
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"label_id" bigint NOT NULL,
	"date" text NOT NULL,
	"job_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"data" text,
	"page" integer,
	"pages" integer,
	"per_page" integer,
	"queue_order" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"printed_at" timestamp with time zone,
	"device_name" text,
	"content_key" text,
	"printed_data" text,
	"discarded_at" timestamp with time zone,
	"discarded_by" text,
	"requested_by" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "print_jobs_job_uq" UNIQUE("seller_id","scope_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "print_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"job_ref" bigint NOT NULL,
	"token" text NOT NULL,
	"device_id" text NOT NULL,
	"device_name" text NOT NULL,
	"data" text NOT NULL,
	"content_key" text NOT NULL,
	"result" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "print_attempts_token_uq" UNIQUE("seller_id","token")
);
--> statement-breakpoint
CREATE TABLE "label_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "label_templates_kind_uq" UNIQUE("seller_id","kind")
);
--> statement-breakpoint
CREATE TABLE "print_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "print_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "print_queues" ADD CONSTRAINT "print_queues_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_labels" ADD CONSTRAINT "print_labels_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_labels" ADD CONSTRAINT "print_labels_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_label_id_print_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."print_labels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_attempts" ADD CONSTRAINT "print_attempts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_attempts" ADD CONSTRAINT "print_attempts_job_ref_print_jobs_id_fk" FOREIGN KEY ("job_ref") REFERENCES "public"."print_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_labels_scope_idx" ON "print_labels" USING btree ("seller_id","scope_id","kind");--> statement-breakpoint
CREATE INDEX "print_jobs_queue_idx" ON "print_jobs" USING btree ("seller_id","status","queue_order");--> statement-breakpoint
CREATE INDEX "print_jobs_label_idx" ON "print_jobs" USING btree ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_one_printing_uq" ON "print_jobs" USING btree ("seller_id") WHERE status = 'PRINTING';--> statement-breakpoint
CREATE INDEX "print_attempts_job_idx" ON "print_attempts" USING btree ("job_ref");
