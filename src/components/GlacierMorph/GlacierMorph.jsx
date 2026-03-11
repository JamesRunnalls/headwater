import { useState, useMemo } from "react";
import "./GlacierMorph.css";

// ---------------------------------------------------------------------------
// Sample / fallback data — static extents simulating a retreating glacier.
// Replaced by real data when the `frames` prop is provided (scripts/glaciers.py).
// ---------------------------------------------------------------------------

const SAMPLE_FRAMES = [
  {
    year: 1950,
    path: "M 180,120 L 210,90 L 255,80 L 310,95 L 350,125 L 370,165 L 360,210 L 340,250 L 320,290 L 295,320 L 260,340 L 225,330 L 195,305 L 170,270 L 155,235 L 148,195 L 155,158 Z",
  },
  {
    year: 1970,
    path: "M 197,138 L 222,113 L 261,103 L 305,116 L 338,142 L 353,178 L 343,218 L 326,254 L 306,287 L 281,311 L 251,326 L 220,317 L 196,294 L 178,264 L 167,233 L 163,202 L 169,170 Z",
  },
  {
    year: 1990,
    path: "M 220,163 L 243,142 L 274,134 L 308,143 L 330,164 L 339,195 L 332,226 L 317,256 L 297,280 L 272,298 L 247,309 L 221,303 L 203,284 L 191,259 L 186,234 L 185,211 L 190,188 Z",
  },
  {
    year: 2020,
    path: "M 256,208 L 272,195 L 293,191 L 313,198 L 324,214 L 325,234 L 318,252 L 305,265 L 286,272 L 265,270 L 248,258 L 240,241 L 240,222 Z",
  },
];

const SAMPLE_COLORS = { 1950: "#b8d8ee", 1970: "#7ab8e0", 1990: "#3d8ec4", 2020: "#0a4a8c" };

const INVENTORY_COLORS = {
  1850: "#cce8f4",
  1931: "#9ac8e8",
  1973: "#5aa4d4",
  2010: "#2478b0",
  2016: "#0a4a8c",
};

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lerpColor(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/**
 * GlacierMorph — static glacier extent visualization.
 *
 * Props:
 *   frames  (optional)  Array<{ year: number, path: string }> sorted ascending.
 *                       Last frame is the most recent extent (filled).
 *                       All earlier frames are shown as dashed outlines.
 *                       Hovering a dashed outline reveals its year label.
 */
const GlacierMorph = ({ frames: framesProp }) => {
  const activeFrames = useMemo(
    () => (framesProp && framesProp.length >= 1 ? framesProp : SAMPLE_FRAMES),
    [framesProp]
  );

  const decadeColors = useMemo(() => {
    if (!framesProp || framesProp.length < 1) return SAMPLE_COLORS;
    const n = activeFrames.length;
    const result = {};
    activeFrames.forEach((f, idx) => {
      result[f.year] =
        INVENTORY_COLORS[f.year] ??
        lerpColor("#cce8f4", "#0a4a8c", n > 1 ? idx / (n - 1) : 0);
    });
    return result;
  }, [activeFrames, framesProp]);

  const [hoveredYear, setHoveredYear] = useState(null);

  const current = activeFrames[activeFrames.length - 1];
  const historical = activeFrames.slice(0, -1);

  return (
    <div className="glacier-morph">
      <div className="glacier-morph-svg-container">
        <svg
          className="glacier-morph-svg"
          viewBox="0 0 500 500"
          aria-label="Glacier retreat visualization"
        >
          <defs>
            <pattern id="gm-ice-texture" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <rect width="20" height="20" fill="#a8d4f0" fillOpacity="0.12" />
              <line x1="0" y1="10" x2="20" y2="10" stroke="#c8e8ff" strokeOpacity="0.08" strokeWidth="0.5" />
              <line x1="10" y1="0" x2="10" y2="20" stroke="#c8e8ff" strokeOpacity="0.06" strokeWidth="0.5" />
              <circle cx="5" cy="5" r="0.7" fill="#ddeeff" fillOpacity="0.15" />
              <circle cx="15" cy="15" r="0.7" fill="#ddeeff" fillOpacity="0.15" />
            </pattern>
            <filter id="gm-glacier-glow" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Historical extents — dashed, oldest to newest-1 */}
          {historical.map((frame) => (
            <g
              key={frame.year}
              onMouseEnter={() => setHoveredYear(frame.year)}
              onMouseLeave={() => setHoveredYear(null)}
            >
              <path
                d={frame.path}
                fill="none"
                fillRule="evenodd"
                className={`glacier-contour glacier-contour--dashed${hoveredYear === frame.year ? " glacier-contour--hovered" : ""}`}
                style={{ stroke: decadeColors[frame.year] }}
              />
            </g>
          ))}

          {/* Most recent extent — filled */}
          <path
            d={current.path}
            className="glacier-active"
            fill="url(#gm-ice-texture)"
            fillRule="evenodd"
            filter="url(#gm-glacier-glow)"
            style={{ stroke: decadeColors[current.year] }}
          />

          {/* Hovered year label */}
          {hoveredYear !== null && (
            <text className="glacier-label glacier-label--hover" x={20} y={30}>
              {hoveredYear}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
};

export default GlacierMorph;
