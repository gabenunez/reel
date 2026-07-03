"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { api, type MediaItem } from "@/lib/api";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

interface PosterCardProps {
  item: MediaItem;
  className?: string;
  showTitle?: boolean;
  progress?: number;
}

export function PosterCard({
  item,
  className,
  showTitle = true,
  progress,
}: PosterCardProps) {
  const imageUrl = api.imageUrl(item.posterPath);

  return (
    <Link href={routes.media(item.id)} className={cn("group block", className)}>
      <motion.div
        whileHover={{ scale: 1.04, y: -4 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="relative aspect-[2/3] overflow-hidden rounded-xl poster-shadow bg-secondary"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {item.title}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg">
            <Play className="h-6 w-6 fill-current ml-0.5" />
          </div>
        </div>

        {progress !== undefined && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
      </motion.div>

      {showTitle && (
        <div className="mt-2 px-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          {item.year && (
            <p className="text-xs text-muted-foreground">{item.year}</p>
          )}
        </div>
      )}
    </Link>
  );
}
