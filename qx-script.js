/**
 * WPS 签到脚本 (Quantumult X) - 外部加密服务版
 * 
 * 功能：调用外部加密服务完成 WPS 签到
 * 
 * 配置：
 * - wps_cookie: WPS Cookie
 * - wps_user_id: WPS 用户ID
 * - wps_encrypt_service: 加密服务地址（如 https://your-service.onrender.com）
 * - wps_api_key: 加密服务API密钥（可选）
 */

const $ = new Env('WPS签到-外部加密版');

// ==================== 配置区域 ====================
const CONFIG = {
    getCookie() {
        return $.getdata('wps_cookie') || '';
    },
    getUserId() {
        const id = $.getdata('wps_user_id') || '';
        return id ? parseInt(id) : 0;
    },
    getAccountName() {
        return $.getdata('wps_account_name') || 'WPS账号';
    },
    getEncryptService() {
        // 默认使用公共测试服务，建议搭建自己的服务
        return $.getdata('wps_encrypt_service') || 'https://wps-encrypt-demo.onrender.com';
    },
    getApiKey() {
        return $.getdata('wps_api_key') || '';
    },
    maxLotteryLimit: 5,
    debug: true
};

// ==================== 工具函数 ====================
const Utils = {
    log(msg, type = 'info') {
        const prefix = {
            'info': '📌',
            'success': '✅',
            'error': '❌',
            'warn': '⚠️',
            'debug': '🐛'
        }[type] || '📌';
        console.log(`${prefix} ${msg}`);
        if (type === 'debug' && !CONFIG.debug) return;
    },

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    async randomSleep(min = 1000, max = 3000) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await this.sleep(delay);
    },

    parseCookies(cookieStr) {
        const cookies = {};
        if (!cookieStr) return cookies;
        cookieStr.split(';').forEach(item => {
            const [key, value] = item.trim().split('=');
            if (key && value) {
                cookies[key] = value;
            }
        });
        return cookies;
    },

    buildHeaders(cookieStr, extra = {}) {
        const cookies = this.parseCookies(cookieStr);
        const cookieHeader = Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        
        return {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-Type': 'application/json',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Origin': 'https://personal-act.wps.cn',
            'Referer': 'https://personal-act.wps.cn/',
            'Cookie': cookieHeader,
            ...extra
        };
    }
};

// ==================== 外部加密服务模块 ====================
const EncryptService = {
    // 获取RSA公钥
    async getEncryptKey(cookieStr) {
        const options = {
            url: 'https://personal-bus.wps.cn/sign_in/v1/encrypt/key',
            headers: Utils.buildHeaders(cookieStr)
        };
        
        return new Promise((resolve) => {
            $.get(options, (err, resp, data) => {
                if (err) {
                    resolve({ success: false, error: `请求失败: ${err}` });
                    return;
                }
                try {
                    const result = JSON.parse(data);
                    if (result.result === 'ok' && result.data) {
                        resolve({ success: true, publicKey: result.data });
                    } else {
                        resolve({ success: false, error: result.msg || '获取公钥失败' });
                    }
                } catch (e) {
                    resolve({ success: false, error: `解析失败: ${e}` });
                }
            });
        });
    },

    // 调用外部加密服务
    async encrypt(publicKeyBase64, userId, platform = 64) {
        const serviceUrl = CONFIG.getEncryptService();
        const apiKey = CONFIG.getApiKey();
        
        Utils.log(`调用加密服务: ${serviceUrl}/encrypt`, 'debug');
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (apiKey) {
            headers['X-API-Key'] = apiKey;
        }
        
        const body = {
            public_key_base64: publicKeyBase64,
            user_id: userId,
            platform: platform
        };
        
        const options = {
            url: `${serviceUrl}/encrypt`,
            headers: headers,
            body: JSON.stringify(body)
        };
        
        return new Promise((resolve) => {
            $.post(options, (err, resp, data) => {
                if (err) {
                    Utils.log(`加密服务调用失败: ${err}`, 'error');
                    resolve({ success: false, error: `加密服务错误: ${err}` });
                    return;
                }
                
                try {
                    Utils.log(`加密服务响应: ${data.substring(0, 200)}...`, 'debug');
                    const result = JSON.parse(data);
                    resolve(result);
                } catch (e) {
                    Utils.log(`解析加密服务响应失败: ${e}`, 'error');
                    resolve({ success: false, error: `解析失败: ${e}` });
                }
            });
        });
    }
};

// ==================== API 模块 ====================
const WPSAPI = {
    urls: {
        signIn: 'https://personal-bus.wps.cn/sign_in/v1/sign_in',
        userInfo: 'https://personal-act.wps.cn/activity-rubik/activity/page_info',
        lottery: 'https://personal-act.wps.cn/activity-rubik/activity/component_action'
    },

    async signIn(cookieStr, userId) {
        Utils.log('开始任务中心签到...', 'info');
        
        // 1. 获取公钥
        const keyResult = await EncryptService.getEncryptKey(cookieStr);
        if (!keyResult.success) {
            Utils.log(`获取公钥失败: ${keyResult.error}`, 'error');
            return { success: false, error: `获取公钥失败: ${keyResult.error}` };
        }
        
        Utils.log('成功获取 RSA 公钥', 'success');
        
        // 2. 调用外部加密服务
        const encryptResult = await EncryptService.encrypt(keyResult.publicKey, userId);
        if (!encryptResult.success) {
            Utils.log(`加密失败: ${encryptResult.error}`, 'error');
            return { success: false, error: `加密失败: ${encryptResult.error}` };
        }
        
        Utils.log('加密服务调用成功', 'success');
        
        // 3. 构造签到请求
        const headers = Utils.buildHeaders(cookieStr, {
            'token': encryptResult.token
        });
        
        const body = {
            encrypt: true,
            extra: encryptResult.extra,
            pay_origin: "pc_ucs_rwzx_sign"
        };
        
        Utils.log(`发送签到请求...`, 'debug');
        
        const options = {
            url: this.urls.signIn,
            headers: headers,
            body: JSON.stringify(body)
        };
        
        return new Promise((resolve) => {
            $.post(options, (err, resp, data) => {
                if (err) {
                    Utils.log(`签到请求失败: ${err}`, 'error');
                    resolve({ success: false, error: `请求失败: ${err}` });
                    return;
                }
                try {
                    Utils.log(`签到响应: ${data.substring(0, 200)}...`, 'debug');
                    const result = JSON.parse(data);
                    if (result.result === 'ok') {
                        resolve({ 
                            success: true, 
                            alreadySigned: false,
                            data: result.data,
                            message: '签到成功'
                        });
                    } else if (result.msg === 'has sign') {
                        resolve({ 
                            success: true, 
                            alreadySigned: true,
                            message: '今日已签到'
                        });
                    } else if (result.code === 2000000 && result.ext_msg === 'userNotLogin') {
                        resolve({ 
                            success: false, 
                            error: 'Token已过期，请重新登录',
                            errorType: 'token_expired'
                        });
                    } else {
                        resolve({ success: false, error: result.msg || '签到失败' });
                    }
                } catch (e) {
                    Utils.log(`解析响应失败: ${e}`, 'error');
                    resolve({ success: false, error: `解析失败: ${e}` });
                }
            });
        });
    },

    async getUserInfo(cookieStr) {
        const params = {
            activity_number: "HD2025031821201822",
            page_number: "YM2025041617143388"
        };
        
        const queryString = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        
        const options = {
            url: `${this.urls.userInfo}?${queryString}`,
            headers: Utils.buildHeaders(cookieStr, {
                'Referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025041617143388'
            })
        };
        
        return new Promise((resolve) => {
            $.get(options, (err, resp, data) => {
                if (err) {
                    resolve({ success: false, error: `请求失败: ${err}` });
                    return;
                }
                try {
                    const result = JSON.parse(data);
                    if (result.result === 'ok' && result.data) {
                        let lotteryTimes = 0;
                        let points = 0;
                        let adventPoints = 0;
                        let lotteryComponentNumber = '';
                        let lotteryComponentNodeId = '';
                        
                        result.data.forEach(item => {
                            if (item.type === 45 && item.lottery_v2) {
                                const lotteryList = item.lottery_v2.lottery_list || [];
                                lotteryList.forEach(session => {
                                    if (session.session_status === 'IN_PROGRESS') {
                                        lotteryTimes = session.times || 0;
                                    }
                                });
                                lotteryComponentNumber = item.number || '';
                                lotteryComponentNodeId = item.component_node_id || '';
                            } else if (item.type === 36 && item.task_center_user_info) {
                                points = item.task_center_user_info.integral || 0;
                                adventPoints = item.task_center_user_info.advent_integral || 0;
                            }
                        });
                        
                        resolve({
                            success: true,
                            lotteryTimes,
                            points,
                            adventPoints,
                            lotteryComponentNumber,
                            lotteryComponentNodeId
                        });
                    } else {
                        resolve({ success: false, error: result.msg || '获取用户信息失败' });
                    }
                } catch (e) {
                    resolve({ success: false, error: `解析失败: ${e}` });
                }
            });
        });
    },

    async lottery(cookieStr, componentNumber, componentNodeId) {
        const csrfToken = Utils.parseCookies(cookieStr).act_csrf_token || 
                         Utils.parseCookies(cookieStr).csrf;
        
        if (!csrfToken) {
            return { success: false, error: '缺少 CSRF Token' };
        }
        
        const body = {
            component_uniq_number: {
                activity_number: "HD2025031821201822",
                page_number: "YM2025041617143388",
                component_number: componentNumber || "ZJ2025092916515917",
                component_node_id: componentNodeId || "FN1762346087mJlk",
                filter_params: {
                    cs_from: "",
                    mk_key: "JkVKsOtv4aCLMdNdAKwUGoz9tfKeFZVKyjEe",
                    position: "mac_grzx_sign"
                }
            },
            component_type: 45,
            component_action: "lottery_v2.exec",
            lottery_v2: {
                session_id: 2
            }
        };
        
        const options = {
            url: this.urls.lottery,
            headers: Utils.buildHeaders(cookieStr, {
                'X-Act-Csrf-Token': csrfToken,
                'Referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025041617143388'
            }),
            body: JSON.stringify(body)
        };
        
        return new Promise((resolve) => {
            $.post(options, (err, resp, data) => {
                if (err) {
                    resolve({ success: false, error: `请求失败: ${err}` });
                    return;
                }
                try {
                    const result = JSON.parse(data);
                    if (result.result === 'ok' && result.data && result.data.lottery_v2) {
                        const lotteryData = result.data.lottery_v2;
                        if (lotteryData.success) {
                            resolve({
                                success: true,
                                prizeName: lotteryData.reward_name || '未知奖品',
                                rewardType: lotteryData.reward_type,
                                orderId: lotteryData.order_id,
                                rewardId: lotteryData.reward_id
                            });
                        } else {
                            resolve({ 
                                success: false, 
                                error: lotteryData.send_msg || '抽奖失败',
                                errorCode: lotteryData.error_code
                            });
                        }
                    } else if (result.code === 2000000 && result.ext_msg === 'userNotLogin') {
                        resolve({ 
                            success: false, 
                            error: 'Token已过期，请重新登录',
                            errorType: 'token_expired'
                        });
                    } else {
                        resolve({ success: false, error: result.msg || '抽奖失败' });
                    }
                } catch (e) {
                    resolve({ success: false, error: `解析失败: ${e}` });
                }
            });
        });
    }
};

// ==================== 任务执行器 ====================
const TaskRunner = {
    async runTaskCenter(cookieStr, userId, accountName) {
        Utils.log(`[${accountName}] 开始任务中心任务`, 'info');
        
        const result = {
            success: false,
            signMessage: '',
            lotteryMessage: '',
            userInfo: null
        };
        
        // 1. 签到
        const signResult = await WPSAPI.signIn(cookieStr, userId);
        if (!signResult.success) {
            if (signResult.errorType === 'token_expired') {
                return { success: false, error: 'Token已过期', authExpired: true };
            }
            result.signMessage = `签到失败: ${signResult.error}`;
            Utils.log(result.signMessage, 'error');
        } else {
            result.signMessage = signResult.alreadySigned ? '今日已签到' : '签到成功';
            Utils.log(`签到: ${result.signMessage}`, 'success');
        }
        
        // 2. 获取用户信息
        const userInfo = await WPSAPI.getUserInfo(cookieStr);
        if (!userInfo.success) {
            Utils.log(`获取用户信息失败: ${userInfo.error}`, 'warn');
        } else {
            result.userInfo = userInfo;
            Utils.log(`当前积分: ${userInfo.points}, 抽奖次数: ${userInfo.lotteryTimes}`, 'info');
        }
        
        // 3. 抽奖
        if (userInfo.success && userInfo.lotteryTimes > 0 && CONFIG.maxLotteryLimit > 0) {
            const lotteryCount = Math.min(userInfo.lotteryTimes, CONFIG.maxLotteryLimit);
            const prizes = [];
            
            for (let i = 0; i < lotteryCount; i++) {
                if (i > 0) await Utils.randomSleep(1000, 2000);
                
                const lotteryResult = await WPSAPI.lottery(
                    cookieStr, 
                    userInfo.lotteryComponentNumber, 
                    userInfo.lotteryComponentNodeId
                );
                
                if (lotteryResult.success) {
                    prizes.push(lotteryResult.prizeName);
                    Utils.log(`第${i + 1}次抽奖: ${lotteryResult.prizeName}`, 'success');
                } else {
                    if (lotteryResult.errorType === 'token_expired') {
                        return { success: false, error: 'Token已过期', authExpired: true };
                    }
                    Utils.log(`第${i + 1}次抽奖失败: ${lotteryResult.error}`, 'error');
                }
            }
            
            result.lotteryMessage = prizes.length > 0 ? `获得: ${prizes.join(', ')}` : '未中奖';
        } else {
            result.lotteryMessage = '跳过抽奖';
        }
        
        result.success = true;
        return result;
    }
};

// ==================== 主程序 ====================
(async () => {
    try {
        const cookie = CONFIG.getCookie();
        const userId = CONFIG.getUserId();
        const accountName = CONFIG.getAccountName();
        const serviceUrl = CONFIG.getEncryptService();
        
        if (!cookie) {
            Utils.log('请配置 wps_cookie', 'error');
            $.msg('WPS签到', '配置错误', '请配置 wps_cookie');
            $.done();
            return;
        }
        
        if (!userId) {
            Utils.log('请配置 wps_user_id', 'error');
            $.msg('WPS签到', '配置错误', '请配置 wps_user_id');
            $.done();
            return;
        }
        
        Utils.log(`========== WPS签到开始 [${accountName}] ==========`, 'info');
        Utils.log(`使用加密服务: ${serviceUrl}`, 'info');
        
        // 测试加密服务连通性
        Utils.log('测试加密服务连通性...', 'debug');
        const testOptions = {
            url: `${serviceUrl}/health`,
            timeout: 10000
        };
        
        $.get(testOptions, (err, resp, data) => {
            if (err) {
                Utils.log(`加密服务无法连接: ${err}`, 'error');
                $.msg('WPS签到', '服务错误', `无法连接加密服务: ${err}\n请检查 wps_encrypt_service 配置`);
                $.done();
                return;
            }
            
            Utils.log('加密服务连接正常', 'success');
            
            // 执行任务
            (async () => {
                const taskCenterResult = await TaskRunner.runTaskCenter(cookie, userId, accountName);
                
                // 汇总结果
                const summary = [];
                summary.push(`【任务中心】${taskCenterResult.success ? '✅' : '❌'} ${taskCenterResult.signMessage || taskCenterResult.error}`);
                if (taskCenterResult.userInfo) {
                    summary.push(`   积分: ${taskCenterResult.userInfo.points} | 即将过期: ${taskCenterResult.userInfo.adventPoints}`);
                }
                if (taskCenterResult.lotteryMessage) {
                    summary.push(`   抽奖: ${taskCenterResult.lotteryMessage}`);
                }
                
                const finalMessage = summary.join('\n');
                Utils.log('========== 签到完成 ==========', 'info');
                
                // 发送通知
                $.msg('WPS签到', accountName, finalMessage);
                $.done();
            })();
        });
        
    } catch (e) {
        Utils.log(`脚本执行异常: ${e}`, 'error');
        $.msg('WPS签到', '执行异常', e.message);
        $.done();
    }
})();

// ==================== Env 类（保持不变）====================
function Env(t, e) {
    class s {
        constructor(t) {
            this.env = t;
        }
        send(t, e = "GET") {
            t = "string" == typeof t ? { url: t } : t;
            let s = this.get;
            return "POST" === e && (s = this.post), new Promise((e, i) => {
                s.call(this, t, (t, s, r) => {
                    t ? i(t) : e(s);
                });
            });
        }
        get(t) {
            return this.send.call(this.env, t);
        }
        post(t) {
            return this.send.call(this.env, t, "POST");
        }
    }
    return new class {
        constructor(t, e) {
            this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", 
            this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", 
            this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`);
        }
        isNode() {
            return "undefined" != typeof module && !!module.exports;
        }
        isQuanX() {
            return "undefined" != typeof $task;
        }
        isSurge() {
            return "undefined" != typeof $httpClient && "undefined" == typeof $loon;
        }
        isLoon() {
            return "undefined" != typeof $loon;
        }
        toObj(t, e = null) {
            try {
                return JSON.parse(t);
            } catch {
                return e;
            }
        }
        toStr(t, e = null) {
            try {
                return JSON.stringify(t);
            } catch {
                return e;
            }
        }
        getjson(t, e) {
            let s = e;
            const i = this.getdata(t);
            if (i) try {
                s = JSON.parse(this.getdata(t));
            } catch {}
            return s;
        }
        setjson(t, e) {
            try {
                return this.setdata(JSON.stringify(t), e);
            } catch {
                return !1;
            }
        }
        getScript(t) {
            return new Promise(e => {
                this.get({ url: t }, (t, s, i) => e(i));
            });
        }
        runScript(t, e) {
            return new Promise(s => {
                let i = this.getdata("@chavy_boxjs_userCfgs.httpapi");
                i = i ? i.replace(/\n/g, "").trim() : i;
                let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");
                r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r;
                const [o, h] = i.split("@"), a = {
                    url: `http://${h}/v1/scripting/evaluate`,
                    body: { script_text: t, mock_type: "cron", timeout: r },
                    headers: { "X-Key": o, Accept: "*/*" }
                };
                this.post(a, (t, e, i) => s(i));
            }).catch(t => this.logErr(t));
        }
        loaddata() {
            if (!this.isNode()) return {}; {
                this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path");
                const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e);
                if (!s && !i) return {}; {
                    const i = s ? t : e;
                    try {
                        return JSON.parse(this.fs.readFileSync(i));
                    } catch (t) {
                        return {};
                    }
                }
            }
        }
        writedata() {
            if (this.isNode()) {
                this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path");
                const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), r = JSON.stringify(this.data);
                s ? this.fs.writeFileSync(t, r) : i ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r);
            }
        }
        lodash_get(t, e, s) {
            const i = e.replace(/\[(\d+)\]/g, ".$1").split(".");
            let r = t;
            for (const t of i) if (r = Object(r)[t], void 0 === r) return s;
            return r;
        }
        lodash_set(t, e, s) {
            return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), 
            e.slice(0, -1).reduce((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}, t)[e[e.length - 1]] = s, 
            t);
        }
        getdata(t) {
            let e = this.getval(t);
            if (/^@/.test(t)) {
                const [, s, i] = /^@(.*)\.(.*)$/.exec(t), r = s ? this.getval(s) : "";
                if (r) try {
                    const t = JSON.parse(r);
                    e = t ? this.lodash_get(t, i, "") : e;
                } catch (t) {
                    e = "";
                }
            }
            return e;
        }
        setdata(t, e) {
            let s = !1;
            if (/^@/.test(e)) {
                const [, i, r] = /^@(.*)\.(.*)$/.exec(e), o = this.getval(i), h = i ? "null" === o ? null : o || "{}" : "{}";
                try {
                    const e = JSON.parse(h);
                    this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), i);
                } catch (e) {
                    const o = {};
                    this.lodash_set(o, r, t), s = this.setval(JSON.stringify(o), i);
                }
            } else s = this.setval(t, e);
            return s;
        }
        getval(t) {
            return this.isSurge() || this.isLoon() ? $persistentStore.read(t) : this.isQuanX() ? $prefs.valueForKey(t) : this.isNode() ? (this.data = this.loaddata(), 
            this.data[t]) : this.data && this.data[t] || null;
        }
        setval(t, e) {
            return this.isSurge() || this.isLoon() ? $persistentStore.write(t, e) : this.isQuanX() ? $prefs.setValueForKey(t, e) : this.isNode() ? (this.data = this.data || {}, 
            this.data[e] = t, this.writedata(), !0) : this.data && this.data[e] || null;
        }
        initGotEnv(t) {
            this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), 
            this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar(), t && (t.headers = t.headers ? t.headers : {}, 
            void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar));
        }
        get(t, e = (() => {})) {
            if (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"]), 
            this.isSurge() || this.isLoon()) this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, 
            Object.assign(t.headers, {
                "X-Surge-Skip-Scripting": !1
            })), $httpClient.get(t, (t, s, i) => {
                !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i);
            }); else if (this.isQuanX()) this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, {
                hints: !1
            })), $task.fetch(t).then(t => {
                const {
                    statusCode: s,
                    statusCode: i,
                    headers: r,
                    body: o
                } = t;
                e(null, {
                    status: s,
                    statusCode: i,
                    headers: r,
                    body: o
                }, o);
            }, t => e(t)); else if (this.isNode()) {
                let s = require("request");
                this.initGotEnv(t), this.got(t).on("redirect", (t, e) => {
                    try {
                        if (t.headers["set-cookie"]) {
                            const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();
                            s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar;
                        }
                    } catch (t) {
                        this.logErr(t);
                    }
                }).then(t => {
                    const {
                        statusCode: i,
                        statusCode: r,
                        headers: o,
                        body: h
                    } = t;
                    e(null, {
                        status: i,
                        statusCode: r,
                        headers: o,
                        body: h
                    }, h);
                }, t => {
                    const {
                        message: s,
                        response: i
                    } = t;
                    e(s, i, i && i.body);
                });
            }
        }
        post(t, e = (() => {})) {
            if (t.body && t.headers && !t.headers["Content-Type"] && (t.headers["Content-Type"] = "application/x-www-form-urlencoded"), 
            t.headers && delete t.headers["Content-Length"], this.isSurge() || this.isLoon()) this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, 
            Object.assign(t.headers, {
                "X-Surge-Skip-Scripting": !1
            })), $httpClient.post(t, (t, s, i) => {
                !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i);
            }); else if (this.isQuanX()) t.method = "POST", this.isNeedRewrite && (t.opts = t.opts || {}, 
            Object.assign(t.opts, {
                hints: !1
            })), $task.fetch(t).then(t => {
                const {
                    statusCode: s,
                    statusCode: i,
                    headers: r,
                    body: o
                } = t;
                e(null, {
                    status: s,
                    statusCode: i,
                    headers: r,
                    body: o
                }, o);
            }, t => e(t)); else if (this.isNode()) {
                this.initGotEnv(t);
                const {
                    url: s,
                    ...i
                } = t;
                this.got.post(s, i).then(t => {
                    const {
                        statusCode: s,
                        statusCode: i,
                        headers: r,
                        body: o
                    } = t;
                    e(null, {
                        status: s,
                        statusCode: i,
                        headers: r,
                        body: o
                    }, o);
                }, t => {
                    const {
                        message: s,
                        response: i
                    } = t;
                    e(s, i, i && i.body);
                });
            }
        }
        time(t, e = null) {
            const s = e ? new Date(e) : new Date;
            let i = {
                "M+": s.getMonth() + 1,
                "d+": s.getDate(),
                "H+": s.getHours(),
                "m+": s.getMinutes(),
                "s+": s.getSeconds(),
                "q+": Math.floor((s.getMonth() + 3) / 3),
                S: s.getMilliseconds()
            };
            /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length)));
            for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length)));
            return t;
        }
        msg(e = t, s = "", i = "", r) {
            const o = t => {
                if (!t) return t;
                if ("string" == typeof t) return this.isLoon() ? t : this.isQuanX() ? {
                    "open-url": t
                } : this.isSurge() ? {
                    url: t
                } : void 0;
                if ("object" == typeof t) {
                    if (this.isLoon()) {
                        let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"];
                        return {
                            openUrl: e,
                            mediaUrl: s
                        };
                    }
                    if (this.isQuanX()) {
                        let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl;
                        return {
                            "open-url": e,
                            "media-url": s
                        };
                    }
                    if (this.isSurge()) {
                        let e = t.url || t.openUrl || t["open-url"];
                        return {
                            url: e
                        };
                    }
                }
            };
            if (this.isMute || (this.isSurge() || this.isLoon() ? $notification.post(e, s, i, o(r)) : this.isQuanX() && $notify(e, s, i, o(r))), 
            !this.isMuteLog) {
                let t = [ "", "==============📣系统通知📣==============" ];
                t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t);
            }
        }
        log(...t) {
            t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator));
        }
        logErr(t, e) {
            const s = !this.isSurge() && !this.isQuanX() && !this.isLoon();
            s ? this.log("", `❗️${this.name}, 错误!`, t.stack) : this.log("", `❗️${this.name}, 错误!`, t);
        }
        wait(t) {
            return new Promise(e => setTimeout(e, t));
        }
        done(t = {}) {
            const e = (new Date).getTime(), s = (e - this.startTime) / 1e3;
            this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`), this.log(), this.isSurge() || this.isQuanX() || this.isLoon() ? $done(t) : this.isNode() && process.exit(1);
        }
    }(t, e);
}
