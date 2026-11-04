export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span dir="ltr" className="brand">
      <span className="wordmark" style={{ fontSize: size }}>
        Pixtaha<span className="wordmark-dot">.</span>
      </span>
      <span className="brand-sub" style={{ fontSize: size - 3 }}>Management</span>
    </span>
  );
}
