-- S04 첫 스키마 (AC-S04-20). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
CREATE TABLE "sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone_key_enc" text NOT NULL,
	"settings" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"login_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_login_id_uq" UNIQUE("login_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"extended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scopes_seller_date_uq" UNIQUE("seller_id","date")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"start_seq" integer NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	"at" bigint NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"account_id" text,
	"request_id" text,
	"chat_broadcast" text,
	"chat_message_id" text,
	"sms_ref" text,
	"changed" boolean NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "events_scope_seq_uq" UNIQUE("scope_id","seq"),
	CONSTRAINT "events_request_uq" UNIQUE("seller_id","request_id"),
	CONSTRAINT "events_chat_uq" UNIQUE("seller_id","chat_broadcast","chat_message_id"),
	CONSTRAINT "events_sms_ref_uq" UNIQUE("seller_id","sms_ref")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"effect_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outbox_effect_uq" UNIQUE("seller_id","scope_id","effect_id")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"seq" integer NOT NULL,
	"format" integer NOT NULL,
	"state" text NOT NULL,
	"attention" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "snapshots_scope_seq_uq" UNIQUE("scope_id","seq")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scopes" ADD CONSTRAINT "scopes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_seller_idx" ON "accounts" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_seller_idx" ON "sessions" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "broadcasts_seller_idx" ON "broadcasts" USING btree ("seller_id","date","start_seq");--> statement-breakpoint
CREATE INDEX "outbox_scope_seq_idx" ON "outbox" USING btree ("scope_id","seq");
