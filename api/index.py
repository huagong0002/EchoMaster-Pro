import os
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# 开启跨域支持，确保不同域名的前端也能访问
CORS(app)

# =========================================================
# 1. 用户名单管理中心 (在这里手动维护账号)
# 角色说明: 'admin' 拥有管理权限, 'user' 仅能练习
# =========================================================
USERS = {
    "jerry": {
        "password": os.environ.get('ADMIN_PASSWORD', 'sdeducation'),
        "role": "admin",
        "name": "超级管理员"
    },
    "admin": {
        "password": "admin123",
        "role": "admin",
        "name": "老师助手"
    },
    "teacher01": {
        "password": "password888",
        "role": "user",
        "name": "教师张三"
    }
}

# =========================================================
# 2. 路由定义
# =========================================================

# 健康检查接口
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok", 
        "service": "EchoMaster API",
        "environment": "Vercel Serverless"
    })

# 登录接口
@app.route('/api/login', methods=['POST'])
def login():
    try:
        # 获取前端传来的 JSON 数据
        data = request.get_json()
        if not data:
            return jsonify({"status": "fail", "message": "无效的请求格式"}), 400
            
        username = data.get('username', '').strip()
        password = data.get('password', '')

        # 核心验证逻辑
        if username in USERS:
            user_record = USERS[username]
            if user_record["password"] == password:
                # 登录成功，返回用户信息给前端
                return jsonify({
                    "status": "success",
                    "token": "secure_token_" + os.urandom(8).hex(), # 简单生成一个随机 Token
                    "user": {
                        "id": username,
                        "username": username,
                        "role": user_record["role"],
                        "displayName": user_record["name"]
                    }
                }), 200
        
        # 验证失败
        return jsonify({"status": "fail", "message": "用户名或密码错误"}), 401
        
    except Exception as e:
        # 捕获潜在错误，防止程序崩溃返回 HTML
        return jsonify({"status": "error", "message": str(e)}), 500

# =========================================================
# 3. Vercel 适配层
# =========================================================
def handler(event, context):
    return app(event, context)
