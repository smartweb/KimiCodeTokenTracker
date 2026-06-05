function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function updateOverview(stats) {
  const today = stats.today || { input: 0, output: 0, total: 0 };
  document.getElementById('today-total').textContent = formatNumber(today.total);
  document.getElementById('today-input').textContent = formatNumber(today.input);
  document.getElementById('today-output').textContent = formatNumber(today.output);

  const total = today.total || 1;
  const inputPct = (today.input / total) * 100;
  const outputPct = (today.output / total) * 100;
  document.getElementById('bar-input').style.width = inputPct + '%';
  document.getElementById('bar-output').style.width = outputPct + '%';
}

function updateMood(stats) {
  const fun = stats.fun || {};
  const emojiEl = document.getElementById('mood-emoji');
  const textEl = document.getElementById('mood-text');
  const convEl = document.getElementById('mood-conversion');

  if (emojiEl) emojiEl.textContent = fun.emoji || '🌱';
  if (textEl) textEl.textContent = fun.moodText || '种子已经埋下，等待发芽 🌱';
  if (convEl) convEl.textContent = fun.conversion || '';
}

function updateActiveSession(stats) {
  const active = stats.activeSession;
  const container = document.getElementById('active-session');
  const badge = document.getElementById('active-badge');

  if (!active) {
    container.innerHTML = '<div class="empty">暂无活跃会话</div>';
    badge.textContent = '无';
    badge.className = 'badge inactive';
    return;
  }

  badge.textContent = active.isActive ? '活跃' : '最近';
  badge.className = active.isActive ? 'badge' : 'badge inactive';

  const dir = active.workDir ? active.workDir.split('/').pop() : active.sessionId.slice(0, 12);
  container.innerHTML = `
    <div class="session-info">
      <div class="session-path">📁 ${dir}</div>
      <div class="session-stats">
        <div class="stat-item">
          <span class="stat-label">Input</span>
          <span class="stat-value" style="color:#4dabf7">${formatNumber(active.totalInput)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Output</span>
          <span class="stat-value" style="color:#69db7c">${formatNumber(active.totalOutput)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Total</span>
          <span class="stat-value">${formatNumber(active.totalTokens)}</span>
        </div>
      </div>
    </div>
  `;
}

function updateTrendChart(stats) {
  const chart = document.getElementById('trend-chart');
  const days = stats.last7Days || [];

  if (days.length === 0) {
    chart.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }

  const maxVal = Math.max(...days.map(d => d.total), 1);

  chart.innerHTML = days.map(d => {
    const pct = (d.total / maxVal) * 100;
    const label = d.date.slice(5); // MM-DD
    return `
      <div class="trend-bar">
        <div class="trend-bar-fill" style="height: ${Math.max(pct, 2)}%"></div>
        <div class="trend-bar-label">${label}</div>
      </div>
    `;
  }).join('');
}

function updateHeatmap(stats) {
  const container = document.getElementById('heatmap');
  const badge = document.getElementById('peak-hour-badge');
  const hourly = stats.hourly || [];

  if (hourly.length === 0 || hourly.every(h => h.total === 0)) {
    container.innerHTML = '<div class="empty">今日暂无时段数据</div>';
    if (badge) {
      badge.textContent = '--:--';
      badge.className = 'badge inactive';
    }
    return;
  }

  if (badge) {
    badge.textContent = stats.peakHour || '--:--';
    badge.className = 'badge';
  }

  container.innerHTML = hourly.map(h => {
    // 根据 intensity 计算颜色深浅
    const intensity = h.intensity || 0;
    const alpha = 0.08 + intensity * 0.82; // 0.08 ~ 0.9
    const bg = `rgba(77, 171, 247, ${alpha})`;
    const isEmpty = h.total === 0;
    return `
      <div class="heatmap-cell ${isEmpty ? 'empty' : ''}"
           style="background: ${isEmpty ? '' : bg};"
           title="${h.label}: ${formatNumber(h.total)}">
        ${h.hour % 3 === 0 ? h.hour : ''}
      </div>
    `;
  }).join('');
}

function updateModelList(stats) {
  const list = document.getElementById('model-list');
  const models = stats.modelDistribution || [];

  if (models.length === 0) {
    list.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }

  const maxVal = Math.max(...models.map(m => m.total), 1);

  list.innerHTML = models.map(m => {
    const pct = (m.total / maxVal) * 100;
    const shortName = m.name.split('/').pop() || m.name;
    return `
      <div class="model-item">
        <span class="model-name" title="${m.name}">${shortName}</span>
        <div class="model-bar-track">
          <div class="model-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="model-value">${formatNumber(m.total)}</span>
      </div>
    `;
  }).join('');
}

function updateSessionList(stats) {
  const list = document.getElementById('session-list');
  const sessions = stats.todaySessions || [];

  if (sessions.length === 0) {
    list.innerHTML = '<div class="empty">今日暂无会话</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const name = s.workDir ? s.workDir.split('/').pop() : s.sessionId.slice(0, 12);
    const icon = s.isActive ? '●' : '○';
    return `
      <div class="session-row">
        <span class="session-row-name">${icon} ${name}</span>
        <span class="session-row-value">${formatNumber(s.total)}</span>
      </div>
    `;
  }).join('');
}

// ========== 分享卡片 ==========

let _lastStats = null;

function generateShareCard() {
  const stats = _lastStats;
  if (!stats || !stats.today || stats.today.total === 0) {
    alert('今日暂无数据，生成不了分享卡片～先去跟 Kimi 聊几句吧！');
    return;
  }

  const canvas = document.getElementById('share-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1a1a2e');
  grad.addColorStop(1, '#16213e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 装饰圆点
  ctx.fillStyle = 'rgba(77, 171, 247, 0.08)';
  ctx.beginPath();
  ctx.arc(340, 80, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(60, 200, 40, 0, Math.PI * 2);
  ctx.fill();

  // 顶部品牌
  ctx.fillStyle = '#888';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('KimiCode Token Tracker', w / 2, 32);

  // 日期
  const todayStr = new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  ctx.fillStyle = '#666';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.fillText(todayStr, w / 2, 48);

  // 大 emoji
  const fun = stats.fun || {};
  ctx.font = '48px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(fun.emoji || '🌱', w / 2, 110);

  // 用量级别标签
  ctx.fillStyle = '#4dabf7';
  ctx.font = 'bold 13px -apple-system, sans-serif';
  ctx.fillText(fun.moodLevel === 'zero' ? '萌芽中' : fun.moodLevel === 'low' ? '萌新期'
    : fun.moodLevel === 'mid' ? '上升期' : fun.moodLevel === 'high' ? '高产期'
    : fun.moodLevel === 'extreme' ? '肝帝模式' : fun.moodLevel === 'ultra' ? '80分选手'
    : '传说级', w / 2, 135);

  // 大数字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 42px -apple-system, sans-serif';
  ctx.fillText(formatNumber(stats.today.total), w / 2, 190);

  ctx.fillStyle = '#888';
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillText('今日 Token 用量', w / 2, 212);

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 230);
  ctx.lineTo(w - 60, 230);
  ctx.stroke();

  // 心情语录
  ctx.fillStyle = '#ccc';
  ctx.font = '13px -apple-system, sans-serif';
  wrapText(ctx, fun.moodText || '今天也要加油呀～', w / 2, 260, 320, 20);

  // 趣味换算
  if (fun.conversion) {
    ctx.fillStyle = '#69db7c';
    ctx.font = 'italic 12px -apple-system, sans-serif';
    ctx.fillText(fun.conversion, w / 2, 310);
  }

  // Input / Output 占比
  ctx.fillStyle = '#aaa';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.fillText(`Input ${formatNumber(stats.today.input)}  ·  Output ${formatNumber(stats.today.output)}`, w / 2, 345);

  // 7 日迷你趋势
  const days = stats.last7Days || [];
  if (days.length > 0) {
    const chartY = 380;
    const chartH = 60;
    const barW = 36;
    const gap = 8;
    const startX = (w - (days.length * (barW + gap) - gap)) / 2;
    const maxVal = Math.max(...days.map(d => d.total), 1);

    days.forEach((d, i) => {
      const pct = d.total / maxVal;
      const barH = Math.max(pct * chartH, 4);
      const x = startX + i * (barW + gap);
      const y = chartY + chartH - barH;

      // 柱体
      const barGrad = ctx.createLinearGradient(0, y, 0, y + barH);
      barGrad.addColorStop(0, '#69db7c');
      barGrad.addColorStop(1, '#4dabf7');
      ctx.fillStyle = barGrad;
      ctx.fillRect(x, y, barW, barH);
      ctx.restore();

      // 日期标签
      ctx.fillStyle = '#666';
      ctx.font = '9px -apple-system, sans-serif';
      ctx.fillText(d.date.slice(5), x + barW / 2, chartY + chartH + 14);
    });
  }

  // 底部
  ctx.fillStyle = '#555';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.fillText('github.com/smartweb/KimiCodeTokenTracker', w / 2, h - 20);

  // 导出
  const dataUrl = canvas.toDataURL('image/png');
  if (window.electronAPI && window.electronAPI.saveShareCard) {
    window.electronAPI.saveShareCard(dataUrl).then(result => {
      if (result && result.success) {
        const btn = document.getElementById('share-btn');
        const original = btn.textContent;
        btn.textContent = '✅ 已保存到桌面';
        setTimeout(() => btn.textContent = original, 2000);
      } else {
        alert('保存失败：' + (result?.error || '未知错误'));
      }
    }).catch(err => {
      console.error(err);
      alert('保存失败');
    });
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split('');
  let line = '';
  let currentY = y;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, currentY);
      line = words[i];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

function render(stats) {
  if (!stats) return;
  _lastStats = stats;
  updateOverview(stats);
  updateMood(stats);
  updateActiveSession(stats);
  updateTrendChart(stats);
  updateHeatmap(stats);
  updateModelList(stats);
  updateSessionList(stats);
}

// 初始加载
async function init() {
  if (window.electronAPI) {
    const stats = await window.electronAPI.getStats();
    render(stats);

    window.electronAPI.onStatsUpdated((stats) => {
      render(stats);
    });
  }

  // 绑定分享按钮
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', generateShareCard);
  }
}

init();
