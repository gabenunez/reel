CREATE TABLE `libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`path` text NOT NULL,
	`last_scanned_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `libraries_path_unique` ON `libraries` (`path`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`tmdb_id` integer,
	`title` text NOT NULL,
	`original_title` text,
	`overview` text,
	`year` integer,
	`poster_path` text,
	`backdrop_path` text,
	`type` text NOT NULL,
	`genres` text,
	`rating` real,
	`match_confidence` real,
	`needs_match` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tv_seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`poster_path` text,
	`air_date` text,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tv_episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text,
	`overview` text,
	`file_path` text NOT NULL,
	`duration_ms` integer,
	`file_size` integer,
	`still_path` text,
	`air_date` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `tv_seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tv_episodes_file_path_unique` ON `tv_episodes` (`file_path`);--> statement-breakpoint
CREATE TABLE `movie_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`duration_ms` integer,
	`file_size` integer,
	`video_codec` text,
	`audio_codec` text,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movie_files_file_path_unique` ON `movie_files` (`file_path`);--> statement-breakpoint
CREATE TABLE `subtitles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_file_id` integer,
	`episode_id` integer,
	`language` text DEFAULT 'und' NOT NULL,
	`label` text,
	`source` text NOT NULL,
	`path_or_index` text NOT NULL,
	`is_default` integer DEFAULT false,
	FOREIGN KEY (`movie_file_id`) REFERENCES `movie_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `tv_episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `watch_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_type` text NOT NULL,
	`item_id` integer NOT NULL,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
