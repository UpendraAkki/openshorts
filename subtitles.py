import os
import subprocess


def transcribe_audio(video_path):
    """
    Transcribe audio from a video file using faster-whisper.
    Returns transcript in the same format as main.py for compatibility.
    """
    from faster_whisper import WhisperModel

    print(f"🎙️  Transcribing audio from: {video_path}")

    # Run on CPU with INT8 quantization for speed
    model = WhisperModel("base", device="cpu", compute_type="int8")

    segments, info = model.transcribe(video_path, word_timestamps=True)

    transcript = {
        "segments": [],
        "language": info.language
    }

    for segment in segments:
        seg_data = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
            "words": []
        }
        if segment.words:
            for word in segment.words:
                seg_data["words"].append({
                    "word": word.word.strip(),
                    "start": word.start,
                    "end": word.end
                })
        transcript["segments"].append(seg_data)

    print(f"✅ Transcription complete. Language: {info.language}")
    return transcript


def generate_srt_from_video(video_path, output_path, max_chars=20, max_duration=2.0):
    """
    Transcribe a video and generate SRT directly.
    Used for dubbed videos that don't have a pre-existing transcript.
    """
    transcript = transcribe_audio(video_path)

    # Get video duration to use as clip_end
    import cv2
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps else 0
    cap.release()

    return generate_srt(transcript, 0, duration, output_path, max_chars, max_duration)


def generate_srt(transcript, clip_start, clip_end, output_path, max_chars=20, max_duration=2.0):
    """
    Generates an SRT file from the transcript for a specific time range.
    Groups words into short lines suitable for vertical video.
    """
    
    words = []
    # 1. Extract and flatten words within range
    for segment in transcript.get('segments', []):
        for word_info in segment.get('words', []):
            # Check overlap
            if word_info['end'] > clip_start and word_info['start'] < clip_end:
                words.append(word_info)
    
    if not words:
        return False

    srt_content = ""
    index = 1
    
    current_block = []
    block_start = None
    
    for i, word in enumerate(words):
        # Adjust times relative to clip
        start = max(0, word['start'] - clip_start)
        end = max(0, word['end'] - clip_start)
        
        # Clip to video duration logic handled by ffmpeg usually, but good to be safe
        
        if not current_block:
            current_block.append(word)
            block_start = start
        else:
            # Decide whether to close block
            current_text_len = sum(len(w['word']) + 1 for w in current_block)
            duration = end - block_start
            
            if current_text_len + len(word['word']) > max_chars or duration > max_duration:
                # Finalize current block
                # End time of block is start of this word (gap) or end of last word?
                # Usually end of last word.
                block_end = current_block[-1]['end'] - clip_start
                
                text = " ".join([w['word'] for w in current_block]).strip()
                srt_content += format_srt_block(index, block_start, block_end, text)
                index += 1
                
                current_block = [word]
                block_start = start
            else:
                current_block.append(word)
    
    # Final block
    if current_block:
        block_end = current_block[-1]['end'] - clip_start
        text = " ".join([w['word'] for w in current_block]).strip()
        srt_content += format_srt_block(index, block_start, block_end, text)
        
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(srt_content)
        
    return True

def format_srt_block(index, start, end, text):
    def format_time(seconds):
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
        
    return f"{index}\n{format_time(start)} --> {format_time(end)}\n{text}\n\n"

def hex_to_ass_color(hex_color, opacity=1.0):
    """Convert #RRGGBB to ASS &HAABBGGRR format. opacity: 0.0=transparent, 1.0=opaque"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        hex_color = "FFFFFF"
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    alpha = round((1.0 - opacity) * 255)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def burn_subtitles(video_path, srt_path, output_path, alignment=2, fontsize=16,
                   font_name="Verdana", font_color="#FFFFFF",
                   border_color="#000000", border_width=2,
                   bg_color="#000000", bg_opacity=0.0):
    """
    Burns subtitles into the video using FFmpeg with ASS styling.
    Uses PlayResY=100 scaling trick so font sizes behave like percentages of video height.
    """
    # Position alignment mapping (ASS numpad layout)
    ass_alignment = 2
    align_lower = str(alignment).lower()
    if align_lower == 'top':
        ass_alignment = 8
    elif align_lower == 'middle':
        ass_alignment = 5
    elif align_lower == 'bottom':
        ass_alignment = 2

    # For a 1920px tall video with PlayResY=720, fontsize 18 ≈ 3.4% of height ≈ 65px
    # We keep font sizes in the 14-20 range which renders well for 1080x1920 vertical video
    # Apply a gentle scaling to convert user's preview size to ASS units
    # User fontsize is in ~16-48 range (small preview); scale for 1080p vertical
    final_fontsize = max(12, int(fontsize * 0.9))

    # Path handling for FFmpeg filter syntax (cross-platform safe)
    safe_srt_path = srt_path.replace('\\', '/').replace(':', '\\\\:')

    primary_colour = hex_to_ass_color(font_color, 1.0)

    if bg_opacity > 0:
        border_style = 3  # Box mode
        outline_colour = hex_to_ass_color(bg_color, bg_opacity)
        outline_width = 1
        shadow_depth = 0
    else:
        border_style = 1  # Outline mode
        outline_colour = hex_to_ass_color(border_color, 1.0)
        outline_width = max(1, border_width)
        shadow_depth = 0

    back_colour = hex_to_ass_color("#000000", 0.0)

    style_string = (
        f"Alignment={ass_alignment},"
        f"Fontname={font_name},"
        f"Fontsize={final_fontsize},"
        f"PrimaryColour={primary_colour},"
        f"OutlineColour={outline_colour},"
        f"BackColour={back_colour},"
        f"BorderStyle={border_style},"
        f"Outline={outline_width},"
        f"Shadow={shadow_depth},"
        f"MarginV=60,"
        f"Bold=1,"
        f"Spacing=0"
    )

    cmd = [
        'ffmpeg', '-y',
        '-i', video_path,
        '-vf', f"subtitles='{safe_srt_path}':force_style='{style_string}'",
        '-c:a', 'aac', '-b:a', '192k',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
        '-profile:v', 'high', '-level', '4.2',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        output_path
    ]

    print(f"🎬 Burning subtitles: {' '.join(cmd)}")
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    if result.returncode != 0:
        print(f"❌ FFmpeg Subtitle Error: {result.stderr.decode()}")
        raise Exception(f"FFmpeg failed: {result.stderr.decode()}")

    return True


def _caption_word_to_remotion(word_info, clip_start, clip_end, min_word_ms=50):
    """
    One word -> Remotion {text, startMs, endMs} relative to clip start.
    Clamps to clip range and enforces a minimum duration for stable highlighting.
    """
    raw = (word_info.get("word") or "").strip()
    w_start = float(word_info.get("start", 0))
    w_end = float(word_info.get("end", w_start))
    start = max(0.0, w_start - clip_start)
    end = max(start, w_end - clip_start)
    clip_len = max(0.0, float(clip_end) - float(clip_start))
    if clip_len > 0:
        end = min(end, clip_len)
    start = min(start, end)
    start_ms = int(round(start * 1000))
    end_ms = int(round(end * 1000))
    if end_ms - start_ms < min_word_ms:
        end_ms = start_ms + min_word_ms
    return {"text": raw, "startMs": start_ms, "endMs": end_ms}


def extract_clip_captions(transcript, clip_start, clip_end):
    """
    Build word-level caption list for one clip (times relative to clip t=0).
    Used by API and for precomputed metadata (clip_captions).
    """
    captions = []
    if not transcript or not transcript.get("segments"):
        return captions
    cs, ce = float(clip_start), float(clip_end)
    for segment in transcript["segments"]:
        for word_info in segment.get("words") or []:
            try:
                w_end = float(word_info.get("end", 0))
                w_start = float(word_info.get("start", 0))
            except (TypeError, ValueError):
                continue
            if w_end > cs and w_start < ce:
                captions.append(_caption_word_to_remotion(word_info, cs, ce))
    return captions


def build_per_clip_captions_metadata(transcript, shorts):
    """
    Precompute per-clip captions for Remotion so the client can load subtitles
    without re-scanning the full transcript. Each entry matches /api/clip/.../transcript.
    """
    if not transcript or not shorts:
        return []
    out = []
    for clip in shorts:
        cs = float(clip.get("start", 0))
        ce = float(clip.get("end", 0))
        caps = extract_clip_captions(transcript, cs, ce)
        out.append(
            {
                "captions": caps,
                "durationSec": max(0.0, ce - cs),
            }
        )
    return out

