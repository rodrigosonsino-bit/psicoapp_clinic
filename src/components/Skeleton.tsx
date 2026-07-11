import './Skeleton.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  className?: string;
}

export default function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius = 'var(--radius-md)',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-text-container">
      {Array.from({ length: lines }).map((_, idx) => (
        <Skeleton
          key={idx}
          width={idx === lines - 1 && lines > 1 ? '70%' : '100%'}
          height="0.875rem"
          className="skeleton-text-line"
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card skeleton-card">
      <Skeleton width="40px" height="40px" borderRadius="var(--radius-full)" />
      <div className="skeleton-card-content">
        <Skeleton width="60%" height="1.25rem" />
        <Skeleton width="40%" height="0.875rem" />
      </div>
    </div>
  );
}

export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="skeleton-table-row">
      {Array.from({ length: cols }).map((_, idx) => (
        <td key={idx}>
          <Skeleton
            width={idx === 0 ? '70%' : '50%'}
            height="1rem"
          />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, idx) => (
              <th key={idx}>
                <Skeleton width="40%" height="0.875rem" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, idx) => (
            <SkeletonTableRow key={idx} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
