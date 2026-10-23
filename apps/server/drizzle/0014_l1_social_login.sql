CREATE TABLE "login_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "login_links_provider_user_uq" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "login_links_account_provider_uq" UNIQUE("account_id","provider")
);
--> statement-breakpoint
CREATE TABLE "login_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"browser_hash" text NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"seller_id" text,
	"account_id" text,
	"session_hash" text,
	"verifier_enc" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "method" text DEFAULT 'PASSWORD' NOT NULL;--> statement-breakpoint
ALTER TABLE "login_links" ADD CONSTRAINT "login_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_links" ADD CONSTRAINT "login_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_states" ADD CONSTRAINT "login_states_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_states" ADD CONSTRAINT "login_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_links_seller_idx" ON "login_links" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "login_states_expires_idx" ON "login_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_method_idx" ON "sessions" USING btree ("account_id","method");
