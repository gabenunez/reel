/** Prerendered static hero copy — baked into the static export shell. */
export function HomeHeroStatic() {
  return (
    <div>
      <h1 className="mb-4 text-5xl font-black sm:text-7xl">Reel</h1>
      <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
        Your personal library for movies and TV, played locally on your network.
      </p>
    </div>
  );
}

export function HomeSectionHeading({
  title,
  accent = "primary",
}: {
  title: string;
  accent?: "primary" | "accent";
}) {
  return (
    <div className="mx-auto mb-4 flex max-w-7xl items-center gap-3 px-4 sm:px-6">
      <span
        className={accent === "accent" ? "h-px w-8 bg-accent" : "h-px w-8 bg-primary"}
      />
      <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
    </div>
  );
}
