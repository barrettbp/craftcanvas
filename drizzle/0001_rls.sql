-- Row level security as a second layer (spec section 11).
--
-- The app talks to Postgres with the Supabase service role / table owner,
-- which BYPASSES row level security: every query in src/lib/**/repo.ts and
-- the route handlers already scopes by user_id in SQL, and that remains the
-- primary ownership check. These policies exist so that any other client
-- (PostgREST with a user JWT, a dashboard, a future edge function using the
-- anon key) can only ever see its own rows.
--
-- The caller's user id is read from the JWT claims that Supabase sets for
-- each request: coalesce(current_setting('request.jwt.claims', true)::json->>'sub', '').
-- Clerk user ids are the `sub` claim when Clerk is configured as a third
-- party auth provider for Supabase; with no JWT the expression is '' and no
-- row matches. Tables are not FORCEd, so the owner keeps bypassing RLS.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "craft_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "craft_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canvases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- users: a user sees and edits only their own row.
CREATE POLICY "users_own_rows" ON "users"
  FOR ALL
  USING ("id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''))
  WITH CHECK ("id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''));--> statement-breakpoint

-- craft_connections: keyed on user_id. The encrypted key columns are still
-- in the row; keep the service role for anything that needs to decrypt.
CREATE POLICY "craft_connections_own_rows" ON "craft_connections"
  FOR ALL
  USING ("user_id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''))
  WITH CHECK ("user_id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''));--> statement-breakpoint

-- craft_documents: no user_id column, so join through the owning connection.
CREATE POLICY "craft_documents_own_rows" ON "craft_documents"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "craft_connections" c
      WHERE c."id" = "craft_documents"."connection_id"
        AND c."user_id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', '')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "craft_connections" c
      WHERE c."id" = "craft_documents"."connection_id"
        AND c."user_id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', '')
    )
  );--> statement-breakpoint

-- canvases: keyed on user_id.
CREATE POLICY "canvases_own_rows" ON "canvases"
  FOR ALL
  USING ("user_id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''))
  WITH CHECK ("user_id" = coalesce(current_setting('request.jwt.claims', true)::json->>'sub', ''));
