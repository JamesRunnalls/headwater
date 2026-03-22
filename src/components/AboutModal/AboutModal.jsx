import React from "react";
import "./AboutModal.css";

const AboutModal = ({ t = {}, onClose, onMouseEnter }) => {
  return (
    <div className="about-overlay" onClick={onClose} onMouseEnter={onMouseEnter}>
      <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="about-dialog-header">
          <div className="about-dialog-title">{t.aboutTitle}</div>
          <button className="about-dialog-close" onClick={onClose}>×</button>
        </div>
        <div className="about-dialog-body">
          <p className="about-body">{t.aboutBody}</p>
          <div className="about-sources-label">{t.aboutSources}</div>
          <ul className="about-sources">
            <li>{t.aboutSourceRivers}</li>
            <li>{t.aboutSourceLakes}</li>
            <li>{t.aboutSourceGlaciers}</li>
            <li>{t.aboutSourceTiles}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
