const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#07060b;color:#e9e4f5;font-family:system-ui,sans-serif">
      <div style="text-align:center">
        <h1 style="font-weight:300;letter-spacing:0.4em;margin:0">VESPER</h1>
        <p style="opacity:0.6">The town is still being built. Come back at dusk.</p>
      </div>
    </main>
  `;
}
