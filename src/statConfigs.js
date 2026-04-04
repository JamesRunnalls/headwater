import elevationIcon from "./img/elevation.png";
import typeIcon from "./img/type.png";
import levelIcon from "./img/level.png";
import timeIcon from "./img/time.png";
import volumeIcon from "./img/volume.png";
import buildIcon from "./img/build.png";
import lengthIcon from "./img/length.png";
import fluxIcon from "./img/flux.png";
import temperatureIcon from "./img/temperature.png";
import areaIcon from "./img/area.png";
import depthIcon from "./img/depth.png";
import mixingIcon from "./img/mixing.png";

export const fmt = (val, decimals = 0) =>
  val != null ? Number(val).toLocaleString("en-CH", { maximumFractionDigits: decimals }) : "—";

export const STAT_ICONS = {
  elevation: elevationIcon,
  type: typeIcon,
  level: levelIcon,
  time: timeIcon,
  volume: volumeIcon,
  build: buildIcon,
  length: lengthIcon,
  flux: fluxIcon,
  temperature: temperatureIcon,
  area: areaIcon,
  depth: depthIcon,
  mixing: mixingIcon,
};

export const STAT_FIELDS = {
  // Dam
  dam_height_m:            { icon: "length",      tKey: "damHeight",        fallback: "Dam height",        format: (v) => `${fmt(v, 1)} m` },
  crest_level_m:           { icon: "level",       tKey: "crestLevel",       fallback: "Crest level",       format: (v) => `${fmt(v, 1)} m` },
  dam_type:                { icon: "type",        tKey: "damType",          fallback: "Type" },
  reservoir_volume_hm3:    { icon: "volume",      tKey: "reservoirVolume",  fallback: "Reservoir volume",  format: (v) => `${fmt(v, 2)} hm³` },
  reservoir_level_m:       { icon: "elevation",   tKey: "reservoirLevel",   fallback: "Reservoir level",   format: (v) => `${fmt(v, 1)} m` },
  construction_year:       { icon: "build",       tKey: "constructionYear", fallback: "Built" },
  // Power station
  power_max_mw:            { icon: "flux",        tKey: "powerMax",         fallback: "Max power",         format: (v) => `${fmt(v, 1)} MW` },
  production_gwh:          { icon: "flux",        tKey: "production",       fallback: "Production",        format: (v) => `${fmt(v, 1)} GWh/y` },
  fall_height_m:           { icon: "length",      tKey: "fallHeight",       fallback: "Fall height",       format: (v) => `${fmt(v, 0)} m` },
  type_de:                 { icon: "type",        tKey: "plantType",        fallback: "Type" },
  beginning_of_operation:  { icon: "time",        tKey: "operationStart",   fallback: "In operation" },
  canton:                  { icon: "area",        tKey: "canton",           fallback: "Canton" },
  // Hydro station live readings (value passed as pre-formatted string)
  discharge:               { icon: "flux",        tKey: "discharge",        fallback: "Discharge" },
  water_level:             { icon: "level",       tKey: "waterLevel",       fallback: "Water level" },
  temperature:             { icon: "temperature", tKey: "temperature",      fallback: "Temperature" },
  oxygen:                  { icon: "flux",        tKey: "oxygen",           fallback: "Oxygen" },
  turbidity:               { icon: "type",        tKey: "turbidity",        fallback: "Turbidity" },
  // Lake
  surface_area:            { icon: "area",        tKey: "surfaceArea",      fallback: "Surface area",      format: (v) => `${fmt(v, 1)} km²` },
  max_depth:               { icon: "depth",       tKey: "maxDepth",         fallback: "Max depth",         format: (v) => `${fmt(v, 0)} m` },
  avg_depth:               { icon: "depth",       tKey: "avgDepth",         fallback: "Avg depth",         format: (v) => `${fmt(v, 0)} m` },
  elevation:               { icon: "elevation",   tKey: "elevation",        fallback: "Elevation",         format: (v) => `${fmt(v, 0)} m` },
  volume_km3:              { icon: "volume",      tKey: "volume",           fallback: "Volume",            format: (v) => `${fmt(v, 2)} km³` },
  mixing_regime:           { icon: "mixing",      tKey: "mixingRegime",     fallback: "Mixing" },
  // Glacier
  glacier_area:            { icon: "area",        tKey: "glacierArea",      fallback: "Area",              format: (v) => `${fmt(v, 2)} km²` },
  length_change:           { icon: "length",      tKey: "lengthChange",     fallback: "Length change",     format: (v) => `${fmt(v, 0)} m` },
  mass_balance:            { icon: "volume",      tKey: "massBalance",      fallback: "Mass balance",      format: (v) => `${fmt(v, 3)} m w.e.` },
};

// Resolves icon, translated label, and formatted value from the central config.
// Pass value as a pre-formatted string to skip the format function (e.g. hydro readings with dynamic units).
// Any key in overrides (label, color, ago, etc.) replaces the default.
export const buildStat = (fieldKey, value, t, overrides = {}) => {
  const field = STAT_FIELDS[fieldKey];
  if (!field) return null;
  const formattedValue =
    value == null ? "—"
    : field.format && typeof value !== "string" ? field.format(value)
    : String(value);
  return {
    icon: STAT_ICONS[field.icon],
    label: t[field.tKey] || field.fallback,
    value: formattedValue,
    ...overrides,
  };
};
