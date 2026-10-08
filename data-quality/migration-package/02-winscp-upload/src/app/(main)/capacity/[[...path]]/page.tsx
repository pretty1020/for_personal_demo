import { notFound } from "next/navigation";
import { CapacitySection } from "@/components/capacity-section";

type PageProps = { params: Promise<{ path?: string[] }> };

/**
 * Static embed assets live in public/capacity. When one is missing (typically a
 * stale chunk requested by a cached embed.js after a deploy) Next would otherwise
 * fall through to this catch-all and answer a .js request with HTML, which the
 * browser rejects as a MIME type error. Answer 404 so the failure is honest and
 * the embed's reload-on-stale-chunk recovery can kick in.
 */
function isStaticAssetRequest(segments: string[]): boolean {
  if (segments[0] === "chunks") return true;
  const last = segments.at(-1);
  return Boolean(last && /\.(js|css|map|svg|png|jpe?g|webp|woff2?)$/i.test(last));
}

export default async function CapacityPlanPage({ params }: PageProps) {
  const { path = [] } = await params;
  if (isStaticAssetRequest(path)) notFound();

  return <CapacitySection />;
}
