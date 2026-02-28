import express from "express";
import cors from "cors";
import Database from "better-sqlite3";

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("inventario.db");

// --- DB init ---
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL, -- "sale", "delivery", "adjustment", etc.
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
`);

const getProductBySku = db.prepare("SELECT * FROM products WHERE sku = ?");
const getProductById = db.prepare("SELECT * FROM products WHERE id = ?");

const listProductsStmt = db.prepare("SELECT * FROM products ORDER BY created_at DESC");
const createProductStmt = db.prepare(
  "INSERT INTO products (name, sku, stock) VALUES (?, ?, ?)"
);

const updateStockStmt = db.prepare(
  "UPDATE products SET stock = stock + ? WHERE id = ?"
);

const insertMovementStmt = db.prepare(
  "INSERT INTO movements (product_id, delta, reason, note) VALUES (?, ?, ?, ?)"
);

const listMovementsStmt = db.prepare(`
  SELECT m.*, p.name, p.sku
  FROM movements m
  JOIN products p ON p.id = m.product_id
  ORDER BY m.created_at DESC
  LIMIT 200
`);

// --- Helpers ---
function asInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isInteger(x) ? x : fallback;
}

// --- API ---
// Health
app.get("/api/health", (_, res) => res.json({ ok: true }));

// Products
app.get("/api/products", (_, res) => {
  res.json(listProductsStmt.all());
});

app.post("/api/products", (req, res) => {
  const { name, sku, stock } = req.body || {};
  if (!name || !sku) return res.status(400).json({ error: "name y sku son obligatorios" });

  try {
    const info = createProductStmt.run(name.trim(), sku.trim(), asInt(stock, 0));
    const product = getProductById.get(info.lastInsertRowid);
    res.status(201).json(product);
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return res.status(409).json({ error: "Ese SKU ya existe" });
    }
    res.status(500).json({ error: "Error creando producto" });
  }
});

// Consume / decrement by scan
// body: { sku: "ABC-123", qty: 1, reason: "delivery", note?: "..." }
app.post("/api/consume", (req, res) => {
  const { sku, qty, reason, note } = req.body || {};
  const q = Math.max(1, asInt(qty, 1));
  const r = (reason || "delivery").trim();

  if (!sku) return res.status(400).json({ error: "sku es obligatorio" });

  const product = getProductBySku.get(String(sku).trim());
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  // check stock
  if (product.stock < q) {
    return res.status(409).json({ error: "Stock insuficiente", stock: product.stock });
  }

  const tx = db.transaction(() => {
    updateStockStmt.run(-q, product.id);
    insertMovementStmt.run(product.id, -q, r, note || null);
    return getProductById.get(product.id);
  });

  const updated = tx();
  res.json(updated);
});

// Restock / increment (manual)
app.post("/api/restock", (req, res) => {
  const { sku, qty, reason, note } = req.body || {};
  const q = Math.max(1, asInt(qty, 1));
  const r = (reason || "restock").trim();

  if (!sku) return res.status(400).json({ error: "sku es obligatorio" });

  const product = getProductBySku.get(String(sku).trim());
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const tx = db.transaction(() => {
    updateStockStmt.run(+q, product.id);
    insertMovementStmt.run(product.id, +q, r, note || null);
    return getProductById.get(product.id);
  });

  const updated = tx();
  res.json(updated);
});

// Movements
app.get("/api/movements", (_, res) => {
  res.json(listMovementsStmt.all());
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listo en http://localhost:${PORT}`);
});
