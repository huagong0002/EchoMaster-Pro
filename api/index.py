import os
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# 开启跨域支持，确保您的听力系统子域名能正常访问后端
CORS(app)

# =========================================================
# 【用户名单管理中心】
# 老师，您以后只需要在这里增删学生即可。
# 格式说明: "账号": {"password": "密码", "role": "用户角色", "name": "显示姓名"}
# =========================================================
USERS = {
    # --- 管理员账号 ---
    "jerry": {
        "password": os.environ.get('ADMIN_PASSWORD', 'sdeducation'), 
        "role": "admin", 
        "name": "超级管理员"
    },
    "admin": {
        "password": "admin123", 
        "role": "admin", 
        "name": "管理员老师"
    },

    # --- 学生名单开始 (您可以参考格式自由增加) ---
    "2023001": {"password": "123456", "role": "user", "name": "梁冰"},
    "2023002": {"password": "123456", "role": "user", "name": "李琼英"},
    "2024001": {"password": "123456", "role": "user", "name": "唐思莲"},
    "2024002": {"password": "123456", "role": "user", "name": "于希平"},
    "2024003": {"password": "123456", "role": "user", "name": "涂瀚月"},
    "2024004": {"password": "123456", "role": "user", "name": "张璐"},
    "2025001": {"password": "123456", "role": "user", "name": "贾丽娟"},
    "2025002": {"password": "123456", "role": "user", "name": "徐敬平"},
    # -------------------------------------------------------
}

# =========================================================
# 【系统核心逻辑】(建议非必要不修改)
# =========================================================

@app.route('/api/health', methods=['GET'])
def health():
    """健康检查接口，用于测试后端是否通畅"""
    return jsonify({
        "status": "ok", 
        "service": "EchoMaster API",
        "user_count": len(USERS)
    })

@app.route('/api/login', methods=['POST'])
def login():
    """统一登录验证接口"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "fail", "message": "请求格式错误"}), 400
            
        username = data.get('username', '').strip()
        password = data.get('password', '')

        # 检查账号是否存在于 USERS 字典中
        if username in USERS:
            user_data = USERS[username]
            # 校验密码
            if user_data["password"] == password:
                return jsonify({
                    "status": "success",
                    "user": {
                        "id": username,
                        "username": username,
                        "role": user_data["role"],
                        "displayName": user_data["name"]
                    }
                }), 200
        
        # 账号不存在或密码错误
        return jsonify({"status": "fail", "message": "用户名或密码错误"}), 401
        
    except Exception as e:
        # 捕捉异常，避免返回 HTML 错误页面导致前端解析 JSON 失败
        return jsonify({"status": "error", "message": "服务器内部错误"}), 500

# Vercel Serverless 环境必须的 handler
def handler(event, context):
    return app(event, context)
