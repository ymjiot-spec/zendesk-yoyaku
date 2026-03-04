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
    
    // 依頼者ID取得（メモ機能用）
    const reqData = await zafClient.get('ticket.requester');
    const requesterId = reqData['ticket.requester'] ? reqData['ticket.requester'].id : null;
    
    // チケット履歴取得
    const tickets = await fetchTicketHistory(requesterEmail);
    currentTickets = tickets;
    
    // 顧客リスク分析（キーワードベース＝初期表示）
    customerRiskData = analyzeCustomerRisk(tickets, requesterEmail);
    
    // UI表示
    renderCustomerRisk(customerRiskData);
    renderTicketList(tickets);
    await loadExistingMemos(requesterId);
    
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
      // デバッグ: コメント内容を確認
      alert('コメント数: ' + comments.length + '\n' + comments.map((c, i) => i + ': public=' + c.public + ', text=' + (c.body || c.plain_body || '').substring(0, 30)).join('\n'));
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
    
    // 要約生成
    let summary = generateModernSummary([currentTicket]);
    
    // GPTで各コメントを要約
    if (OPENAI_API_KEY && summary.orderedMessages && summary.orderedMessages.length > 0) {
      const statusText = currentTicket.status ? translateStatus(currentTicket.status) : '';
      summary.orderedMessages = await summarizeOrderedMessages(summary.orderedMessages, currentTicket.subject, statusText);
      // brief/trendも更新
      const fc = summary.orderedMessages.find(m => m.type === 'customer');
      const fo = summary.orderedMessages.find(m => m.type === 'operator');
      if (fc) summary.brief = fc.text;
      if (fo) summary.trend = fo.text;
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
    
    // 要約生成
    let summary = generateModernSummary([ticketWithComments]);
    
    // GPTで各コメントを要約
    if (OPENAI_API_KEY && summary.orderedMessages && summary.orderedMessages.length > 0) {
      const statusText = ticketWithComments.status ? translateStatus(ticketWithComments.status) : '';
      summary.orderedMessages = await summarizeOrderedMessages(summary.orderedMessages, ticketWithComments.subject, statusText);
      const fc = summary.orderedMessages.find(m => m.type === 'customer');
      const fo = summary.orderedMessages.find(m => m.type === 'operator');
      if (fc) summary.brief = fc.text;
      if (fo) summary.trend = fo.text;
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
 * OpenAI GPTによるorderedMessages要約
 * generateModernSummaryで作ったorderedMessagesの各テキストをGPTで要約する
 */
async function summarizeOrderedMessages(orderedMessages, subject, status) {
  // 要約対象（customer/operator/memo）を抽出
  const targets = [];
  orderedMessages.forEach((msg, i) => {
    if ((msg.type === 'customer' || msg.type === 'operator' || msg.type === 'memo') && msg.text && msg.text.length > 10) {
      const label = msg.type === 'customer' ? '客' : msg.type === 'operator' ? 'OP' : 'メモ';
      targets.push({ idx: i, label, text: msg.text });
    }
  });
  
  if (targets.length === 0) return orderedMessages;
  
  const lines = targets.map(t => `${t.idx}|${t.label}|${t.text.substring(0, 200)}`).join('\n');
  
  const prompt = `通信会社コールセンターのチケット。各コメントを40文字程度で要約（2行くらい）。挨拶・定型文・名前除去、用件の本質のみ。GB=通信量、ID=回線ID。JSON配列で回答。
件名:${subject || ''} ステータス:${status || ''}
${lines}
[{"i":番号,"s":"要約"}]`;

  try {
    const response = await zafClient.request({
      url: 'https://api.openai.com/v1/chat/completions',
      type: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY },
      data: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: Math.max(200, targets.length * 60)
      })
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const results = JSON.parse(jsonMatch[0]);
      const updated = [...orderedMessages];
      results.forEach(r => {
        if (r.i !== undefined && r.s && updated[r.i]) {
          updated[r.i] = { ...updated[r.i], text: r.s };
        }
      });
      return updated;
    }
  } catch (error) {
    console.error('GPTメッセージ要約エラー:', error);
  }
  
  return orderedMessages; // 失敗時はそのまま返す
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
      return text.length > 0;
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
  
  // コメントから顧客メッセージを抽出
  let foundFirstPublic = false;
  if (ticket.comments && ticket.comments.length > 0) {
    ticket.comments.forEach((c, idx) => {
      const rawText = stripHTML(c.value || c.body || c.plain_body || '').trim();
      if (rawText.length < 1) return;
      
      // publicフィールドの判定（undefined/nullはpublicとみなす）
      const isPrivate = c.public === false;
      const isMerge = rawText.includes('統合させていただきました');
      const isAutoMemo = rawText.includes('顧客メモ（自動投稿）');
      const isSelfSolved = rawText.includes('解決策を見つけ') || rawText.includes('記事に');
      const isSystemChannel = c.via && c.via.channel === 'system';
      const isSystem = !isMerge && !isAutoMemo && (rawText.includes('解決済み') || rawText.includes('にしました') || 
        rawText.includes('次の記事') || isSelfSolved || isSystemChannel);
      
      // author_idとrequester_idを数値に変換して比較
      const authorId = c.author_id ? Number(c.author_id) : 0;
      const reqId = requesterId ? Number(requesterId) : 0;
      
      // 最初のpublicコメントを顧客メッセージとして扱う
      const isFirstPublic = !isPrivate && !foundFirstPublic && !isAutoMemo && !isSystem && !isMerge;
      if (isFirstPublic) foundFirstPublic = true;
      
      const isCustomerAuthor = isFirstPublic || (reqId > 0 && authorId === reqId && !isPrivate);
      
      let type, text;
      if (isMerge) {
        type = 'memo';
        const ticketMatch = rawText.match(/#(\d{4,})/);
        text = ticketMatch ? `#${ticketMatch[1]} を統合` : 'チケット統合';
      } else if (isAutoMemo || (isPrivate && !isSystem)) {
        type = 'memo';
        text = rawText.substring(0, 60) + (rawText.length > 60 ? '...' : '');
      } else if (isSystem) {
        type = 'system';
        text = rawText.substring(0, 60) + (rawText.length > 60 ? '...' : '');
      } else if (isCustomerAuthor) {
        type = 'customer';
        const cleaned = cleanText(rawText);
        text = (cleaned.length > 0 ? cleaned : rawText).substring(0, 80);
        if (text.length === 0) text = rawText.substring(0, 80);
        if (rawText.length > 80) text += '...';
      } else {
        type = 'operator';
        const cleaned = cleanText(rawText);
        text = (cleaned.length > 0 ? cleaned : rawText).substring(0, 80);
        if (text.length === 0) text = rawText.substring(0, 80);
        if (rawText.length > 80) text += '...';
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
 * メモ保存 - Zendesk User notesに上書き保存
 */
async function handleSaveMemo() {
  const input = document.getElementById('memo-input');
  if (!input) return;
  
  const text = input.value.trim();
  
  try {
    const requesterData = await zafClient.get('ticket.requester');
    const requesterId = requesterData['ticket.requester'].id;
    
    // User APIで上書き保存
    await zafClient.request({
      url: `/api/v2/users/${requesterId}.json`,
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ user: { notes: text } })
    });
    
    // 保存成功フィードバック
    const btn = document.getElementById('save-memo-btn');
    if (btn) {
      const btnText = btn.querySelector('.btn-text');
      if (btnText) {
        btnText.textContent = '✓ 保存済み';
        setTimeout(() => { btnText.textContent = 'メモを保存'; }, 2000);
      }
    }
    
  } catch (error) {
    console.error('メモ保存エラー:', error);
    showError('メモの保存に失敗しました');
  }
}

/**
 * 既存メモ読み込み - Zendesk User notesからテキストエリアにセット + 自動社内メモ投稿
 */
async function loadExistingMemos(requesterId) {
  if (!requesterId) return;
  
  try {
    const userResponse = await zafClient.request({
      url: `/api/v2/users/${requesterId}.json`,
      type: 'GET'
    });
    const notes = userResponse.user.notes || '';
    
    // テキストエリアにセット
    const input = document.getElementById('memo-input');
    if (input && notes) {
      input.value = notes;
    }
    
    // 自動社内メモ投稿：メモがあれば現在のチケットに社内コメントとして追加（初回のみ）
    if (notes) {
      try {
        const ticketData = await zafClient.get('ticket.id');
        const ticketId = ticketData['ticket.id'];
        
        // 既に同じ内容の社内メモがないか確認（Audits APIで確実にチェック）
        let alreadyPosted = false;
        try {
          const auditsResponse = await zafClient.request({
            url: `/api/v2/tickets/${ticketId}/audits.json`,
            type: 'GET'
          });
          const audits = auditsResponse.audits || [];
          alreadyPosted = audits.some(audit => {
            if (!audit.events) return false;
            return audit.events.some(event => {
              if (event.type !== 'Comment') return false;
              const body = stripHTML(event.html_body || event.body || '');
              return body.includes('顧客メモ（自動投稿）');
            });
          });
        } catch (auditErr) {
          // Audits API失敗時はComments APIでフォールバック
          const commentsResponse = await zafClient.request({
            url: `/api/v2/tickets/${ticketId}/comments.json`,
            type: 'GET'
          });
          const existingComments = commentsResponse.comments || [];
          alreadyPosted = existingComments.some(c => {
            const body = stripHTML(c.body || c.value || '');
            return body.includes('顧客メモ（自動投稿）');
          });
        }
        
        if (!alreadyPosted) {
          await zafClient.request({
            url: `/api/v2/tickets/${ticketId}.json`,
            type: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({
              ticket: {
                comment: {
                  body: `⚡ 顧客メモ（自動投稿）\n${notes}`,
                  public: false
                }
              }
            })
          });
        }
      } catch (autoMemoError) {
        // 自動メモ投稿失敗は無視（チケットが終了済みの場合など）
      }
    }
    
  } catch (error) {
    console.error('メモ読み込みエラー:', error);
  }
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
