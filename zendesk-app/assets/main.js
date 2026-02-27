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

/**
 * HTMLタグを除去する関数
 */
function stripHTML(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

// クレーム判定キーワード辞書（強化版）
const COMPLAINT_KEYWORDS = {
  high: [
    '返金', '詐欺', '訴える', '弁護士', '消費者センター', 
    '許せない', '最悪', '二度と', 'ふざけるな', '責任者',
    '怒り', '対応しない', '解約', '騙された', '信じられない',
    '謝罪', '賠償', '訴訟', 'クレーム', '激怒'
  ],
  medium: [
    '不満', '困る', '納得できない', '説明不足', '対応悪い', 
    '時間かかる', '遅い', '不誠実', '不親切', '改善',
    '問題', 'トラブル', '困った', '心配'
  ],
  low: [
    '確認', '問い合わせ', '教えて', '質問', 'わからない',
    '知りたい', '聞きたい', '相談'
  ]
};

/**
 * アプリ初期化
 */
async function initializeApp() {
  try {
    // ZAFClientがグローバルに存在するか確認
    if (typeof ZAFClient === 'undefined') {
      throw new Error('ZAFClient is not loaded');
    }
    
    console.log('Initializing ZAF Client...');
    zafClient = ZAFClient.init();
    
    // ZAF初期化完了を待つ
    console.log('Waiting for ZAF to be ready...');
    await zafClient.get('currentUser');
    
    console.log('ZAF initialized successfully');
    
    // アプリ設定を取得
    try {
      const settings = await zafClient.metadata();
      if (settings && settings.settings) {
        API_ENDPOINT = settings.settings.api_endpoint || '';
        API_KEY = settings.settings.api_key || '';
        if (API_ENDPOINT) {
          console.log('API設定を読み込みました');
        } else {
          console.warn('API設定が見つかりません。要約機能は利用できません。');
        }
      } else {
        console.warn('設定情報が取得できませんでした');
      }
    } catch (settingsError) {
      console.warn('設定の取得に失敗しました:', settingsError);
    }
    
    // Zendesk Framework用のリサイズ
    try {
      await zafClient.invoke('resize', { width: '100%', height: '600px' });
      console.log('App resized successfully');
    } catch (resizeError) {
      console.warn('Resize failed:', resizeError);
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
  // 現在のチケットを要約ボタン
  const currentTicketBtn = document.getElementById('current-ticket-btn');
  if (currentTicketBtn) {
    currentTicketBtn.addEventListener('click', handleCurrentTicketSummary);
  } else {
    console.warn('current-ticket-btn not found');
  }
  
  // 選択したチケットを要約ボタン
  const selectedBtn = document.getElementById('summarize-selected-btn');
  if (selectedBtn) {
    selectedBtn.addEventListener('click', handleSelectedTicketSummary);
  } else {
    console.warn('summarize-selected-btn not found');
  }
  
  // このチケットを表示ボタン
  const showTicketBtn = document.getElementById('show-current-ticket-btn');
  if (showTicketBtn) {
    showTicketBtn.addEventListener('click', handleShowCurrentTicket);
  } else {
    console.warn('show-current-ticket-btn not found');
  }
  
  // 要約クローズ
  const closeBtn = document.getElementById('close-summary');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const container = document.getElementById('summary-container');
      if (container) container.style.display = 'none';
    });
  } else {
    console.warn('close-summary not found');
  }
  
  // メモ保存
  const saveBtn = document.getElementById('save-memo-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleSaveMemo);
  } else {
    console.warn('save-memo-btn not found');
  }
  
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
      console.log('チケット表示:', targetTicketId);
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
    
    // 顧客リスク分析
    customerRiskData = analyzeCustomerRisk(tickets, requesterEmail);
    
    // UI表示
    renderCustomerRisk(customerRiskData);
    renderTicketList(tickets);
    await loadExistingMemos(requesterEmail);
    
    hideLoading();
    showContent();
    
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
      console.log('キャッシュから取得');
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
 * チケットリスク分析（強化版）
 */
function analyzeTicketRisk(ticket) {
  const text = `${ticket.subject || ''} ${ticket.description || ''}`.toLowerCase();
  
  let complaintScore = 0;
  let matchedKeywords = [];
  
  // 高リスクキーワードマッチング（各30点）
  COMPLAINT_KEYWORDS.high.forEach(keyword => {
    if (text.includes(keyword)) {
      complaintScore += 30;
      matchedKeywords.push(keyword);
    }
  });
  
  // 中リスクキーワードマッチング（各15点）
  COMPLAINT_KEYWORDS.medium.forEach(keyword => {
    if (text.includes(keyword)) {
      complaintScore += 15;
      if (matchedKeywords.length === 0) matchedKeywords.push(keyword);
    }
  });
  
  // 低リスクキーワードマッチング（各5点）
  COMPLAINT_KEYWORDS.low.forEach(keyword => {
    if (text.includes(keyword)) {
      complaintScore += 5;
      if (matchedKeywords.length === 0) matchedKeywords.push(keyword);
    }
  });
  
  // スコア正規化（最大100）
  complaintScore = Math.min(100, complaintScore);
  
  // レベル判定（閾値再設計）
  let level = 'safe';
  let levelText = '通常';
  let icon = '🟢';
  
  if (complaintScore >= 50) {
    level = 'danger';
    levelText = 'クレーム';
    icon = '🔥';
  } else if (complaintScore >= 25) {
    level = 'warn';
    levelText = '注意';
    icon = '⚠';
  }
  
  const reason = matchedKeywords.length > 0 ? matchedKeywords[0] : '通常';
  
  return {
    complaintScore,
    level,
    levelText,
    icon,
    reason,
    toxicity: complaintScore,
    repeatRisk: 0,
    refundPressure: text.includes('返金') ? 80 : 0
  };
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
  
  // 最終スコア計算
  let finalScore = avgScore;
  if (recentComplaints >= 2) finalScore += 20;
  if (complaintCount >= 3) finalScore += 15;
  
  finalScore = Math.min(100, finalScore);
  
  // レベル判定
  let level = 'normal';
  let levelText = '通常';
  if (finalScore >= 60) {
    level = 'danger';
    levelText = '要注意';
  } else if (finalScore >= 30) {
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
  
  console.log('renderTicketList called with', tickets ? tickets.length : 0, 'tickets');
  
  if (!tickets || tickets.length === 0) {
    listEl.style.display = 'none';
    noTicketsEl.style.display = 'block';
    console.log('No tickets to display');
    return;
  }
  
  listEl.innerHTML = '';
  noTicketsEl.style.display = 'none';
  
  tickets.forEach(ticket => {
    const item = createTicketItem(ticket);
    listEl.appendChild(item);
  });
  
  console.log('Rendered', tickets.length, 'ticket items');
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
    const summary = truncateText(ticket.subject || '問い合わせ', 40);
    const status = translateStatus(ticket.status);
    const ticketNumber = `#${ticket.id}`;
    
    div.dataset.risk = risk.level;
    
    // 選択チェック（左側）
    const checkDiv = document.createElement('div');
    checkDiv.className = 'ticket-select-check';
    
    // チケットコンテンツ
    const contentDiv = document.createElement('div');
    contentDiv.className = 'ticket-content';
    
    contentDiv.innerHTML = `
      <div class="ticket-header">
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
          console.log('チケット表示:', ticketId);
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
    'open': '対応中',
    'pending': '保留',
    'solved': '解決済',
    'closed': 'クローズ'
  };
  return map[status] || status;
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
      'ticket.comments'
    ]);
    
    const ticketId = ticketData['ticket.id'];
    
    console.log('チケットデータ取得:', ticketData);
    
    // チケットのコメント（やり取り）を取得 - 常にAPIから取得（publicフラグが確実に含まれる）
    let comments = [];
    try {
      const commentsResponse = await zafClient.request({
        url: `/api/v2/tickets/${ticketId}/comments.json`,
        type: 'GET'
      });
      comments = commentsResponse.comments || [];
      console.log('APIからコメント取得:', comments.length, '件');
    } catch (error) {
      console.warn('コメントAPI取得エラー、ZAFフォールバック:', error);
      if (ticketData['ticket.comments']) {
        comments = ticketData['ticket.comments'];
      }
    }
    
    console.log('現在チケット#' + ticketId + 'の最終コメント数:', comments.length, '件');
    console.log('コメント詳細:', JSON.stringify(comments, null, 2));
    
    const currentTicket = {
      id: ticketId,
      subject: ticketData['ticket.subject'],
      description: ticketData['ticket.description'],
      status: ticketData['ticket.status'],
      created_at: ticketData['ticket.createdAt'],
      comments: comments,
      riskAnalysis: analyzeTicketRisk({
        subject: ticketData['ticket.subject'],
        description: ticketData['ticket.description']
      })
    };
    
    // 要約生成
    const summary = generateModernSummary([currentTicket]);
    
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
      console.log('選択チケットのコメント取得:', comments.length, '件');
    } catch (error) {
      console.warn('コメント取得エラー:', error);
    }
    
    // チケットにコメントを追加
    const ticketWithComments = {
      ...selectedTicket,
      comments: comments
    };
    
    // 要約生成（ルールベース）
    const summary = generateModernSummary([ticketWithComments]);
    
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
  
  console.log('要約生成 - チケット:', ticket.id, 'コメント数:', ticket.comments ? ticket.comments.length : 0);
  
  // 超要約（顧客からの最初の問い合わせ）
  let brief = '';
  
  // 顧客の問い合わせ内容
  // 有効なコメントを抽出（publicフラグ不使用）
  let customerInquiry = '';
  let validComments = [];
  
  if (ticket.comments && ticket.comments.length > 0) {
    console.log('=== コメント解析開始 ===');
    console.log('総コメント:', ticket.comments.length, '件');
    
    // 全コメントの詳細をログ出力（author情報含む）
    ticket.comments.forEach((c, i) => {
      const text = stripHTML(c.value || c.body || c.plain_body || '').trim();
      console.log(`RAWコメント[${i}]:`, {
        author_id: c.author_id,
        public: c.public,
        text_preview: text.substring(0, 80),
        text_length: text.length
      });
    });
    
    // 有効コメント抽出：HTML除去後に20文字以上
    validComments = ticket.comments.filter(c => {
      const text = stripHTML(c.value || c.body || c.plain_body || '').trim();
      return text.length > 20;
    });
    
    console.log('有効コメント数:', validComments.length, '件');
    
    validComments.forEach((c, i) => {
      const text = stripHTML(c.value || c.body || c.plain_body || '');
      console.log(`  有効コメント[${i}]:`, text.substring(0, 80));
    });
    
    // 最後の有効コメントを顧客問い合わせとする（コメントは新しい順なので最後が最初の問い合わせ）
    if (validComments.length > 0) {
      customerInquiry = stripHTML(validComments[validComments.length - 1].value || validComments[validComments.length - 1].body || validComments[validComments.length - 1].plain_body || '');
    }
  }
  
  // 顧客問い合わせの処理
  if (customerInquiry && customerInquiry.trim().length > 0) {
    let desc = customerInquiry.replace(/\n+/g, ' ').trim();
    
    console.log('顧客問い合わせ（処理前）:', desc.substring(0, 100));
    
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
    
    console.log('顧客問い合わせ（処理後）:', desc.substring(0, 100));
    
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
  
  // オペレーター返信内容の要約（publicコメントのみ、社内メモ除外）
  let trend = '返信なし';
  let privateMemo = '';
  
  console.log('=== オペレーター返信抽出開始 ===');
  
  // publicコメントのみ抽出（社内メモを除外）
  const publicComments = validComments.filter(c => c.public !== false);
  console.log('公開コメント数:', publicComments.length);
  
  // publicコメントが2件以上あれば、最初（最新）がオペレーター返信
  if (publicComments.length >= 2) {
    const operatorComment = publicComments[0];
    let opBody = stripHTML(operatorComment.value || operatorComment.body || operatorComment.plain_body || '');
    
    console.log('オペレーター返信（元データ）:', opBody.substring(0, 100));
    
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
    
    console.log('オペレーター返信（処理後）:', opBody.substring(0, 100));
    
    if (opBody && opBody.length > 0) {
      trend = opBody.substring(0, 30);
      if (opBody.length > 30) {
        trend += '...';
      }
    }
  } else {
    console.log('オペレーター返信なし（公開コメント不足）');
  }
  
  // 社内メモ（privateコメント）
  if (ticket.comments && ticket.comments.length > 0) {
    const privateComments = ticket.comments.filter(c => {
      if (c.public === false) {
        const text = stripHTML(c.value || c.body || c.plain_body || '').trim();
        return text.length > 20;
      }
      return false;
    });
    
    if (privateComments.length > 0) {
      const latestPrivate = privateComments[privateComments.length - 1];
      let privateBody = stripHTML(latestPrivate.value || latestPrivate.body || latestPrivate.plain_body || '');
      privateBody = privateBody.replace(/\n+/g, ' ').trim();
      
      if (privateBody) {
        privateMemo = `${privateBody.substring(0, 30)}`;
        if (privateBody.length > 30) {
          privateMemo += '...';
        }
      }
    }
  }
  
  console.log('生成されたオペレーター返信:', trend);
  console.log('生成された社内メモ:', privateMemo);
  
  // 推奨対応
  let action = '';
  if (risk.complaintScore >= 50) {
    action = '丁寧な傾聴と共感を最優先。必要に応じて上長エスカレーションを検討してください。';
  } else if (risk.complaintScore >= 25) {
    action = '通常対応＋丁寧な説明を心がけてください。';
  } else {
    action = '通常対応で問題ありません。';
  }
  
  return { brief, trend, action, privateMemo };
}

/**
 * 文章型要約表示
 */
function displayModernSummary(summary, ticketId) {
  const container = document.getElementById('summary-container');
  const briefText = document.getElementById('summary-brief-text');
  const trendText = document.getElementById('summary-trend-text');
  const privateMemoSection = document.getElementById('private-memo-section');
  const privateMemoText = document.getElementById('summary-private-memo-text');
  
  if (!container || !briefText || !trendText) {
    console.error('Summary container elements not found');
    return;
  }
  
  // チケット番号を表示
  const titleEl = container.querySelector('.section-title');
  if (titleEl && ticketId) {
    titleEl.textContent = `📋 AI要約 #${ticketId}`;
  }
  
  briefText.textContent = summary.brief;
  trendText.textContent = summary.trend;
  
  // 社内メモがあれば表示
  if (summary.privateMemo && privateMemoSection && privateMemoText) {
    privateMemoText.textContent = summary.privateMemo;
    privateMemoSection.style.display = 'flex';
  } else if (privateMemoSection) {
    privateMemoSection.style.display = 'none';
  }
  
  container.style.display = 'block';
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
    console.log('メモ保存:', { requesterId, text, date: new Date().toISOString() });
    
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
  console.log('既存メモ読み込み:', requesterEmail);
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
  
  console.log('Script loaded, document.readyState:', document.readyState);
  console.log('ZAFClient available:', typeof ZAFClient !== 'undefined');
  
  function safeInit() {
    console.log('safeInit called');
    
    // DOMが完全に読み込まれるまで待つ
    if (document.readyState === 'loading') {
      console.log('Waiting for DOMContentLoaded...');
      document.addEventListener('DOMContentLoaded', function() {
        console.log('DOMContentLoaded fired');
        initializeApp();
      });
    } else {
      console.log('DOM already ready, initializing immediately');
      // DOMは既に準備完了 - 少し待ってから初期化
      setTimeout(initializeApp, 100);
    }
  }
  
  // ZAF SDKが読み込まれるまで待つ
  if (typeof ZAFClient !== 'undefined') {
    console.log('ZAFClient already available');
    safeInit();
  } else {
    console.log('Waiting for ZAFClient to load...');
    
    // ZAF SDKの読み込みを待つ（複数の方法を試す）
    var checkCount = 0;
    var maxChecks = 50; // 5秒間チェック
    
    var checkInterval = setInterval(function() {
      checkCount++;
      
      if (typeof ZAFClient !== 'undefined') {
        console.log('ZAFClient loaded after', checkCount * 100, 'ms');
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
    
    // window.loadイベントもリッスン
    window.addEventListener('load', function() {
      console.log('window.load fired, ZAFClient available:', typeof ZAFClient !== 'undefined');
    });
  }
})();
