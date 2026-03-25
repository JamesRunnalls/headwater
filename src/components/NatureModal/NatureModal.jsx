import { useRef } from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import "./NatureModal.css";
import areaIcon from "../../img/area.png";
import depthIcon from "../../img/depth.png";
import elevationIcon from "../../img/elevation.png";
import volumeIcon from "../../img/volume.png";
import mixingIcon from "../../img/mixing.png";
import temperatureIcon from "../../img/temperature.png";

const fmt = (val, decimals = 0) =>
  val != null ? Number(val).toLocaleString("en-CH", { maximumFractionDigits: decimals }) : "—";

const Stat = ({ icon, value, label }) => (
  <div className="nature-modal-stat">
    <img src={icon} className="nature-modal-stat-icon" alt="" />
    <div>
      <div className="nature-modal-stat-value">{value}</div>
      <div className="nature-modal-stat-label">{label}</div>
    </div>
  </div>
);

const VARIANTS = {
  lake: {
    label: (t) => t.lake,
    defaultName: "Lake",
    link: (p) => ({ url: `https://www.alplakes.eawag.ch/${p?.key}`, show: !!p?.key }),
    linkLabel: (t) => t.viewOnAlplakes || "View on Alplakes",
    stats: (p, t) => [
      { icon: areaIcon,     value: `${fmt(p?.area, 1)} km²`,      label: t.surfaceArea || "Surface area" },
      { icon: depthIcon,    value: `${fmt(p?.max_depth)} m`,       label: t.maxDepth || "Max depth" },
      { icon: depthIcon,    value: `${fmt(p?.ave_depth)} m`,       label: t.avgDepth || "Avg depth" },
      { icon: elevationIcon,value: `${fmt(p?.elevation)} m`,       label: t.elevation || "Elevation" },
      { icon: volumeIcon,   value: `${fmt(p?.volume, 2)} km³`,     label: t.volume || "Volume" },
      { icon: mixingIcon,   value: p?.mixing_regime ?? "—",        label: t.mixingRegime || "Mixing" },
    ],
  },
  glacier: {
    label: (t) => t.glacier,
    defaultName: "Glacier",
    link: (p) => ({ url: `https://glamos.ch/en/factsheet#/${p?.["sgi-id"]}`, show: !!p?.["sgi-id"] }),
    linkLabel: (t) => t.viewOnGlamos || "View on Glamos",
    stats: (p, t) => [
      { icon: areaIcon,     value: `${fmt(p?.area, 1)} km²`,      label: t.surfaceArea || "Surface area" },
      { icon: elevationIcon,value: `${fmt(p?.elevation)} m`,       label: t.elevation || "Elevation" },
    ],
  },
};

const NatureModal = ({ variant = "lake", properties, t = {}, onClose, onMouseEnter }) => {
  const config = VARIANTS[variant];
  const name = properties?.name ?? config.defaultName;
  const { url, show: hasLink } = config.link(properties);
  const stats = config.stats(properties, t);

  const scrollRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });

  const onMouseDown = (e) => {
    drag.current = { active: true, startX: e.pageX, scrollLeft: scrollRef.current.scrollLeft };
    scrollRef.current.style.cursor = "grabbing";
  };
  const onMouseUp = () => {
    drag.current.active = false;
    scrollRef.current.style.cursor = "";
  };
  const onMouseMove = (e) => {
    if (!drag.current.active) return;
    e.preventDefault();
    scrollRef.current.scrollLeft = drag.current.scrollLeft - (e.pageX - drag.current.startX);
  };

  return (
    <FeatureModal label={config.label(t)} name={name} onClose={onClose} overlayClassName="modal-right" hideHeader overlayHandle onMouseEnter={onMouseEnter}>
      <div className={`nature-modal-hero nature-modal-hero--${variant}`}>
        <div className="nature-modal-image" />
        <div className="nature-modal-badge">
          <img src={temperatureIcon} className="nature-modal-badge-icon" alt="" />
          <span>— °C</span>
        </div>
      </div>
      <div
        className="nature-modal-stats"
        ref={scrollRef}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onMouseMove={onMouseMove}
      >
        {stats.map((s, i) => <Stat key={i} {...s} />)}
      </div>
      <p className="nature-modal-description">
        Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum.
      </p>
      {hasLink && (
        <a href={url} target="_blank" rel="noopener noreferrer" className={`nature-modal-link nature-modal-link--${variant}`}>
          {config.linkLabel(t)}
        </a>
      )}
    </FeatureModal>
  );
};

export default NatureModal;
