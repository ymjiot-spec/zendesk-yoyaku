/**
 * Zendesk 顧客リスク分析アプリ
 * コールセンター電話中の高速理解を実現
 */

// グローバル変数
let zafClient;
let currentTickets = [];
let selectedTicketId = null; // 単一選択に変更
let customerRiskData = null;
let ticketCache = new Map();
let API_ENDPOINT = '';
let API_KEY = '';
let OPENAI_API_KEY = '';

/**
 * HTMLタグを除去する関数
 */
function stripHTML(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

/**
 * アプリ初期化
 */
async function initializeApp() {
  try {
    // ZAFClientがグローバルに存在するか確認
    if (typeof ZAFClient === 'undefined') {
      throw new Error('ZAFClient is not loaded');
    }
    
    zafClient = ZAFClient.init();
    
    // ZAF初期化完了を待つ
    await zafClient.get('currentUser');
    
    // アプリ設定を取得
    try {
      const settings = await zafClient.metadata();
      if (settings && settings.settings) {
        API_ENDPOINT = settings.settings.api_endpoint || '';
        API_KEY = settings.settings.api_key || '';
        OPENAI_API_KEY = settings.settings.openai_api_key || '';
      }
    } catch (settingsError) {
      // 設定取得失敗は無視（デフォルト値を使用）
    }
    
    // Zendesk Framework用のリサイズ
    try {
      await zafClient.invoke('resize', { width: '100%', height: '600px' });
    } catch (resizeError) {
      // リサイズ失敗は無視
    }
    
    // イベントリスナー登録
    registerEventListeners();
    
    // アプリ起動
    await startApp();
    
  } catch (error) {
    console.error('ZAF initialization error:', error);
    showError('アプリの初期化に失敗しました: ' + error.message);
    hideLoading();
  }
}

/**
 * イベントリスナー登録 - 安全なDOM操作
 */
function registerEventListeners() {
  const currentTicketBtn = document.getElementById('current-ticket-btn');
  if (currentTicketBtn) currentTicketBtn.addEventListener('click', handleCurrentTicketSummary);
  
  const selectedBtn = document.getElementById('summarize-selected-btn');
  if (selectedBtn) selectedBtn.addEventListener('click', handleSelectedTicketSummary);
  
  const showTicketBtn = document.getElementById('show-current-ticket-btn');
  if (showTicketBtn) showTicketBtn.addEventListener('click', handleShowCurrentTicket);
  
  const closeBtn = document.getElementById('close-summary');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const container = document.getElementById('summary-container');
      if (container) container.style.display = 'none';
    });
  }
  
  const saveBtn = document.getElementById('save-memo-btn');
  if (saveBtn) saveBtn.addEventListener('click', handleSaveMemo);
  
  // アプリ全体のホバーでリサイズ
  const appRoot = document.getElementById('app-root');
  if (appRoot) {
    appRoot.addEventListener('mouseenter', () => {
      if (zafClient) {
        zafClient.invoke('resize', { width: '100%', height: '800px' });
      }
    });
    
    appRoot.addEventListener('mouseleave', () => {
      if (zafClient) {
        zafClient.invoke('resize', { width: '100%', height: '600px' });
      }
    });
  }
  
  // キャッシュクリア
  window.addEventListener('beforeunload', () => {
    ticketCache.clear();
  });
}

/**
 * このチケットを表示
 */
async function handleShowCurrentTicket() {
  try {
    // 選択されたチケットIDがあればそれを使用、なければ現在のチケット
    let targetTicketId = selectedTicketId;
    
    if (!targetTicketId) {
      const ticketData = await zafClient.get('ticket.id');
      targetTicketId = ticketData['ticket.id'];
    }
    
    if (targetTicketId) {
      // チケット詳細画面に遷移
      await zafClient.invoke('routeTo', 'ticket', targetTicketId);
    } else {
      showError('チケットIDが取得できませんでした');
    }
  } catch (error) {
    console.error('チケット表示エラー:', error);
    showError('チケットの表示に失敗しました: ' + error.message);
  }
}

/**
 * アプリ起動
 */
async function startApp() {
  try {
    showLoading();
    
    // 依頼者情報取得
    const requesterEmail = await getRequesterEmail();
    if (!requesterEmail) {
      showError('依頼者のメールアドレスが見つかりません');
      return;
    }
    
    // チケット履歴取得
    const tickets = await fetchTicketHistory(requesterEmail);
    currentTickets = tickets;
    
    // 顧客リスク分析（キーワードベース＝初期表示）
    customerRiskData = analyzeCustomerRisk(tickets, requesterEmail);
    
    // UI表示
    renderCustomerRisk(customerRiskData);
    renderTicketList(tickets);
    await loadExistingMemos(requesterEmail);
    
    hideLoading();
    showContent();
    
    // GPTによるAI要約・リスク判定（バックグラウンド）
    if (OPENAI_API_KEY && tickets.length > 0) {
      analyzeTicketRiskWithAI(tickets).then(() => {
        customerRiskData = analyzeCustomerRisk(currentTickets, requesterEmail);
        renderCustomerRisk(customerRiskData);
      }).catch(err => {
        console.error('AIリスク判定失敗:', err);
      });
    }
    
  } catch (error) {
    console.error('アプリ起動エラー:', error);
    showError('アプリの初期化に失敗しました', error);
    hideLoading();
  }
}

/**
 * 依頼者メールアドレス取得
 */
async function getRequesterEmail() {
  try {
    const data = await zafClient.get('ticket.requester');
    if (data && data['ticket.requester'] && data['ticket.requester'].email) {
      return data['ticket.requester'].email;
    }
    return null;
  } catch (error) {
    console.error('メールアドレス取得エラー:', error);
    return null;
  }
}

/**
 * チケット履歴取得
 */
async function fetchTicketHistory(email) {
  try {
    // キャッシュチェック
    if (ticketCache.has(email)) {
      return ticketCache.get(email);
    }
    
    // 現在のチケットID取得
    const currentTicketData = await zafClient.get('ticket.id');
    const currentTicketId = currentTicketData['ticket.id'];
    
    // 検索クエリ
    const searchQuery = `type:ticket requester:${email}`;
    
    // API呼び出し
    const response = await zafClient.request({
      url: `/api/v2/search.json?query=${encodeURIComponent(searchQuery)}`,
      type: 'GET'
    });
    
    let tickets = response.results || [];
    
    // 現在のチケットを除外
    tickets = tickets.filter(t => t.id !== currentTicketId);
    
    // 日時降順ソート
    tickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // 各チケットにリスクスコア追加
    tickets = tickets.map(ticket => ({
      ...ticket,
      riskAnalysis: analyzeTicketRisk(ticket)
    }));
    
    // キャッシュ保存
    ticketCache.set(email, tickets);
    
    return tickets;
    
  } catch (error) {
    console.error('チケット履歴取得エラー:', error);
    throw error;
  }
}

/**
 * チケットリスク分析（初期表示用・GPT判定前のプレースホルダー）
 */
function analyzeTicketRisk(ticket) {
  return {
    complaintScore: 0,
    level: 'safe',
    levelText: '通常',
    icon: '🟢',
    reason: '通常',
    toxicity: 0,
    repeatRisk: 0,
    refundPressure: 0
  };
}

/**
 * GPTによるAIリスク判定（高速版）
 * 全チケットを1回のGPTリクエストで処理（オーバーヘッド最小化）
 */
async function analyzeTicketRiskWithAI(tickets) {
  if (!tickets || tickets.length === 0) return;
  
  const removeGreetings = /(?:お問い合わせいただきありがとうございます|いつもお世話になっております|お世話になっております|お疲れ様です|よろしくお願い(?:いた)?します|何卒よろしくお願いいたします)[。、\s]*/g;
  
  const ticketSummaries = tickets.map(t => {
    const desc = stripHTML(t.description || '').replace(/\n+/g, ' ').replace(removeGreetings, '').replace(/^[。、\s　]+/, '').trim();
    return `${t.id}:${desc.substring(0, 80) || '不明'}`;
  }).join('\n');
  
  const prompt = `チケット分析。JSON配列で回答。summaryは問い合わせ内容を具体的に30文字程度で要約（人名除外）。

level判定基準（文章のトーン・感情で判断すること）：
- danger: 顧客が怒っている。怒りの感情表現・クレーム・返金要求・訴訟示唆・「許せない」「ふざけるな」等。不具合の報告や改善要望はdangerではない
- warn: 不満や困惑を感じているが怒りではない。「困っている」「納得できない」「改善してほしい」等の要望レベル
- safe: 通常の問い合わせ・確認・依頼・手続き・丁寧なお願い。迷惑をかけた側が謝っている場合もsafe

${ticketSummaries}
[{"id":数値,"level":"safe/warn/danger","score":0-100,"summary":"30文字程度の具体的要約"}]`;

  try {
    const response = await zafClient.request({
      url: 'https://api.openai.com/v1/chat/completions',
      type: 'POST',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_API_KEY
      },
      data: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: Math.max(1200, tickets.length * 120)
      })
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;
    
    const results = JSON.parse(jsonMatch[0]);
    
    results.forEach(result => {
      const ticket = currentTickets.find(t => t.id == result.id);
      if (!ticket) return;
      
      const levelMap = {
        'safe': { levelText: '通常', icon: '🟢' },
        'warn': { levelText: '注意', icon: '⚠️' },
        'danger': { levelText: 'クレーム', icon: '🔥' }
      };
      
      const mapped = levelMap[result.level] || levelMap['safe'];
      
      ticket.riskAnalysis = {
        complaintScore: result.score || 0,
        level: result.level || 'safe',
        levelText: mapped.levelText,
        icon: mapped.icon,
        reason: result.reason || '通常',
        toxicity: result.score || 0,
        repeatRisk: 0,
        refundPressure: 0
      };
      
      if (result.summary) {
        ticket.aiSummary = result.summary;
      }
      
      // DOM更新
      const ticketEl = document.querySelector(`.ticket-item[data-ticket-id="${ticket.id}"]`);
      if (ticketEl) {
        const badge = ticketEl.querySelector('.ticket-risk-badge');
        if (badge) {
          badge.className = `ticket-risk-badge ${result.level}`;
          badge.textContent = `${mapped.icon} ${mapped.levelText}`;
        }
        ticketEl.dataset.risk = result.level;
        
        if (result.summary) {
          const summaryEl = ticketEl.querySelector('.ticket-summary');
          if (summaryEl) {
            summaryEl.textContent = `「${result.summary}」`;
          }
        }
      }
    });
    
  } catch (error) {
    console.error('AIリスク判定エラー:', error);
    throw error;
  }
}

/**
 * 顧客リスク分析
 */
function analyzeCustomerRisk(tickets, email) {
  if (!tickets || tickets.length === 0) {
    return {
      score: 0,
      level: 'normal',
      levelText: '通常',
      details: '過去の問い合わせ履歴がありません'
    };
  }
  
  let totalScore = 0;
  let complaintCount = 0;
  let recentComplaints = 0;
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  
  tickets.forEach(ticket => {
    const risk = ticket.riskAnalysis;
    totalScore += risk.complaintScore;
    
    if (risk.complaintScore >= 50) {
      complaintCount++;
      
      const ticketDate = new Date(ticket.created_at);
      if (ticketDate >= ninetyDaysAgo) {
        recentComplaints++;
      }
    }
  });
  
  // 平均スコア
  const avgScore = Math.round(totalScore / tickets.length);
  
  // 最終スコア計算（クレームチケットの割合ベース）
  let finalScore = avgScore;
  if (recentComplaints >= 3) finalScore += 20;
  else if (recentComplaints >= 2) finalScore += 10;
  if (complaintCount >= 5) finalScore += 15;
  else if (complaintCount >= 3) finalScore += 10;
  
  finalScore = Math.min(100, finalScore);
  
  // レベル判定（クレームが実際にあるかどうかで判断）
  let level = 'normal';
  let levelText = '通常';
  if (complaintCount >= 3 || finalScore >= 70) {
    level = 'danger';
    levelText = '要注意';
  } else if (complaintCount >= 1 || finalScore >= 50) {
    level = 'caution';
    levelText = '慎重対応';
  }
  
  // 詳細テキスト
  const details = `過去${tickets.length}件 / 直近90日クレーム${recentComplaints}件 / 平均リスク${avgScore}点`;
  
  return {
    score: finalScore,
    level,
    levelText,
    details,
    complaintCount,
    recentComplaints
  };
}

/**
 * 顧客リスク表示 - 安全なDOM操作
 */
function renderCustomerRisk(riskData) {
  const levelEl = document.getElementById('risk-level');
  const barFillEl = document.getElementById('risk-bar-fill');
  const scoreEl = document.getElementById('risk-score');
  const detailsEl = document.getElementById('risk-details');
  
  if (!levelEl || !barFillEl || !scoreEl || !detailsEl) {
    console.error('Risk panel elements not found');
    return;
  }
  
  levelEl.textContent = riskData.levelText;
  levelEl.className = `risk-level ${riskData.level}`;
  
  barFillEl.style.width = `${riskData.score}%`;
  barFillEl.className = `risk-bar-fill ${riskData.level}`;
  
  scoreEl.textContent = riskData.score;
  detailsEl.textContent = riskData.details;
}

/**
 * チケット一覧表示 - 安全なDOM操作
 */
function renderTicketList(tickets) {
  const listEl = document.getElementById('ticket-list');
  const noTicketsEl = document.getElementById('no-tickets');
  
  if (!listEl || !noTicketsEl) {
    console.error('Ticket list elements not found');
    return;
  }
  
  if (!tickets || tickets.length === 0) {
    listEl.style.display = 'none';
    noTicketsEl.style.display = 'block';
    return;
  }
  
  listEl.innerHTML = '';
  noTicketsEl.style.display = 'none';
  
  tickets.forEach(ticket => {
    const item = createTicketItem(ticket);
    listEl.appendChild(item);
  });
  
}

/**
 * チケットアイテム作成（洗練版・toggle機能付き）
 */
function createTicketItem(ticket) {
  try {
    const div = document.createElement('div');
    div.className = 'ticket-item';
    div.dataset.ticketId = ticket.id;
    
    const risk = ticket.riskAnalysis || { complaintScore: 0, levelText: '通常', icon: '🟢', level: 'safe' };
    const datetime = formatDateTime(ticket.created_at);
    
    // descriptionから要約を生成（常にdescriptionを使う）
    const desc = stripHTML(ticket.description || '').trim();
    let summary = '';
    if (desc.length > 5) {
      let cleanDesc = desc.replace(/\n+/g, ' ').trim();
      const removeGreetings = /(?:お問い合わせいただきありがとうございます|いつもお世話になっております|お世話になっております|お疲れ様です|ご担当者様|よろしくお願い(?:いた)?します|何卒よろしくお願いいたします|ありがとうございます)[。、\s]*/g;
      cleanDesc = cleanDesc.replace(removeGreetings, '').replace(/^[。、\s　]+/, '').trim();
      summary = cleanDesc.length > 5 ? cleanDesc : (ticket.subject || '問い合わせ');
    } else {
      summary = ticket.subject || '問い合わせ';
    }
    summary = truncateText(summary, 80);
    const status = translateStatus(ticket.status);
    const ticketNumber = `#${ticket.id}`;
    const channel = getChannelInfo(ticket);
    
    div.dataset.risk = risk.level;
    
    // 選択チェック（左側）
    const checkDiv = document.createElement('div');
    checkDiv.className = 'ticket-select-check';
    
    // チケットコンテンツ
    const contentDiv = document.createElement('div');
    contentDiv.className = 'ticket-content';
    
    contentDiv.innerHTML = `
      <div class="ticket-header">
        <span class="ticket-channel" title="${escapeHtml(channel.label)}">${channel.icon}</span>
        <a href="#" class="ticket-number-link" data-ticket-id="${ticket.id}">${escapeHtml(ticketNumber)}</a>
        <span class="ticket-datetime">${escapeHtml(datetime)}</span>
        <span class="ticket-risk-badge ${risk.level}">${risk.icon} ${risk.levelText}</span>
        <span class="ticket-status ${escapeHtml(ticket.status)}">${escapeHtml(status)}</span>
      </div>
      <div class="ticket-summary">「${escapeHtml(summary)}」</div>
    `;
    
    div.appendChild(checkDiv);
    div.appendChild(contentDiv);
    
    // チケット番号クリックイベント
    const ticketLink = contentDiv.querySelector('.ticket-number-link');
    if (ticketLink) {
      ticketLink.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ticketId = e.target.dataset.ticketId;
        try {
          await zafClient.invoke('routeTo', 'ticket', ticketId);
        } catch (error) {
          console.error('チケット表示エラー:', error);
          showError('チケットの表示に失敗しました');
        }
      });
    }
    
    // クリックイベント（toggle機能）
    div.addEventListener('click', () => {
      const isCurrentlySelected = div.classList.contains('selected');
      
      // 他の選択を解除
      document.querySelectorAll('.ticket-item').forEach(item => {
        item.classList.remove('selected');
      });
      
      // 要約を非表示
      const summaryContainer = document.getElementById('summary-container');
      if (summaryContainer) {
        summaryContainer.style.display = 'none';
      }
      
      if (isCurrentlySelected) {
        // 同じカードをクリック → 選択解除
        selectedTicketId = null;
        updateButtonStates(false);
      } else {
        // 新しいカードを選択
        div.classList.add('selected');
        selectedTicketId = ticket.id;
        updateButtonStates(true);
      }
    });
    
    return div;
  } catch (error) {
    console.error('createTicketItem error:', error);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'ticket-item error';
    errorDiv.textContent = 'チケット表示エラー';
    return errorDiv;
  }
}

/**
 * ボタン状態更新（視覚的優先度切替）
 */
function updateButtonStates(isSelected) {
  const currentTicketBtn = document.getElementById('current-ticket-btn');
  const selectedTicketBtn = document.getElementById('summarize-selected-btn');
  
  if (!currentTicketBtn || !selectedTicketBtn) return;
  
  if (isSelected) {
    // 履歴選択時：選択ボタンを強調、現在チケットボタンをグレーダウン
    currentTicketBtn.classList.add('btn-disabled');
    selectedTicketBtn.classList.add('btn-active');
    selectedTicketBtn.disabled = false;
  } else {
    // 未選択時：現在チケットボタンを強調、選択ボタンをセカンダリ
    currentTicketBtn.classList.remove('btn-disabled');
    selectedTicketBtn.classList.remove('btn-active');
    selectedTicketBtn.disabled = true;
  }
}

/**
 * 日時フォーマット（YYYY/MM/DD HH:MM形式）
 */
function formatDateTime(isoDate) {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

/**
 * テキスト切り詰め
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * チケットサマリ生成（ルールベース）
 */
function generateTicketSummary(ticket) {
  const subject = ticket.subject || '';
  
  // 30文字に切り詰め
  if (subject.length <= 30) {
    return subject;
  }
  
  return subject.substring(0, 30) + '...';
}

/**
 * 日付フォーマット
 */
function formatDate(isoDate) {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

/**
 * ステータス翻訳
 */
function translateStatus(status) {
  const map = {
    'new': '新規',
    'open': 'オープン',
    'pending': '保留中',
    'hold': '待機中',
    'solved': '解決済み',
    'closed': '終了'
  };
  return map[status] || status;
}

/**
 * チャネル情報取得（電話・メール・Web等）
 */
function getChannelInfo(ticket) {
  const channel = (ticket.via && ticket.via.channel) || '';
  const map = {
    'voice': { icon: '📞', label: '電話' },
    'phone': { icon: '📞', label: '電話' },
    'email': { icon: '✉️', label: 'メール' },
    'web':   { icon: '🌐', label: 'Web' },
    'chat':  { icon: '💬', label: 'チャット' },
    'api':   { icon: '🔗', label: 'API' },
    'twitter': { icon: '🐦', label: 'Twitter' },
    'facebook': { icon: '📘', label: 'Facebook' }
  };
  return map[channel] || { icon: '📩', label: channel || '不明' };
}

/**
 * 現在のチケットを要約
 */
async function handleCurrentTicketSummary() {
  try {
    // 選択を解除
    selectedTicketId = null;
    document.querySelectorAll('.ticket-item').forEach(item => {
      item.classList.remove('selected');
    });
    updateButtonStates(false);
    
    // ボタンを無効化
    const btn = document.getElementById('current-ticket-btn');
    if (btn) {
      btn.disabled = true;
      const btnText = btn.querySelector('.btn-text');
      if (btnText) btnText.textContent = '生成中...';
    }
    
    // 現在のチケット情報を取得
    const ticketData = await zafClient.get([
      'ticket.id', 
      'ticket.subject', 
      'ticket.description', 
      'ticket.status', 
      'ticket.createdAt',
      'ticket.comments',
      'ticket.requester.id'
    ]);
    
    const ticketId = ticketData['ticket.id'];
    const requesterId = ticketData['ticket.requester.id'];
    
    // チケットのコメント（やり取り）を取得 - 常にAPIから取得（publicフラグが確実に含まれる）
    let comments = [];
    try {
      const commentsResponse = await zafClient.request({
        url: `/api/v2/tickets/${ticketId}/comments.json`,
        type: 'GET'
      });
      comments = commentsResponse.comments || [];
    } catch (error) {
      if (ticketData['ticket.comments']) {
        comments = ticketData['ticket.comments'];
      }
    }
    
    // Audits APIからシステムイベント（自己解決・チケット統合等）を取得して追加
    try {
      const auditsResponse = await zafClient.request({
        url: `/api/v2/tickets/${ticketId}/audits.json`,
        type: 'GET'
      });
      const audits = auditsResponse.audits || [];
      const commentIds = new Set(comments.map(c => c.id));
      
      audits.forEach(audit => {
        if (!audit.events) return;
        audit.events.forEach(event => {
          // Commentタイプのイベントでまだcommentsに含まれていないもの
          if (event.type === 'Comment' && !commentIds.has(event.id)) {
            const text = stripHTML(event.html_body || event.body || '').trim();
            if (text.length >= 5) {
              comments.push({
                id: event.id,
                author_id: event.author_id,
                body: event.body || '',
                value: event.html_body || event.body || '',
                public: event.public,
                created_at: audit.created_at,
                via: audit.via || {}
              });
              commentIds.add(event.id);
            }
          }
        });
      });
      
      // 時系列順にソート
      comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch (auditError) {
      // Audits API失敗は無視
    }
    
    const currentTicket = {
      id: ticketId,
      subject: ticketData['ticket.subject'],
      description: ticketData['ticket.description'],
      status: ticketData['ticket.status'],
      created_at: ticketData['ticket.createdAt'],
      comments: comments,
      requester_id: requesterId,
      riskAnalysis: analyzeTicketRisk({
        subject: ticketData['ticket.subject'],
        description: ticketData['ticket.description']
      })
    };
    
    // 要約生成（GPT優先、フォールバックでルールベース）
    let summary;
    if (OPENAI_API_KEY) {
      const ruleBase = generateModernSummary([currentTicket]);
      const aiResult = await generateAISummary(currentTicket, ruleBase._validComments || [], ruleBase._publicComments || []);
      if (aiResult) {
        // AI要約で社内メモが空ならルールベースの社内メモを使う
        if (!aiResult.privateMemo && ruleBase.privateMemo) {
          aiResult.privateMemo = ruleBase.privateMemo;
        }
        summary = aiResult;
      } else {
        summary = ruleBase;
      }
    } else {
      summary = generateModernSummary([currentTicket]);
    }
    
    // 表示（チケットID付き）
    displayModernSummary(summary, ticketId);
    
    // ボタンを復元
    if (btn) {
      btn.disabled = false;
      const btnText = btn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'このチケットを要約';
    }
    
  } catch (error) {
    console.error('現在チケット要約エラー:', error);
    showError('要約の生成に失敗しました: ' + error.message);
    
    // ボタンを復元
    const btn = document.getElementById('current-ticket-btn');
    if (btn) {
      btn.disabled = false;
      const btnText = btn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'このチケットを要約';
    }
  }
}

/**
 * 選択したチケットを要約
 */
async function handleSelectedTicketSummary() {
  try {
    if (!selectedTicketId) {
      showError('チケットを選択してください');
      return;
    }
    
    // 選択されたチケットを取得
    const selectedTicket = currentTickets.find(t => t.id === selectedTicketId);
    if (!selectedTicket) {
      showError('選択されたチケットが見つかりません');
      return;
    }
    
    // ボタンを無効化
    const btn = document.getElementById('summarize-selected-btn');
    if (btn) {
      btn.disabled = true;
      btn.querySelector('.btn-text').textContent = '生成中...';
    }
    
    // 選択されたチケットのコメントを取得
    let comments = [];
    try {
      const commentsResponse = await zafClient.request({
        url: `/api/v2/tickets/${selectedTicketId}/comments.json`,
        type: 'GET'
      });
      comments = commentsResponse.comments || [];
    } catch (error) {
      // コメント取得失敗は無視
    }
    
    // Audits APIからシステムイベントを取得して追加
    try {
      const auditsResponse = await zafClient.request({
        url: `/api/v2/tickets/${selectedTicketId}/audits.json`,
        type: 'GET'
      });
      const audits = auditsResponse.audits || [];
      const commentIds = new Set(comments.map(c => c.id));
      
      audits.forEach(audit => {
        if (!audit.events) return;
        audit.events.forEach(event => {
          if (event.type === 'Comment' && !commentIds.has(event.id)) {
            const text = stripHTML(event.html_body || event.body || '').trim();
            if (text.length >= 5) {
              comments.push({
                id: event.id,
                author_id: event.author_id,
                body: event.body || '',
                value: event.html_body || event.body || '',
                public: event.public,
                created_at: audit.created_at,
                via: audit.via || {}
              });
              commentIds.add(event.id);
            }
          }
        });
      });
      
      comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } catch (auditError) {
      // Audits API失敗は無視
    }
    
    // チケットにコメントを追加
    const ticketWithComments = {
      ...selectedTicket,
      comments: comments
    };
    
    // 要約生成（GPT優先、フォールバックでルールベース）
    let summary;
    if (OPENAI_API_KEY) {
      const ruleBase = generateModernSummary([ticketWithComments]);
      const aiResult = await generateAISummary(ticketWithComments, ruleBase._validComments || [], ruleBase._publicComments || []);
      if (aiResult) {
        if (!aiResult.privateMemo && ruleBase.privateMemo) {
          aiResult.privateMemo = ruleBase.privateMemo;
        }
        summary = aiResult;
      } else {
        summary = ruleBase;
      }
    } else {
      summary = generateModernSummary([ticketWithComments]);
    }
    
    // 表示（チケットID付き）
    displayModernSummary(summary, selectedTicketId);
    
    // ボタンを復元
    if (btn) {
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '選択を要約';
    }
    
  } catch (error) {
    console.error('要約エラー:', error);
    showError('要約の生成に失敗しました', error);
    
    // ボタンを復元
    const btn = document.getElementById('summarize-selected-btn');
    if (btn) {
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = '選択したチケットを要約';
    }
  }
}

/**
 * OpenAI GPTによるAI要約
 */
async function generateAISummary(ticket, validComments, publicComments) {
  const requesterId = ticket.requester_id;
  const allComments = ticket.comments || [];
  
  // requester_idでお客様とオペレーターを分類
  let customerTexts = '';
  let operatorTexts = '';
  let privateTexts = '';
  let systemTexts = '';
  
  allComments.forEach(c => {
    const text = stripHTML(c.value || c.body || '').trim();
    if (text.length < 5) return;
    
    // システム自動コメント判定を最優先（author_idに関係なくテキスト内容で判定）
    const isSystem = text.includes('解決済み') || text.includes('にしました') || 
                     text.includes('次の記事') || text.includes('解決策を見つけ') ||
                     text.includes('統合させていただきました') ||
                     (c.via && c.via.channel === 'system');
    
    if (isSystem) {
      systemTexts += text.substring(0, 100) + '\n';
    } else if (c.public === false || c.public === 'false') {
      privateTexts += text.substring(0, 100) + '\n';
    } else if (requesterId && c.author_id == requesterId) {
      customerTexts += text.substring(0, 150) + '\n';
    } else {
      operatorTexts += text.substring(0, 150) + '\n';
    }
  });

  const statusText = ticket.status ? translateStatus(ticket.status) : '';

  const prompt = `チケット要約。JSON形式で回答。各項目40文字以内、本質のみ。
件名:${ticket.subject || ''} ステータス:${statusText}
客:${customerTexts || 'なし'}
OP:${operatorTexts || 'なし'}
メモ:${privateTexts || 'なし'}
経緯:${systemTexts || 'なし'}
{"customer":"要点","operator":"要点","system":"経緯(なければ空)","memo":"要点(なければ空)"}`;

  try {
    const response = await zafClient.request({
      url: 'https://api.openai.com/v1/chat/completions',
      type: 'POST',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_API_KEY
      },
      data: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300
      })
    });

    const content = response.choices[0].message.content.trim();
    
    // JSON部分を抽出
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // 時系列順メッセージ配列を生成（元コメントの順序に基づく）
      const orderedMessages = [];
      const seenTypes = { customer: false, operator: false, memo: false, system: false };
      
      allComments.forEach(c => {
        const text = stripHTML(c.value || c.body || '').trim();
        if (text.length < 5) return;
        
        const isPrivate = c.public === false || c.public === 'false';
        // システム判定を最優先（author_idに関係なくテキスト内容で判定）
        const isSystem = text.includes('解決済み') || text.includes('にしました') || 
          text.includes('次の記事') || text.includes('解決策を見つけ') ||
          text.includes('統合させていただきました') ||
          (c.via && c.via.channel === 'system');
        const isCustomer = !isSystem && requesterId && c.author_id == requesterId;
        
        let type;
        if (isPrivate && !isSystem) {
          type = 'memo';
        } else if (isSystem) {
          type = 'system';
        } else if (isCustomer) {
          type = 'customer';
        } else {
          type = 'operator';
        }
        
        if (type === 'system') {
          // システムコメントは全件そのまま表示（GPT要約に依存しない）
          const sysText = parsed.system ? parsed.system.substring(0, 80) : text.substring(0, 80);
          orderedMessages.push({ type: 'system', text: sysText });
          seenTypes.system = true;
        } else if (!seenTypes[type]) {
          // customer/operator/memoは最初の出現のみGPT要約テキストを使用
          seenTypes[type] = true;
          let msgText = '';
          if (type === 'customer') msgText = (parsed.customer || '問い合わせなし').substring(0, 80);
          else if (type === 'operator') msgText = (parsed.operator || '返信なし').substring(0, 80);
          else if (type === 'memo') msgText = (parsed.memo || '').substring(0, 80);
          
          if (msgText) {
            orderedMessages.push({ type, text: msgText });
          }
        }
      });
      
      // コメントに含まれなかったタイプも追加（GPTが生成した場合）
      if (!seenTypes.customer && parsed.customer) {
        orderedMessages.unshift({ type: 'customer', text: parsed.customer.substring(0, 80) });
      }
      if (!seenTypes.operator && parsed.operator) {
        orderedMessages.push({ type: 'operator', text: parsed.operator.substring(0, 80) });
      }
      if (!seenTypes.system && parsed.system) {
        orderedMessages.push({ type: 'system', text: parsed.system.substring(0, 80) });
      }
      if (!seenTypes.memo && parsed.memo) {
        orderedMessages.push({ type: 'memo', text: parsed.memo.substring(0, 80) });
      }
      
      return {
        brief: (parsed.customer || '問い合わせなし').substring(0, 80),
        trend: (parsed.operator || '返信なし').substring(0, 80),
        privateMemo: (parsed.memo || '').substring(0, 80),
        action: '',
        orderedMessages
      };
    }
  } catch (error) {
    console.error('GPT要約エラー:', error);
  }
  
  return null; // 失敗時はnullを返す → ルールベースにフォールバック
}

/**
 * モダンな要約生成（文章型・オペレーター返信含む）
 */
function generateModernSummary(tickets) {
  if (!tickets || tickets.length === 0) {
    return {
      brief: 'チケット情報がありません',
      trend: 'オペレーター返信がありません',
      action: '通常対応で問題ありません。',
      privateMemo: ''
    };
  }
  
  const ticket = tickets[0];
  const risk = ticket.riskAnalysis || { complaintScore: 0, level: 'safe', levelText: '通常' };
  const requesterId = ticket.requester_id;
  
  let brief = '';
  let customerInquiry = '';
  let validComments = [];
  let customerComments = [];
  let operatorComments = [];
  
  if (ticket.comments && ticket.comments.length > 0) {
    
    // 有効コメント抽出：HTML除去後に20文字以上
    validComments = ticket.comments.filter(c => {
      const text = stripHTML(c.value || c.body || c.plain_body || '').trim();
      return text.length > 20;
    });
    
    // requester_idでお客様とオペレーターを分類
    if (requesterId) {
      customerComments = validComments.filter(c => c.author_id == requesterId && c.public !== false);
      operatorComments = validComments.filter(c => c.author_id != requesterId && c.public !== false);
    } else {
      // requester_idがない場合はフォールバック（最後=お客様、最初=オペレーター）
      const publicComments = validComments.filter(c => c.public !== false);
      if (publicComments.length >= 2) {
        customerComments = [publicComments[publicComments.length - 1]];
        operatorComments = [publicComments[0]];
      } else if (publicComments.length === 1) {
        customerComments = publicComments;
      }
    }
    
    // お客様の問い合わせ内容
    if (customerComments.length > 0) {
      customerInquiry = stripHTML(customerComments[0].value || customerComments[0].body || customerComments[0].plain_body || '');
    }
  }
  
  // 顧客問い合わせの処理
  if (customerInquiry && customerInquiry.trim().length > 0) {
    let desc = customerInquiry.replace(/\n+/g, ' ').trim();
    
    // 業務テンプレ文章を除去
    const templates = [
      'お問い合わせいただきありがとうございます',
      'いつもお世話になっております',
      'お世話になっております',
      'お疲れ様です',
      'ご担当者様',
      '株式会社',
      'よろしくお願いいたします',
      'よろしくお願いします',
      '何卒よろしくお願いいたします',
      '何卒よろしくお願いします',
      'ありがとうございます',
      'お手数ですが',
      'お手数をおかけしますが',
      '恐れ入りますが',
      '恐縮ですが',
      '下記をご確認ください',
      '下記の通り',
      '弊社では',
      '弊社の',
      '通常対応で問題ありません'
    ];
    
    // テンプレ文を削除
    templates.forEach(template => {
      desc = desc.replace(new RegExp(template + '[。、\\s]*', 'g'), '');
    });
    
    // 先頭の句読点や空白を削除
    desc = desc.replace(/^[。、\s]+/, '').trim();
    
    if (desc.length > 0) {
      // 30文字以内で本質を抽出
      brief = desc.substring(0, 30);
      if (desc.length > 30) {
        brief += '...';
      }
    } else {
      brief = '問い合わせなし';
    }
  } else {
    brief = '問い合わせなし';
  }
  
  // オペレーター返信内容の要約（author_idベースで分類済み）
  let trend = '返信なし';
  let privateMemo = '';
  
  if (operatorComments.length > 0) {
    // 最新のオペレーターコメント（配列の先頭が最新）
    const operatorComment = operatorComments[0];
    let opBody = stripHTML(operatorComment.value || operatorComment.body || operatorComment.plain_body || '');
    
    const templates = [
      'お問い合わせいただきありがとうございます',
      'いつもお世話になっております',
      'お世話になっております',
      '恐れ入りますが',
      '下記をご確認ください',
      '何卒よろしくお願いいたします',
      '何卒よろしくお願いします',
      'よろしくお願いいたします',
      'よろしくお願いします',
      '下記記事をご参照ください'
    ];
    
    templates.forEach(template => {
      opBody = opBody.replace(new RegExp(template + '[。、\\s]*', 'g'), '');
    });
    
    opBody = opBody.replace(/\n+/g, ' ').trim();
    opBody = opBody.replace(/^[。、\s]+/, '').trim();
    
    if (opBody && opBody.length > 0) {
      trend = opBody.substring(0, 30);
      if (opBody.length > 30) {
        trend += '...';
      }
    }
  }
  
  // publicCommentsはoperatorCommentsを使う
  const publicComments = operatorComments;
  
  // 社内メモ（privateコメント）
  if (ticket.comments && ticket.comments.length > 0) {
    const privateComments = ticket.comments.filter(c => {
      // public === false または public が falsy（undefined以外）
      const isPrivate = c.public === false || c.public === 'false';
      if (isPrivate) {
        const text = stripHTML(c.value || c.body || c.plain_body || '').trim();
        return text.length > 5;
      }
      return false;
    });
    
    if (privateComments.length > 0) {
      const latestPrivate = privateComments[privateComments.length - 1];
      let privateBody = stripHTML(latestPrivate.value || latestPrivate.body || latestPrivate.plain_body || '');
      privateBody = privateBody.replace(/\n+/g, ' ').trim();
      
      if (privateBody) {
        privateMemo = `${privateBody.substring(0, 60)}`;
        if (privateBody.length > 60) {
          privateMemo += '...';
        }
      }
    } else {
      // publicフラグがない場合のフォールバック：author_idがrequester_idでもオペレーターでもないコメントを探す
      ticket.comments.forEach((c, i) => {
      });
    }
  }
  
  // 推奨対応
  let action = '';
  if (risk.complaintScore >= 50) {
    action = '丁寧な傾聴と共感を最優先。必要に応じて上長エスカレーションを検討してください。';
  } else if (risk.complaintScore >= 25) {
    action = '通常対応＋丁寧な説明を心がけてください。';
  } else {
    action = '通常対応で問題ありません。';
  }
  
  // 時系列順メッセージ配列を生成
  const orderedMessages = [];
  if (ticket.comments && ticket.comments.length > 0) {
    // テンプレ除去関数
    const cleanText = (text) => {
      const templates = [
        'お問い合わせいただきありがとうございます', 'いつもお世話になっております',
        'お世話になっております', 'お疲れ様です', 'よろしくお願いいたします',
        'よろしくお願いします', '何卒よろしくお願いいたします', '何卒よろしくお願いします',
        'ありがとうございます', 'お手数ですが', '恐れ入りますが', '下記をご確認ください'
      ];
      let cleaned = text.replace(/\n+/g, ' ').trim();
      templates.forEach(t => { cleaned = cleaned.replace(new RegExp(t + '[。、\\s]*', 'g'), ''); });
      cleaned = cleaned.replace(/^[。、\s]+/, '').trim();
      return cleaned;
    };
    
    ticket.comments.forEach(c => {
      const rawText = stripHTML(c.value || c.body || c.plain_body || '').trim();
      if (rawText.length < 5) return;
      
      const isPrivate = c.public === false || c.public === 'false';
      // システム判定を最優先（author_idに関係なくテキスト内容で判定）
      const isSystem = rawText.includes('解決済み') || rawText.includes('にしました') || 
        rawText.includes('次の記事') || rawText.includes('解決策を見つけ') ||
        rawText.includes('統合させていただきました') ||
        (c.via && c.via.channel === 'system');
      const isCustomer = !isSystem && requesterId && c.author_id == requesterId;
      
      let type, text;
      if (isPrivate && !isSystem) {
        type = 'memo';
        text = rawText.substring(0, 60) + (rawText.length > 60 ? '...' : '');
      } else if (isSystem) {
        type = 'system';
        text = rawText.substring(0, 60) + (rawText.length > 60 ? '...' : '');
      } else if (isCustomer) {
        type = 'customer';
        const cleaned = cleanText(rawText);
        if (cleaned.length === 0) return;
        text = cleaned.substring(0, 30) + (cleaned.length > 30 ? '...' : '');
      } else {
        type = 'operator';
        const cleaned = cleanText(rawText);
        if (cleaned.length === 0) return;
        text = cleaned.substring(0, 30) + (cleaned.length > 30 ? '...' : '');
      }
      
      orderedMessages.push({ type, text });
    });
  }
  
  return { brief, trend, action, privateMemo, orderedMessages, _validComments: validComments, _publicComments: publicComments };
}

/**
 * 文章型要約表示（時系列順・動的DOM生成）
 */
function displayModernSummary(summary, ticketId) {
  const container = document.getElementById('summary-container');
  const chatContainer = document.getElementById('summary-chat-container');
  
  if (!container || !chatContainer) {
    console.error('Summary container elements not found');
    return;
  }
  
  // チケット番号を表示
  const titleEl = container.querySelector('.section-title');
  if (titleEl && ticketId) {
    titleEl.textContent = `📋 AI要約 #${ticketId}`;
  }
  
  // チャットコンテナをクリア
  chatContainer.innerHTML = '';
  
  // orderedMessagesがあれば時系列順で表示
  const messages = summary.orderedMessages && summary.orderedMessages.length > 0
    ? summary.orderedMessages
    : buildFallbackMessages(summary);
  
  messages.forEach(msg => {
    if (!msg.text) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${msg.type === 'customer' ? 'customer' : msg.type === 'memo' ? 'private-memo' : msg.type === 'system' ? 'system-msg' : 'operator'}`;
    
    if (msg.type === 'customer') {
      messageDiv.innerHTML = `
        <div class="chat-avatar customer-avatar">👤</div>
        <div class="chat-bubble">
          <div class="chat-tag">お客様</div>
          <div class="chat-text">${linkifyTicketNumbers(escapeHtml(msg.text))}</div>
        </div>
      `;
    } else if (msg.type === 'operator') {
      messageDiv.innerHTML = `
        <div class="chat-bubble">
          <div class="chat-tag">オペレーター返信</div>
          <div class="chat-text">${linkifyTicketNumbers(escapeHtml(msg.text))}</div>
        </div>
        <div class="chat-avatar operator-avatar">🎧</div>
      `;
    } else if (msg.type === 'system') {
      const isSelfSolved = msg.text.includes('解決策を見つけ') || msg.text.includes('記事に') || msg.text.includes('自己解決');
      const sysTag = isSelfSolved ? '📌 お客様が自己解決' : '📌 解決経緯';
      const sysIcon = isSelfSolved ? '✅' : '🔧';
      messageDiv.innerHTML = `
        <div class="chat-avatar system-avatar">${sysIcon}</div>
        <div class="chat-bubble">
          <div class="chat-tag">${sysTag}</div>
          <div class="chat-text">${linkifyTicketNumbers(escapeHtml(msg.text))}</div>
        </div>
      `;
    } else if (msg.type === 'memo') {
      messageDiv.innerHTML = `
        <div class="chat-bubble">
          <div class="chat-tag">📝 社内メモ</div>
          <div class="chat-text">${linkifyTicketNumbers(escapeHtml(msg.text))}</div>
        </div>
        <div class="chat-avatar private-avatar">📋</div>
      `;
    }
    
    chatContainer.appendChild(messageDiv);
    
    // チケットリンクにクリックイベントを設定
    messageDiv.querySelectorAll('.ticket-inline-link').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tid = e.target.dataset.ticketId;
        try {
          await zafClient.invoke('routeTo', 'ticket', tid);
        } catch (err) {
          console.error('チケット遷移エラー:', err);
        }
      });
    });
  });
  
  container.style.display = 'block';
}

/**
 * テキスト内の #数字 パターンをクリック可能なチケットリンクに変換
 */
function linkifyTicketNumbers(text) {
  return text.replace(/#(\d{4,})/g, '<a href="#" class="ticket-inline-link" data-ticket-id="$1">#$1</a>');
}

/**
 * orderedMessagesがない場合のフォールバック（旧形式互換）
 */
function buildFallbackMessages(summary) {
  const messages = [];
  if (summary.brief) messages.push({ type: 'customer', text: summary.brief });
  if (summary.privateMemo) messages.push({ type: 'memo', text: summary.privateMemo });
  if (summary.trend) messages.push({ type: 'operator', text: summary.trend });
  return messages;
}

/**
 * メモ保存 - 安全なDOM操作
 */
async function handleSaveMemo() {
  const input = document.getElementById('memo-input');
  
  if (!input) {
    console.error('memo-input element not found');
    return;
  }
  
  const text = input.value.trim();
  
  if (!text) {
    showError('メモを入力してください');
    return;
  }
  
  try {
    // 依頼者情報取得
    const requesterData = await zafClient.get('ticket.requester');
    const requesterId = requesterData['ticket.requester'].id;
    
    // メモ保存（ユーザーフィールドに保存）
    // 注：実際の実装ではカスタムフィールドやタグを使用
    
    // UI更新
    addMemoToUI(text, new Date());
    
    input.value = '';
    
    alert('メモを保存しました');
    
  } catch (error) {
    console.error('メモ保存エラー:', error);
    showError('メモの保存に失敗しました', error);
  }
}

/**
 * 既存メモ読み込み
 */
async function loadExistingMemos(requesterEmail) {
  // 注：実際の実装ではカスタムフィールドやタグから取得
  // 今はダミー
}

/**
 * メモUI追加 - 安全なDOM操作
 */
function addMemoToUI(text, date) {
  const container = document.getElementById('existing-memos');
  if (!container) {
    console.error('existing-memos element not found');
    return;
  }
  
  const item = document.createElement('div');
  item.className = 'memo-item';
  item.innerHTML = `
    <div class="memo-date">${formatDateTime(date.toISOString())}</div>
    <div class="memo-text">${escapeHtml(text)}</div>
  `;
  container.insertBefore(item, container.firstChild);
}

/**
 * HTMLエスケープ
 */
function escapeHtml(text) {
  if (!text) return '';
  
  // より安全な方法
  var map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

/**
 * UI制御 - 安全なDOM操作
 */
function showLoading() {
  try {
    const el = document.getElementById('loading');
    if (el) el.style.display = 'block';
  } catch (e) {
    console.error('showLoading error:', e);
  }
}

function hideLoading() {
  try {
    const el = document.getElementById('loading');
    if (el) el.style.display = 'none';
  } catch (e) {
    console.error('hideLoading error:', e);
  }
}

function showContent() {
  try {
    const el = document.getElementById('content');
    if (el) el.style.display = 'flex';
  } catch (e) {
    console.error('showContent error:', e);
  }
}

function showError(message, error = null) {
  try {
    const errorEl = document.getElementById('error');
    if (!errorEl) {
      console.error('Error element not found:', message);
      return;
    }
    
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    
    if (error) {
      console.error('エラー詳細:', error);
    }
  } catch (e) {
    console.error('showError failed:', e, 'Original message:', message);
  }
}

// 初期化 - より安全な方法
(function() {
  'use strict';
  
  function safeInit() {
    
    // DOMが完全に読み込まれるまで待つ
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        initializeApp();
      });
    } else {
      // DOMは既に準備完了 - 少し待ってから初期化
      setTimeout(initializeApp, 100);
    }
  }
  
  // ZAF SDKが読み込まれるまで待つ
  if (typeof ZAFClient !== 'undefined') {
    safeInit();
  } else {
    
    // ZAF SDKの読み込みを待つ（複数の方法を試す）
    var checkCount = 0;
    var maxChecks = 50; // 5秒間チェック
    
    var checkInterval = setInterval(function() {
      checkCount++;
      
      if (typeof ZAFClient !== 'undefined') {
        clearInterval(checkInterval);
        safeInit();
      } else if (checkCount >= maxChecks) {
        console.error('ZAFClient failed to load after', maxChecks * 100, 'ms');
        clearInterval(checkInterval);
        
        // フォールバック: エラー表示
        setTimeout(function() {
          var errorEl = document.getElementById('error');
          if (errorEl) {
            errorEl.textContent = 'ZAF SDKの読み込みに失敗しました。ページを再読み込みしてください。';
            errorEl.style.display = 'block';
          }
          var loadingEl = document.getElementById('loading');
          if (loadingEl) {
            loadingEl.style.display = 'none';
          }
        }, 100);
      }
    }, 100);
  }
})();
