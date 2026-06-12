/** Media Studio — YouTube channel growth tools (concept v0). */

// Your channel id (the UC... part of youtube.com/channel/UC...).
// Set in .env.local; the Media Studio page shows a hint until it is set.
export const YT_CHANNEL_ID = process.env.NEXT_PUBLIC_YT_CHANNEL_ID || ''
export const YT_CHANNEL_URL = `https://www.youtube.com/channel/${YT_CHANNEL_ID}`
export const YT_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`
// Optional: your site, used as the CTA target in generated ideas/scripts.
export const BRAND_SITE = process.env.NEXT_PUBLIC_BRAND_SITE || ''

// Edit to match your channel — this profile is injected into every
// generation prompt so ideas/scripts stay on-brand.
export const CHANNEL_PROFILE = {
  name: 'My Channel',
  tagline: 'AI, coding and hands-on product builds',
  niche: [
    'comparing LLMs on real coding tasks',
    'AI news and model releases',
    'practical AI products (bots, automations, tools)',
  ],
  audience: 'developers and entrepreneurs interested in AI',
  language: 'English',
  cta: BRAND_SITE ? `Subscribe + visit ${BRAND_SITE}` : 'Subscribe',
}

export type GenerateKind = 'ideas' | 'script' | 'thumbnail'

export interface YtVideo {
  id: string
  title: string
  url: string
  publishedAt: string
  thumbnail: string
  description: string
  views: number
  likes: number
}

export interface ChannelSnapshot {
  channel: typeof CHANNEL_PROFILE & { id: string; url: string; rssUrl: string; since: string }
  videos: YtVideo[]
  stats: {
    videoCount: number
    totalViews: number
    avgViews: number
    latestPublished: string | null
  }
  conceptNote: string
}

function tag(xml: string, name: string): string {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')
  const m = xml.match(re)
  return m ? m[1].trim() : ''
}

function attr(xml: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`, 'i')
  const m = xml.match(re)
  return m ? m[1] : ''
}

export function parseYoutubeRss(xml: string): { title: string; published: string; videos: YtVideo[] } {
  const channelTitle = tag(xml, 'title') || CHANNEL_PROFILE.name
  const channelPublished = tag(xml, 'published')
  const entries = xml.split(/<entry>/i).slice(1)
  const videos: YtVideo[] = entries.map((chunk) => {
    const entry = `<entry>${chunk}`
    const id = tag(entry, 'yt:videoId') || tag(entry, 'id').replace(/^yt:video:/, '')
    const title = tag(entry, 'title')
    const publishedAt = tag(entry, 'published')
    const linkMatch = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i)
    const url = linkMatch?.[1] || `https://www.youtube.com/watch?v=${id}`
    const thumbMatch = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i)
    const thumbnail = thumbMatch?.[1] || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    const description = tag(entry, 'media:description')
    const views = Number(attr(entry, 'views') || tag(entry.match(/<media:statistics[^>]*\/>/)?.[0] || '', 'views') || 0)
    const likes = Number(tag(entry, 'media:starRating') ? attr(entry.match(/<media:starRating[^>]*\/>/)?.[0] || '', 'count') : 0)
    return { id, title, url, publishedAt, thumbnail, description, views, likes }
  })
  return { title: channelTitle, published: channelPublished, videos }
}

export function buildChannelSnapshot(xml: string): ChannelSnapshot {
  const parsed = parseYoutubeRss(xml)
  const videos = parsed.videos.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
  const totalViews = videos.reduce((s, v) => s + v.views, 0)
  return {
    channel: {
      ...CHANNEL_PROFILE,
      id: YT_CHANNEL_ID,
      url: YT_CHANNEL_URL,
      rssUrl: YT_RSS_URL,
      since: parsed.published,
      name: parsed.title,
    },
    videos,
    stats: {
      videoCount: videos.length,
      totalViews,
      avgViews: videos.length ? Math.round(totalViews / videos.length) : 0,
      latestPublished: videos[0]?.publishedAt ?? null,
    },
    conceptNote:
      'Concept v0: ideas and scripts via the proxy model, thumbnails as a prompt for an image model. Full analytics (CTR, retention, revenue) arrives with the YouTube Data API integration.',
  }
}

export function buildSystemPrompt(kind: GenerateKind): string {
  const base = `You are the producer of the YouTube channel "${CHANNEL_PROFILE.name}"${YT_CHANNEL_ID ? ` (${YT_CHANNEL_URL})` : ''}.
Niche: ${CHANNEL_PROFILE.niche.join('; ')}.
Audience: ${CHANNEL_PROFILE.audience}.
Style: energetic, practical, no filler, hook within the first 3 seconds.
Always write in ${CHANNEL_PROFILE.language}.${CHANNEL_PROFILE.cta ? ` Work in the CTA where appropriate: ${CHANNEL_PROFILE.cta}.` : ''}`
  if (kind === 'ideas') {
    return `${base}
Generate 5 ideas for new videos. For each: a clickable title (up to 70 characters), one sentence on why it will perform, the format (comparison / news / tutorial / challenge), and 3 hashtags.
Markdown format, numbered list.`
  }
  if (kind === 'script') {
    return `${base}
Write a skeleton script for the video: hook at 0:00, blocks with timecodes every 30–60 seconds, CTA at the end.
Add a list of B-roll / screens for editing. Markdown format.`
  }
  return `${base}
Create a brief for a YouTube thumbnail (1280×720):
1) A detailed English prompt for an image model (no text in the image).
2) The thumbnail text (2–4 words, ALL CAPS, high contrast).
3) Background and accent colors in hex.
4) Composition (where the face/logo/arrows go).
Markdown format.`
}
