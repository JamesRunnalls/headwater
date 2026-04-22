import averageDepthIcon from "./img/icons/average_depth.png";
import cantonIcon from "./img/icons/canton.png";
import chlorophyllAIcon from "./img/icons/chlorophyll_a.png";
import constructionYearIcon from "./img/icons/construction_year.png";
import damHeightIcon from "./img/icons/dam_height.png";
import dischargeIcon from "./img/icons/discharge.png";
import elevationIcon from "./img/icons/elevation.png";
import fallHeightIcon from "./img/icons/fall_height .png";
import lengthChangeIcon from "./img/icons/length_change.png";
import levelIcon from "./img/icons/level.png";
import massBalanceIcon from "./img/icons/mass_balance.png";
import maxDepthIcon from "./img/icons/max_depth.png";
import mixingRegimeIcon from "./img/icons/mixing_regime.png";
import oxygenIcon from "./img/icons/oxygen.png";
import powerIcon from "./img/icons/power.png";
import timeIcon from "./img/icons/time.png";
import productionIcon from "./img/icons/production.png";
import surfaceAreaIcon from "./img/icons/surface_area.png";
import temperatureIcon from "./img/icons/temperature.png";
import turbidityIcon from "./img/icons/turbidity.png";
import typeIcon from "./img/icons/type.png";
import volumeIcon from "./img/icons/volume.png";
import waveHeightIcon from "./img/icons/wave_height.png";
import wavePeriodIcon from "./img/icons/wave_period.png";
import windSpeedIcon from "./img/icons/wind_speed.png";

export const fmt = (val, decimals = 0) =>
  val != null ? Number(val).toLocaleString("en-CH", { maximumFractionDigits: decimals }) : "—";

export const STAT_ICONS = {
  average_depth:     averageDepthIcon,
  canton:            cantonIcon,
  chlorophyll_a:     chlorophyllAIcon,
  construction_year: constructionYearIcon,
  dam_height:        damHeightIcon,
  discharge:         dischargeIcon,
  elevation:         elevationIcon,
  fall_height:       fallHeightIcon,
  length_change:     lengthChangeIcon,
  level:             levelIcon,
  mass_balance:      massBalanceIcon,
  max_depth:         maxDepthIcon,
  mixing_regime:     mixingRegimeIcon,
  oxygen:            oxygenIcon,
  power:             powerIcon,
  production:        productionIcon,
  surface_area:      surfaceAreaIcon,
  temperature:       temperatureIcon,
  time:              timeIcon,
  turbidity:         turbidityIcon,
  type:              typeIcon,
  volume:            volumeIcon,
  wave_height:       waveHeightIcon,
  wave_period:       wavePeriodIcon,
  wind_speed:        windSpeedIcon,
};

export const STAT_FIELDS = {
  // Dam
  dam_height_m:            { icon: "dam_height",        tKey: "damHeight",        fallback: "Dam height",        format: (v) => fmt(v, 1), unit: "m" },
  crest_level_m:           { icon: "level",              tKey: "crestLevel",       fallback: "Crest level",       format: (v) => fmt(v, 1), unit: "m ü. M" },
  dam_type:                { icon: "type",               tKey: "damType",          fallback: "Type" },
  reservoir_volume_hm3:    { icon: "volume",             tKey: "reservoirVolume",  fallback: "Reservoir volume",  format: (v) => fmt(v, 2), unit: "hm³" },
  reservoir_level_m:       { icon: "elevation",          tKey: "reservoirLevel",   fallback: "Reservoir level",   format: (v) => fmt(v, 1), unit: "m" },
  construction_year:       { icon: "construction_year",  tKey: "constructionYear", fallback: "Built" },
  // Power station
  power_max_mw:            { icon: "power",              tKey: "powerMax",         fallback: "Max power",         format: (v) => fmt(v, 1), unit: "MW" },
  production_gwh:          { icon: "production",         tKey: "production",       fallback: "Production",        format: (v) => fmt(v, 1), unit: "GWh/y" },
  fall_height_m:           { icon: "fall_height",        tKey: "fallHeight",       fallback: "Fall height",       format: (v) => fmt(v, 0), unit: "m" },
  type_de:                 { icon: "type",               tKey: "plantType",        fallback: "Type" },
  beginning_of_operation:  { icon: "time",  tKey: "operationStart",   fallback: "In operation" },
  canton:                  { icon: "canton",             tKey: "canton",           fallback: "Canton" },
  // Hydro station live readings (value passed as pre-formatted string, unit passed as override)
  discharge:               { icon: "discharge",          tKey: "discharge",        fallback: "Discharge" },
  water_level:             { icon: "level",              tKey: "waterLevel",       fallback: "Water level" },
  temperature:             { icon: "temperature",        tKey: "temperature",      fallback: "Temperature" },
  oxygen:                  { icon: "oxygen",             tKey: "oxygen",           fallback: "Oxygen" },
  turbidity:               { icon: "turbidity",          tKey: "turbidity",        fallback: "Turbidity" },
  // Datalakes station live readings
  water_temperature:    { icon: "temperature",   tKey: "waterTemperature",  fallback: "Water temperature" },
  wave_height:          { icon: "wave_height",   tKey: "waveHeight",        fallback: "Wave height" },
  wave_period:          { icon: "wave_period",   tKey: "wavePeriod",        fallback: "Wave period" },
  chla:                 { icon: "chlorophyll_a", tKey: "chla",              fallback: "Chlorophyll-a" },
  oxygen_saturation:    { icon: "oxygen",        tKey: "oxygenSaturation",  fallback: "Oxygen saturation" },
  air_temperature:      { icon: "temperature",   tKey: "airTemperature",    fallback: "Air temperature" },
  wind_speed:           { icon: "wind_speed",    tKey: "windSpeed",         fallback: "Wind speed" },
  // Lake
  surface_area:            { icon: "surface_area",  tKey: "surfaceArea",      fallback: "Surface area",      format: (v) => fmt(v, 1), unit: "km²" },
  max_depth:               { icon: "max_depth",     tKey: "maxDepth",         fallback: "Max depth",         format: (v) => fmt(v, 0), unit: "m" },
  avg_depth:               { icon: "average_depth", tKey: "avgDepth",         fallback: "Avg depth",         format: (v) => fmt(v, 0), unit: "m" },
  elevation:               { icon: "elevation",     tKey: "elevation",        fallback: "Elevation",         format: (v) => fmt(v, 0), unit: "m" },
  volume_km3:              { icon: "volume",        tKey: "volume",           fallback: "Volume",            format: (v) => fmt(v, 2), unit: "km³" },
  mixing_regime:           { icon: "mixing_regime", tKey: "mixingRegime",     fallback: "Mixing" },
  // Glacier
  glacier_area:            { icon: "surface_area",  tKey: "glacierArea",      fallback: "Area",              format: (v) => fmt(v, 2), unit: "km²" },
  length_change:           { icon: "length_change", tKey: "lengthChange",     fallback: "Length change",     format: (v) => fmt(v, 0), unit: "m" },
  mass_balance:            { icon: "mass_balance",  tKey: "massBalance",      fallback: "Mass balance",      format: (v) => fmt(v, 3), unit: "m w.e." },
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
    unit: field.unit ?? null,
    ...overrides,
  };
};
