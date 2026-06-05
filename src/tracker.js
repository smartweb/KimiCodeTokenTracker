const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chokidar = require('chokidar');
const EventEmitter = require('events');

const KIMI_HOME = path.join(process.env.HOME, '.kimi-code');
const SESSION_INDEX = path.join(KIMI_HOME, 'session_index.jsonl');

function formatDate(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ========== 趣味文案系统（按真实用量规模校准） ==========
// 参考：5000万 ≈ 60分，1亿 ≈ 80分，3亿 ≈ 跑赢99%

const TIER_CONFIG = [
  { threshold: 0,             emoji: '🌱', labels: ['萌芽中'] },
  { threshold: 1,             emoji: '🐣', labels: ['新手村'] },
  { threshold: 1_000_000,     emoji: '🚀', labels: ['小有成就'] },
  { threshold: 10_000_000,    emoji: '💪', labels: ['进阶选手'] },
  { threshold: 50_000_000,    emoji: '🔥', labels: ['高产达人'] },
  { threshold: 100_000_000,   emoji: '🤯', labels: ['肝帝模式'] },
  { threshold: 300_000_000,   emoji: '👑', labels: ['传说级'] },
];

const MOOD_MESSAGES = {
  zero: [
    '今天有点低调，是 AI 不配让你开口吗？',
    '种子已经埋下，等待发芽 🌱',
    '休息是为了更好地出发～',
  ],
  low: [
    '热身完毕，准备起飞 🚀',
    '轻轻试探，AI 已经收到信号',
    '好的开始是成功的一半 ✨',
  ],
  mid: [
    '这个节奏不错，人和 AI 都在舒适区～',
    '产能在稳步爬坡，继续保持 💪',
    '你和 Kimi 已经建立了基本的默契',
  ],
  high: [
    '今日高产，键盘在燃烧 🔥',
    'Kimi 已经被你调教得服服帖帖',
    '这效率，老板看了都流泪',
  ],
  extreme: [
    '你已经和 Kimi 聊了相当于一本《三体》的量！',
    'Token 消耗速度堪比火箭推进器 🚀',
    '今天的你，是行走的 Prompt 大师',
    'Kimi 的显卡："谢谢老板，已经冒烟了"',
  ],
  ultra: [
    '🏆 80分选手！Kimi 服务器因你而颤抖',
    '1亿 Token，这是人类与 AI 协作的巅峰之作',
    '你的生产力已经超越了 95% 的用户',
    'Kimi 内部排行榜：您已进入 TOP 5%',
  ],
  god: [
    '👑 传说级！3亿 Token，跑赢 99% 的用户',
    '您不是在使用 AI，您是在驯服 AI',
    'Kimi 的显卡看到你的名字都会发抖',
    '这是人类与 AI 协作的极限，请收下我的膝盖',
  ],
};

function getTier(total) {
  let tier = TIER_CONFIG[0];
  for (const t of TIER_CONFIG) {
    if (total >= t.threshold) tier = t;
  }
  return tier;
}

function getMood(todayTotal) {
  if (todayTotal === 0)       return { level: 'zero',    messages: MOOD_MESSAGES.zero };
  if (todayTotal < 1_000_000) return { level: 'low',     messages: MOOD_MESSAGES.low };
  if (todayTotal < 10_000_000)return { level: 'mid',     messages: MOOD_MESSAGES.mid };
  if (todayTotal < 50_000_000)return { level: 'high',    messages: MOOD_MESSAGES.high };
  if (todayTotal < 100_000_000)return { level: 'extreme', messages: MOOD_MESSAGES.extreme };
  if (todayTotal < 300_000_000)return { level: 'ultra',   messages: MOOD_MESSAGES.ultra };
  return { level: 'god', messages: MOOD_MESSAGES.god };
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 趣味换算：把 Token 换算成日常事物
function funConversion(tokens) {
  if (tokens === 0) return null;
  const conversions = [
    { unit: '封情书', tokensPerUnit: 500 },
    { unit: '篇高考作文', tokensPerUnit: 800 },
    { unit: '页《红楼梦》', tokensPerUnit: 1200 },
    { unit: '集《甄嬛传》台词', tokensPerUnit: 3000 },
    { unit: '首唐诗', tokensPerUnit: 200 },
    { unit: '条朋友圈小作文', tokensPerUnit: 300 },
    { unit: '分钟播客文稿', tokensPerUnit: 2500 },
  ];
  const c = pickOne(conversions);
  const val = Math.max(1, Math.round(tokens / c.tokensPerUnit));
  return `≈ ${val} ${c.unit}`;
}

class TokenTracker extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();      // sessionId -> session stats
    this.byDate = new Map();        // "YYYY-MM-DD" -> { input, output, total }
    this.byModel = new Map();       // modelName -> { input, output, total }
    this.byHour = new Map();        // 0-23 -> { input, output, total }
    this.hourlyDate = '';           // byHour 对应的日期，跨天时清空
    this.global = { input: 0, output: 0, total: 0 };
    this.watchers = new Map();      // filePath -> chokidar watcher
    this.fileOffsets = new Map();   // filePath -> { size, inode }
    this._scanInterval = null;
  }

  async start() {
    await this._scanSessions();
    this._startWatching();
    // 每 10 秒重新扫描 session_index，发现新会话
    this._scanInterval = setInterval(() => this._scanSessions(), 10000);
  }

  stop() {
    for (const [fp, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
  }

  async _scanSessions() {
    if (!fs.existsSync(SESSION_INDEX)) return;

    const lines = fs.readFileSync(SESSION_INDEX, 'utf8')
      .split('\n')
      .filter(l => l.trim());

    const sessionIds = new Set();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        sessionIds.add(entry.sessionId);
        const wirePath = path.join(entry.sessionDir, 'agents', 'main', 'wire.jsonl');
        if (!fs.existsSync(wirePath)) continue;

        if (!this.sessions.has(entry.sessionId)) {
          this.sessions.set(entry.sessionId, {
            sessionId: entry.sessionId,
            workDir: entry.workDir || '',
            isActive: false,
            totalInput: 0,
            totalOutput: 0,
            totalTokens: 0,
            byDate: new Map(),
            byModel: new Map(),
            lastUsageTime: 0,
          });
        }

        // 增量解析该会话的 wire.jsonl
        await this._parseWireLog(entry.sessionId, wirePath);

        // 启动对该 wire.jsonl 的实时监听
        this._watchWireLog(wirePath);

        // 判断活跃性：最近 5 分钟有写入即视为活跃
        const stat = fs.statSync(wirePath);
        const sess = this.sessions.get(entry.sessionId);
        sess.isActive = (Date.now() - stat.mtimeMs) < 5 * 60 * 1000;
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 清理已不存在的会话
    for (const sid of this.sessions.keys()) {
      if (!sessionIds.has(sid)) {
        this.sessions.delete(sid);
      }
    }
  }

  async _parseWireLog(sessionId, filePath) {
    const stat = fs.statSync(filePath);
    const currentSize = stat.size;
    const currentInode = stat.ino;

    const offsetKey = filePath;
    const prev = this.fileOffsets.get(offsetKey);

    // 如果文件被截断或 inode 变了（重建），从头读取
    let startPos = 0;
    if (prev && prev.inode === currentInode && prev.size <= currentSize) {
      startPos = prev.size;
    }

    if (startPos === currentSize) {
      // 无新内容
      this.fileOffsets.set(offsetKey, { size: currentSize, inode: currentInode });
      return;
    }

    const stream = fs.createReadStream(filePath, { start: startPos });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let hasNew = false;
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.type === 'usage.record' && record.usage) {
          this._processUsageRecord(sessionId, record);
          hasNew = true;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    this.fileOffsets.set(offsetKey, { size: currentSize, inode: currentInode });

    if (hasNew) {
      this.emit('update');
    }
  }

  _processUsageRecord(sessionId, record) {
    const u = record.usage;
    const input = (u.inputOther || 0) + (u.inputCacheRead || 0) + (u.inputCacheCreation || 0);
    const output = u.output || 0;
    const total = input + output;
    const date = formatDate(record.time);
    const model = record.model || 'unknown';

    // 更新会话级统计
    const sess = this.sessions.get(sessionId);
    if (sess) {
      sess.totalInput += input;
      sess.totalOutput += output;
      sess.totalTokens += total;
      sess.lastUsageTime = Math.max(sess.lastUsageTime, record.time || 0);

      if (!sess.byDate.has(date)) {
        sess.byDate.set(date, { input: 0, output: 0, total: 0 });
      }
      const sd = sess.byDate.get(date);
      sd.input += input;
      sd.output += output;
      sd.total += total;

      if (!sess.byModel.has(model)) {
        sess.byModel.set(model, { input: 0, output: 0, total: 0 });
      }
      const sm = sess.byModel.get(model);
      sm.input += input;
      sm.output += output;
      sm.total += total;
    }

    // 更新全局按日期统计
    if (!this.byDate.has(date)) {
      this.byDate.set(date, { input: 0, output: 0, total: 0 });
    }
    const gd = this.byDate.get(date);
    gd.input += input;
    gd.output += output;
    gd.total += total;

    // 更新全局按模型统计
    if (!this.byModel.has(model)) {
      this.byModel.set(model, { input: 0, output: 0, total: 0 });
    }
    const gm = this.byModel.get(model);
    gm.input += input;
    gm.output += output;
    gm.total += total;

    // 更新全局总计
    this.global.input += input;
    this.global.output += output;
    this.global.total += total;

    // 更新今日小时级统计（用于热力图）
    if (record.time) {
      const recDate = formatDate(record.time);
      if (recDate !== this.hourlyDate) {
        this.byHour.clear();
        this.hourlyDate = recDate;
      }
      const hour = new Date(record.time).getHours();
      if (!this.byHour.has(hour)) {
        this.byHour.set(hour, { input: 0, output: 0, total: 0 });
      }
      const h = this.byHour.get(hour);
      h.input += input;
      h.output += output;
      h.total += total;
    }
  }

  _watchWireLog(filePath) {
    if (this.watchers.has(filePath)) return;
    const watcher = chokidar.watch(filePath, { persistent: true });
    watcher.on('change', async () => {
      // 查找该 wire.jsonl 对应的 sessionId
      try {
        const lines = fs.readFileSync(SESSION_INDEX, 'utf8')
          .split('\n')
          .filter(l => l.trim());
        for (const line of lines) {
          const entry = JSON.parse(line);
          const wp = path.join(entry.sessionDir, 'agents', 'main', 'wire.jsonl');
          if (wp === filePath) {
            await this._parseWireLog(entry.sessionId, filePath);
            break;
          }
        }
      } catch (e) {
        // 忽略错误
      }
    });
    this.watchers.set(filePath, watcher);
  }

  _startWatching() {
    // 监听 session_index.jsonl 的变化（新会话创建）
    if (fs.existsSync(SESSION_INDEX) && !this.watchers.has(SESSION_INDEX)) {
      const watcher = chokidar.watch(SESSION_INDEX, { persistent: true });
      watcher.on('change', () => this._scanSessions());
      this.watchers.set(SESSION_INDEX, watcher);
    }
  }

  _getWirePath(sessionId) {
    // 从 session_index 反查路径，这里用缓存的 sessions map
    const sess = this.sessions.get(sessionId);
    if (!sess) return null;
    // 无法直接从 sessions 获取 sessionDir，需要重新读 session_index
    // 这里简单处理：构造可能路径
    try {
      const lines = fs.readFileSync(SESSION_INDEX, 'utf8')
        .split('\n')
        .filter(l => l.trim());
      for (const line of lines) {
        const entry = JSON.parse(line);
        if (entry.sessionId === sessionId) {
          return path.join(entry.sessionDir, 'agents', 'main', 'wire.jsonl');
        }
      }
    } catch (e) {}
    return null;
  }

  getStats() {
    const today = formatDate(Date.now());
    const todayStats = this.byDate.get(today) || { input: 0, output: 0, total: 0 };

    // 找出当前活跃会话（最近有使用）
    let activeSession = null;
    for (const sess of this.sessions.values()) {
      if (sess.isActive) {
        if (!activeSession || sess.lastUsageTime > activeSession.lastUsageTime) {
          activeSession = sess;
        }
      }
    }

    // 如果没有活跃会话，取最近使用的会话
    if (!activeSession) {
      for (const sess of this.sessions.values()) {
        if (!activeSession || sess.lastUsageTime > activeSession.lastUsageTime) {
          activeSession = sess;
        }
      }
    }

    // 按日期排序取最近 7 天
    const sortedDates = Array.from(this.byDate.keys()).sort();
    const last7Days = sortedDates.slice(-7).map(d => ({
      date: d,
      ...this.byDate.get(d),
    }));

    // 模型分布
    const modelDistribution = Array.from(this.byModel.entries()).map(([name, stats]) => ({
      name,
      ...stats,
    }));

    // 今日会话列表
    const todaySessions = [];
    for (const sess of this.sessions.values()) {
      const td = sess.byDate.get(today);
      if (td && td.total > 0) {
        todaySessions.push({
          sessionId: sess.sessionId,
          workDir: sess.workDir,
          isActive: sess.isActive,
          ...td,
        });
      }
    }
    todaySessions.sort((a, b) => b.total - a.total);

    const mood = getMood(todayStats.total);
    const tier = getTier(todayStats.total);

    // 组装小时级数据（0-23，没有数据的补 0）
    const hourly = [];
    const maxHourly = Math.max(...Array.from(this.byHour.values()).map(h => h.total), 1);
    for (let h = 0; h < 24; h++) {
      const data = this.byHour.get(h) || { input: 0, output: 0, total: 0 };
      hourly.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        intensity: maxHourly > 0 ? data.total / maxHourly : 0,
        ...data,
      });
    }
    // 找出最活跃的时段
    let peakHour = -1;
    let peakTotal = 0;
    for (const h of hourly) {
      if (h.total > peakTotal) {
        peakTotal = h.total;
        peakHour = h.hour;
      }
    }

    return {
      today: { ...todayStats },
      global: { ...this.global },
      activeSession: activeSession ? {
        sessionId: activeSession.sessionId,
        workDir: activeSession.workDir,
        isActive: activeSession.isActive,
        totalInput: activeSession.totalInput,
        totalOutput: activeSession.totalOutput,
        totalTokens: activeSession.totalTokens,
      } : null,
      last7Days,
      modelDistribution,
      todaySessions,
      sessionCount: this.sessions.size,
      hourly,
      peakHour: peakHour >= 0 ? `${String(peakHour).padStart(2, '0')}:00` : null,
      // 趣味数据
      fun: {
        emoji: tier.emoji,
        moodLevel: mood.level,
        moodText: pickOne(mood.messages),
        conversion: funConversion(todayStats.total),
      },
    };
  }

  getCompactTitle() {
    const stats = this.getStats();
    const todayTotal = stats.today?.total || 0;
    const tier = getTier(todayTotal);
    const label = pickOne(tier.labels);

    // macOS 状态栏空间有限，优先显示 emoji + 数字
    // 超过 10K 时偶尔切换为 emoji + 趣味标签，增加惊喜感
    if (todayTotal >= 10000 && Math.random() > 0.7) {
      return `${tier.emoji} ${label}`;
    }
    return `${tier.emoji} ${formatNumber(todayTotal)}`;
  }
}

module.exports = { TokenTracker, formatNumber };
