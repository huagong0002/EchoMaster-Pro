from flask import Flask, request, jsonify
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

# 这里你可以手动维护几个账号，或者读取环境变量
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'sdeducation')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    # 简单的逻辑：jerry 是老师，sdeducation 是默认密码
    if username == 'jerry' and password == ADMIN_PASS:
        return jsonify({
            "status": "success",
            "token": "admin_token_2026",
            "user": {"id": "1", "username": "jerry", "role": "admin", "displayName": "管理员"}
        })
    return jsonify({"status": "fail", "message": "账号或密码错误"}), 401

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "EchoMaster API"})

# 必须添加这个 handler 供 Vercel 调用
def handler(event, context):
    return app(event, context)
