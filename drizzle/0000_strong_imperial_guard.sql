CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"title" text DEFAULT 'Untitled canvas' NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"thumbnail" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "craft_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"base_url" text NOT NULL,
	"api_key_cipher" "bytea" NOT NULL,
	"api_key_iv" "bytea" NOT NULL,
	"space_id" text,
	"label" text,
	"last_full_sync" timestamp with time zone,
	"status" text DEFAULT 'ok',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "craft_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "craft_documents" (
	"connection_id" uuid,
	"craft_doc_id" text,
	"title" text,
	"folder_id" text,
	"folder_path" text,
	"updated_at" timestamp with time zone,
	"preview" text,
	"indexed_at" timestamp with time zone,
	"missing" boolean DEFAULT false,
	CONSTRAINT "craft_documents_pkey" PRIMARY KEY("connection_id","craft_doc_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_connections" ADD CONSTRAINT "craft_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_documents" ADD CONSTRAINT "craft_documents_connection_id_craft_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."craft_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvases_user_id_updated_at_idx" ON "canvases" USING btree ("user_id","updated_at" DESC NULLS LAST);