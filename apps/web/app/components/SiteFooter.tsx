export default function SiteFooter() {
  return (
    <footer
      style={{
        marginTop: 'auto',
        padding: '28px 0 36px',
        borderTop: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          width: '100%',
        }}
      >
        <span>© 2026 Skald and Stone LLC</span>
        <nav aria-label="Legal">
          <a href="/privacy-policy">Privacy Policy</a>
        </nav>
      </div>
    </footer>
  );
}
