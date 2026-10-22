CREATE TABLE "assist_settings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"consented_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assist_cache" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_date" text NOT NULL,
	"rehearsal" boolean NOT NULL,
	"broadcast_id" text NOT NULL,
	"text_hash" text NOT NULL,
	"no" integer NOT NULL,
	"suggestion" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assist_cache_uq" UNIQUE("seller_id","scope_date","rehearsal","broadcast_id","text_hash","no")
);
--> statement-breakpoint
CREATE TABLE "assist_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"day" text NOT NULL,
	"items" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"ok" boolean,
	"failure" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assist_settings" ADD CONSTRAINT "assist_settings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assist_cache" ADD CONSTRAINT "assist_cache_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assist_calls" ADD CONSTRAINT "assist_calls_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assist_calls_day_idx" ON "assist_calls" USING btree ("day","seller_id");
