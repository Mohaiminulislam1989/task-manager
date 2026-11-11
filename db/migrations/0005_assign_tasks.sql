-- People move from columns to tasks. Cards on the line with nobody assigned keep the people
-- who were responsible for their column, so nobody loses work they were already doing.
INSERT INTO "task_assignees" ("task_id", "user_id")
  SELECT t."id", co."user_id" FROM "tasks" t JOIN "column_owners" co ON co."column_id" = t."column_id"
  WHERE t."stage" = 'line' AND NOT EXISTS (SELECT 1 FROM "task_assignees" a WHERE a."task_id" = t."id")
  ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "column_owners" CASCADE;--> statement-breakpoint
ALTER TABLE "subtasks" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
