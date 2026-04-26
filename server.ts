import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-me";
const PORT = 3000;

// DB Setup
const db = new Database("data.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    author_id TEXT,
    title TEXT,
    audio_url TEXT,
    script TEXT,
    segments TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(author_id) REFERENCES users(id)
  );
`);

// Seed Admin
const seedAdmin = () => {
  const adminExists = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  if (!adminExists) {
    const adminId = crypto.randomUUID();
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
    const hashed = bcrypt.hashSync(adminPassword, 10);
    db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").run(
      adminId,
      "admin",
      hashed,
      "admin"
    );
    console.log("Admin account created: admin / " + adminPassword);
  }
};
seedAdmin();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // --- Auth Middleware ---
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    next();
  };

  // --- API Routes ---

  // User Login
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ id: user.id, username: user.username, role: user.role });
  });

  // Logout
  app.post("/api/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ success: true });
  });

  // Current User
  app.get("/api/me", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "No session" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json(decoded);
    } catch (err) {
      res.status(401).json({ error: "Invalid session" });
    }
  });

  // Get Materials (Shared Library)
  app.get("/api/materials", authenticate, (req, res) => {
    const materials = db.prepare(`
      SELECT m.*, u.username as authorName 
      FROM materials m 
      JOIN users u ON m.author_id = u.id 
      ORDER BY m.created_at DESC
    `).all() as any[];
    
    res.json(materials.map(m => ({
      id: m.id,
      authorId: m.author_id,
      authorName: m.authorName,
      title: m.title,
      audioUrl: m.audio_url,
      script: m.script,
      segments: JSON.parse(m.segments),
      createdAt: m.created_at
    })));
  });

  // Create Material
  app.post("/api/materials", authenticate, (req, res) => {
    const { title, audioUrl, script, segments } = req.body;
    const user = (req as any).user;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO materials (id, author_id, title, audio_url, script, segments)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, user.id, title, audioUrl, script, JSON.stringify(segments));
    res.json({ id });
  });

  // Update Material
  app.put("/api/materials/:id", authenticate, (req, res) => {
    const { title, audioUrl, script, segments } = req.body;
    const materialId = req.params.id;
    const user = (req as any).user;

    const existing = db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });
    
    // Auth check: Admin can update anything, user only their own
    if (existing.author_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized" });
    }

    db.prepare(`
      UPDATE materials SET title = ?, audio_url = ?, script = ?, segments = ?
      WHERE id = ?
    `).run(title, audioUrl, script, JSON.stringify(segments), materialId);
    res.json({ success: true });
  });

  // Delete Material
  app.delete("/api/materials/:id", authenticate, (req, res) => {
    const materialId = req.params.id;
    const user = (req as any).user;

    const existing = db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });
    
    if (existing.author_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized" });
    }

    db.prepare("DELETE FROM materials WHERE id = ?").run(materialId);
    res.json({ success: true });
  });

  // Admin: User Management (List)
  app.get("/api/admin/users", authenticate, isAdmin, (req, res) => {
    const users = db.prepare("SELECT id, username, role FROM users").all();
    res.json(users);
  });

  // Admin: Create User
  app.post("/api/admin/users", authenticate, isAdmin, (req, res) => {
    const { username, password, role } = req.body;
    const id = crypto.randomUUID();
    const hashed = bcrypt.hashSync(password, 10);
    try {
      db.prepare("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)").run(
        id,
        username,
        hashed,
        role || 'user'
      );
      res.json({ id, username, role: role || 'user' });
    } catch (err) {
      res.status(400).json({ error: "Username already exists" });
    }
  });

  // Admin: Delete User
  app.delete("/api/admin/users/:id", authenticate, isAdmin, (req, res) => {
    const userId = req.params.id;
    if (userId === (req as any).user.id) return res.status(400).json({ error: "Cannot delete yourself" });
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    res.json({ success: true });
  });

  // --- Vite Integration ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
