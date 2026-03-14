import React from "react";
import FeatureModal from "../FeatureModal/FeatureModal";
import "./AboutModal.css";

const AboutModal = ({ t = {}, onClose, onMouseEnter }) => {
  return (
    <FeatureModal name={t.aboutTitle} onClose={onClose} onMouseEnter={onMouseEnter}>
      <p className="about-body">{t.aboutBody}</p>
      <div className="about-sources-label">{t.aboutSources}</div>
      <ul className="about-sources">
        <li>{t.aboutSourceRivers}</li>
        <li>{t.aboutSourceLakes}</li>
        <li>{t.aboutSourceGlaciers}</li>
        <li>{t.aboutSourceTiles}</li>
      </ul>
    </FeatureModal>
  );
};

export default AboutModal;
