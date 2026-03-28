import { useState } from "react";
import "./InfraModal.css";
import elevationIcon from "../../img/elevation.png";
import typeIcon from "../../img/type.png";
import levelIcon from "../../img/level.png";
import timeIcon from "../../img/time.png";
import volumeIcon from "../../img/volume.png";
import buildIcon from "../../img/build.png";
import lengthIcon from "../../img/length.png";
import fluxIcon from "../../img/flux.png";

const fmt = (val, decimals = 0) =>
  val != null ? Number(val).toLocaleString("en-CH", { maximumFractionDigits: decimals }) : "—";

const VARIANTS = {
  dam: {
    label: (t) => t.dam || "Dam",
    stats: (p, t) => [
      { icon: lengthIcon,     value: p?.dam_height_m != null ? `${fmt(p.dam_height_m, 1)} m` : "—",              label: t.damHeight || "Dam height" },
      { icon: levelIcon, value: p?.crest_level_m != null ? `${fmt(p.crest_level_m, 1)} m` : "—",            label: t.crestLevel || "Crest level" },
      { icon: typeIcon,      value: p?.dam_type ?? "—",                                                          label: t.damType || "Type" },
      { icon: volumeIcon,    value: p?.reservoir_volume_hm3 != null ? `${fmt(p.reservoir_volume_hm3, 2)} hm³` : "—", label: t.reservoirVolume || "Reservoir volume" },
      { icon: elevationIcon, value: p?.reservoir_level_m != null ? `${fmt(p.reservoir_level_m, 1)} m` : "—",    label: t.reservoirLevel || "Reservoir level" },
      { icon: buildIcon,      value: p?.construction_year ?? "—",                                                 label: t.constructionYear || "Built" },
    ],
  },
  power: {
    label: (t) => t.powerstation || "Power Station",
    stats: (p, t) => [
      { icon: fluxIcon,      value: p?.power_max_mw != null ? `${fmt(p.power_max_mw, 1)} MW` : "—",             label: t.powerMax || "Max power" },
      { icon: fluxIcon,      value: p?.production_gwh != null ? `${fmt(p.production_gwh, 1)} GWh/y` : "—",      label: t.production || "Production" },
      { icon: lengthIcon,    value: p?.fall_height_m != null ? `${fmt(p.fall_height_m, 0)} m` : "—",            label: t.fallHeight || "Fall height" },
      { icon: typeIcon,      value: p?.type_de ?? "—",                                                           label: t.plantType || "Type" },
      { icon: timeIcon,      value: p?.beginning_of_operation ?? "—",                                            label: t.operationStart || "In operation" },
    ],
  },
  dam_with_power: {
    label: (t) => t.damWithPower || "Dam + Power Station",
    stats: (p, t) => [
      { icon: lengthIcon,    value: p?.dam_height_m != null ? `${fmt(p.dam_height_m, 1)} m` : "—",              label: t.damHeight || "Dam height",         color: "rgb(122, 154, 184)" },
      { icon: levelIcon,     value: p?.crest_level_m != null ? `${fmt(p.crest_level_m, 1)} m` : "—",            label: t.crestLevel || "Crest level",       color: "rgb(122, 154, 184)" },
      { icon: typeIcon,      value: p?.dam_type ?? "—",                                                          label: t.damType || "Type",                 color: "rgb(122, 154, 184)" },
      { icon: volumeIcon,    value: p?.reservoir_volume_hm3 != null ? `${fmt(p.reservoir_volume_hm3, 2)} hm³` : "—", label: t.reservoirVolume || "Reservoir volume", color: "rgb(122, 154, 184)" },
      { icon: buildIcon,     value: p?.construction_year ?? "—",                                                  label: t.constructionYear || "Built",       color: "rgb(122, 154, 184)" },
      { icon: fluxIcon,      value: p?.power_max_mw != null ? `${fmt(p.power_max_mw, 1)} MW` : "—",             label: t.powerMax || "Max power",           color: "rgb(232, 164, 58)" },
      { icon: fluxIcon,      value: p?.production_gwh != null ? `${fmt(p.production_gwh, 1)} GWh/y` : "—",      label: t.production || "Production",        color: "rgb(232, 164, 58)" },
      { icon: lengthIcon,    value: p?.fall_height_m != null ? `${fmt(p.fall_height_m, 0)} m` : "—",            label: t.fallHeight || "Fall height",       color: "rgb(232, 164, 58)" },
      { icon: timeIcon,      value: p?.beginning_of_operation ?? "—",                                            label: t.operationStart || "In operation",  color: "rgb(232, 164, 58)" },
    ],
  },
};

const ESRI_SAT = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export";

const satUrl = (lon, lat, delta = 0.0025) =>
  `${ESRI_SAT}?bbox=${lon - delta},${lat - delta},${lon + delta},${lat + delta}&bboxSR=4326&size=408,200&f=image&format=jpg`;

const InfraModal = ({ variant, properties, t = {}, onClose, onMouseEnter }) => {
  const config = VARIANTS[variant];
  const name = properties?.name ?? config.label(t);
  const stats = config.stats(properties, t);
  const lon = properties?._lon;
  const lat = properties?._lat;
  const [imgLoaded, setImgLoaded] = useState(false);

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
        {lon != null && lat != null && (
          <div className="infra-satellite">
            {!imgLoaded && <div className="infra-satellite-loading"><div className="infra-satellite-spinner" /></div>}
            <a href={`https://www.google.com/maps/@${lat},${lon},17z/data=!3m1!1e3`} target="_blank" rel="noopener noreferrer" className="infra-satellite-link">
              <img src={satUrl(lon, lat)} alt="Satellite view" className="infra-satellite-img"
                style={{ opacity: imgLoaded ? 1 : 0 }}
                onLoad={() => setImgLoaded(true)} />
            </a>
          </div>
        )}
        <div className="infra-dialog-body">
          <div className="infra-stats">
            {stats.map((s, i) => (
              <div key={i} className="infra-stat">
                <div className="infra-stat-top">
                  <img src={s.icon} className="infra-stat-icon" alt="" />
                  <div className="infra-stat-label" style={s.color ? { color: s.color } : undefined}>{s.label}</div>
                </div>
                <div className="infra-stat-value">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfraModal;
