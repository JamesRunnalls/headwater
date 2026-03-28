import { useRef, useState, useEffect } from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import CONFIG from "../../config.json";
import "./NatureModal.css";
import areaIcon from "../../img/area.png";
import lengthIcon from "../../img/length.png";
import depthIcon from "../../img/depth.png";
import elevationIcon from "../../img/elevation.png";
import volumeIcon from "../../img/volume.png";
import mixingIcon from "../../img/mixing.png";
import temperatureIcon from "../../img/temperature.png";
import fluxIcon from "../../img/flux.png";
import glacierPlaceholder from "../../img/glacier.png";

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

const fmt = (val, decimals = 0) =>
  val != null ? Number(val).toLocaleString("en-CH", { maximumFractionDigits: decimals }) : "—";

const Stat = ({ icon, value, label }) => (
  <div className="nature-modal-stat">
    <div className="nature-modal-stat-top">
      <img src={icon} className="nature-modal-stat-icon" alt="" />
      <div className="nature-modal-stat-label">{label}</div>
    </div>
    <div className="nature-modal-stat-value">{value}</div>
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
        { icon: areaIcon,   value: areaKm2 != null ? `${fmt(areaKm2, 2)} km²` : "—",                                          label: areaLabel },
        { icon: lengthIcon,   value: p?.last_length_change_cumulative != null ? `${fmt(p.last_length_change_cumulative)} m` : "—", label: t.lengthChange || "Length change" },
        { icon: volumeIcon, value: massBalanceM != null ? `${fmt(massBalanceM, 3)} m w.e.` : "—",                               label: massLabel },
      ];
    },
  },
  dam: {
    label: (t) => t.dam || "Dam",
    defaultName: "Dam",
    link: () => ({ url: "", show: false }),
    linkLabel: () => "",
    stats: (p, t) => [
      { icon: depthIcon,    value: p?.dam_height_m != null ? `${fmt(p.dam_height_m, 1)} m` : "—",      label: t.damHeight || "Dam height" },
      { icon: elevationIcon,value: p?.crest_level_m != null ? `${fmt(p.crest_level_m, 1)} m` : "—",    label: t.crestLevel || "Crest level" },
      { icon: areaIcon,     value: p?.dam_type ?? "—",                                                  label: t.damType || "Type" },
      { icon: volumeIcon,   value: p?.reservoir_volume_hm3 != null ? `${fmt(p.reservoir_volume_hm3, 2)} hm³` : "—", label: t.reservoirVolume || "Reservoir volume" },
      { icon: elevationIcon,value: p?.reservoir_level_m != null ? `${fmt(p.reservoir_level_m, 1)} m` : "—", label: t.reservoirLevel || "Reservoir level" },
      { icon: areaIcon,     value: p?.construction_year ?? "—",                                         label: t.constructionYear || "Built" },
    ],
  },
  powerstation: {
    label: (t) => t.powerstation || "Power Station",
    defaultName: "Power Station",
    link: () => ({ url: "", show: false }),
    linkLabel: () => "",
    stats: (p, t) => [
      { icon: fluxIcon,     value: p?.power_max_mw != null ? `${fmt(p.power_max_mw, 1)} MW` : "—",     label: t.powerMax || "Max power" },
      { icon: fluxIcon,     value: p?.production_gwh != null ? `${fmt(p.production_gwh, 1)} GWh/y` : "—", label: t.production || "Production" },
      { icon: lengthIcon,   value: p?.fall_height_m != null ? `${fmt(p.fall_height_m, 0)} m` : "—",    label: t.fallHeight || "Fall height" },
      { icon: areaIcon,     value: p?.type_de ?? "—",                                                   label: t.plantType || "Type" },
      { icon: areaIcon,     value: p?.canton ?? "—",                                                    label: t.canton || "Canton" },
      { icon: areaIcon,     value: p?.beginning_of_operation ?? "—",                                    label: t.operationStart || "In operation" },
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
            <img src={temperatureIcon} className="nature-modal-badge-icon" alt="" />
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
