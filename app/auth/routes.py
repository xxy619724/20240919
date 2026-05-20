from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from app import db
from app.models import User

auth_bp = Blueprint('auth', __name__)


def api_response(code, message, data=None, status=200):
    """统一 API 响应格式"""
    resp = {'code': code, 'message': message}
    if data is not None:
        resp['data'] = data
    return jsonify(resp), status


def login_required(f):
    """登录态装饰器"""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return api_response('UNAUTHORIZED', '请先登录', status=401)
        return f(*args, **kwargs)
    return decorated


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return api_response('INVALID_REQUEST', '请求数据不能为空', status=400)

    email = data.get('email', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    confirm_password = data.get('confirm_password', '')

    # 校验
    if not email or not username or not password or not confirm_password:
        return api_response('MISSING_FIELD', '所有字段不能为空', status=400)

    if len(username) < 3 or len(username) > 20:
        return api_response('INVALID_USERNAME', '用户名长度需在3-20之间', status=400)

    if len(password) < 6:
        return api_response('INVALID_PASSWORD', '密码长度不能少于6位', status=400)

    if password != confirm_password:
        return api_response('PASSWORD_MISMATCH', '两次密码不一致', status=400)

    if User.query.filter_by(email=email).first():
        return api_response('EMAIL_EXISTS', '该邮箱已被注册', status=400)

    if User.query.filter_by(username=username).first():
        return api_response('USERNAME_EXISTS', '该用户名已被使用', status=400)

    # 创建用户
    user = User(
        email=email,
        username=username,
        password_hash=generate_password_hash(password)
    )
    db.session.add(user)
    db.session.commit()

    session['user_id'] = user.id
    session['username'] = user.username

    return api_response('SUCCESS', '注册成功', data=user.to_dict())


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return api_response('INVALID_REQUEST', '请求数据不能为空', status=400)

    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return api_response('MISSING_FIELD', '邮箱和密码不能为空', status=400)

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return api_response('INVALID_CREDENTIALS', '邮箱或密码错误', status=401)

    session['user_id'] = user.id
    session['username'] = user.username

    return api_response('SUCCESS', '登录成功', data=user.to_dict())


@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return api_response('SUCCESS', '已登出')


@auth_bp.route('/me', methods=['GET'])
@login_required
def me():
    user = User.query.get(session['user_id'])
    if not user:
        session.clear()
        return api_response('UNAUTHORIZED', '请先登录', status=401)
    return api_response('SUCCESS', '获取成功', data=user.to_dict())
