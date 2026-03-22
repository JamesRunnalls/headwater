import React, { useState, useEffect, useRef, useCallback } from "react";
import "./FeatureModal.css";

const PEEK_HEIGHT = 110;

const getSnapHeights = () => [
  PEEK_HEIGHT,
  window.innerHeight * 0.5,
  window.innerHeight - 70,
];

const FeatureModal = ({ label, name, onClose, children, overlayClassName, hideHeader, onMouseEnter, defaultSnapIndex = 0, onSnapChange }) => {
  const isMobile = window.innerWidth <= 768;
  const [snapIndex, setSnapIndex] = useState(isMobile ? defaultSnapIndex : 1);
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const snapIndexRef = useRef(snapIndex);
  snapIndexRef.current = snapIndex;

  useEffect(() => {
    if (window.innerWidth <= 768) setSnapIndex(defaultSnapIndex);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onSnapChange?.(snapIndex);
  }, [snapIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = useCallback((e) => {
    if (window.innerWidth > 768) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startHeight: cardRef.current.getBoundingClientRect().height,
      startTime: Date.now(),
    };
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const card = cardRef.current;
    const delta = dragRef.current.startY - e.clientY;
    const newHeight = Math.max(
      PEEK_HEIGHT * 0.4,
      Math.min(window.innerHeight - 70, dragRef.current.startHeight + delta)
    );
    card.style.transition = "none";
    card.style.height = `${newHeight}px`;
  }, []);

  const handlePointerUp = useCallback((e) => {
    if (!dragRef.current) return;
    const card = cardRef.current;
    card.style.transition = "";

    const elapsed = Date.now() - dragRef.current.startTime;
    const totalDelta = dragRef.current.startY - e.clientY;
    const velocity = totalDelta / Math.max(elapsed, 1); // px/ms
    const snaps = getSnapHeights();
    const currentHeight = parseFloat(card.style.height) || cardRef.current.getBoundingClientRect().height;

    let newIndex;
    if (Math.abs(velocity) > 0.4) {
      newIndex = velocity > 0
        ? Math.min(snapIndexRef.current + 1, snaps.length - 1)
        : snapIndexRef.current - 1;
    } else {
      newIndex = snaps.reduce((best, h, i) =>
        Math.abs(h - currentHeight) < Math.abs(snaps[best] - currentHeight) ? i : best
      , 0);
    }

    card.style.height = "";
    dragRef.current = null;

    if (newIndex < 0) {
      onClose();
    } else {
      setSnapIndex(newIndex);
    }
  }, [onClose]);

  const cardStyle = isMobile ? { height: getSnapHeights()[snapIndex] } : {};

  return (
    <div className={`feature-modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}>
      <div
        ref={cardRef}
        className="feature-modal-card"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
      >
        {isMobile && (
          <div
            className="bottom-sheet-handle-area"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div className="bottom-sheet-handle" />
          </div>
        )}
        <>
          {!hideHeader && (
            <div className="feature-modal-header">
              <div>
                {label && <div className="feature-modal-label">{label}</div>}
                <div className="feature-modal-name">{name}</div>
              </div>
              {!isMobile && (
                <div className="feature-modal-header-actions">
                  <button className="feature-modal-close" onClick={onClose}>×</button>
                </div>
              )}
            </div>
          )}
          {hideHeader && !isMobile && (
            <div className="feature-modal-corner-actions">
              <button className="feature-modal-close-btn" onClick={onClose}>×</button>
            </div>
          )}
          {children}
        </>
      </div>
    </div>
  );
};

export default FeatureModal;
