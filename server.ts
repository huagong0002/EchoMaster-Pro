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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

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

  // 登录
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      // 如果是第一次运行，且用户不存在，自动注册（方便教学环境使用）
      if (!user && username && password) {
        const id = Math.random().toString(36).substr(2, 9);
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare('INSERT INTO users (id, username, password, displayName, role) VALUES (?, ?, ?, ?, ?)')
          .run(id, username, hashedPassword, username, username === 'admin' ? 'admin' : 'user');
        
        const newUser = { id, username, displayName: username, role: username === 'admin' ? 'admin' : 'user' };
        const token = jwt.sign(newUser, JWT_SECRET);
        return res.json({ token, user: newUser });
      }
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const { password: _, ...userWithoutPassword } = user;
    const token = jwt.sign(userWithoutPassword, JWT_SECRET);
    res.json({ token, user: userWithoutPassword });
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
