const ANCHOR_HREF_PATTERN = /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi;

/** Rewrites every <a href="..."> in HTML to route through the click-tracking redirect endpoint. */
export function rewriteLinksForTracking(html: string, trackingId: string, baseUrl: string): string {
  return html.replace(ANCHOR_HREF_PATTERN, (match, before, href, after) => {
    if (href.startsWith("mailto:") || href.startsWith("#")) return match;
    const trackedUrl = `${baseUrl}/api/track/click/${trackingId}?url=${encodeURIComponent(href)}`;
    return `<a ${before}href="${trackedUrl}"${after}>`;
  });
}
