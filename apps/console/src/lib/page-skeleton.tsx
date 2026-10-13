import type { CSSProperties, ReactNode } from 'react';

/**
 * `FE-W124` — what a console page shows while the server is still reading for it.
 *
 * Every console page is a Server Component that reads before it renders, and a read that carries an
 * audit reason is not instant. Without this the browser kept the previous page on screen with no
 * sign that anything was happening. The shape echoes the page that is coming — a header, then a
 * card of rows — so the layout does not jump when it arrives.
 *
 * **It claims nothing.** No figure, no row count, no words that could be read as a result; one
 * status for assistive technology, and shapes. A placeholder number on a compliance screen would
 * be exactly the plausible-looking invention the console's notes refuse elsewhere.
 */
const bar = (width: string, height: number): CSSProperties => ({ width, height });

export const PageSkeleton = (): ReactNode => (
  <div aria-busy="true" aria-label="Loading" className="ff-page" role="status">
    <div className="ff-page-header-text">
      <span className="ff-skeleton" style={bar('34%', 30)} />
      <span className="ff-skeleton" style={bar('62%', 14)} />
    </div>
    <div className="ff-card">
      {['92%', '78%', '86%', '64%', '81%'].map((width) => (
        <span className="ff-skeleton" key={width} style={bar(width, 16)} />
      ))}
    </div>
    <div className="ff-columns">
      <div>
        <div className="ff-card">
          <span className="ff-skeleton" style={bar('40%', 14)} />
          <span className="ff-skeleton" style={bar('28%', 32)} />
        </div>
      </div>
      <div>
        <div className="ff-card">
          <span className="ff-skeleton" style={bar('48%', 14)} />
          <span className="ff-skeleton" style={bar('70%', 14)} />
        </div>
      </div>
    </div>
  </div>
);
