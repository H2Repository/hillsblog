import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export interface LocalInsightsRow {
  recommendedForSolo: string;
  localFood?: string;
  transportTip?: string;
  soloTravelTip?: string;
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const diaries = pgTable('diaries', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  lat: doublePrecision('lat').notNull().default(0),
  lng: doublePrecision('lng').notNull().default(0),
  accuracy: doublePrecision('accuracy'),
  address: text('address').notNull().default(''),
  region: text('region').notNull().default(''),
  landmark: text('landmark'),
  isRealtimeGps: boolean('is_realtime_gps').default(false),
  includeInDistance: boolean('include_in_distance').default(true),
  weather: text('weather').notNull().default('sunny'),
  moodTags: jsonb('mood_tags').$type<string[]>().notNull().default([]),
  localInsights: jsonb('local_insights')
    .$type<LocalInsightsRow>()
    .notNull()
    .default({ recommendedForSolo: '' }),
  rating: integer('rating').notNull().default(5),
  totalPhotosCount: integer('total_photos_count').notNull().default(0),
  isModified: boolean('is_modified').default(false),
  createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
  updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const diaryPhotos = pgTable('diary_photos', {
  id: text('id').primaryKey(),
  diaryId: text('diary_id')
    .references(() => diaries.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  photoId: text('photo_id').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  caption: text('caption').notNull().default(''),
  timestamp: text('timestamp').notNull().default(''),
  isCover: boolean('is_cover').notNull().default(false),
  mimeType: text('mime_type').notNull().default('image/jpeg'),
  byteSize: integer('byte_size').notNull().default(0),
  contentSig: text('content_sig').notNull().default(''),
  thumbnailUrl: text('thumbnail_url'),
  imageData: bytea('image_data'),
  externalUrl: text('external_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  diaries: many(diaries),
}));

export const diariesRelations = relations(diaries, ({ one, many }) => ({
  author: one(users, {
    fields: [diaries.userId],
    references: [users.id],
  }),
  photos: many(diaryPhotos),
}));

export const diaryPhotosRelations = relations(diaryPhotos, ({ one }) => ({
  diary: one(diaries, {
    fields: [diaryPhotos.diaryId],
    references: [diaries.id],
  }),
  author: one(users, {
    fields: [diaryPhotos.userId],
    references: [users.id],
  }),
}));
