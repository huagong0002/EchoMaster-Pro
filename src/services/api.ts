import { ListeningMaterial, User } from '../types';

export const api = {
  async getMe(): Promise<User | null> {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  async login(username: string, password: string): Promise<User> {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '登录失败');
    }
    return res.json();
  },

  async logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST' });
  },

  async getMaterials(): Promise<ListeningMaterial[]> {
    const res = await fetch('/api/materials');
    if (!res.ok) throw new Error('获取材料失败');
    return res.json();
  },

  async saveMaterial(material: ListeningMaterial): Promise<{ id: string }> {
    const isUpdate = !!material.id;
    const url = isUpdate ? `/api/materials/${material.id}` : '/api/materials';
    const method = isUpdate ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(material),
    });
    
    if (!res.ok) throw new Error('保存失败');
    return res.json();
  },

  async deleteMaterial(id: string): Promise<void> {
    const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
  },

  async getUsers(): Promise<User[]> {
    const res = await fetch('/api/admin/users');
    if (!res.ok) throw new Error('获取用户失败');
    return res.json();
  },

  async createUser(user: any): Promise<User> {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '创建失败');
    }
    return res.json();
  },

  async deleteUser(id: string): Promise<void> {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
  }
};
