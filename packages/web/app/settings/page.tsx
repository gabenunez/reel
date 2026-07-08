import type { Metadata } from "next";
import { SettingsPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <SettingsPageClient />
    </div>
  );
}
