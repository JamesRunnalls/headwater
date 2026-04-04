import { useState, useEffect, useRef } from "react";
import "./FeatureModal.css";

const PEEK_HEIGHT = 40;

const getVh = () => window.visualViewport?.height ?? window.innerHeight;

const getSnapHeights = () => {
  const vh = getVh();
  return [PEEK_HEIGHT, vh * 0.5, vh - 70];
};

const FeatureModal = ({ label, name, onClose, children, overlayClassName, hideHeader, overlayHandle, onMouseEnter, defaultSnapIndex = 0, onSnapChange }) => {
  const isMobile = window.innerWidth <= 768;
  const [snapIndex, setSnapIndex] = useState(isMobile ? defaultSnapIndex : 1);
  const [minimized, setMinimized] = useState(false);
  const cardRef = useRef(null);
  const snapIndexRef = useRef(snapIndex);
  snapIndexRef.current = snapIndex;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const setSnapIndexRef = useRef(setSnapIndex);

  useEffect(() => {
    if (window.innerWidth <= 768) setSnapIndex(defaultSnapIndex);
    setMinimized(false);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onSnapChange?.(snapIndex);
  }, [snapIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch-based drag: non-passive touchmove lets us preventDefault to block
  // native scroll when we decide to resize instead.
  useEffect(() => {
    if (!isMobile) return;
    const card = cardRef.current;
    if (!card) return;

    let drag = null; // { startY, startScrollTop, startHeight, startTime, fromHandle, mode }

    const onTouchStart = (e) => {
      drag = {
        startY: e.touches[0].clientY,
        startScrollTop: card.scrollTop,
        startHeight: card.getBoundingClientRect().height,
        startTime: Date.now(),
        fromHandle: !!e.target.closest('.bottom-sheet-handle-area'),
        mode: null, // null=pending, 'resize', 'scroll'
      };
    };

    const onTouchMove = (e) => {
      if (!drag) return;
      const dy = e.touches[0].clientY - drag.startY;

      // Determine mode on first significant movement
      if (drag.mode === null) {
        if (Math.abs(dy) < 5) return;
        const atFullSize = snapIndexRef.current === getSnapHeights().length - 1;
        const pullDown = dy > 0;
        if (!atFullSize || drag.fromHandle || (pullDown && drag.startScrollTop === 0)) {
          drag.mode = 'resize';
        } else {
          drag.mode = 'scroll'; // let native scroll handle it
        }
      }

      if (drag.mode === 'resize') {
        e.preventDefault(); // block native scroll
        const delta = drag.startY - e.touches[0].clientY;
        const newHeight = Math.max(
          PEEK_HEIGHT * 0.4,
          Math.min(getVh() - 70, drag.startHeight + delta)
        );
        card.style.transition = 'none';
        card.style.height = `${newHeight}px`;
      }
    };

    const onTouchEnd = (e) => {
      if (!drag || drag.mode !== 'resize') {
        drag = null;
        return;
      }
      card.style.transition = '';
      const elapsed = Date.now() - drag.startTime;
      const totalDelta = drag.startY - e.changedTouches[0].clientY;
      const velocity = totalDelta / Math.max(elapsed, 1); // px/ms
      const snaps = getSnapHeights();
      const currentHeight = parseFloat(card.style.height) || card.getBoundingClientRect().height;

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

      card.style.height = '';
      drag = null;

      if (newIndex < 0) {
        onCloseRef.current();
      } else {
        setSnapIndexRef.current(newIndex);
      }
    };

    card.addEventListener('touchstart', onTouchStart, { passive: true });
    card.addEventListener('touchmove', onTouchMove, { passive: false });
    card.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      card.removeEventListener('touchstart', onTouchStart);
      card.removeEventListener('touchmove', onTouchMove);
      card.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const snaps = getSnapHeights();
  const isFullSize = isMobile && snapIndex === snaps.length - 1;
  const isPeek = isMobile && snapIndex === 0;
  const cardStyle = isMobile ? { height: snaps[snapIndex] } : {};

  return (
    <div className={`feature-modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}>
      <div
        ref={cardRef}
        className={`feature-modal-card${isFullSize ? ' feature-modal-card--full' : ''}${isPeek ? ' feature-modal-card--peek' : ''}${minimized ? ' feature-modal-card--minimized' : ''}`}
        style={{ ...cardStyle, ...(minimized ? { cursor: 'pointer' } : {}) }}
        onClick={minimized ? () => setMinimized(false) : (e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
      >
        {isMobile && (
          <div className={`bottom-sheet-handle-area${overlayHandle ? ' bottom-sheet-handle-area--overlay' : ''}`}>
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
                  {!minimized && <button className="feature-modal-close" onClick={() => setMinimized(true)} style={{ fontSize: 18, lineHeight: 0 }}>−</button>}
                  <button className="feature-modal-close" onClick={onClose}>×</button>
                </div>
              )}
            </div>
          )}
          {hideHeader && !minimized && (
            <div className="feature-modal-corner-actions">
              {!isMobile && <button className="feature-modal-close-btn" onClick={() => setMinimized(true)} style={{ fontSize: 18, lineHeight: 0 }}>−</button>}
              <button className="feature-modal-close-btn" onClick={onClose}>×</button>
            </div>
          )}
          {hideHeader && minimized && !isMobile && (
            <div className="feature-modal-minimized-bar">
              <span className="feature-modal-name" style={{ flex: 1, fontSize: 14 }}>{name}</span>
              <button className="feature-modal-icon-btn" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
            </div>
          )}
          {!minimized && children}
        </>
      </div>
    </div>
  );
};

export default FeatureModal;
