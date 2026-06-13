export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div>
        <h1 style={{ marginBottom: "0.5rem" }}>Offline</h1>
        <p style={{ opacity: 0.8, maxWidth: "28rem" }}>
          The Panono Control shell is cached, but this page was opened without a network
          connection. Reconnect to load updates, or continue using the app if it is already
          open.
        </p>
      </div>
    </main>
  );
}
