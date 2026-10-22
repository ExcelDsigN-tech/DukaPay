import type { Metadata } from "next";
import { buildPageMetadata } from "../../lib/metadata";
import MoreClient from "./MoreClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildPageMetadata({
    locale,
    path: "/more",
    title: "More | DukaPay",
    description: "Every DukaPay page that is not in the mobile tab bar, in one list.",
  });
}

export default function MorePage() {
  return <MoreClient />;
}
