import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

export const libraries = sqliteTable("libraries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ["movies", "tv"] }).notNull(),
  path: text("path").notNull().unique(),
  lastScannedAt: integer("last_scanned_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    libraryId: integer("library_id")
      .notNull()
      .references(() => libraries.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id"),
    /** IMDb id with tt prefix when known (e.g. tt0094715). */
    imdbId: text("imdb_id"),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    overview: text("overview"),
    year: integer("year"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    themePath: text("theme_path"),
    type: text("type", { enum: ["movie", "tv"] }).notNull(),
    genres: text("genres"),
    rating: real("rating"),
    matchConfidence: real("match_confidence"),
    needsMatch: integer("needs_match", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    libraryIdIdx: index("media_items_library_id_idx").on(table.libraryId),
    createdAtIdx: index("media_items_created_at_idx").on(table.createdAt),
    updatedAtIdx: index("media_items_updated_at_idx").on(table.updatedAt),
  }),
);

export const tvSeasons = sqliteTable(
  "tv_seasons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mediaItemId: integer("media_item_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    seasonNumber: integer("season_number").notNull(),
    name: text("name"),
    overview: text("overview"),
    posterPath: text("poster_path"),
    airDate: text("air_date"),
  },
  (table) => ({
    mediaItemIdIdx: index("tv_seasons_media_item_id_idx").on(table.mediaItemId),
  }),
);

export const tvEpisodes = sqliteTable(
  "tv_episodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => tvSeasons.id, { onDelete: "cascade" }),
    episodeNumber: integer("episode_number").notNull(),
    title: text("title"),
    overview: text("overview"),
    filePath: text("file_path").notNull().unique(),
    durationMs: integer("duration_ms"),
    fileSize: integer("file_size"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    width: integer("width"),
    height: integer("height"),
    stillPath: text("still_path"),
    airDate: text("air_date"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    seasonIdIdx: index("tv_episodes_season_id_idx").on(table.seasonId),
  }),
);

export const movieFiles = sqliteTable(
  "movie_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mediaItemId: integer("media_item_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull().unique(),
    durationMs: integer("duration_ms"),
    fileSize: integer("file_size"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    width: integer("width"),
    height: integer("height"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    mediaItemIdIdx: index("movie_files_media_item_id_idx").on(table.mediaItemId),
  }),
);

export const subtitles = sqliteTable(
  "subtitles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    movieFileId: integer("movie_file_id").references(() => movieFiles.id, {
      onDelete: "cascade",
    }),
    episodeId: integer("episode_id").references(() => tvEpisodes.id, {
      onDelete: "cascade",
    }),
    language: text("language").notNull().default("und"),
    label: text("label"),
    source: text("source", {
      enum: ["external", "embedded", "opensubtitles"],
    }).notNull(),
    pathOrIndex: text("path_or_index").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).default(false),
  },
  (table) => ({
    movieFileIdIdx: index("subtitles_movie_file_id_idx").on(table.movieFileId),
    episodeIdIdx: index("subtitles_episode_id_idx").on(table.episodeId),
  }),
);

export const watchProgress = sqliteTable(
  "watch_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemType: text("item_type", { enum: ["movie", "episode"] }).notNull(),
    itemId: integer("item_id").notNull(),
    positionMs: integer("position_ms").notNull().default(0),
    durationMs: integer("duration_ms"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index("watch_progress_updated_at_idx").on(table.updatedAt),
    itemLookupIdx: index("watch_progress_item_lookup_idx").on(
      table.itemType,
      table.itemId,
    ),
  }),
);

export const favorites = sqliteTable("favorites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" })
    .unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const libraryDecks = sqliteTable("library_decks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  paths: text("paths").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const scanJobs = sqliteTable("scan_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  libraryId: integer("library_id")
    .notNull()
    .references(() => libraries.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export type Library = typeof libraries.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
export type TvSeason = typeof tvSeasons.$inferSelect;
export type TvEpisode = typeof tvEpisodes.$inferSelect;
export type MovieFile = typeof movieFiles.$inferSelect;
export type Subtitle = typeof subtitles.$inferSelect;
export type WatchProgress = typeof watchProgress.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type ScanJob = typeof scanJobs.$inferSelect;
export type LibraryDeck = typeof libraryDecks.$inferSelect;
