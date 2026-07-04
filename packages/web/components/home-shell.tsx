import Link from "next/link";

/** Prerendered static hero copy — baked into the static export shell. */
export function HomeHeroStatic() {
  return (
    <div className="max-w-3xl">
      <h1 className="flex flex-col items-start gap-1 sm:gap-1.5">
        <span className="text-lg font-medium text-primary/65 sm:text-xl">
          This is your
        </span>
        <span className="text-[2.65rem] font-black leading-none tracking-tight sm:text-6xl lg:text-[4.5rem] bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          MEDIA!
        </span>
      </h1>

      <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground sm:mt-5 sm:text-lg">
        Your movies and TV, streamed from your own drives on your network.
      </p>
    </div>
  );
}

export function HomeSectionHeading({
  title,
  accent = "primary",
  href,
  linkLabel = "View all",
}: {
  title: string;
  accent?: "primary" | "accent";
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mx-auto mb-4 flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <span
          className={accent === "accent" ? "h-px w-8 bg-accent" : "h-px w-8 bg-primary"}
        />
        <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
      </div>
      {href ? (
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
