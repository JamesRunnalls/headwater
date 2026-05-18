import React, { useState, useDeferredValue, useMemo, useRef } from "react";

const MAX_RESULTS = 8;

const normalize = (s) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Wagner–Fischer DP with row-0 zeros: returns the min edit distance between
// `query` and any contiguous substring of `name`.
const approxSubstringDistance = (query, name) => {
  const m = query.length, n = name.length;
  if (m === 0) return 0;
  if (n === 0) return m;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const qc = query.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = qc === name.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    [prev, curr] = [curr, prev];
  }
  let best = prev[0];
  for (let j = 1; j <= n; j++) if (prev[j] < best) best = prev[j];
  return best;
};

const matchToken = (token, name) => {
  const pos = name.indexOf(token);
  if (pos >= 0) return { edits: 0, pos, exact: true };
  if (token.length < 3) return null;
  const maxEdits = Math.floor(token.length / 4);
  if (maxEdits === 0) return null;
  const d = approxSubstringDistance(token, name);
  if (d <= maxEdits) return { edits: d, pos: name.length, exact: false };
  return null;
};

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
    <line x1="10.3" y1="10.3" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SearchBar = ({ index, onSelect, t, visible }) => {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = normalize(deferredQuery.trim());
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const matches = [];
    for (const item of index) {
      const nd = normalize(item.display);
      let exactCount = 0;
      let totalEdits = 0;
      let firstPos = Infinity;
      let allMatched = true;
      for (let i = 0; i < tokens.length; i++) {
        const m = matchToken(tokens[i], nd);
        if (!m) { allMatched = false; break; }
        if (m.exact) exactCount++;
        totalEdits += m.edits;
        if (i === 0) firstPos = m.pos;
      }
      if (allMatched) matches.push({ item, exactCount, totalEdits, firstPos });
    }
    matches.sort((a, b) => {
      if (a.exactCount !== b.exactCount) return b.exactCount - a.exactCount;
      if (a.totalEdits !== b.totalEdits) return a.totalEdits - b.totalEdits;
      if (a.firstPos !== b.firstPos) return a.firstPos - b.firstPos;
      return a.item.display.localeCompare(b.item.display);
    });
    return matches.slice(0, MAX_RESULTS).map((m) => m.item);
  }, [deferredQuery, index]);

  const handleSelect = (item) => {
    onSelect(item);
    setQuery("");
    setFocused(false);
    setExpanded(false);
    inputRef.current?.blur();
  };

  const expandFromIcon = () => {
    setExpanded(true);
    // Wait for the input to become display-block before focusing.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const showResults = focused && deferredQuery.trim().length > 0;

  return (
    <div
      className={`search-bar${expanded ? " search-bar-expanded" : ""}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 1.5s ease, width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
        pointerEvents: visible ? "all" : "none",
        "--search-collapsed-width": `${48 + t.searchPlaceholder.length * 10.5}px`,
      }}
    >
      <button
        type="button"
        className="search-icon-btn"
        onClick={expandFromIcon}
        aria-label={t.searchPlaceholder}
      >
        <SearchIcon />
      </button>
      <div className="search-bar-field">
        <div className="search-bar-input-row">
          <span className="search-bar-input-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            type="text"
            className="search-bar-input"
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => { setFocused(false); setExpanded(false); }, 120)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {showResults && (
          <div className="search-results">
            {results.length === 0 && (
              <div className="search-result-empty">{t.noResults}</div>
            )}
            {results.map((item) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                className="search-result"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(item)}
              >
                <span className="search-result-kind">
                  {item.kind === "river" ? t.river : item.kind === "lake" ? t.lake : t.glacier}
                </span>
                <span className="search-result-name">{item.display}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
