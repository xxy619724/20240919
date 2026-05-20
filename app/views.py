from flask import Blueprint, render_template, session

views_bp = Blueprint('views', __name__)


@views_bp.route('/')
def index():
    user = None
    if 'user_id' in session:
        from app.models import User
        user = User.query.get(session['user_id'])
    return render_template('index.html', user=user)


@views_bp.route('/room/<room_id>')
def room(room_id):
    from app.models import Room
    room = Room.query.get(room_id)
    if not room:
        return render_template('index.html', user=None, error='房间不存在')

    user = None
    if 'user_id' in session:
        from app.models import User
        user = User.query.get(session['user_id'])

    return render_template('room.html', room=room, user=user)


@views_bp.route('/login')
def login_page():
    from flask import redirect, url_for
    if 'user_id' in session:
        return redirect(url_for('views.index'))
    return render_template('login.html', user=None)


@views_bp.route('/register')
def register_page():
    from flask import redirect, url_for
    if 'user_id' in session:
        return redirect(url_for('views.index'))
    return render_template('register.html', user=None)
