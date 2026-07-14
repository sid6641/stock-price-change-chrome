import { logger } from './logger';
import type { VideoMeta } from '../types';

const M = 'YouTube';

/**
 * Extract video metadata from the YouTube watch page DOM.
 * Reads title, description, and publish date from page elements
 * and the embedded ytInitialPlayerResponse data.
 */
export function getVideoMeta(): VideoMeta | null {
  const url = new URL(window.location.href);
  const id = url.searchParams.get('v');
  if (!id) {
    logger.warn(M, 'No video ID in URL');
    return null;
  }

  const titleEl = document.querySelector('h1.ytd-watch-metadata');
  const title = titleEl?.textContent?.trim() ?? document.title.replace(' - YouTube', '').trim();

  const descEl = document.querySelector('#description-inline-expander') ?? document.querySelector('#description');
  const description = descEl?.textContent?.trim() ?? '';

  const publishDate = extractPublishDate();
  if (!publishDate) {
    logger.warn(M, 'Could not extract publish date for video', id);
    return null;
  }

  logger.log(M, 'Meta extracted', { id, titleLen: title.length, descLen: description.length, publishDate });
  return { id, title, description, publishDate };
}

/**
 * Extract the publish date from ytInitialPlayerResponse JSON embedded in the page.
 */
function extractPublishDate(): string | null {
  try {
    const script = findInitialDataScript();
    if (!script?.textContent) return null;

    const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const dateStr = data?.microformat?.playerMicroformatRenderer?.publishDate;
    return dateStr ? dateStr.split('T')[0] : null;
  } catch {
    return null;
  }
}

/**
 * Extract the caption track URL from ytInitialPlayerResponse,
 * then fetch and parse the transcript text.
 * Returns null if no captions are available.
 */
export async function extractTranscript(): Promise<string | null> {
  const captionUrl = getCaptionBaseUrl();
  if (!captionUrl) {
    logger.log(M, 'No captions available for this video');
    return null;
  }

  logger.log(M, 'Fetching transcript from', captionUrl);
  try {
    const response = await fetch(captionUrl);
    const xml = await response.text();
    const transcript = parseTranscriptXml(xml);
    const wordCount = transcript.split(/\s+/).length;
    logger.log(M, `Transcript extracted: ${wordCount} words`);
    return transcript;
  } catch (err) {
    logger.error(M, 'Failed to fetch transcript', err);
    return null;
  }
}

/**
 * Find the caption track URL from ytInitialPlayerResponse.
 * Prefers English captions, falls back to first available.
 */
function getCaptionBaseUrl(): string | null {
  try {
    const script = findInitialDataScript();
    if (!script?.textContent) return null;

    const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) return null;

    const eng = tracks.find((t: any) => t.languageCode === 'en');
    return (eng ?? tracks[0]).baseUrl;
  } catch {
    return null;
  }
}

/**
 * Parse YouTube's SRT-like transcript XML into plain text.
 * Handles both <text> elements and plain text content.
 */
function parseTranscriptXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const texts = doc.querySelectorAll('text');
  const lines: string[] = [];

  texts.forEach((el) => {
    const text = el.textContent?.trim();
    if (text) lines.push(text);
  });

  return lines.join(' ');
}

/**
 * Find the <script> tag containing ytInitialPlayerResponse.
 */
function findInitialDataScript(): HTMLScriptElement | null {
  return (
    document.querySelector('script#ytd-page-data') ??
    Array.from(document.querySelectorAll('script')).find((s) =>
      s.textContent?.includes('ytInitialPlayerResponse'),
    ) ??
    null
  );
}

/**
 * Detect SPA navigation on YouTube (yt-navigate-finish event).
 * Calls the callback when a new video page loads.
 */
export function onYouTubeNavigation(callback: () => void): () => void {
  const handler = () => {
    logger.log(M, 'SPA navigation detected — re-running trigger flow');
    callback();
  };
  document.addEventListener('yt-navigate-finish', handler);
  // Return cleanup function
  return () => document.removeEventListener('yt-navigate-finish', handler);
}
