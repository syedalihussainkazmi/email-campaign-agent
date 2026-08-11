const ANCHOR_HREF_PATTERN = /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi;

/** Rewrites every <a href="..."> in HTML to route through the click-tracking redirect endpoint. */
export function rewriteLinksForTracking(html: string, trackingId: string, baseUrl: string): string {
  return html.replace(ANCHOR_HREF_PATTERN, (match, before, href, after) => {
    if (href.startsWith("mailto:") || href.startsWith("#")) return match;
    const trackedUrl = `${baseUrl}/api/track/click/${trackingId}?url=${encodeURIComponent(href)}`;
    return `<a ${before}href="${trackedUrl}"${after}>`;
  });
}

/**
 * The invisible 1x1 pixel tag appended just before the signature. A known-
 * imprecise signal (Apple Mail Privacy Protection preloads it regardless of
 * a real open; other clients block remote images entirely) — directional,
 * not exact.
 */
export function openTrackingPixel(trackingId: string, baseUrl: string): string {
  return `<img src="${baseUrl}/api/track/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
}
