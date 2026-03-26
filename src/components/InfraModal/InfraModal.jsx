import React from "react";
import "./InfraModal.css";
import depthIcon from "../../img/depth.png";
import elevationIcon from "../../img/elevation.png";
import areaIcon from "../../img/area.png";
import volumeIcon from "../../img/volume.png";
import lengthIcon from "../../img/length.png";
import fluxIcon from "../../img/flux.png";

const fmt = (val, decimals = 0) =>
  val != null ? Number(val).toLocaleString("en-CH", { maximumFractionDigits: decimals }) : "—";

const VARIANTS = {
  dam: {
    label: (t) => t.dam || "Dam",
    stats: (p, t) => [
      { icon: depthIcon,     value: p?.dam_height_m != null ? `${fmt(p.dam_height_m, 1)} m` : "—",              label: t.damHeight || "Dam height" },
      { icon: elevationIcon, value: p?.crest_level_m != null ? `${fmt(p.crest_level_m, 1)} m` : "—",            label: t.crestLevel || "Crest level" },
      { icon: areaIcon,      value: p?.dam_type ?? "—",                                                          label: t.damType || "Type" },
      { icon: volumeIcon,    value: p?.reservoir_volume_hm3 != null ? `${fmt(p.reservoir_volume_hm3, 2)} hm³` : "—", label: t.reservoirVolume || "Reservoir volume" },
      { icon: elevationIcon, value: p?.reservoir_level_m != null ? `${fmt(p.reservoir_level_m, 1)} m` : "—",    label: t.reservoirLevel || "Reservoir level" },
      { icon: areaIcon,      value: p?.construction_year ?? "—",                                                 label: t.constructionYear || "Built" },
    ],
  },
  powerstation: {
    label: (t) => t.powerstation || "Power Station",
    stats: (p, t) => [
      { icon: fluxIcon,      value: p?.power_max_mw != null ? `${fmt(p.power_max_mw, 1)} MW` : "—",             label: t.powerMax || "Max power" },
      { icon: fluxIcon,      value: p?.production_gwh != null ? `${fmt(p.production_gwh, 1)} GWh/y` : "—",      label: t.production || "Production" },
      { icon: lengthIcon,    value: p?.fall_height_m != null ? `${fmt(p.fall_height_m, 0)} m` : "—",            label: t.fallHeight || "Fall height" },
      { icon: areaIcon,      value: p?.type_de ?? "—",                                                           label: t.plantType || "Type" },
      { icon: areaIcon,      value: p?.canton ?? "—",                                                            label: t.canton || "Canton" },
      { icon: areaIcon,      value: p?.beginning_of_operation ?? "—",                                            label: t.operationStart || "In operation" },
    ],
  },
};

const InfraModal = ({ variant, properties, t = {}, onClose, onMouseEnter }) => {
  const config = VARIANTS[variant];
  const name = properties?.name ?? config.label(t);
  const stats = config.stats(properties, t);

  return (
    <div className="infra-overlay" onClick={onClose} onMouseEnter={onMouseEnter}>
      <div className="infra-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="infra-dialog-header">
          <div>
            <div className="infra-dialog-label">{config.label(t)}</div>
            <div className="infra-dialog-title">{name}</div>
          </div>
          <button className="infra-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="infra-dialog-body">
          <div className="infra-stats">
            {stats.map((s, i) => (
              <div key={i} className="infra-stat">
                <div className="infra-stat-top">
                  <img src={s.icon} className="infra-stat-icon" alt="" />
                  <div className="infra-stat-label">{s.label}</div>
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
