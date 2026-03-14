import React from "react";
import "./FeatureModal.css";

const FeatureModal = ({ label, name, onClose, children, overlayClassName, hideHeader }) => {
  return (
    <div className={`feature-modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}>
      <div className="feature-modal-card" onClick={(e) => e.stopPropagation()}>
        {!hideHeader && (
          <>
            <div className="feature-modal-header">
              <div>
                {label && <div className="feature-modal-label">{label}</div>}
                <div className="feature-modal-name">{name}</div>
              </div>
              <button className="feature-modal-close" onClick={onClose}>×</button>
            </div>
            <div className="feature-modal-divider" />
          </>
        )}
        {hideHeader && (
          <button className="feature-modal-close feature-modal-close-corner" onClick={onClose}>×</button>
        )}
        {children}
      </div>
    </div>
  );
};

export default FeatureModal;
