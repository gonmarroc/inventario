import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import QRCode from "qrcode";

const API = "http://localhost:4000/api";

export default function App() {
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [form, setForm] = useState({ name: "", sku: "", stock: 0 });

  const [scanMode, setScanMode] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("delivery");
  const scannerRef = useRef(null);

  async function load() {
    const [p, m] = await Promise.all([
      fetch(`${API}/products`).then(r => r.json()),
      fetch(`${API}/movements`).then(r => r.json()),
    ]);
    setProducts(p);
    setMovements(m);
  }

  useEffect(() => { load(); }, []);

  // Start/Stop scanner
  useEffect(() => {
    if (!scanMode) return;

    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scanner.render(
      async (decodedText) => {
        // QR payload recommended: "SKU:ABC-123" or just "ABC-123"
        const sku = decodedText.startsWith("SKU:") ? decodedText.slice(4).trim() : decodedText.trim();
        setLastScan({ sku, at: new Date().toISOString() });

        // consume
        const resp = await fetch(`${API}/consume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku, qty: Number(qty) || 1, reason }),
        });

        const data = await resp.json();
        if (!resp.ok) {
          alert(data?.error || "Error al descontar");
          return;
        }
        await load();
      },
      (err) => {
        // ignore scan errors
      }
    );

    scannerRef.current = scanner;

    return () => {
      try {
        scannerRef.current?.clear();
      } catch {}
      scannerRef.current = null;
    };
  }, [scanMode, qty, reason]);

  async function createProduct(e) {
    e.preventDefault();
    const resp = await fetch(`${API}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, stock: Number(form.stock) || 0 }),
    });
    const data = await resp.json();
    if (!resp.ok) return alert(data?.error || "Error creando producto");
    setForm({ name: "", sku: "", stock: 0 });
    await load();
  }

  async function getQrDataUrl(sku) {
    // QR contains "SKU:<sku>" so it’s unambiguous
    return QRCode.toDataURL(`SKU:${sku}`, { margin: 1, scale: 8 });
  }

  const totalStock = useMemo(
    () => products.reduce((acc, p) => acc + (p.stock || 0), 0),
    [products]
  );

  return (
    <div style={{ fontFamily: "system-ui", padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <h1>Inventario Merch (Fundación)</h1>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <h2>Alta de producto</h2>
          <form onSubmit={createProduct} style={{ display: "grid", gap: 8 }}>
            <input
              placeholder="Nombre (ej: Camiseta blanca)"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <input
              placeholder="SKU (ej: CAMI-BLA-001)"
              value={form.sku}
              onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))}
            />
            <input
              type="number"
              placeholder="Stock inicial"
              value={form.stock}
              onChange={(e) => setForm(f => ({ ...f, stock: e.target.value }))}
            />
            <button type="submit">Crear</button>
          </form>

          <div style={{ marginTop: 12, color: "#555" }}>
            <div><b>Productos:</b> {products.length}</div>
            <div><b>Stock total:</b> {totalStock}</div>
          </div>
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <h2>Escanear y descontar</h2>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Cantidad:
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                style={{ width: 80, marginLeft: 8 }}
              />
            </label>
            <label>
              Motivo:
              <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginLeft: 8 }}>
                <option value="delivery">Entrega</option>
                <option value="sale">Venta</option>
                <option value="internal_use">Uso interno</option>
              </select>
            </label>

            <button onClick={() => setScanMode(s => !s)}>
              {scanMode ? "Parar cámara" : "Iniciar cámara"}
            </button>
          </div>

          {scanMode && (
            <div style={{ marginTop: 12 }}>
              <div id="qr-reader" />
              <p style={{ color: "#666" }}>
                Consejo: en móvil, abre con HTTPS o en localhost para permisos de cámara.
              </p>
            </div>
          )}

          {lastScan && (
            <div style={{ marginTop: 12 }}>
              <b>Último escaneo:</b> {lastScan.sku}
            </div>
          )}
        </section>
      </div>

      <section style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <h2>Listado de productos (con QR)</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {products.map((p) => (
            <ProductRow key={p.id} p={p} getQrDataUrl={getQrDataUrl} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <h2>Últimos movimientos</h2>
        <div style={{ overflowX: "auto" }}>
          <table cellPadding="8" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Fecha</th><th>SKU</th><th>Producto</th><th>Delta</th><th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td>{m.created_at}</td>
                  <td>{m.sku}</td>
                  <td>{m.name}</td>
                  <td>{m.delta}</td>
                  <td>{m.reason}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td colSpan="5" style={{ color: "#666" }}>Sin movimientos todavía</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ProductRow({ p, getQrDataUrl }) {
  const [qr, setQr] = useState(null);

  useEffect(() => {
    (async () => {
      const url = await getQrDataUrl(p.sku);
      setQr(url);
    })();
  }, [p.sku, getQrDataUrl]);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <div style={{ width: 110 }}>
        {qr ? <img src={qr} alt={`QR ${p.sku}`} style={{ width: 100, height: 100 }} /> : "Generando..."}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{p.name}</div>
        <div style={{ color: "#555" }}>SKU: {p.sku}</div>
        <div style={{ marginTop: 6 }}>
          <b>Stock:</b> {p.stock}
        </div>
      </div>
      <div>
        {/* Impresión rápida */}
        <button onClick={() => window.print()}>Imprimir</button>
      </div>
    </div>
  );
}
