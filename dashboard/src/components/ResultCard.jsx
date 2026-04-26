import React, { useState, useEffect } from 'react';
import { Download, Share2, Instagram, Youtube, Video, CheckCircle, AlertCircle, X, Loader2, Copy, Wand2, Type, Calendar, Clock, Languages, Maximize2, Minimize2, ChevronDown, ChevronUp, Play, Zap } from 'lucide-react';
import { getApiUrl } from '../config';
import SubtitleModal from './SubtitleModal';
import HookModal from './HookModal';
import TranslateModal from './TranslateModal';
import { renderInBrowser } from '../lib/renderInBrowser';

export default function ResultCard({ clip, index, jobId, uploadPostKey, uploadUserId, geminiApiKey, elevenLabsKey, onPlay, onPause }) {
    const [showModal, setShowModal] = useState(false);
    const [showSubtitleModal, setShowSubtitleModal] = useState(false);
    const videoRef = React.useRef(null);
    const originalVideoUrl = getApiUrl(clip.video_url); // Never changes — used for Remotion previews
    const [currentVideoUrl, setCurrentVideoUrl] = useState(originalVideoUrl);
    // Browser-compatible URL for Remotion rendering (may differ from originalVideoUrl for old clips with B-frames)
    const [renderVideoUrl, setRenderVideoUrl] = useState(originalVideoUrl);

    const [platforms, setPlatforms] = useState({
        tiktok: true,
        instagram: true,
        youtube: true
    });
    const [postTitle, setPostTitle] = useState("");
    const [postDescription, setPostDescription] = useState("");
    const [isScheduling, setIsScheduling] = useState(false);
    const [scheduleDate, setScheduleDate] = useState("");

    const [posting, setPosting] = useState(false);
    const [postResult, setPostResult] = useState(null);

    const [isEditing, setIsEditing] = useState(false);
    const [isSubtitling, setIsSubtitling] = useState(false);
    const [isHooking, setIsHooking] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [showHookModal, setShowHookModal] = useState(false);
    const [showTranslateModal, setShowTranslateModal] = useState(false);
    const [editError, setEditError] = useState(null);
    const [showFullscreen, setShowFullscreen] = useState(false);
    const [showMetadata, setShowMetadata] = useState(false);

    const [clipDuration, setClipDuration] = useState(clip.end && clip.start ? clip.end - clip.start : 30);

    // Accumulate Remotion layers across operations
    const [activeLayers, setActiveLayers] = useState({ subtitles: null, hook: null, effects: null });

    /**
     * Ensure the video is encoded in a browser-compatible format for Remotion rendering.
     * Old clips may have B-frames (H.264 High profile) which prevent frame-accurate seeking.
     * Calls /api/videos/fix-compat which re-encodes with no B-frames if needed.
     * Returns the URL to use for rendering (may be the same or a compat_ variant).
     */
    const ensureRenderCompat = async (sourceUrl) => {
        // blob: URLs are already rendered output — use directly
        if (sourceUrl.startsWith('blob:')) return sourceUrl;
        const filename = sourceUrl.split('/').pop();
        // Already a compat file
        if (filename.startsWith('compat_')) return sourceUrl;
        try {
            const res = await fetch(getApiUrl('/api/videos/fix-compat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: jobId, input_filename: filename })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.new_video_url) return getApiUrl(data.new_video_url);
            }
        } catch (_) { /* ignore — fall back to original */ }
        return sourceUrl;
    };

    // Fetch clip duration from transcript endpoint
    useEffect(() => {
        if (!jobId || index === undefined) return;
        fetch(getApiUrl(`/api/clip/${jobId}/${index}/transcript`))
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.durationSec) setClipDuration(data.durationSec);
            })
            .catch(() => {});
    }, [jobId, index]);

    // Initialize/Reset form when modal opens
    useEffect(() => {
        if (showModal) {
            setPostTitle(clip.video_title_for_youtube_short || "Viral Short");
            setPostDescription(clip.video_description_for_instagram || clip.video_description_for_tiktok || "");
            setIsScheduling(false);
            setScheduleDate("");
            setPostResult(null);
        }
    }, [showModal, clip]);

    const handleAutoEdit = async () => {
        setIsEditing(true);
        setEditError(null);
        try {
            const apiKey = geminiApiKey || localStorage.getItem('gemini_key');

            if (!apiKey) {
                throw new Error("Gemini API Key is missing. Please set it in Settings.");
            }

            // Try Remotion effects endpoint first
            const effectsRes = await fetch(getApiUrl('/api/effects/generate'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Gemini-Key': apiKey
                },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: currentVideoUrl.split('/').pop()
                })
            });

            if (effectsRes.ok) {
                const data = await effectsRes.json();
                if (data.effects && data.effects.segments) {
                    // Ensure the source video is Remotion-decodable (no B-frames)
                    const compatUrl = await ensureRenderCompat(renderVideoUrl);
                    if (compatUrl !== renderVideoUrl) setRenderVideoUrl(compatUrl);

                    const newLayers = { ...activeLayers, effects: data.effects };
                    setActiveLayers(newLayers);
                    const blobUrl = await renderInBrowser({
                        videoUrl: compatUrl,
                        durationInSeconds: clipDuration,
                        subtitles: newLayers.subtitles,
                        hook: newLayers.hook,
                        effects: newLayers.effects,
                    });
                    setCurrentVideoUrl(blobUrl);
                    if (videoRef.current) videoRef.current.load();
                    return;
                }
            }

            // Fallback: legacy FFmpeg edit endpoint
            const res = await fetch(getApiUrl('/api/edit'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Gemini-Key': apiKey
                },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: currentVideoUrl.split('/').pop()
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    throw new Error(errText);
                }
            }

            const data = await res.json();
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                if (videoRef.current) {
                    videoRef.current.load();
                }
            }

        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsEditing(false);
        }
    };

    const handleSubtitle = async (options) => {
        setIsSubtitling(true);
        setEditError(null);
        try {
            if (options.remotion) {
                // Ensure the source video is Remotion-decodable (no B-frames)
                const compatUrl = await ensureRenderCompat(renderVideoUrl);
                if (compatUrl !== renderVideoUrl) setRenderVideoUrl(compatUrl);

                const newLayers = { ...activeLayers, subtitles: options.remotion };
                setActiveLayers(newLayers);
                try {
                    const blobUrl = await renderInBrowser({
                        videoUrl: compatUrl,
                        durationInSeconds: clipDuration,
                        subtitles: newLayers.subtitles,
                        hook: newLayers.hook,
                        effects: newLayers.effects,
                    });
                    setCurrentVideoUrl(blobUrl);
                    if (videoRef.current) videoRef.current.load();
                    setShowSubtitleModal(false);
                    return;
                } catch (renderErr) {
                    console.warn('Remotion subtitle render failed, falling back to backend FFmpeg:', renderErr);
                }
            }

            // Fallback: legacy FFmpeg
            const currentFilename = currentVideoUrl?.split('/').pop();
            const originalFilename = clip?.video_url?.split('/').pop();
            const inputFilename = currentVideoUrl?.startsWith('blob:')
                ? originalFilename
                : (currentFilename || originalFilename);
            const res = await fetch(getApiUrl('/api/subtitle'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    position: options.position,
                    font_size: options.fontSize,
                    font_name: options.fontName,
                    font_color: options.fontColor,
                    border_color: options.borderColor,
                    border_width: options.borderWidth,
                    bg_color: options.bgColor,
                    bg_opacity: options.bgOpacity,
                    input_filename: inputFilename
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                if (videoRef.current) videoRef.current.load();
                setShowSubtitleModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsSubtitling(false);
        }
    };

    const handleHook = async (hookData) => {
        setIsHooking(true);
        setEditError(null);
        try {
            if (hookData.remotion) {
                // Ensure the source video is Remotion-decodable (no B-frames)
                const compatUrl = await ensureRenderCompat(renderVideoUrl);
                if (compatUrl !== renderVideoUrl) setRenderVideoUrl(compatUrl);

                const newLayers = { ...activeLayers, hook: hookData.remotion };
                setActiveLayers(newLayers);
                const blobUrl = await renderInBrowser({
                    videoUrl: compatUrl,
                    durationInSeconds: clipDuration,
                    subtitles: newLayers.subtitles,
                    hook: newLayers.hook,
                    effects: newLayers.effects,
                });
                setCurrentVideoUrl(blobUrl);
                if (videoRef.current) videoRef.current.load();
                setShowHookModal(false);
                return;
            }

            // Fallback: legacy FFmpeg
            const payload = typeof hookData === 'string'
                ? { text: hookData, position: 'top', size: 'M' }
                : hookData;

            const res = await fetch(getApiUrl('/api/hook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    text: payload.text,
                    position: payload.position,
                    size: payload.size,
                    input_filename: currentVideoUrl.split('/').pop()
                })
            });

            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                if (videoRef.current) videoRef.current.load();
                setShowHookModal(false);
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsHooking(false);
        }
    };

    const handleTranslate = async (options) => {
        console.log('[Translate] Starting translation with options:', options);
        setIsTranslating(true);
        setEditError(null);
        try {
            const apiKey = elevenLabsKey;
            console.log('[Translate] API Key available:', !!apiKey);

            if (!apiKey) {
                throw new Error("ElevenLabs API Key is missing. Please set it in Settings.");
            }

            const requestBody = {
                job_id: jobId,
                clip_index: index,
                target_language: options.targetLanguage,
                input_filename: currentVideoUrl.split('/').pop()
            };
            console.log('[Translate] Request body:', requestBody);
            console.log('[Translate] Sending request to /api/translate');

            const res = await fetch(getApiUrl('/api/translate'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-ElevenLabs-Key': apiKey
                },
                body: JSON.stringify(requestBody)
            });

            console.log('[Translate] Response status:', res.status);

            if (!res.ok) {
                const errText = await res.text();
                console.error('[Translate] Error response:', errText);
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    if (e.message !== errText) throw e;
                    throw new Error(errText);
                }
            }

            const data = await res.json();
            console.log('[Translate] Success response:', data);
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                if (videoRef.current) {
                    videoRef.current.load();
                }
                setShowTranslateModal(false);
            }

        } catch (e) {
            console.error('[Translate] Exception:', e);
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsTranslating(false);
        }
    };

    const handleEnhance = async () => {
        setIsEnhancing(true);
        setEditError(null);
        try {
            const currentFilename = currentVideoUrl?.split('/').pop();
            const originalFilename = clip?.video_url?.split('/').pop();
            const inputFilename = currentVideoUrl?.startsWith('blob:')
                ? originalFilename
                : (currentFilename || originalFilename);

            const res = await fetch(getApiUrl('/api/enhance'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId,
                    clip_index: index,
                    input_filename: inputFilename,
                })
            });
            if (!res.ok) {
                const err = await res.text();
                try { throw new Error(JSON.parse(err).detail || err); }
                catch (e) { if (e.message !== err) throw e; throw new Error(err); }
            }
            const data = await res.json();
            if (data.new_video_url) {
                setCurrentVideoUrl(getApiUrl(data.new_video_url));
                if (videoRef.current) videoRef.current.load();
            }
        } catch (e) {
            setEditError(e.message);
            setTimeout(() => setEditError(null), 5000);
        } finally {
            setIsEnhancing(false);
        }
    };

    const handlePost = async () => {
        if (!uploadPostKey || !uploadUserId) {
            setPostResult({ success: false, msg: "Missing API Key or User ID." });
            return;
        }

        const selectedPlatforms = Object.keys(platforms).filter(k => platforms[k]);
        if (selectedPlatforms.length === 0) {
            setPostResult({ success: false, msg: "Select at least one platform." });
            return;
        }

        if (isScheduling && !scheduleDate) {
            setPostResult({ success: false, msg: "Please select a date and time." });
            return;
        }

        setPosting(true);
        setPostResult(null);

        try {
            const payload = {
                job_id: jobId,
                clip_index: index,
                api_key: uploadPostKey,
                user_id: uploadUserId,
                platforms: selectedPlatforms,
                title: postTitle,
                description: postDescription
            };

            if (isScheduling && scheduleDate) {
                // Convert to ISO-8601
                payload.scheduled_date = new Date(scheduleDate).toISOString();
                // Optional: pass timezone if needed, backend defaults to UTC or we can send user's timezone
                payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            }

            const res = await fetch(getApiUrl('/api/social/post'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await res.text();
                try {
                    const jsonErr = JSON.parse(errText);
                    throw new Error(jsonErr.detail || errText);
                } catch (e) {
                    throw new Error(errText);
                }
            }

            setPostResult({ success: true, msg: isScheduling ? "Scheduled successfully!" : "Posted successfully!" });
            setTimeout(() => {
                setShowModal(false);
                setPostResult(null);
            }, 3000);

        } catch (e) {
            setPostResult({ success: false, msg: `Failed: ${e.message}` });
        } finally {
            setPosting(false);
        }
    };

    return (
        <div className="bg-surface border border-white/5 rounded-2xl overflow-hidden flex flex-col group hover:border-white/10 transition-all animate-[fadeIn_0.5s_ease-out]" style={{ animationDelay: `${index * 0.1}s` }}>
            {/* Video Preview — large & responsive */}
            <div className="w-full bg-black relative aspect-[9/16] max-h-[70vh] sm:max-h-[65vh] mx-auto group/video" style={{ maxWidth: 'min(100%, 420px)' }}>
                <video
                    ref={videoRef}
                    src={currentVideoUrl}
                    controls
                    className="w-full h-full object-contain bg-black"
                    playsInline
                    onPlay={() => {
                        const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
                        onPlay && onPlay(clip.start + currentTime);
                    }}
                    onPause={() => onPause && onPause()}
                    onEnded={() => {
                        if (videoRef.current) {
                            videoRef.current.currentTime = 0;
                            videoRef.current.play();
                        }
                    }}
                />
                <div className="absolute top-3 left-3 flex gap-2 pointer-events-none">
                    <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md border border-white/10 uppercase tracking-wide">
                        Clip {index + 1}
                    </span>
                    <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-mono px-2 py-1 rounded-md border border-white/10">
                        {Math.floor(clip.end - clip.start)}s
                    </span>
                </div>

                <button
                    onClick={() => setShowFullscreen(true)}
                    className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white p-2 rounded-md border border-white/10 transition-all opacity-0 group-hover/video:opacity-100 focus:opacity-100"
                    title="Expand"
                >
                    <Maximize2 size={14} />
                </button>

                {/* Auto Edit Overlay if Processing */}
                {isEditing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10 p-4 text-center">
                        <Loader2 size={32} className="text-primary animate-spin mb-3" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">AI Magic in Progress...</span>
                        <span className="text-[10px] text-zinc-400 mt-1">Applying viral edits & zooms</span>
                    </div>
                )}
            </div>

            {/* Content & Details */}
            <div className="p-4 md:p-5 flex flex-col bg-[#121214] min-w-0">
                <div className="mb-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className="text-base font-bold text-white leading-tight line-clamp-2 break-words flex-1" title={clip.video_title_for_youtube_short}>
                            {clip.video_title_for_youtube_short || "Viral Clip Generated"}
                        </h3>
                        <button
                            onClick={() => setShowMetadata(v => !v)}
                            className="shrink-0 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 bg-white/5 hover:bg-white/10 rounded-md px-2 py-1 border border-white/5 transition-colors"
                            title={showMetadata ? 'Hide details' : 'Show details'}
                        >
                            {showMetadata ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            <span>{showMetadata ? 'Hide' : 'Details'}</span>
                        </button>
                    </div>
                </div>

                {/* Collapsible Metadata */}
                {showMetadata && (
                    <div className="space-y-3 mb-4 animate-[fadeIn_0.15s_ease-out]">
                        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-red-400 mb-1.5 uppercase tracking-wider">
                                <Youtube size={12} className="shrink-0" /> <span className="truncate">YouTube Title</span>
                            </div>
                            <p className="text-xs text-zinc-300 select-all break-words">
                                {clip.video_title_for_youtube_short || "Viral Short Video"}
                            </p>
                        </div>

                        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400 mb-1.5 uppercase tracking-wider">
                                <Video size={12} className="text-cyan-400 shrink-0" />
                                <span className="text-zinc-500">/</span>
                                <Instagram size={12} className="text-pink-400 shrink-0" />
                                <span className="truncate">Caption</span>
                            </div>
                            <p className="text-xs text-zinc-300 select-all break-words whitespace-pre-wrap">
                                {clip.video_description_for_tiktok || clip.video_description_for_instagram}
                            </p>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {editError && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] rounded-lg flex items-center gap-2">
                        <AlertCircle size={12} className="shrink-0" />
                        {editError}
                    </div>
                )}

                {/* Actions Footer */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-auto pt-3 border-t border-white/5">
                    <button
                        onClick={handleAutoEdit}
                        disabled={isEditing}
                        className="col-span-1 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-purple-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                    >
                        {isEditing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        {isEditing ? 'Editing...' : 'Auto Edit'}
                    </button>

                    <button
                        onClick={() => setShowSubtitleModal(true)}
                        disabled={isSubtitling}
                        className="col-span-1 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                    >
                        {isSubtitling ? <Loader2 size={14} className="animate-spin" /> : <Type size={14} />}
                        {isSubtitling ? 'Adding...' : 'Subtitles'}
                    </button>

                    <button
                        onClick={() => setShowHookModal(true)}
                        disabled={isHooking}
                        className="col-span-1 py-2 bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-black rounded-lg text-xs font-bold shadow-lg shadow-yellow-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                    >
                        {isHooking ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        {isHooking ? 'Adding...' : 'Viral Hook'}
                    </button>

                    <button
                        onClick={() => setShowTranslateModal(true)}
                        disabled={isTranslating}
                        className="col-span-1 py-2 bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-400 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-green-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                    >
                        {isTranslating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                        {isTranslating ? 'Translating...' : 'Dub Voice'}
                    </button>

                    <button
                        onClick={handleEnhance}
                        disabled={isEnhancing}
                        className="col-span-1 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-sky-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-1 truncate px-1"
                    >
                        {isEnhancing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {isEnhancing ? 'Enhancing...' : 'Enhance'}
                    </button>

                    <button
                        onClick={() => setShowModal(true)}
                        className="col-span-1 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg text-xs font-bold shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 truncate px-2"
                    >
                        <Share2 size={14} className="shrink-0" /> Post
                    </button>
                    <button
                        onClick={async (e) => {
                            e.preventDefault();
                            const filename = `clip-${index + 1}.mp4`;
                            try {
                                // If already a blob URL (from in-browser render), download it directly
                                // to avoid re-fetching which can fail and to preserve the MP4 MIME.
                                if (currentVideoUrl.startsWith('blob:')) {
                                    const a = document.createElement('a');
                                    a.style.display = 'none';
                                    a.href = currentVideoUrl;
                                    a.download = filename;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    return;
                                }

                                const response = await fetch(currentVideoUrl);
                                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                                const rawBlob = await response.blob();
                                // Force MP4 MIME type so OS media players open it correctly.
                                const blob = rawBlob.type && rawBlob.type.startsWith('video/')
                                    ? rawBlob
                                    : new Blob([rawBlob], { type: 'video/mp4' });
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.style.display = 'none';
                                a.href = url;
                                a.download = filename;
                                document.body.appendChild(a);
                                a.click();
                                // Defer revoke so some browsers finish writing the file
                                setTimeout(() => window.URL.revokeObjectURL(url), 2000);
                                document.body.removeChild(a);
                            } catch (err) {
                                console.error('Download error:', err);
                                window.open(currentVideoUrl, '_blank');
                            }
                        }}
                        className="col-span-1 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-white/5 truncate px-2"
                    >
                        <Download size={14} className="shrink-0" /> Download
                    </button>
                </div>
            </div>

            {/* Post Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-[#121214] border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
                        <button
                            onClick={() => setShowModal(false)}
                            className="absolute top-4 right-4 text-zinc-500 hover:text-white"
                        >
                            <X size={20} />
                        </button>

                        <h3 className="text-lg font-bold text-white mb-4">Post / Schedule</h3>

                        {!uploadPostKey && (
                            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-xs rounded-lg flex items-start gap-2">
                                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                <div>Configure API Key in Settings first.</div>
                            </div>
                        )}

                        <div className="space-y-4 mb-6">
                            {/* Title & Description */}
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-1">Video Title</label>
                                <input
                                    type="text"
                                    value={postTitle}
                                    onChange={(e) => setPostTitle(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary/50 placeholder-zinc-600"
                                    placeholder="Enter a catchy title..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-1">Caption / Description</label>
                                <textarea
                                    value={postDescription}
                                    onChange={(e) => setPostDescription(e.target.value)}
                                    rows={4}
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-primary/50 placeholder-zinc-600 resize-none"
                                    placeholder="Write a caption for your post..."
                                />
                            </div>

                            {/* Scheduling */}
                            <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 text-sm text-white font-medium">
                                        <Calendar size={16} className="text-purple-400" /> Schedule Post
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" checked={isScheduling} onChange={(e) => setIsScheduling(e.target.checked)} className="sr-only peer" />
                                        <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                                    </label>
                                </div>

                                {isScheduling && (
                                    <div className="mt-3 animate-[fadeIn_0.2s_ease-out]">
                                        <label className="block text-xs text-zinc-400 mb-1">Select Date & Time</label>
                                        <div className="relative">
                                            <input
                                                type="datetime-local"
                                                value={scheduleDate}
                                                onChange={(e) => setScheduleDate(e.target.value)}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg p-2 pl-9 text-sm text-white focus:outline-none focus:border-purple-500/50 [color-scheme:dark]"
                                            />
                                            <Clock size={14} className="absolute left-3 top-2.5 text-zinc-500" />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Platforms */}
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-2">Select Platforms</label>
                                <div className="grid grid-cols-1 gap-2">
                                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors border border-white/5">
                                        <input type="checkbox" checked={platforms.tiktok} onChange={e => setPlatforms({ ...platforms, tiktok: e.target.checked })} className="w-4 h-4 rounded border-zinc-600 bg-black/50 text-primary focus:ring-primary" />
                                        <div className="flex items-center gap-2 text-sm text-white"><Video size={16} className="text-cyan-400" /> TikTok</div>
                                    </label>
                                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors border border-white/5">
                                        <input type="checkbox" checked={platforms.instagram} onChange={e => setPlatforms({ ...platforms, instagram: e.target.checked })} className="w-4 h-4 rounded border-zinc-600 bg-black/50 text-primary focus:ring-primary" />
                                        <div className="flex items-center gap-2 text-sm text-white"><Instagram size={16} className="text-pink-400" /> Instagram</div>
                                    </label>
                                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors border border-white/5">
                                        <input type="checkbox" checked={platforms.youtube} onChange={e => setPlatforms({ ...platforms, youtube: e.target.checked })} className="w-4 h-4 rounded border-zinc-600 bg-black/50 text-primary focus:ring-primary" />
                                        <div className="flex items-center gap-2 text-sm text-white"><Youtube size={16} className="text-red-400" /> YouTube Shorts</div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {postResult && (
                            <div className={`mb-4 p-3 rounded-lg text-xs flex items-start gap-2 ${postResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                {postResult.success ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                                <div>{postResult.msg}</div>
                            </div>
                        )}

                        <button
                            onClick={handlePost}
                            disabled={posting || !uploadPostKey}
                            className="w-full py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-bold transition-all flex items-center justify-center gap-2"
                        >
                            {posting ? <><Loader2 size={16} className="animate-spin" /> {isScheduling ? 'Scheduling...' : 'Publishing...'}</> : <><Share2 size={16} /> {isScheduling ? 'Schedule Post' : 'Publish Now'}</>}
                        </button>
                    </div>
                </div>
            )}

            <SubtitleModal
                isOpen={showSubtitleModal}
                onClose={() => setShowSubtitleModal(false)}
                onGenerate={handleSubtitle}
                isProcessing={isSubtitling}
                videoUrl={originalVideoUrl}
                jobId={jobId}
                clipIndex={index}
                existingHook={activeLayers.hook}
                existingEffects={activeLayers.effects}
            />

            <HookModal
                isOpen={showHookModal}
                onClose={() => setShowHookModal(false)}
                onGenerate={handleHook}
                isProcessing={isHooking}
                videoUrl={originalVideoUrl}
                initialText={clip.viral_hook_text}
                durationInSeconds={clip.end && clip.start ? clip.end - clip.start : 30}
                existingSubtitles={activeLayers.subtitles}
                existingEffects={activeLayers.effects}
            />

            <TranslateModal
                isOpen={showTranslateModal}
                onClose={() => setShowTranslateModal(false)}
                onTranslate={handleTranslate}
                isProcessing={isTranslating}
                videoUrl={currentVideoUrl}
                hasApiKey={!!elevenLabsKey}
            />

            {/* Fullscreen Video Modal */}
            {showFullscreen && (
                <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center animate-[fadeIn_0.15s_ease-out]" onClick={() => setShowFullscreen(false)}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowFullscreen(false); }}
                        className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white p-2.5 rounded-lg border border-white/10 transition-all z-10"
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                    <div className="h-full w-full flex items-center justify-center p-4 sm:p-8" onClick={(e) => e.stopPropagation()}>
                        <div className="relative h-full max-h-[95vh] aspect-[9/16] bg-black rounded-xl overflow-hidden shadow-2xl">
                            <video
                                src={currentVideoUrl}
                                controls
                                autoPlay
                                className="w-full h-full object-contain"
                                playsInline
                            />
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
