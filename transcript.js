/**
 * Transcript Service — Phase 6
 * Uses YouTube's Innertube API (impersonating Android client)
 * + YouTube Data API for metadata and caption track detection
 *
 * POST /transcript  { videoId: "abc123" }
 * GET  /health
 */

const express = require('express');
const app = express();
app.use(express.json());

// ── CORS for your domains ──
app.use((req, res, next) => {
  const allowed = [
    'https://studio1live.com',
    'https://www.studio1live.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── YouTube Data API helpers ──
const YT_API_KEY = process.env.YOUTUBE_API_KEY || '';

async function getVideoMetadata(videoId) {
  if (!YT_API_KEY) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${YT_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;
    return {
      title: item.snippet?.title,
      channel: item.snippet?.channelTitle,
      description: item.snippet?.description?.slice(0, 500),
      duration: item.contentDetails?.duration,
      language: item.snippet?.defaultAudioLanguage || item.snippet?.defaultLanguage
    };
  } catch { return null; }
}

async function getCaptionTracks(videoId) {
  if (!YT_API_KEY) return [];
  try {
    const url = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${YT_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => ({
      id: item.id,
      language: item.snippet?.language,
      trackKind: item.snippet?.trackKind,
      name: item.snippet?.name
    }));
  } catch { return []; }
}

// ── Parse JSON3 caption format ──
function parseJson3(data) {
  if (!data || !data.events) return [];
  return data.events
    .filter(e => e.segs && e.segs.length)
    .map(e => ({
      ts: Math.floor((e.tStartMs || 0) / 1000),
      text: e.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')).join('').trim()
    }))
    .filter(s => s.text.length > 1);
}

// ── Parse XML caption format ──
function parseCaptionXml(xmlText) {
  const segments = [];
  const regex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>[^<]*)*)<\/text>/g;
  let match;
  while ((match = regex.exec(xmlText)) !== null) {
    const ts = parseFloat(match[1]);
    let text = match[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();
    if (text) segments.push({ ts: Math.floor(ts), text });
  }
  return segments;
}

function segmentsToText(segments) {
  return segments.map(s => {
    const m = Math.floor(s.ts / 60);
    const sec = String(s.ts % 60).padStart(2, '0');
    return `[${m}:${sec}] ${s.text}`;
  }).join('\n');
}

// ── Strategy 1: Innertube Android client (most reliable) ──
async function fetchViaInnertube(videoId) {
  const ANDROID_CLIENT = {
    clientName: 'ANDROID',
    clientVersion: '19.44.38',
    androidSdkVersion: 30,
    userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip',
    hl: 'en',
    gl: 'US'
  };

  const payload = {
    context: { client: ANDROID_CLIENT },
    videoId,
    racyCheckOk: false,
    contentCheckOk: false
  };

  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_CLIENT.userAgent,
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': ANDROID_CLIENT.clientVersion,
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });

  if (!res.ok) throw new Error(`Innertube HTTP ${res.status}`);
  const data = await res.json();

  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;

  const sorted = [...tracks].sort((a, b) => {
    const aEn = (a.languageCode || '').startsWith('en') ? 0 : 1;
    const bEn = (b.languageCode || '').startsWith('en') ? 0 : 1;
    if (aEn !== bEn) return aEn - bEn;
    const aAuto = a.kind === 'asr' ? 1 : 0;
    const bAuto = b.kind === 'asr' ? 1 : 0;
    return aAuto - bAuto;
  });

  const track = sorted[0];
  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');

  const captionRes = await fetch(captionUrl.toString(), {
    headers: { 'User-Agent': ANDROID_CLIENT.userAgent },
    signal: AbortSignal.timeout(10000)
  });

  if (!captionRes.ok) throw new Error(`Caption fetch HTTP ${captionRes.status}`);
  const captionData = await captionRes.json();
  const segments = parseJson3(captionData);

  return {
    segments,
    language: track.languageCode,
    source: 'innertube-android',
    isAutoGenerated: track.kind === 'asr'
  };
}

// ── Strategy 2: Innertube WEB client (fallback) ──
async function fetchViaInnertubeWeb(videoId) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240101.00.00'
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US'
        }
      },
      videoId
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!res.ok) throw new Error(`Innertube WEB HTTP ${res.status}`);
  const data = await res.json();

  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;

  const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];
  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');

  const cr = await fetch(captionUrl.toString(), { signal: AbortSignal.timeout(10000) });
  const captionData = await cr.json();
  const segments = parseJson3(captionData);

  return {
    segments,
    language: track.languageCode,
    source: 'innertube-web',
    isAutoGenerated: track.kind === 'asr'
  };
}

// ── Strategy 3: Direct timedtext API ──
async function fetchViaTimedText(videoId) {
  for (const lang of ['en', 'a.en', 'en-US', 'en-GB']) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const segs = parseJson3(data);
      if (segs.length > 3) return {
        segments: segs,
        language: lang,
        source: 'timedtext',
        isAutoGenerated: lang.startsWith('a.')
      };
    } catch { /* try next */ }
  }
  return null;
}

// ── Main endpoint ──
app.post('/transcript', async (req, res) => {
  const { videoId, url } = req.body;

  let vid = videoId;
  if (!vid && url) {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    vid = match?.[1];
  }

  if (!vid) return res.status(400).json({ error: 'videoId or url required' });

  console.log(`[transcript] Fetching: ${vid}`);

  // ── Get metadata and caption tracks via YouTube Data API ──
  const [metadata, captionTracks] = await Promise.all([
    getVideoMetadata(vid),
    getCaptionTracks(vid)
  ]);

  if (metadata) {
    console.log(`[transcript] Video: "${metadata.title}" by ${metadata.channel}`);
  }

  if (captionTracks.length > 0) {
    console.log(`[transcript] Caption tracks: ${captionTracks.map(t => `${t.language}(${t.trackKind})`).join(', ')}`);
  }

  // ── Try transcript strategies in order ──
  let result = null;

  try { result = await fetchViaInnertube(vid); }
  catch (e) { console.log(`[transcript] Innertube Android failed: ${e.message}`); }

  if (!result) {
    try { result = await fetchViaInnertubeWeb(vid); }
    catch (e) { console.log(`[transcript] Innertube Web failed: ${e.message}`); }
  }

  if (!result) {
    try { result = await fetchViaTimedText(vid); }
    catch (e) { console.log(`[transcript] Timedtext failed: ${e.message}`); }
  }

  if (!result || !result.segments?.length) {
    return res.json({
      success: false,
      videoId: vid,
      metadata,
      captionTracksAvailable: captionTracks.length,
      error: captionTracks.length === 0
        ? 'This video has no captions available.'
        : 'Captions exist but could not be fetched — may be member-only or restricted.',
      segments: [],
      transcript: ''
    });
  }

  const transcript = segmentsToText(result.segments);
  const wordCount = transcript.split(/\s+/).length;

  console.log(`[transcript] Success: ${result.segments.length} segments, ~${wordCount} words (${result.source})`);

  return res.json({
    success: true,
    videoId: vid,
    source: result.source,
    language: result.language,
    isAutoGenerated: result.isAutoGenerated,
    segments: result.segments,
    transcript,
    wordCount,
    segmentCount: result.segments.length,
    metadata,
    captionTracks
  });
});

// ── Health check ──
app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '6.1.0',
  youtubeApiKey: YT_API_KEY ? 'configured' : 'not set'
}));
app.post('/api/transcript', async (req, res) => {
  // same handler — just forward to the existing one
  return req.app._router.handle(
    Object.assign(req, { url: '/transcript' }), res, () => {}
  );
});
// ── Keep-alive for Railway free tier ──
setInterval(() => {
  console.log('[keepalive] still running at', new Date().toISOString());
}, 60000);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Transcript service running on port ${PORT}`));
module.exports = app;
