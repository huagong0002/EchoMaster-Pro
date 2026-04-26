import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';

const db = new Database('database.sqlite');
const JWT_SECRET = 'echomaster-secret-key-12345';

// 初始化数据库
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    displayName TEXT,
    role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    title TEXT,
    audioUrl TEXT,
    script TEXT,
    segments TEXT,
    ownerId TEXT,
    createdAt INTEGER,
    updatedAt INTEGER
  );
`);

// 预置管理员账号 (如果不存在)
const adminExists = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const adminId = 'admin-001';
  const hashedPassword = bcrypt.hashSync('sdeducation', 10);
  db.prepare('INSERT INTO users (id, username, password, displayName, role) VALUES (?, ?, ?, ?, ?)')
    .run(adminId, 'admin', hashedPassword, '系统管理员', 'admin');
  console.log('Default admin user created');
}

const jerryExists = db.prepare('SELECT * FROM users WHERE username = ?').get('jerrylee086');
if (!jerryExists) {
  const jerryId = 'jerry-001';
  const hashedPassword = bcrypt.hashSync('sdeducation', 10);
  db.prepare('INSERT INTO users (id, username, password, displayName, role) VALUES (?, ?, ?, ?, ?)')
    .run(jerryId, 'jerrylee086', hashedPassword, 'Jerry Lee', 'admin');
  console.log('Default jerry user created');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // 请求日志
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // 中间件：验证 JWT
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Forbidden' });
      req.user = user;
      next();
    });
  };

  // --- API 路由 ---

  // 登录 (严格校验，不再允许自动注册)
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) as any;
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: '用户名或密码错误，请联系管理员。' });
    }

    const { password: _, ...userWithoutPassword } = user;
    const token = jwt.sign(userWithoutPassword, JWT_SECRET);
    res.json({ token, user: userWithoutPassword });
  });

  // 管理员创建用户
  app.post('/api/admin/create-user', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
    
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing data' });

    try {
      const id = Math.random().toString(36).substr(2, 9);
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare('INSERT INTO users (id, username, password, displayName, role) VALUES (?, ?, ?, ?, ?)')
        .run(id, username, hashedPassword, displayName || username, 'user');
      res.json({ success: true });
    } catch (err: any) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: '用户名已存在' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // 获取所有材料 (共享库)
  app.get('/api/materials', authenticateToken, (req, res) => {
    const materials = db.prepare('SELECT * FROM materials ORDER BY updatedAt DESC').all() as any[];
    const formatted = materials.map(m => ({
      ...m,
      segments: JSON.parse(m.segments)
    }));
    res.json(formatted);
  });

  // 保存材料
  app.post('/api/materials', authenticateToken, (req: any, res) => {
    const { id, title, audioUrl, script, segments } = req.body;
    const ownerId = req.user.id;
    const now = Date.now();

    const existing = db.prepare('SELECT id FROM materials WHERE id = ?').get(id);
    if (existing) {
      db.prepare('UPDATE materials SET title = ?, audioUrl = ?, script = ?, segments = ?, updatedAt = ? WHERE id = ?')
        .run(title, audioUrl, script, JSON.stringify(segments), now, id);
    } else {
      db.prepare('INSERT INTO materials (id, title, audioUrl, script, segments, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, title, audioUrl, script, JSON.stringify(segments), ownerId, now, now);
    }
    res.json({ success: true });
  });

  // 删除材料
  app.delete('/api/materials/:id', authenticateToken, (req: any, res) => {
    const material = db.prepare('SELECT ownerId FROM materials WHERE id = ?').get(req.params.id) as any;
    if (!material) return res.status(404).json({ error: 'Not found' });
    
    // 仅允许所有者或管理员删除
    if (material.ownerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    db.prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // 用户映射表 (前端 attribution)
  app.get('/api/users/map', authenticateToken, (req, res) => {
    const users = db.prepare('SELECT id, displayName FROM users').all() as any[];
    const map = users.reduce((acc, u) => {
      acc[u.id] = u.displayName;
      return acc;
    }, {});
    res.json(map);
  });

  // 404 兜底 (API 路由)
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Vite 托管前端
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running locally (Local DB) at http://localhost:${PORT}`);
  });
}

startServer();
