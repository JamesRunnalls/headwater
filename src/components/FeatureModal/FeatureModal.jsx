import React, { useState, useEffect } from "react";
import "./FeatureModal.css";

const FeatureModal = ({ label, name, onClose, children, overlayClassName, hideHeader, onMouseEnter }) => {
  const [minimized, setMinimized] = useState(false);

  useEffect(() => { setMinimized(false); }, [name]);

  return (
    <div className={`feature-modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}>
      <div
        className={`feature-modal-card${minimized ? " feature-modal-card--minimized" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
      >
        {minimized ? (
          <div className="feature-modal-minimized-bar">
            <div className="feature-modal-minimized-actions">
              <button className="feature-modal-learn-more" onClick={() => setMinimized(false)}>Learn more ↑</button>
              <button className="feature-modal-icon-btn" onClick={onClose} title="Close">×</button>
            </div>
          </div>
        ) : (
          <>
            {!hideHeader && (
              <>
                <div className="feature-modal-header">
                  <div>
                    {label && <div className="feature-modal-label">{label}</div>}
                    <div className="feature-modal-name">{name}</div>
                  </div>
                  <div className="feature-modal-header-actions">
                    <button className="feature-modal-close" onClick={() => setMinimized(true)}>−</button>
                    <button className="feature-modal-close" onClick={onClose}>×</button>
                  </div>
                </div>
              </>
            )}
            {hideHeader && (
              <div className="feature-modal-corner-actions">
                <button className="feature-modal-minimize-btn" onClick={() => setMinimized(true)}>−</button>
                <button className="feature-modal-close-btn" onClick={onClose}>×</button>
              </div>
            )}
            {children}
          </>
        )}
      </div>
    </div>
  );
};

export default FeatureModal;
