export function Soon({ title, text }: { title: string; text: string }) {
  return (
    <div className="stack">
      <h1 className="page-title">{title}</h1>
      <div className="soon">{text}</div>
    </div>
  );
}
