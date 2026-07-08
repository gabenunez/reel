import { Skeleton } from "@/components/ui/skeleton";

export function HomeLoadingSkeleton() {
  return (
    <div className="pb-16">
      <Skeleton className="mb-14 h-96 w-full" />
      <div className="mx-auto max-w-7xl space-y-12 px-4 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-32 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PosterGridLoadingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Skeleton className="mb-8 h-10 w-48" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] rounded-md" />
        ))}
      </div>
    </div>
  );
}

export function BrowseLoadingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Skeleton className="mb-8 h-10 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-md" />
        ))}
      </div>
    </div>
  );
}

export function WatchLoadingSkeleton() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Skeleton className="h-10 w-40" />
    </div>
  );
}

export function SettingsLoadingSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-10 w-32" />
      <Skeleton className="h-48 w-full rounded-md" />
      <Skeleton className="h-48 w-full rounded-md" />
    </div>
  );
}

export function SearchLoadingSkeleton() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6">
      <Skeleton className="h-10 w-56" />
    </div>
  );
}
