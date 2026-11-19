// Define persisted library content, owner defaults, reading checkpoints, story content revisions and durable production jobs/demand.
import {sql} from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const books = sqliteTable('books', { id: text('id').primaryKey(), title: text('title').notNull(), author: text('author').notNull(), era: text('era').notNull(), sourceUrl: text('source_url').notNull(), excerpt: text('excerpt').notNull(), note: text('note').notNull() });
export const events = sqliteTable('events', { id: text('id').primaryKey(), visitor: text('visitor').notNull(), session: text('session').notNull(), storyId: text('story_id').notNull(), kind: text('kind').notNull(), page: integer('page'), mode: text('mode').notNull(), cohort: text('cohort').notNull(), createdAt: text('created_at').notNull() }, t=>[index('events_cohort_date').on(t.cohort,t.createdAt)]);

export const libraryDeletions=sqliteTable('library_deletions',{userId:text('user_id').notNull(),storyId:text('story_id').notNull(),kind:text('kind').notNull(),deletedAt:text('deleted_at').notNull()},t=>[uniqueIndex('library_deletions_user_story').on(t.userId,t.storyId)]);

export const stories=sqliteTable('stories',{id:text('id').primaryKey(),userId:text('user_id').notNull(),selection:text('selection').notNull(),document:text('document').notNull(),generationMode:text('generation_mode').notNull().default('reader'),generationControl:text('generation_control').notNull().default('active'),state:text('state').notNull().default('idle'),error:text('error'),stepKey:text('step_key'),stepAttempts:integer('step_attempts').notNull().default(0),lockToken:text('lock_token'),lockUntil:integer('lock_until').notNull().default(0),page:integer('page').notNull().default(0),saved:integer('saved').notNull().default(0),lastReadAt:text('last_read_at'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()},t=>[index('reader_user_created').on(t.userId,t.createdAt),index('stories_production_scan').on(t.id,t.userId,t.state)]);
// 内容修订号由迁移中的触发器维护，制作节拍据此跳过未变化的故事。
export const storyRevisions=sqliteTable('story_revisions',{storyId:text('story_id').primaryKey(),rev:integer('rev').notNull().default(0)});

export const productionJobs=sqliteTable('production_jobs',{
 id:text('id').primaryKey(),sessionId:text('session_id').notNull(),ownerId:text('owner_id').notNull(),kind:text('kind').notNull(),pool:text('pool').notNull(),version:text('version').notNull(),dependencies:text('dependencies').notNull(),payload:text('payload').notNull(),result:text('result'),state:text('state').notNull().default('queued'),priority:integer('priority').notNull().default(0),attempts:integer('attempts').notNull().default(0),leaseToken:text('lease_token'),leaseUntil:integer('lease_until').notNull().default(0),error:text('error'),interrupted:integer('interrupted').notNull().default(0),failureId:text('failure_id'),recoveryId:text('recovery_id'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[index('production_ready').on(t.state,t.pool,t.priority),index('production_session').on(t.sessionId,t.ownerId)]);
export const productionDemand=sqliteTable('production_demand',{
 sessionId:text('session_id').notNull(),ownerId:text('owner_id').notNull(),viewerId:text('viewer_id').notNull(),page:integer('page').notNull(),throughPage:integer('through_page').notNull(),expiresAt:integer('expires_at').notNull(),runtimeId:text('runtime_id').notNull(),
},t=>[uniqueIndex('production_viewer').on(t.sessionId,t.ownerId,t.viewerId),index('production_live_demand').on(t.runtimeId,t.expiresAt)]);

export const bookImageReferences=sqliteTable('book_image_references',{ownerId:text('owner_id').notNull(),bookKey:text('book_key').notNull(),storyId:text('story_id').notNull(),page:integer('page').notNull(),token:text('token').notNull(),assetKey:text('asset_key').notNull(),updatedAt:text('updated_at').notNull()},t=>[primaryKey({columns:[t.ownerId,t.bookKey]})]);

export const readerPublicationDefaults=sqliteTable('reader_publication_defaults',{ownerId:text('owner_id').primaryKey(),publication:text('publication').notNull()});

export const readerFaults=sqliteTable('reader_faults',{
 id:text('id').primaryKey(),sessionId:text('session_id').notNull(),ownerId:text('owner_id').notNull(),jobId:text('job_id'),kind:text('kind').notNull(),page:integer('page'),version:text('version').notNull(),image:text('image'),message:text('message').notNull(),state:text('state').notNull().default('pending'),commandId:text('command_id'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[index('reader_faults_session').on(t.sessionId,t.ownerId,t.state),uniqueIndex('reader_faults_image').on(t.sessionId,t.ownerId,t.page).where(sql`${t.kind}='image-loss' AND ${t.state} IN ('pending','recovering')`)]);
export const readerCommands=sqliteTable('reader_commands',{
 requestId:text('request_id').notNull(),ownerId:text('owner_id').notNull(),sessionId:text('session_id').notNull(),action:text('action').notNull(),fingerprint:text('fingerprint').notNull(),payload:text('payload').notNull(),faultId:text('fault_id'),resultId:text('result_id'),status:text('status').notNull().default('succeeded'),result:text('result'),error:text('error'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.requestId]}),index('reader_commands_session').on(t.sessionId,t.ownerId)]);
