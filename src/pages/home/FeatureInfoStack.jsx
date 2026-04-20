import React from "react";
import { stripRiverSuffix } from "./functions";
import { GLACIER_THICKNESS_CLASSES, GLACIER_YEAR_COLORS } from "./constants";

const FeatureInfoStack = React.memo(({
  selectedRiverName,
  selectedLake,
  selectedGlacier,
  t,
  bathymetryLoading,
  hillshadeKey,
  glacierThicknessKey,
  glacierHistory,
  infrastructure,
  riverInfra,
  riverHydro,
}) => (
  <div className="feature-info-stack">
    {(selectedRiverName || selectedLake || selectedGlacier) && (
      <div className="feature-label">
        <div className="feature-label-type">
          {selectedRiverName ? t.river : selectedLake ? t.lake : t.glacier}
        </div>
        <div className="feature-label-name">
          {stripRiverSuffix(selectedRiverName) || selectedLake?.name || selectedGlacier?.name}
        </div>
      </div>
    )}

    {bathymetryLoading && (
      <div className="bathy-loading">
        <div className="loading-spinner" />
        <div className="loading-label">{t.loadingBathymetry}</div>
      </div>
    )}

    {!bathymetryLoading && hillshadeKey && selectedLake?.max_depth && (
      <div className="bathy-legend">
        <div className="bathy-legend-bar" />
        <div className="bathy-legend-labels">
          <span>0 m</span>
          <span>{Math.round(selectedLake.max_depth)} m</span>
        </div>
      </div>
    )}

    {(glacierThicknessKey || glacierHistory) && (
      <div className="glacier-legends">
        {glacierThicknessKey && (
          <div className="thickness-legend">
            {GLACIER_THICKNESS_CLASSES.map(({ label, rgb }) => (
              <div key={label} className="thickness-legend-item">
                <div className="thickness-swatch" style={{ background: `rgb(${rgb.join(",")})` }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
        {glacierHistory && (
          <div className="glacier-year-legend">
            <div className="glacier-year-legend-item">
              <svg width="28" height="10" className="glacier-year-swatch">
                <line x1="0" y1="5" x2="28" y2="5" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeDasharray="6 4" />
              </svg>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>{t.surveys}</span>
            </div>
            {[...glacierHistory.features].reverse().map((f) => {
              const year = f.properties.year;
              const [r, g, b] = GLACIER_YEAR_COLORS[year] ?? [255, 255, 255];
              const isLast = year === glacierHistory.features[glacierHistory.features.length - 1].properties.year;
              return (
                <div key={year} className="glacier-year-legend-item">
                  <svg width="28" height="10" className="glacier-year-swatch">
                    <line x1="0" y1="5" x2="28" y2="5" stroke={`rgb(${r},${g},${b})`} strokeWidth="1.5" strokeDasharray={isLast ? "none" : "6 4"} />
                  </svg>
                  <span style={{ color: `rgb(${r},${g},${b})` }}>{year}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}

    {selectedRiverName && infrastructure && (
      <div className="infra-legend">
        {(riverInfra.dams.length > 0 || riverInfra.damWithPower.length > 0) && (
          <div className="infra-legend-item">
            <svg width="18" height="18" viewBox="0 0 32 32">
              <polygon points="12,4 20,4 24,28 8,28" fill="rgb(122,154,184)" />
            </svg>
            {t.dam}
          </div>
        )}
        {(riverInfra.power.length > 0 || riverInfra.damWithPower.length > 0) && (
          <div className="infra-legend-item">
            <svg width="18" height="18" viewBox="0 0 32 32">
              <polygon points="19,2 8,18 16,18 12,30 24,14 16,14" fill="rgb(232,164,58)" />
            </svg>
            {t.powerstation}
          </div>
        )}
        {riverHydro.length > 0 && (
          <div className="infra-legend-item">
            <svg width="18" height="18" viewBox="0 0 64 64">
              <rect x="18" y="8" width="18" height="48" rx="2" fill="#C084FC" opacity="0.35"/>
              <rect x="18" y="30" width="18" height="26" rx="2" fill="#C084FC"/>
            </svg>
            {t.hydroStation}
          </div>
        )}
      </div>
    )}
  </div>
));

export default FeatureInfoStack;
