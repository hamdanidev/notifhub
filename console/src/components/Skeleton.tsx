export function Skeleton({ width, height = 14 }: { width?: string; height?: number }): JSX.Element {
  return (
    <div
      className="skeleton"
      style={{ width: width ?? '100%', height }}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }): JSX.Element {
  return (
    <div className="table-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="table-skeleton__row" key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton key={columnIndex} width={columnIndex === 0 ? '70%' : '50%'} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}
