import { useRef, useState, useEffect } from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import CONFIG from "../../config.json";
import "./NatureModal.css";
import "../stat-card.css";
import glacierPlaceholder from "../../img/glacier.png";
import { fmt, buildStat, STAT_ICONS } from "../../statConfigs";

const DESC_WORD_THRESHOLD = 50;

const ESRI_SAT = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export";
const satUrl = ([minLon, minLat, maxLon, maxLat]) => {
  const padLon = (maxLon - minLon) * 0.1;
  const padLat = (maxLat - minLat) * 0.1;
  return `${ESRI_SAT}?bbox=${minLon - padLon},${minLat - padLat},${maxLon + padLon},${maxLat + padLat}&bboxSR=4326&size=408,210&f=image&format=jpg`;
};

const decodeHtml = (html) => {
  const el = document.createElement("textarea");
  el.innerHTML = html;
  return el.value;
};

const Stat = ({ icon, value, unit, label }) => (
  <div className="stat-card">
    <div className="stat-card-top">
      <img src={icon} className="stat-card-icon" alt="" />
      <div className="stat-card-label">{label}</div>
    </div>
    <div className="stat-card-value">
      <div className="stat-card-reading">
        <span className="stat-card-number">{value}</span>
        {unit && <span className="stat-card-unit">{unit}</span>}
      </div>
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
      buildStat("surface_area", p?.area, t),
      buildStat("max_depth", p?.max_depth, t),
      buildStat("avg_depth", p?.ave_depth, t),
      buildStat("elevation", p?.elevation, t),
      buildStat("volume_km3", p?.volume, t),
      buildStat("mixing_regime", p?.mixing_regime, t),
    ],
  },
  glacier: {
    label: (t) => t.glacier,
    defaultName: "Glacier",
    link: (p) => ({ url: `https://glamos.ch/en/factsheet#/${p?.["sgi-id"]}`, show: !!p?.["sgi-id"] }),
    linkLabel: (t) => t.viewOnGlamos || "View on Glamos",
    stats: (p, t) => {
      const areaKm2 = p?.area_m2 != null ? p.area_m2 / 1e6 : null;
      const massBalanceM = p?.last_mass_balance_observation != null ? p.last_mass_balance_observation / 1000 : null;
      const fromYear = p?.last_mass_balance_fix_date_from?.slice(0, 4);
      const toYear = p?.last_mass_balance_fix_date_to?.slice(0, 4);
      const massLabel = fromYear && toYear
        ? `${t.massBalance || "Mass balance"} (${fromYear}–${toYear})`
        : t.massBalance || "Mass balance";
      const areaLabel = p?.area_year
        ? `${t.glacierArea || "Area"} (${p.area_year})`
        : t.glacierArea || "Area";
      return [
        buildStat("glacier_area", areaKm2, t, { label: areaLabel }),
        buildStat("length_change", p?.last_length_change_cumulative, t),
        buildStat("mass_balance", massBalanceM, t, { label: massLabel }),
      ];
    },
  },
  dam: {
    label: (t) => t.dam || "Dam",
    defaultName: "Dam",
    link: () => ({ url: "", show: false }),
    linkLabel: () => "",
    stats: (p, t) => [
      buildStat("dam_height_m", p?.dam_height_m, t),
      buildStat("crest_level_m", p?.crest_level_m, t),
      buildStat("dam_type", p?.dam_type, t),
      buildStat("reservoir_volume_hm3", p?.reservoir_volume_hm3, t),
      buildStat("reservoir_level_m", p?.reservoir_level_m, t),
      buildStat("construction_year", p?.construction_year, t),
    ],
  },
  powerstation: {
    label: (t) => t.powerstation || "Power Station",
    defaultName: "Power Station",
    link: () => ({ url: "", show: false }),
    linkLabel: () => "",
    stats: (p, t) => [
      buildStat("power_max_mw", p?.power_max_mw, t),
      buildStat("production_gwh", p?.production_gwh, t),
      buildStat("fall_height_m", p?.fall_height_m, t),
      buildStat("type_de", p?.type_de, t),
      buildStat("canton", p?.canton, t),
      buildStat("beginning_of_operation", p?.beginning_of_operation, t),
    ],
  },
};

const NatureModal = ({ variant = "lake", properties, temperature, language = "en", t = {}, onClose, onMouseEnter }) => {
  const config = VARIANTS[variant];
  const name = properties?.name ?? config.defaultName;
  const { url, show: hasLink } = config.link(properties);
  const stats = config.stats(properties, t);
  const sgiId = properties?.["sgi-id"];
  const lakeKey = properties?.key;

  const [rawDescription, setRawDescription] = useState("");
  const [imgSrc, setImgSrc] = useState(null);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    setRawDescription("");
    setImgSrc(null);
    setImgError(false);
    setImgLoaded(false);
    if (variant === "glacier" && sgiId) {
      setImgSrc(`${CONFIG.bucket}/glaciers/images/${sgiId}.jpg`);
      fetch(`${CONFIG.bucket}/glaciers/text/${sgiId}.json`)
        .then(r => r.json())
        .then(data => setRawDescription(data[language] || data.en || ""))
        .catch(() => {});
    } else if (variant === "lake" && lakeKey) {
      setImgSrc(`${CONFIG.bucket}/lakes/images/${lakeKey}.jpg`);
      fetch(`${CONFIG.bucket}/lakes/text/${lakeKey}.json`)
        .then(r => r.json())
        .then(data => setRawDescription(data[language] || data.en || ""))
        .catch(() => {});
    }
  }, [sgiId, lakeKey, language, variant]);

  const bbox = properties?._bbox ?? null;
  const mapsUrl = bbox
    ? (() => {
        const [minLon, minLat, maxLon, maxLat] = bbox;
        const centerLon = (minLon + maxLon) / 2;
        const centerLat = (minLat + maxLat) / 2;
        const zoom = Math.max(8, Math.min(16, Math.round(Math.log2(360 / Math.max(maxLon - minLon, maxLat - minLat)) - 1)));
        return `https://www.google.com/maps/@${centerLat},${centerLon},${zoom}z/data=!3m1!1e3`;
      })()
    : null;

  const isMobile = window.innerWidth <= 768;
  const description = rawDescription ? decodeHtml(rawDescription) : "";
  const words = description.trim().split(/\s+/);
  const descLong = words.length > DESC_WORD_THRESHOLD;
  const displayText = (descExpanded || isMobile || !descLong)
    ? description
    : words.slice(0, DESC_WORD_THRESHOLD).join(' ') + '\u2026';

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

  const hasHero = variant === "lake" || variant === "glacier";

  return (
    <FeatureModal label={config.label(t)} name={name} onClose={onClose} overlayClassName="modal-right" hideHeader overlayHandle onMouseEnter={onMouseEnter} defaultSnapIndex={1}>
      {hasHero && (
        <div className={`nature-modal-hero nature-modal-hero--${variant}`}>
          {!imgLoaded && (imgSrc || bbox) && (
            <div className="nature-modal-loading"><div className="nature-modal-spinner" /></div>
          )}
          {imgSrc && !imgError
            ? <img src={imgSrc} className="nature-modal-image nature-modal-image--photo" alt={name}
                style={{ opacity: imgLoaded ? 1 : 0 }}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)} />
            : bbox
              ? <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="nature-modal-image-link">
                  <img src={satUrl(bbox)} alt="Satellite view" className="nature-modal-image nature-modal-image--photo"
                    style={{ opacity: imgLoaded ? 1 : 0 }}
                    onLoad={() => setImgLoaded(true)} />
                </a>
              : variant === "glacier"
                ? <img src={glacierPlaceholder} className="nature-modal-image nature-modal-image--placeholder" alt={name} />
                : <div className="nature-modal-image" />
          }
          {variant === "glacier" && imgSrc && !imgError && (
            <span className="nature-modal-image-copyright">© GLAMOS</span>
          )}
          <div className="nature-modal-badge">
            <img src={STAT_ICONS.temperature} className="nature-modal-badge-icon" alt="" />
            <span>{temperature != null ? `${fmt(temperature, 1)} °C` : "— °C"}</span>
          </div>
        </div>
      )}
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
      {description && (
        <div className="nature-modal-desc-wrap">
          <p
            className={`nature-modal-description${!isMobile && descLong && !descExpanded ? ' nature-modal-description--truncated' : ''}`}
            onClick={!isMobile && descLong && !descExpanded ? () => setDescExpanded(true) : undefined}
          >
            {displayText}
          </p>
        </div>
      )}
      {hasLink && (
        <a href={url} target="_blank" rel="noopener noreferrer" className={`nature-modal-link nature-modal-link--${variant}`}>
          {config.linkLabel(t)}
        </a>
      )}
    </FeatureModal>
  );
};

export default NatureModal;
