#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WPS 加密服务 API
为 Quantumult X 提供 RSA+AES 加密服务
"""

import base64
import json
import time
import random
import string
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from Crypto.Cipher import AES, PKCS1_v1_5
from Crypto.PublicKey import RSA
from Crypto.Util.Padding import pad

app = Flask(__name__)
CORS(app)  # 允许跨域请求

# 可选：设置访问密钥（环境变量）
API_KEY = os.environ.get('WPS_API_KEY', '')

class WPSEncryption:
    """WPS加密工具类"""
    
    @staticmethod
    def generate_aes_key(length: int = 32) -> str:
        """生成AES密钥: 随机字符 + 时间戳"""
        chars = string.ascii_lowercase + string.digits
        random_part = ''.join(random.choice(chars) for _ in range(length - 10))
        timestamp_part = str(int(time.time()))
        return random_part + timestamp_part
    
    @staticmethod
    def aes_encrypt(plain_text: str, aes_key: str) -> str:
        """
        AES-CBC加密
        密钥处理：零填充到32字节，前16位作为IV
        """
        # 将密钥转为bytes并零填充到32字节
        key_bytes = aes_key.encode('utf-8')
        key_padded = key_bytes + b'\x00' * (32 - len(key_bytes))
        
        # 使用前16位作为IV
        iv = aes_key[:16].encode('utf-8')
        
        # 创建AES加密器 (CBC模式)
        cipher = AES.new(key_padded, AES.MODE_CBC, iv)
        
        # PKCS7填充
        plain_bytes = plain_text.encode('utf-8')
        padded_data = pad(plain_bytes, AES.block_size)
        
        # 加密并返回Base64
        encrypted = cipher.encrypt(padded_data)
        return base64.b64encode(encrypted).decode('utf-8')
    
    @staticmethod
    def rsa_encrypt(plain_text: str, public_key_pem: str) -> str:
        """RSA加密"""
        public_key = RSA.import_key(public_key_pem)
        cipher = PKCS1_v1_5.new(public_key)
        encrypted = cipher.encrypt(plain_text.encode('utf-8'))
        return base64.b64encode(encrypted).decode('utf-8')

def check_auth():
    """简单的API密钥验证（可选）"""
    if not API_KEY:
        return True
    provided_key = request.headers.get('X-API-Key', '')
    return provided_key == API_KEY

@app.route('/')
def index():
    """服务状态检查"""
    return jsonify({
        'status': 'running',
        'service': 'WPS Encrypt Service',
        'version': '1.0.0'
    })

@app.route('/health')
def health():
    """健康检查端点"""
    return jsonify({'status': 'healthy'})

@app.route('/encrypt', methods=['POST'])
def encrypt():
    """
    WPS 签到加密接口
    
    请求体：
    {
        "public_key_base64": "Base64编码的RSA公钥",
        "user_id": 12345678,
        "platform": 64  // 可选，默认64
    }
    
    响应：
    {
        "success": true,
        "extra": "AES加密后的数据(Base64)",
        "token": "RSA加密后的AES密钥(Base64)",
        "aes_key": "AES密钥(仅用于调试)"
    }
    """
    # 验证（可选）
    if not check_auth():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'success': False, 'error': 'No JSON data provided'}), 400
        
        public_key_base64 = data.get('public_key_base64')
        user_id = data.get('user_id')
        platform = data.get('platform', 64)
        
        if not public_key_base64:
            return jsonify({'success': False, 'error': 'Missing public_key_base64'}), 400
        
        if not user_id:
            return jsonify({'success': False, 'error': 'Missing user_id'}), 400
        
        # 解码公钥
        public_key_pem = base64.b64decode(public_key_base64).decode('utf-8')
        
        # 生成AES密钥
        aes_key = WPSEncryption.generate_aes_key(32)
        
        # 准备明文数据
        plain_data = json.dumps({
            "user_id": user_id,
            "platform": platform
        }, separators=(',', ':'))
        
        # AES加密数据 (extra)
        extra = WPSEncryption.aes_encrypt(plain_data, aes_key)
        
        # RSA加密AES密钥 (token)
        token = WPSEncryption.rsa_encrypt(aes_key, public_key_pem)
        
        return jsonify({
            'success': True,
            'extra': extra,
            'token': token,
            'aes_key': aes_key  # 可选返回，生产环境建议移除
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/wps/sign', methods=['POST'])
def wps_sign():
    """
    完整的WPS签到辅助接口（可选）
    如果你不想在QX中处理公钥获取，可以使用这个接口
    
    请求体：
    {
        "cookie": "WPS Cookie字符串",
        "user_id": 12345678,
        "platform": 64
    }
    """
    if not check_auth():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    try:
        import requests
        
        data = request.get_json()
        cookie = data.get('cookie')
        user_id = data.get('user_id')
        platform = data.get('platform', 64)
        
        if not cookie or not user_id:
            return jsonify({'success': False, 'error': 'Missing cookie or user_id'}), 400
        
        # 1. 获取公钥
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Cookie': cookie
        }
        
        key_resp = requests.get(
            'https://personal-bus.wps.cn/sign_in/v1/encrypt/key',
            headers=headers,
            timeout=30
        )
        key_result = key_resp.json()
        
        if key_result.get('result') != 'ok':
            return jsonify({
                'success': False,
                'error': f"获取公钥失败: {key_result.get('msg', '未知错误')}"
            })
        
        public_key_base64 = key_result['data']
        
        # 2. 生成加密数据
        encryption = WPSEncryption()
        public_key_pem = base64.b64decode(public_key_base64).decode('utf-8')
        aes_key = encryption.generate_aes_key(32)
        
        plain_data = json.dumps({
            "user_id": user_id,
            "platform": platform
        }, separators=(',', ':'))
        
        extra = encryption.aes_encrypt(plain_data, aes_key)
        token = encryption.rsa_encrypt(aes_key, public_key_pem)
        
        # 3. 执行签到
        sign_headers = headers.copy()
        sign_headers['token'] = token
        sign_headers['Content-Type'] = 'application/json'
        sign_headers['Origin'] = 'https://personal-act.wps.cn'
        sign_headers['Referer'] = 'https://personal-act.wps.cn/'
        
        sign_body = {
            "encrypt": True,
            "extra": extra,
            "pay_origin": "pc_ucs_rwzx_sign"
        }
        
        sign_resp = requests.post(
            'https://personal-bus.wps.cn/sign_in/v1/sign_in',
            headers=sign_headers,
            json=sign_body,
            timeout=30
        )
        
        sign_result = sign_resp.json()
        
        return jsonify({
            'success': True,
            'sign_result': sign_result,
            'raw_response': {
                'status_code': sign_resp.status_code,
                'headers': dict(sign_resp.headers)
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    # 生产环境使用 gunicorn
    # gunicorn -w 4 -b 0.0.0.0:5000 app:app
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
