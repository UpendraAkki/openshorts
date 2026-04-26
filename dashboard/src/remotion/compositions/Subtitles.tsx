import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { SubtitleConfig } from "../lib/types";
import { groupCaptionsIntoBlocks, getActiveWordIndex } from "../lib/captions";
import { getFontStack } from "../lib/fonts";

interface SubtitlesProps {
  config: SubtitleConfig;
}

const getPositionStyle = (
  position: string,
  verticalPosition?: number
): React.CSSProperties => {
  if (typeof verticalPosition === "number") {
    const clamped = Math.min(95, Math.max(5, verticalPosition));
    return {
      top: `${clamped}%`,
      bottom: "auto",
      transform: "translateY(-50%)",
    };
  }
  const POSITION_MAP: Record<string, React.CSSProperties> = {
    top: { top: "10%", bottom: "auto" },
    middle: { top: "50%", bottom: "auto", transform: "translateY(-50%)" },
    bottom: { bottom: "12%", top: "auto" },
  };
  return POSITION_MAP[position] ?? POSITION_MAP.bottom;
};

export const Subtitles: React.FC<SubtitlesProps> = ({ config }) => {
  const { fps } = useVideoConfig();
  // Fewer words per block = more TikTok-like
  const maxChars = config.style.maxCharsPerBlock ?? 14;
  const blocks = groupCaptionsIntoBlocks(config.captions, maxChars);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {blocks.map((block, i) => {
        const startFrame = Math.round((block.startMs / 1000) * fps);
        const durationFrames = Math.max(
          1,
          Math.round(((block.endMs - block.startMs) / 1000) * fps)
        );

        return (
          <Sequence
            key={i}
            from={startFrame}
            durationInFrames={durationFrames}
            layout="none"
          >
            <SubtitleBlock
              block={block}
              config={config}
              blockStartMs={block.startMs}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

interface SubtitleBlockProps {
  block: ReturnType<typeof groupCaptionsIntoBlocks>[number];
  config: SubtitleConfig;
  blockStartMs: number;
}

const SubtitleBlock: React.FC<SubtitleBlockProps> = ({
  block,
  config,
  blockStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { style, position } = config;

  const currentTimeMs = blockStartMs + (frame / fps) * 1000;
  const activeIndex = getActiveWordIndex(block.words, currentTimeMs);

  const positionStyle = getPositionStyle(position, config.verticalPosition);
  const fontStack = getFontStack(style.fontFamily);

  // Block entrance animation – quick scale-in
  const blockEntrance = spring({
    frame,
    fps,
    config: { mass: 0.4, stiffness: 280, damping: 18 },
    durationInFrames: 8,
  });
  const blockScale = interpolate(blockEntrance, [0, 1], [0.85, 1]);
  const blockOpacity = interpolate(blockEntrance, [0, 1], [0, 1]);

  // Background box style
  const hasBg = style.bgOpacity > 0;
  const bgStyle: React.CSSProperties = hasBg
    ? {
        backgroundColor: `${style.bgColor}${Math.round(style.bgOpacity * 255)
          .toString(16)
          .padStart(2, "0")}`,
        borderRadius: 12,
        padding: "10px 20px",
      }
    : {};

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        ...positionStyle,
        transform: `${positionStyle.transform ?? ""} scale(${blockScale})`,
        opacity: blockOpacity,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: `${Math.max(4, style.fontSize * 0.12)}px`,
          maxWidth: "88%",
          lineHeight: 1.2,
          ...bgStyle,
        }}
      >
        {block.words.map((word, i) => (
          <WordSpan
            key={i}
            word={word.text}
            isActive={i === activeIndex}
            style={style}
            fontStack={fontStack}
            animation={style.animation}
            frame={frame}
            fps={fps}
            wordStartMs={word.startMs}
            blockStartMs={blockStartMs}
          />
        ))}
      </div>
    </div>
  );
};

interface WordSpanProps {
  word: string;
  isActive: boolean;
  style: SubtitleConfig["style"];
  fontStack: string;
  animation: SubtitleConfig["style"]["animation"];
  frame: number;
  fps: number;
  wordStartMs: number;
  blockStartMs: number;
}

const WordSpan: React.FC<WordSpanProps> = ({
  word,
  isActive,
  style,
  fontStack,
  animation,
  frame,
  fps,
  wordStartMs,
  blockStartMs,
}) => {
  const wordStartFrame = Math.round(
    ((wordStartMs - blockStartMs) / 1000) * fps
  );

  let transform = "";
  let color = style.fontColor;
  let extraStyle: React.CSSProperties = {};

  if (isActive) {
    color = style.highlightColor;

    switch (animation) {
      case "pop": {
        const progress = spring({
          frame: frame - wordStartFrame,
          fps,
          config: { mass: 0.35, stiffness: 380, damping: 14 },
          durationInFrames: 12,
        });
        const scaleValue = interpolate(progress, [0, 1], [0.7, 1.22]);
        transform = `scale(${scaleValue})`;
        break;
      }
      case "karaoke": {
        extraStyle = {
          backgroundColor: style.highlightColor,
          color: style.bgColor || "#000000",
          borderRadius: 6,
          padding: "3px 8px",
          marginLeft: "-3px",
          marginRight: "-3px",
        };
        break;
      }
      case "word-highlight": {
        extraStyle = {
          textShadow: `0 0 16px ${style.highlightColor}, 0 0 32px ${style.highlightColor}60`,
        };
        break;
      }
      case "bounce": {
        const progress = spring({
          frame: frame - wordStartFrame,
          fps,
          config: { mass: 0.5, stiffness: 500, damping: 10 },
          durationInFrames: 14,
        });
        const yOffset = interpolate(progress, [0, 1], [12, 0]);
        transform = `translateY(${yOffset}px) scale(1.18)`;
        break;
      }
      default:
        break;
    }
  }

  // Outline: @remotion/web-renderer emulates CSS to canvas — heavy multi-shadow
  // often disappears in the exported file. Prefer -webkit-text-stroke (documented as supported).
  const bw = style.borderWidth;
  const bc = style.borderColor;
  const hasOutline = bw > 0;
  const strokeW = Math.min(Math.max(bw, 0.5), 5);
  const outlineStyle: React.CSSProperties =
    hasOutline && animation !== "karaoke"
      ? { WebkitTextStroke: `${strokeW}px ${bc}`, paintOrder: "stroke fill" }
      : hasOutline && animation === "karaoke" && !isActive
        ? { WebkitTextStroke: `${Math.min(strokeW, 3)}px ${bc}`, paintOrder: "stroke fill" }
        : {};
  const finalTextShadow =
    animation === "word-highlight" && isActive
      ? (extraStyle.textShadow as string) || "none"
      : "none";

  const displayWord = style.uppercase ? word.toUpperCase() : word;

  return (
    <span
      style={{
        fontFamily: fontStack,
        fontSize: style.fontSize,
        fontWeight: 900,
        lineHeight: 1.15,
        letterSpacing: style.uppercase ? "0.04em" : "0.01em",
        color: animation === "karaoke" && isActive ? undefined : color,
        textShadow: finalTextShadow,
        ...outlineStyle,
        transform,
        display: "inline-block",
        transformOrigin: "center bottom",
        whiteSpace: "nowrap",
        ...extraStyle,
      }}
    >
      {displayWord}
    </span>
  );
};
