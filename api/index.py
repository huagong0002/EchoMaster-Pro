from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # 允许前端跨域访问

# 管理员手动维护的账号库
USERS = {
    "jerry": "123456",  # 格式：用户名: 密码
    "student01": "654321"
}

@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        if username in USERS and USERS[username] == password:
            return jsonify({
                "status": "success",
                "message": "登录成功",
                "user": {"username": username}
            }), 200
        else:
            return jsonify({"status": "fail", "message": "用户名或密码错误"}), 401
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# 必须保留，供 Vercel 调用
def handler(event, context):
    return app(event, context)
