import { pgTable, pgEnum, uuid, text, integer, boolean, timestamp, primaryKey, index, bigint } from 'drizzle-orm/pg-core';

// Every row carries organization_id (directly or through its project) so multi-tenancy can be added later.

export const orgRole = pgEnum('org_role', ['super', 'head', 'pm']);
export const stage = pgEnum('task_stage', ['todo', 'line', 'done']);
export const commentKind = pgEnum('comment_kind', ['comment', 'back', 'done', 'backlog']);
export const noteKind = pgEnum('note_kind', ['update', 'move', 'comment', 'back', 'mention']);

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  orgRole: orgRole('org_role'),
  hue: integer('hue').notNull().default(210),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  managerId: uuid('manager_id').notNull().references(() => users.id),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  lineOrder: integer('line_order').notNull(),
  leadId: uuid('lead_id').references(() => users.id),
});

export const teamMembers = pgTable('team_members', {
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
}, t => [primaryKey({ columns: [t.teamId, t.userId] })]);

export const columns = pgTable('columns', {
  id: id(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  estimateMinutes: integer('estimate_minutes').notNull(),
  // Removed columns are archived, not deleted, so task history keeps its names.
  archivedAt: at('archived_at'),
});

export const columnOwners = pgTable('column_owners', {
  columnId: uuid('column_id').notNull().references(() => columns.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
}, t => [primaryKey({ columns: [t.columnId, t.userId] })]);

export const tasks = pgTable('tasks', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // stage 'line' means the task sits in column_id; 'todo' and 'done' are the shared lanes.
  stage: stage('stage').notNull(),
  columnId: uuid('column_id').references(() => columns.id),
  lastTeamId: uuid('last_team_id').references(() => teams.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  deadlineAt: at('deadline_at'),
  createdAt: at('created_at').notNull().defaultNow(),
  startedAt: at('started_at'),
  enteredColumnAt: at('entered_column_at').notNull().defaultNow(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
}, t => [index('tasks_project_idx').on(t.projectId)]);

export const taskAssignees = pgTable('task_assignees', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
}, t => [primaryKey({ columns: [t.taskId, t.userId] })]);

export const subtasks = pgTable('subtasks', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  deadlineAt: at('deadline_at'),
  done: boolean('done').notNull().default(false),
  position: integer('position').notNull().default(0),
});

// Time spent in each team column, closed when the task leaves it.
export const stints = pgTable('stints', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  columnId: uuid('column_id').notNull().references(() => columns.id),
  startedAt: at('started_at').notNull(),
  endedAt: at('ended_at').notNull(),
});

export const comments = pgTable('comments', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  kind: commentKind('kind').notNull().default('comment'),
  body: text('body').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const attachments = pgTable('attachments', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  url: text('url').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const taskEvents = pgTable('task_events', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  text: text('text').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
}, t => [index('task_events_task_idx').on(t.taskId)]);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }), // null for organisation-level changes such as roles
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  byId: uuid('by_id').notNull().references(() => users.id),
  kind: noteKind('kind').notNull(),
  text: text('text').notNull(),
  readAt: at('read_at'),
  createdAt: at('created_at').notNull().defaultNow(),
}, t => [index('notifications_user_idx').on(t.userId, t.createdAt)]);
