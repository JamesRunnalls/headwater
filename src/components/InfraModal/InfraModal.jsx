import { useState, useEffect } from "react";
import "./InfraModal.css";
import "../stat-card.css";
import CONFIG from "../../config.json";
import { fmt, buildStat } from "../../statConfigs";

const timeAgo = (isoString, t) => {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t?.justNow ?? "just now";
  if (diffMin < 60) return (t?.minAgo ?? "{n} min ago").replace("{n}", diffMin);
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return (t?.hAgo ?? "{n}h ago").replace("{n}", diffH);
  const diffD = Math.floor(diffH / 24);
  return (t?.dAgo ?? "{n}d ago").replace("{n}", diffD);
};

const dataAgeHours = (isoString) => {
  if (!isoString) return null;
  return (Date.now() - new Date(isoString).getTime()) / 3600000;
};

const agoClass = (isoString) => {
  const h = dataAgeHours(isoString);
  if (h == null) return "";
  if (h >= 12) return " ago-red";
  if (h >= 6) return " ago-orange";
  return "";
};

const VARIANTS = {
  dam: {
    label: (t) => t.dam || "Dam",
    stats: (p, t) => [
      buildStat("dam_height_m", p?.dam_height_m, t),
      buildStat("crest_level_m", p?.crest_level_m, t),
      buildStat("dam_type", p?.dam_type, t),
      buildStat("reservoir_volume_hm3", p?.reservoir_volume_hm3, t),
      buildStat("reservoir_level_m", p?.reservoir_level_m, t),
      buildStat("construction_year", p?.construction_year, t),
    ],
  },
  power: {
    label: (t) => t.powerstation || "Power Station",
    stats: (p, t) => [
      buildStat("power_max_mw", p?.power_max_mw, t),
      buildStat("production_gwh", p?.production_gwh, t),
      buildStat("fall_height_m", p?.fall_height_m, t),
      buildStat("type_de", p?.type_de, t),
      buildStat("beginning_of_operation", p?.beginning_of_operation, t),
    ],
  },
  hydro_station: {
    label: (t) => t.hydroStation || "Gauging Station",
    stats: (p, t) => [
      p?.discharge?.last_value != null && buildStat("discharge", fmt(p.discharge.last_value, 1), t, { unit: p.discharge.unit, ago: timeAgo(p.discharge.last_measured_at, t) }),
      p?.water_level?.last_value != null && buildStat("water_level", fmt(p.water_level.last_value, 2), t, { unit: p.water_level.unit, ago: timeAgo(p.water_level.last_measured_at, t) }),
      p?.temperature?.last_value != null && buildStat("temperature", fmt(p.temperature.last_value, 1), t, { unit: p.temperature.unit, ago: timeAgo(p.temperature.last_measured_at, t) }),
      p?.oxygen?.last_value != null && buildStat("oxygen", fmt(p.oxygen.last_value, 1), t, { unit: p.oxygen.unit, ago: timeAgo(p.oxygen.last_measured_at, t) }),
      p?.turbidity?.last_value != null && buildStat("turbidity", fmt(p.turbidity.last_value, 1), t, { unit: p.turbidity.unit, ago: timeAgo(p.turbidity.last_measured_at, t) }),
    ].filter(Boolean),
  },
  datalakes_station: {
    label: (t) => t.researchStation || "Research Station",
    stats: (p, t) => {
      const ORDER = ["water_temperature", "air_temperature", "wave_height", "wave_period", "chla", "oxygen_saturation", "turbidity", "wind_speed"];
      const result = [];
      for (const key of ORDER) {
        const param = p?.parameters?.[key];
        if (!param) continue;
        const entries = Array.isArray(param) ? param : [param];
        for (const entry of entries) {
          if (entry?.last_value == null) continue;
          const ageH = dataAgeHours(entry.last_measured_at);
          if (ageH != null && ageH >= 24) continue;
          const stat = buildStat(key, fmt(entry.last_value, 1), t, { unit: entry.unit, ago: timeAgo(entry.last_measured_at, t), agoClass: agoClass(entry.last_measured_at), link: entry.dataset_id != null ? `https://www.datalakes-eawag.ch/datadetail/${entry.dataset_id}` : null });
          if (!stat) continue;
          result.push(entry.depth != null ? { ...stat, label: `${stat.label} (${fmt(entry.depth, 1)}m)` } : stat);
        }
      }
      return result;
    },
  },
  glacier_runoff: {
    label: (t) => t.glacierRunoff || "Glacier Runoff",
    stats: (p, t) => [
      p?.runoff_today != null && buildStat("glacier_runoff", p.runoff_today, t, {
        sublabel: p.pct_next_5d != null ? `${p.pct_next_5d > 0 ? "+" : ""}${p.pct_next_5d.toFixed(0)}% next 5d` : null,
      }),
      p?.pct_last_month != null && buildStat("pct_last_month", p.pct_last_month, t),
      p?.pct_last_2wk   != null && buildStat("pct_last_2wk",   p.pct_last_2wk,   t),
      p?.pct_last_5d    != null && buildStat("pct_last_5d",    p.pct_last_5d,    t),
    ].filter(Boolean),
  },
  dam_with_power: {
    label: (t) => t.damWithPower || "Dam + Power Station",
    stats: (p, t) => [
      buildStat("dam_height_m", p?.dam_height_m, t, { color: "rgb(122, 154, 184)" }),
      buildStat("crest_level_m", p?.crest_level_m, t, { color: "rgb(122, 154, 184)" }),
      buildStat("dam_type", p?.dam_type, t, { color: "rgb(122, 154, 184)" }),
      buildStat("reservoir_volume_hm3", p?.reservoir_volume_hm3, t, { color: "rgb(122, 154, 184)" }),
      buildStat("construction_year", p?.construction_year, t, { color: "rgb(122, 154, 184)" }),
      buildStat("power_max_mw", p?.power_max_mw, t, { color: "rgb(232, 164, 58)" }),
      buildStat("production_gwh", p?.production_gwh, t, { color: "rgb(232, 164, 58)" }),
      buildStat("fall_height_m", p?.fall_height_m, t, { color: "rgb(232, 164, 58)" }),
      buildStat("beginning_of_operation", p?.beginning_of_operation, t, { color: "rgb(232, 164, 58)" }),
    ],
  },
};

const ESRI_SAT = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export";

const satUrl = (lon, lat, delta = 0.0025) =>
  `${ESRI_SAT}?bbox=${lon - delta},${lat - delta},${lon + delta},${lat + delta}&bboxSR=4326&size=408,200&f=image&format=jpg`;

const InfraModal = ({ variant, properties, language = "en", t = {}, onClose, onMouseEnter }) => {
  const config = VARIANTS[variant];
  const name = properties?.name ?? properties?.label ?? config.label(t);
  const stats = config.stats(properties, t);
  const lon = properties?._lon;
  const lat = properties?._lat;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  const stationKey = variant === "hydro_station" ? properties?.key : null;
  const photoSrc =
    variant === "hydro_station" && stationKey != null
      ? `${CONFIG.bucket}/hydro/images/${stationKey}.png`
      : variant === "datalakes_station" && properties?.image
      ? `${CONFIG.bucket}/hydro/images/${properties.image}`
      : null;

  useEffect(() => {
    setImgLoaded(false);
    setPhotoError(false);
  }, [stationKey, properties?.image]);

  const showPhoto = photoSrc && !photoError;
  const showSat = !showPhoto && lon != null && lat != null;

  const floodDanger = (() => {
    const d = properties?.discharge;
    if (!d || d.wl_1 == null || d.last_value == null) return null;
    const v = d.last_value;
    const levels = [
      { level: 5, min: d.wl_4, color: "#7b1fa2", label: t.dangerLevel5 || "Very high danger" },
      { level: 4, min: d.wl_3, color: "#d32f2f", label: t.dangerLevel4 || "High danger" },
      { level: 3, min: d.wl_2, color: "#f57c00", label: t.dangerLevel3 || "Considerable danger" },
      { level: 2, min: d.wl_1, color: "#f9a825", label: t.dangerLevel2 || "Moderate danger" },
    ];
    for (const l of levels) {
      if (l.min != null && v >= l.min) return l;
    }
    return { level: 1, color: "#2e7d32", label: t.dangerLevel1 || "Low danger" };
  })();

  return (
    <div className="infra-overlay" onClick={onClose} onMouseEnter={onMouseEnter}>
      <div className="infra-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="infra-dialog-header">
          <div>
            <div className="infra-dialog-label">{config.label(t)}</div>
            <div className="infra-dialog-title">{name}</div>
            {variant === "dam_with_power" && properties?.power_name && (
              <div className="infra-dialog-subtitle">{properties.power_name}</div>
            )}
          </div>
          <button className="infra-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="infra-dialog-scroll">
          {(showPhoto || showSat) && (
            <div className="infra-satellite">
              {!imgLoaded && <div className="infra-satellite-loading"><div className="infra-satellite-spinner" /></div>}
              {showPhoto
                ? <img src={photoSrc} alt={name} className="infra-satellite-img"
                    style={{ opacity: imgLoaded ? 1 : 0 }}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => { setPhotoError(true); setImgLoaded(false); }} />
                : <a href={`https://www.google.com/maps/@${lat},${lon},17z/data=!3m1!1e3`} target="_blank" rel="noopener noreferrer" className="infra-satellite-link">
                    <img src={satUrl(lon, lat)} alt="Satellite view" className="infra-satellite-img"
                      style={{ opacity: imgLoaded ? 1 : 0 }}
                      onLoad={() => setImgLoaded(true)} />
                  </a>
              }
              {floodDanger && imgLoaded && (
                <a
                  className="infra-flood-badge"
                  style={{ background: floodDanger.color }}
                  href={`https://www.hydrodaten.admin.ch/${language}/die-5-gefahrenstufen-fuer-hochwasser`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="infra-flood-dot" />
                  {floodDanger.label}
                </a>
              )}
            </div>
          )}
          <div className="infra-stats">
            {stats.map((s, i) => {
              const card = (
                <div className={`stat-card${s.link ? " stat-card-link" : ""}`}>
                  <div className="stat-card-top">
                    <img src={s.icon} className="stat-card-icon" alt="" />
                    <div className="stat-card-label" style={s.color ? { color: s.color } : undefined}>{s.label}</div>
                  </div>
                  <div className="stat-card-value">
                    <div className="stat-card-reading">
                      <span className="stat-card-number">{s.value}</span>
                      {s.unit && <span className="stat-card-unit">{s.unit}</span>}
                    </div>
                    {s.ago && <span className={`stat-card-ago${s.agoClass || ""}`}>{s.ago}</span>}
                  </div>
                </div>
              );
              return s.link
                ? <a key={i} href={s.link} target="_blank" rel="noopener noreferrer" className="stat-card-anchor">{card}</a>
                : <div key={i}>{card}</div>;
            })}
          </div>
          <div className="infra-dialog-body">
            {stationKey != null && (
              <a
                href={`https://www.hydrodaten.admin.ch/en/seen-und-fluesse/stations/${stationKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="infra-bafu-link"
              >
                {t.viewOnBafu || "See more on BAFU"}
              </a>
            )}
            {variant === "datalakes_station" && (
              <a
                href={properties?.url || "https://www.datalakes-eawag.ch"}
                target="_blank"
                rel="noopener noreferrer"
                className="infra-bafu-link"
              >
                {t.viewOnDatalakes || "See more on Datalakes"}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfraModal;
