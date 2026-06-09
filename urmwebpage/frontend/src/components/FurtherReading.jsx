export default function FurtherReading({ items }) {
  if (!items?.length) {
    return null;
  }

  return (
    <section className="further-reading" aria-label="Further reading">
      <div className="further-reading-title">Further reading</div>
      <div className="further-reading-list">
        {items.map((item) => (
          <div className="further-reading-item" key={item}>
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}
