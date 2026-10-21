-- N5: 요금 원장 (BILLING_RULES BL-0~BL-8, D-N5-01~D-N5-14) — 이용권·회수·쓴 기록·방송의 이용 방식·결제 주문·사업자 정보·증빙 요청·요금 요청 번호.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 이벤트·발송함·스냅샷·출력 작업 표는 바꾸지 않는다. 모든 표에 판매자 ID가 있다(SYS-02).
CREATE TABLE "billing_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer,
	"source" text NOT NULL,
	"payment_id" text,
	"reason" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_grants_payment_uq" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "billing_revocations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_revocations_grant_uq" UNIQUE("grant_id")
);
--> statement-breakpoint
CREATE TABLE "billing_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"broadcast_id" text,
	"date" text,
	"product_id" text,
	"product_no" integer,
	"job_id" text,
	CONSTRAINT "billing_usage_key_uq" UNIQUE("seller_id","key")
);
--> statement-breakpoint
CREATE TABLE "billing_modes" (
	"broadcast_id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"mode" text NOT NULL,
	"used_day" boolean NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_orders" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"state" text NOT NULL,
	"paid_method" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"granted_at" timestamp with time zone,
	"refund_hold_until" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "billing_orders_request_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "billing_business" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"masked" text NOT NULL,
	"receipt_kind" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"kind" text NOT NULL,
	"recipient_sealed" text NOT NULL,
	"amount" integer NOT NULL,
	"supply" integer NOT NULL,
	"vat" integer NOT NULL,
	"status" text NOT NULL,
	"approval" text,
	"cancel" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_documents_payment_uq" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "billing_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "billing_grants" ADD CONSTRAINT "billing_grants_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_revocations" ADD CONSTRAINT "billing_revocations_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_revocations" ADD CONSTRAINT "billing_revocations_grant_id_billing_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."billing_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_modes" ADD CONSTRAINT "billing_modes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_business" ADD CONSTRAINT "billing_business_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_payment_id_billing_orders_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."billing_orders"("payment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_requests" ADD CONSTRAINT "billing_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_grants_seller_idx" ON "billing_grants" USING btree ("seller_id","at");--> statement-breakpoint
CREATE INDEX "billing_revocations_seller_idx" ON "billing_revocations" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "billing_usage_seller_idx" ON "billing_usage" USING btree ("seller_id","kind","at");--> statement-breakpoint
CREATE INDEX "billing_modes_scope_idx" ON "billing_modes" USING btree ("seller_id","scope_id");--> statement-breakpoint
CREATE INDEX "billing_orders_seller_idx" ON "billing_orders" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_documents_seller_idx" ON "billing_documents" USING btree ("seller_id");
