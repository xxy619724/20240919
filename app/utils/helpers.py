import string
import random


def generate_room_id(length=8):
    """生成随机房间ID"""
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choices(chars, k=length))
