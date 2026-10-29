import { useEffect, useState } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { useReducedMotion } from "@/lib/motion";

// Same artwork as the web app's public/mascot.svg
const MASCOT_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="novaBodyF" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#b6cdb2"/>
      <stop offset="50%" stop-color="#8da38a"/>
      <stop offset="100%" stop-color="#4f644e"/>
    </linearGradient>
    <linearGradient id="novaHighlightF" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#e7e1de" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#e7e1de" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ringGradF" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#b6cdb2"/>
      <stop offset="100%" stop-color="#8da38a"/>
    </linearGradient>
  </defs>
  <ellipse cx="100" cy="162" rx="36" ry="7" fill="none" stroke="url(#ringGradF)" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
  <ellipse cx="100" cy="174" rx="22" ry="4.5" fill="none" stroke="url(#ringGradF)" stroke-width="4.5" stroke-linecap="round" opacity="0.65"/>
  <path d="M 100 48 C 96 36 90 28 85 24 C 95 24 104 32 100 48 Z" fill="#8da38a"/>
  <path d="M 100 48 C 104 36 110 28 115 24 C 105 24 96 32 100 48 Z" fill="#b6cdb2"/>
  <ellipse cx="50" cy="74" rx="8" ry="13" transform="rotate(-35 50 74)" fill="#8da38a"/>
  <ellipse cx="150" cy="74" rx="8" ry="13" transform="rotate(35 150 74)" fill="#8da38a"/>
  <circle cx="48" cy="62" r="5" fill="#b6cdb2"/>
  <circle cx="152" cy="62" r="5" fill="#b6cdb2"/>
  <ellipse cx="100" cy="95" rx="56" ry="50" fill="url(#novaBodyF)"/>
  <ellipse cx="94" cy="70" rx="38" ry="22" fill="url(#novaHighlightF)"/>
  <rect x="58" y="70" width="84" height="52" rx="26" fill="#223522" opacity="0.95"/>
  <path d="M 148 42 L 151 48 L 158 50 L 152 55 L 154 61 L 148 57 L 142 61 L 144 55 L 138 50 L 145 48 Z" fill="#f7b8a5"/>
  <circle cx="148" cy="51" r="2" fill="#e7e1de"/>
  <path d="M 166 66 L 167 69 L 170 70 L 167 71 L 166 74 L 165 71 L 162 70 L 165 69 Z" fill="#b6cdb2"/>
  <path d="M 72 96 C 72 87 84 87 84 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 116 96 C 116 87 128 87 128 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 95 106 Q 100 110 105 106" fill="none" stroke="#b6cdb2" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const toHead = (xml: string) => xml.replace('viewBox="0 0 200 200"', 'viewBox="34 16 132 132"');
const HEAD_XML = toHead(MASCOT_XML);

const HAPPY_EYES = `  <path d="M 72 96 C 72 87 84 87 84 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 116 96 C 116 87 128 87 128 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>`;
// Eyes shut for a blink
const BLINK_EYES = `  <path d="M 72 94 L 84 94" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 116 94 L 128 94" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>`;
const BLINK_XML = MASCOT_XML.replace(HAPPY_EYES, BLINK_EYES);
const BLINK_HEAD_XML = toHead(BLINK_XML);

const FLOAT_PX = 4;
const FLOAT_MS = 1800;
const BLINK_EVERY_MS = 4200;
const BLINK_MS = 140;

/**
 * Nudge Buddy mascot. `full` = whole character with rings (hero spots);
 * `head` = cropped tight for logo/avatar sizes. `animated` = idle: a slow float
 * and the odd blink, both off with Reduce Motion.
 */
export function Mascot({ size = 32, variant = "head", animated }: { size?: number; variant?: "full" | "head"; animated?: boolean }) {
  const reduceMotion = useReducedMotion();
  const idle = !!animated && !reduceMotion;
  const [blinking, setBlinking] = useState(false);
  const y = useSharedValue(0);

  useEffect(() => {
    if (!idle) return;
    y.set(withRepeat(withSequence(
      withTiming(-FLOAT_PX, { duration: FLOAT_MS, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: FLOAT_MS, easing: Easing.inOut(Easing.sin) }),
    ), -1));
    let open: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setBlinking(true);
      open = setTimeout(() => setBlinking(false), BLINK_MS);
    }, BLINK_EVERY_MS);
    return () => { clearInterval(id); clearTimeout(open); y.set(0); };
  }, [idle, y]);

  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const xml = variant === "full" ? (blinking ? BLINK_XML : MASCOT_XML) : (blinking ? BLINK_HEAD_XML : HEAD_XML);
  if (!idle) return <SvgXml xml={xml} width={size} height={size} />;
  return (
    <Animated.View style={floatStyle}>
      <SvgXml xml={xml} width={size} height={size} />
    </Animated.View>
  );
}

const HAPPY_FACE = `  <path d="M 72 96 C 72 87 84 87 84 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 116 96 C 116 87 128 87 128 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 95 106 Q 100 110 105 106" fill="none" stroke="#b6cdb2" stroke-width="3" stroke-linecap="round"/>`;

// One eye open, one winking, bigger grin
const WINK_FACE = `  <ellipse cx="78" cy="93" rx="5.5" ry="7" fill="#b6cdb2"/>
  <path d="M 116 96 C 116 87 128 87 128 96" fill="none" stroke="#b6cdb2" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M 92 104 Q 100 116 108 104 Z" fill="#b6cdb2" stroke="#b6cdb2" stroke-width="2" stroke-linejoin="round"/>`;

const PARTY_HAT = `  <g transform="rotate(-12 100 46)">
    <path d="M 80 50 L 100 4 L 120 50 Z" fill="#f7b8a5"/>
    <path d="M 91 25 L 109 25 L 112 32 L 88 32 Z M 84 41 L 116 41 L 118 46 L 82 46 Z" fill="#e7e1de" opacity="0.85"/>
    <ellipse cx="100" cy="50" rx="22" ry="4" fill="#673b2d"/>
    <circle cx="100" cy="5" r="6" fill="#b6cdb2"/>
  </g>
</svg>`;

const PARTY_XML = MASCOT_XML.replace("</svg>", PARTY_HAT);
const PARTY_WINK_XML = PARTY_XML.replace(HAPPY_FACE, WINK_FACE);

/** Full Buddy in a party hat — winking unless `wink` is false. For celebrations. */
export function PartyMascot({ size = 112, wink = true }: { size?: number; wink?: boolean }) {
  return <SvgXml xml={wink ? PARTY_WINK_XML : PARTY_XML} width={size} height={size} />;
}
