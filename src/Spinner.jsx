import React from "react";

// A spinning ring (Semantic UI's loader), shown next to a header's text while a
// request runs, so that a long wait with no new text (the collection being
// prepared, a retry after a failure) does not look like a frozen page.
//
// `inverted` is the white ring, for the green and red fetch button; the default
// dark ring is for the grey history headers (white would vanish there).
//
// Semantic gives the ring's host element no size of its own, so without the
// width and height the ring would overlap the text. Styles set from script are
// allowed by the page's Content-Security-Policy (see index.html).
export default function Spinner({ inverted = false }) {
  return (
    <span
      className={`ui active${inverted ? " inverted" : ""} inline small loader`}
      aria-hidden="true"
      style={{ width: "1.71rem", height: "1.71rem", marginRight: "0.7rem" }}
    />
  );
}
