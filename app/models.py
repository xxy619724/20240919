from datetime import datetime
from app import db


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'created_at': self.created_at.isoformat()
        }


class Room(db.Model):
    __tablename__ = 'rooms'

    id = db.Column(db.String(8), primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    creator_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    snapshot = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    creator = db.relationship('User', backref='rooms')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'creator_id': self.creator_id,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }


class RoomParticipant(db.Model):
    __tablename__ = 'room_participants'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    room_id = db.Column(db.String(8), db.ForeignKey('rooms.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    nickname = db.Column(db.String(50), nullable=False)
    joined_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    room = db.relationship('Room', backref='participants')
    user = db.relationship('User', backref='participations')
