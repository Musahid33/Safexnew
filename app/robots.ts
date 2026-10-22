import type { MetadataRoute } from 'next';

/**
 * Nothing in this app is meant to be discovered by a crawler. The home page is a worker
 * portal behind a site selector, and every other route either needs the operator session or
 * returns JSON. Keeping the whole origin out of search indexes also keeps old builds and
 * cached snippets of the interface out of public results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }]
  };
}
