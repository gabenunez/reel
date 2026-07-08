import { forwardRef } from "react";
import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";

type MediaImageProps = Omit<ImageProps, "src" | "alt"> & {
  src: string | null | undefined;
  alt?: string;
};

/** Poster, backdrop, and still artwork via the Next.js image optimizer. */
export const MediaImage = forwardRef<HTMLImageElement, MediaImageProps>(
  function MediaImage(
    {
      src,
      alt = "",
      className,
      priority,
      fill,
      loading,
      quality = 80,
      sizes,
      ...props
    },
    ref,
  ) {
    if (!src) return null;

    const loadingProp = priority ? undefined : (loading ?? "lazy");

    if (fill) {
      return (
        <Image
          ref={ref}
          src={src}
          alt={alt}
          fill
          priority={priority}
          loading={loadingProp}
          quality={quality}
          sizes={sizes ?? "100vw"}
          className={cn(className)}
          {...props}
        />
      );
    }

    return (
      <Image
        ref={ref}
        src={src}
        alt={alt}
        priority={priority}
        loading={loadingProp}
        quality={quality}
        sizes={sizes}
        className={cn(className)}
        {...props}
      />
    );
  },
);
